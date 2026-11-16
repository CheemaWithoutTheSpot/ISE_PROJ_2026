import { pool, query, withTransaction } from '../config/database.js';
import { config } from '../config/env.js';
import { extractText } from '../services/documentExtractor.js';
import { evaluateWithGemini } from '../services/ai/geminiAdapter.js';

let stopped = false;

export function startEvaluationWorker() {
  stopped = false;
  const loops = Array.from({ length: config.workerConcurrency }, () => workerLoop());
  return () => { stopped = true; return Promise.all(loops); };
}

async function workerLoop() {
  while (!stopped) {
    try {
      await queueDueSubmissions();
      await markExpiredExhaustedJobs();
      const job = await claimJob();
      if (job) await evaluateJob(job);
      else await sleep(900);
    } catch (error) {
      console.error('Evaluation worker cycle failed:', error.message);
      await sleep(1500);
    }
  }
}

export async function queueDueSubmissions() {
  await query(
    `INSERT INTO processing_jobs (submission_id)
     SELECT latest.id FROM (
       SELECT DISTINCT ON (s.assignment_id, s.student_id) s.id
       FROM submissions s JOIN assignments a ON a.id = s.assignment_id
       ORDER BY s.assignment_id, s.student_id, s.submitted_at DESC, s.version DESC
     ) latest
     LEFT JOIN evaluations e ON e.submission_id = latest.id
     WHERE e.id IS NULL
     ON CONFLICT DO NOTHING`,
  );
}

async function markExpiredExhaustedJobs() {
  const { rows } = await query(
    `UPDATE processing_jobs SET status = 'manual', locked_until = NULL,
       last_error = COALESCE(last_error, 'Processing lease expired after maximum attempts.'), completed_at = now()
     WHERE status = 'processing' AND locked_until < now() AND attempt_count >= 3
     RETURNING submission_id`,
  );
  for (const row of rows) await saveManualEvaluation(row.submission_id);
}

async function claimJob() {
  const { rows } = await query(
    `WITH candidate AS (
       SELECT id FROM processing_jobs
      WHERE (status = 'pending' AND attempt_count < 3 AND (locked_until IS NULL OR locked_until < now()))
          OR (status = 'processing' AND locked_until < now() AND attempt_count < 3)
       ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1
     )
     UPDATE processing_jobs j SET status = 'processing', attempt_count = j.attempt_count + 1,
       locked_until = now() + interval '3 minutes', last_error = NULL
     FROM candidate WHERE j.id = candidate.id
    RETURNING j.id, j.submission_id, j.attempt_count`,
  );
  if (!rows.length) return null;
  const { rows: details } = await query(
    `SELECT s.id AS submission_id, s.storage_key, s.mime_type, s.assignment_id, s.student_id,
       a.teacher_id, a.title AS assignment_title, a.instructions,
       COALESCE(q.extracted_text, '') AS question_text
     FROM submissions s JOIN assignments a ON a.id = s.assignment_id
     LEFT JOIN assignment_source_documents q ON q.assignment_id = a.id
     WHERE s.id = $1`, [rows[0].submission_id],
  );
  return { ...rows[0], ...details[0] };
}

async function evaluateJob(job) {
  try {
    const file = await readPrivateFile(job.storage_key);
    const text = await extractText(file, job.mime_type);
    const rubricResult = await query(
      'SELECT id, name, description, max_marks FROM assignment_criteria WHERE assignment_id = $1 ORDER BY position', [job.assignment_id],
    );
    if (!rubricResult.rowCount) throw new Error('Assignment rubric is empty.');
    const criteria = rubricResult.rows;
    const evaluation = await evaluateWithGemini({ text, questionText: job.question_text, instructions: job.instructions, criteria });
    await saveCompletedEvaluation(job, evaluation);
  } catch (error) {
    const retryable = ['ai_temporary_failure'].includes(error.code);
    if (retryable && job.attempt_count < 3) {
      const delaySeconds = 5 * (2 ** (job.attempt_count - 1));
      await query(
        `UPDATE processing_jobs SET status = 'pending', locked_until = now() + ($1 * interval '1 second'), last_error = $2
         WHERE id = $3 AND status = 'processing'`, [delaySeconds, safeError(error), job.id],
      );
      return;
    }
    await saveManualEvaluation(job.submission_id, job.id, safeError(error));
  }
}

async function saveCompletedEvaluation(job, suggestions) {
  await withTransaction(async (client) => {
    if (!(await isSelected(client, job))) {
      await client.query("UPDATE processing_jobs SET status = 'obsolete', locked_until = NULL, completed_at = now() WHERE id = $1", [job.id]);
      return;
    }
    const inserted = await client.query(
      `INSERT INTO evaluations (submission_id, status, provider) VALUES ($1, 'completed', 'gemini')
       ON CONFLICT (submission_id) DO NOTHING RETURNING id`, [job.submission_id],
    );
    if (inserted.rowCount) {
      for (const suggestion of suggestions) {
        await client.query(
          `INSERT INTO evaluation_criteria (evaluation_id, assignment_criterion_id, suggested_marks, explanation)
           VALUES ($1, $2, $3, $4)`, [inserted.rows[0].id, suggestion.criterionId, suggestion.marks, suggestion.explanation],
        );
      }
    }
    await client.query("UPDATE processing_jobs SET status = 'completed', locked_until = NULL, completed_at = now() WHERE id = $1", [job.id]);
  });
}

async function saveManualEvaluation(submissionId, jobId = null, reason = 'Needs teacher review.') {
  await withTransaction(async (client) => {
    const submission = await client.query('SELECT id, assignment_id, student_id FROM submissions WHERE id = $1', [submissionId]);
    if (!submission.rowCount) return;
    const job = { ...submission.rows[0] };
    if (!(await isSelected(client, job))) {
      if (jobId) await client.query("UPDATE processing_jobs SET status = 'obsolete', locked_until = NULL, completed_at = now() WHERE id = $1", [jobId]);
      return;
    }
    await client.query(
      `INSERT INTO evaluations (submission_id, status, provider) VALUES ($1, 'manual', NULL)
       ON CONFLICT (submission_id) DO NOTHING`, [submissionId],
    );
    if (jobId) await client.query(
      `UPDATE processing_jobs SET status = 'manual', locked_until = NULL, last_error = $1, completed_at = now()
       WHERE id = $2`, [reason.slice(0, 500), jobId],
    );
  });
}

async function isSelected(client, submission) {
  const { rows } = await client.query(
    `SELECT id FROM submissions WHERE assignment_id = $1 AND student_id = $2
     ORDER BY version DESC LIMIT 1`, [submission.assignment_id, submission.student_id],
  );
  return rows[0]?.id === submission.id || rows[0]?.id === submission.submission_id;
}

async function readPrivateFile(storageKey) {
  const { getStoredFile } = await import('../services/submissionService.js');
  const { rows } = await query('SELECT storage_key, mime_type, id, assignment_id, student_id FROM submissions WHERE storage_key = $1', [storageKey]);
  if (!rows.length) throw new Error('Stored submission record is missing.');
  const filePath = await getStoredFile(rows[0]);
  const { readFile } = await import('node:fs/promises');
  return readFile(filePath);
}

function safeError(error) {
  return String(error.message || 'Evaluation failed.').replace(/https?:\/\/\S+|key=[^&\s]+/gi, '[redacted]').slice(0, 500);
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}