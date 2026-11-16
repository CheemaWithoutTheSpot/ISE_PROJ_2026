import { randomUUID } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileTypeFromBuffer } from 'file-type';
import JSZip from 'jszip';
import { query, withTransaction } from '../config/database.js';
import { config } from '../config/env.js';
import { AppError } from '../errors.js';

const uploadRoot = path.resolve(config.uploadDir);
const typeRules = {
  '.pdf': { mime: 'application/pdf', kind: 'pdf' },
  '.doc': { mime: 'application/msword', kind: 'doc' },
  '.docx': { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', kind: 'docx' },
};

export async function acceptSubmission(user, assignmentId, file) {
  if (!file) throw new AppError(400, 'Choose a PDF, DOC or DOCX file.', 'file_required');
  if (!file.size || file.size > 10 * 1024 * 1024) throw new AppError(400, 'Files must be between 1 byte and 10 MB.', 'invalid_file_size');
  const extension = path.extname(file.originalname).toLowerCase();
  const rule = typeRules[extension];
  if (!rule || file.mimetype !== rule.mime || !(await matchesSignature(rule.kind, file.buffer))) {
    throw new AppError(400, 'The file extension, MIME type and file signature must match a supported document.', 'invalid_file_type');
  }

  const safeName = path.basename(file.originalname).replace(/[\r\n"<>]/g, '_').slice(0, 180);
  const storageKey = `${randomUUID()}${extension}`;
  await mkdir(uploadRoot, { recursive: true });
  const absolutePath = path.join(uploadRoot, storageKey);
  await writeFile(absolutePath, file.buffer, { flag: 'wx', mode: 0o600 });

  try {
    return await withTransaction(async (client) => {
      const { rows } = await client.query(
        `SELECT a.id, a.due_at, a.classroom_id, (a.due_at < now()) AS deadline_passed FROM assignments a
         WHERE a.id = $1 AND EXISTS (
           SELECT 1 FROM classroom_memberships cm WHERE cm.classroom_id = a.classroom_id AND cm.student_id = $2
         ) FOR UPDATE`, [assignmentId, user.id],
      );
      if (!rows.length) throw new AppError(404, 'Assignment not found for your classrooms.', 'not_found');
      if (rows[0].deadline_passed) throw new AppError(409, 'The deadline has passed. Late submissions are not accepted.', 'deadline_passed');
      const latest = await client.query('SELECT COALESCE(max(version), 0)::int AS version FROM submissions WHERE assignment_id = $1 AND student_id = $2', [assignmentId, user.id]);
      const inserted = await client.query(
        `INSERT INTO submissions (assignment_id, student_id, version, original_filename, storage_key, mime_type, file_size)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, assignment_id, version, original_filename, file_size, submitted_at`,
        [assignmentId, user.id, latest.rows[0].version + 1, safeName, storageKey, rule.mime, file.size],
      );
      const submission = inserted.rows[0];
      await client.query('UPDATE assignments SET rubric_locked = true, updated_at = now() WHERE id = $1', [assignmentId]);
      const previousFinal = await client.query('SELECT id FROM final_results WHERE assignment_id = $1 AND student_id = $2', [assignmentId, user.id]);
      for (const result of previousFinal.rows) await client.query('DELETE FROM final_result_criteria WHERE final_result_id = $1', [result.id]);
      await client.query('DELETE FROM final_results WHERE assignment_id = $1 AND student_id = $2', [assignmentId, user.id]);
      await client.query(
        `UPDATE processing_jobs SET status = 'obsolete', locked_until = NULL, completed_at = now()
         WHERE submission_id IN (SELECT id FROM submissions WHERE assignment_id = $1 AND student_id = $2 AND id <> $3)
           AND status IN ('pending', 'processing')`, [assignmentId, user.id, submission.id],
      );
      return submission;
    });
  } catch (error) {
    await unlink(absolutePath).catch((cleanupError) => console.error('Unable to remove orphaned upload:', cleanupError.message));
    throw error;
  }
}

export async function getAuthorizedSubmission(user, submissionId) {
  const { rows } = await query(
    `SELECT s.*, a.teacher_id, a.title AS assignment_title, c.name AS classroom_name,
      u.full_name AS student_name, u.email AS student_email,
      (s.student_id = $2) AS is_owner
     FROM submissions s JOIN assignments a ON a.id = s.assignment_id
     JOIN classrooms c ON c.id = a.classroom_id JOIN users u ON u.id = s.student_id
     WHERE s.id = $1 AND (a.teacher_id = $2 OR s.student_id = $2)`, [submissionId, user.id],
  );
  const submission = rows[0];
  if (!submission || (user.role === 'student' && !submission.is_owner) || (user.role === 'teacher' && submission.teacher_id !== user.id)) {
    throw new AppError(404, 'Submission not found.', 'not_found');
  }
  return submission;
}

export async function getStoredFile(submission) {
  const absolutePath = path.resolve(uploadRoot, submission.storage_key);
  if (!absolutePath.startsWith(`${uploadRoot}${path.sep}`)) throw new AppError(404, 'Submission file not found.', 'not_found');
  return absolutePath;
}

export async function createReceipt(submission) {
  const submittedAt = new Date(submission.submitted_at).toISOString();
  return `<!doctype html><html lang="en"><meta charset="utf-8"><title>Submission receipt</title><body><h1>Submission receipt</h1><dl><dt>Assignment</dt><dd>${escapeHtml(submission.assignment_title)}</dd><dt>Classroom</dt><dd>${escapeHtml(submission.classroom_name)}</dd><dt>Filename</dt><dd>${escapeHtml(submission.original_filename)}</dd><dt>Submitted</dt><dd>${escapeHtml(submittedAt)}</dd><dt>Status</dt><dd>Accepted</dd></dl></body></html>`;
}

async function matchesSignature(kind, buffer) {
  if (kind === 'doc') return buffer.subarray(0, 8).equals(Buffer.from('D0CF11E0A1B11AE1', 'hex'));
  const detected = await fileTypeFromBuffer(buffer);
  if (kind === 'pdf') return detected?.ext === 'pdf' && buffer.subarray(0, 5).toString() === '%PDF-';
  if (kind === 'docx') {
    const zipSignature = buffer[0] === 0x50 && buffer[1] === 0x4b && [0x03, 0x05, 0x07].includes(buffer[2]) && [0x04, 0x06, 0x08].includes(buffer[3]);
    if (!zipSignature || !['zip', 'docx'].includes(detected?.ext)) return false;
    try {
      const archive = await JSZip.loadAsync(buffer, { checkCRC32: false, createFolders: false });
      return Boolean(archive.file('[Content_Types].xml') && archive.file('word/document.xml'));
    } catch {
      return false;
    }
  }
  return false;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}