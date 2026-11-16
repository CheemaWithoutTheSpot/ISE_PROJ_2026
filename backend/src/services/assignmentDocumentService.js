import { randomUUID } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileTypeFromBuffer } from 'file-type';
import { query, withTransaction } from '../config/database.js';
import { config } from '../config/env.js';
import { AppError } from '../errors.js';
import { extractText } from './documentExtractor.js';

const uploadRoot = path.resolve(config.uploadDir);

export async function saveAssignmentQuestionPdf(user, assignmentId, file) {
  if (!file) throw new AppError(400, 'Choose a PDF containing the assignment questions.', 'file_required');
  if (!file.size || file.size > 10 * 1024 * 1024) throw new AppError(400, 'The question PDF must be between 1 byte and 10 MB.', 'invalid_file_size');
  if (path.extname(file.originalname).toLowerCase() !== '.pdf' || file.mimetype !== 'application/pdf' ||
      file.buffer.subarray(0, 5).toString() !== '%PDF-' || (await fileTypeFromBuffer(file.buffer))?.ext !== 'pdf') {
    throw new AppError(400, 'Upload a valid PDF question sheet.', 'invalid_file_type');
  }

  const owned = await query('SELECT rubric_locked FROM assignments WHERE id = $1 AND teacher_id = $2', [assignmentId, user.id]);
  if (!owned.rowCount) throw new AppError(404, 'Assignment not found.', 'not_found');
  const existingSubmissions = await query('SELECT 1 FROM submissions WHERE assignment_id = $1 LIMIT 1', [assignmentId]);
  if (owned.rows[0].rubric_locked || existingSubmissions.rowCount) {
    throw new AppError(409, 'Question PDFs cannot be changed after submissions begin.', 'assignment_locked');
  }
  const extractedText = await extractText(file.buffer, 'application/pdf');
  const storageKey = `${randomUUID()}.pdf`;
  const safeName = path.basename(file.originalname).replace(/[\r\n"<>]/g, '_').slice(0, 180);
  await mkdir(uploadRoot, { recursive: true });
  const absolutePath = path.join(uploadRoot, storageKey);
  await writeFile(absolutePath, file.buffer, { flag: 'wx', mode: 0o600 });

  try {
    const saved = await withTransaction(async (client) => {
      const assignment = await client.query(
        `SELECT id, rubric_locked FROM assignments WHERE id = $1 AND teacher_id = $2 FOR UPDATE`, [assignmentId, user.id],
      );
      if (!assignment.rowCount) throw new AppError(404, 'Assignment not found.', 'not_found');
      const submissions = await client.query('SELECT 1 FROM submissions WHERE assignment_id = $1 LIMIT 1', [assignmentId]);
      if (assignment.rows[0].rubric_locked || submissions.rowCount) {
        throw new AppError(409, 'Question PDFs cannot be changed after submissions begin.', 'assignment_locked');
      }
      const previous = await client.query('SELECT storage_key FROM assignment_source_documents WHERE assignment_id = $1 FOR UPDATE', [assignmentId]);
      const document = await client.query(
        `INSERT INTO assignment_source_documents (assignment_id, original_filename, storage_key, mime_type, file_size, extracted_text)
         VALUES ($1, $2, $3, 'application/pdf', $4, $5)
         ON CONFLICT (assignment_id) DO UPDATE SET original_filename = EXCLUDED.original_filename,
           storage_key = EXCLUDED.storage_key, mime_type = EXCLUDED.mime_type,
           file_size = EXCLUDED.file_size, extracted_text = EXCLUDED.extracted_text, uploaded_at = now()
         RETURNING id, assignment_id, original_filename, uploaded_at`,
        [assignmentId, safeName, storageKey, file.size, extractedText],
      );
      return { document: document.rows[0], previousKey: previous.rows[0]?.storage_key };
    });
    if (saved.previousKey && saved.previousKey !== storageKey) {
      await unlink(path.join(uploadRoot, saved.previousKey)).catch((error) => console.error('Unable to remove replaced question PDF:', error.message));
    }
    return { ...saved.document, extractedCharacterCount: extractedText.length };
  } catch (error) {
    await unlink(absolutePath).catch((cleanupError) => console.error('Unable to remove orphaned question PDF:', cleanupError.message));
    throw error;
  }
}

export async function getQuestionText(assignmentId) {
  const { rows } = await query('SELECT extracted_text FROM assignment_source_documents WHERE assignment_id = $1', [assignmentId]);
  return rows[0]?.extracted_text || '';
}