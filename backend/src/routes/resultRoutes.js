import { Router } from 'express';
import { query, withTransaction } from '../config/database.js';
import { AppError } from '../errors.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

export const resultRoutes = Router();
resultRoutes.use(requireAuth);

resultRoutes.get('/assignments/:id/reviews', requireRole('teacher'), async (req, res) => {
  const owned = await query('SELECT id FROM assignments WHERE id = $1 AND teacher_id = $2', [req.params.id, req.user.id]);
  if (!owned.rowCount) throw new AppError(404, 'Assignment not found.', 'not_found');
  const { rows } = await query(
    `WITH roster AS (
       SELECT student_id FROM classroom_memberships cm JOIN assignments a ON a.classroom_id = cm.classroom_id WHERE a.id = $1
       UNION SELECT student_id FROM submissions WHERE assignment_id = $1
     ), latest AS (
       SELECT DISTINCT ON (student_id) * FROM submissions WHERE assignment_id = $1 ORDER BY student_id, version DESC
     )
     SELECT u.id AS student_id, u.full_name AS student_name, u.email AS student_email,
      s.id AS submission_id, s.original_filename, s.submitted_at, e.status AS evaluation_status,
      j.status AS job_status, j.last_error AS evaluation_error,
       fr.total_marks, fr.max_marks, fr.updated_at AS final_updated_at,
       COALESCE((SELECT json_agg(json_build_object('criterionId', ac.id, 'name', ac.name, 'maxMarks', ac.max_marks,
          'suggestedMarks', ec.suggested_marks, 'explanation', ec.explanation, 'finalMarks', frc.marks) ORDER BY ac.position)
         FROM assignment_criteria ac
         LEFT JOIN evaluation_criteria ec ON ec.assignment_criterion_id = ac.id AND ec.evaluation_id = e.id
         LEFT JOIN final_result_criteria frc ON frc.assignment_criterion_id = ac.id AND frc.final_result_id = fr.id
         WHERE ac.assignment_id = $1), '[]'::json) AS criteria
     FROM roster r JOIN users u ON u.id = r.student_id
     LEFT JOIN latest s ON s.student_id = r.student_id
     LEFT JOIN evaluations e ON e.submission_id = s.id
    LEFT JOIN processing_jobs j ON j.submission_id = s.id
     LEFT JOIN final_results fr ON fr.assignment_id = $1 AND fr.student_id = r.student_id
     ORDER BY u.full_name`, [req.params.id],
  );
  res.json({ reviews: rows });
});

resultRoutes.patch('/assignments/:id/reviews/:studentId', requireRole('teacher'), async (req, res) => {
  const result = await saveTeacherMarks(req.params.id, req.params.studentId, req.user.id, req.body.criteria);
  res.json({ result });
});

resultRoutes.post('/assignments/:id/reviews/:studentId/retry-ai', requireRole('teacher'), async (req, res) => {
  const retry = await withTransaction(async (client) => {
    const assignment = await client.query(
      'SELECT id, released_at FROM assignments WHERE id = $1 AND teacher_id = $2 FOR UPDATE',
      [req.params.id, req.user.id],
    );
    if (!assignment.rowCount) throw new AppError(404, 'Assignment not found.', 'not_found');
    if (assignment.rows[0].released_at) throw new AppError(409, 'Released results cannot be re-evaluated. Update the teacher marks instead.', 'results_released');
    const latest = await client.query(
      `SELECT s.id FROM submissions s WHERE s.assignment_id = $1 AND s.student_id = $2
       ORDER BY s.version DESC LIMIT 1 FOR UPDATE`, [req.params.id, req.params.studentId],
    );
    if (!latest.rowCount) throw new AppError(404, 'Submission not found.', 'not_found');
    const submissionId = latest.rows[0].id;
    const finalized = await client.query(
      'SELECT 1 FROM final_results WHERE assignment_id = $1 AND student_id = $2', [req.params.id, req.params.studentId],
    );
    if (finalized.rowCount) throw new AppError(409, 'Teacher marks already exist for this submission.', 'final_marks_exist');
    const evaluation = await client.query('SELECT id, status FROM evaluations WHERE submission_id = $1 FOR UPDATE', [submissionId]);
    if (evaluation.rows[0]?.status === 'completed') throw new AppError(409, 'This submission already has a completed AI evaluation.', 'evaluation_complete');
    if (evaluation.rows[0]) {
      await client.query('DELETE FROM evaluation_criteria WHERE evaluation_id = $1', [evaluation.rows[0].id]);
      await client.query('DELETE FROM evaluations WHERE id = $1', [evaluation.rows[0].id]);
    }
    const existingJob = await client.query('SELECT id FROM processing_jobs WHERE submission_id = $1 FOR UPDATE', [submissionId]);
    if (existingJob.rowCount) {
      await client.query(
        `UPDATE processing_jobs SET status = 'pending', attempt_count = 0, locked_until = NULL,
           last_error = NULL, completed_at = NULL WHERE id = $1`, [existingJob.rows[0].id],
      );
    } else {
      await client.query("INSERT INTO processing_jobs (submission_id, status) VALUES ($1, 'pending')", [submissionId]);
    }
    return { submissionId };
  });
  res.status(202).json({ status: 'pending', submissionId: retry.submissionId });
});

resultRoutes.post('/assignments/:id/confirm-results', requireRole('teacher'), async (req, res) => {
  const outcome = await withTransaction(async (client) => {
    const assignment = await client.query('SELECT * FROM assignments WHERE id = $1 AND teacher_id = $2 FOR UPDATE', [req.params.id, req.user.id]);
    if (!assignment.rowCount) throw new AppError(404, 'Assignment not found.', 'not_found');
    if (new Date(assignment.rows[0].due_at).getTime() > Date.now()) throw new AppError(409, 'Results can only be released after the deadline.', 'deadline_not_reached');
    const submissions = await client.query('SELECT count(*)::int AS count FROM submissions WHERE assignment_id = $1', [req.params.id]);
    if (submissions.rows[0].count === 0) return { noSubmissions: true };
    const maxMarks = await client.query('SELECT COALESCE(sum(max_marks), 0)::numeric AS total FROM assignment_criteria WHERE assignment_id = $1', [req.params.id]);
    const missing = await client.query(
      `SELECT cm.student_id FROM classroom_memberships cm JOIN assignments a ON a.classroom_id = cm.classroom_id
      WHERE a.id = $1 AND NOT EXISTS (SELECT 1 FROM submissions s WHERE s.assignment_id = a.id AND s.student_id = cm.student_id)`, [req.params.id],
    );
    for (const student of missing.rows) {
      await client.query(
        `INSERT INTO final_results (assignment_id, student_id, total_marks, max_marks, submission_status)
         VALUES ($1, $2, 0, $3, 'not_submitted') ON CONFLICT (assignment_id, student_id) DO UPDATE
         SET total_marks = 0, max_marks = EXCLUDED.max_marks, submission_status = 'not_submitted', updated_at = now()`,
        [req.params.id, student.student_id, maxMarks.rows[0].total],
      );
    }
    const unresolved = await client.query(
      `SELECT s.student_id FROM (SELECT DISTINCT student_id FROM submissions WHERE assignment_id = $1) s
       LEFT JOIN final_results fr ON fr.assignment_id = $1 AND fr.student_id = s.student_id
       WHERE fr.id IS NULL`, [req.params.id],
    );
    if (unresolved.rowCount) throw new AppError(409, 'Every submitted student needs a final teacher mark before release.', 'results_unresolved');
    const updated = await client.query('UPDATE assignments SET released_at = now(), updated_at = now() WHERE id = $1 RETURNING released_at', [req.params.id]);
    return { noSubmissions: false, releasedAt: updated.rows[0].released_at };
  });
  if (outcome.noSubmissions) return res.json({ state: 'no_submissions' });
  res.json({ state: 'released', releasedAt: outcome.releasedAt });
});

resultRoutes.patch('/assignments/:id/results/:studentId', requireRole('teacher'), async (req, res) => {
  const result = await saveTeacherMarks(req.params.id, req.params.studentId, req.user.id, req.body.criteria);
  res.json({ result });
});

resultRoutes.get('/assignments/:id/results/export', requireRole('teacher'), async (req, res) => {
  const assignment = await query('SELECT id, title, released_at FROM assignments WHERE id = $1 AND teacher_id = $2', [req.params.id, req.user.id]);
  if (!assignment.rowCount) throw new AppError(404, 'Assignment not found.', 'not_found');
  if (!assignment.rows[0].released_at) throw new AppError(409, 'Results must be released before export.', 'results_not_released');
  const { rows } = await query(
    `SELECT u.full_name, u.email, fr.total_marks, fr.max_marks, fr.submission_status
     FROM final_results fr JOIN users u ON u.id = fr.student_id WHERE fr.assignment_id = $1 ORDER BY u.full_name`, [req.params.id],
  );
  const csv = [
    ['Assignment', 'Student', 'Student ID', 'Final marks', 'Maximum marks', 'Submission status'],
    ...rows.map((row) => [assignment.rows[0].title, row.full_name, row.email, row.total_marks, row.max_marks, row.submission_status]),
  ].map((line) => line.map(csvCell).join(',')).join('\r\n');
  res.setHeader('content-type', 'text/csv; charset=utf-8');
  res.attachment(`assignment-${req.params.id}-results.csv`).send(`\uFEFF${csv}`);
});

resultRoutes.get('/me/results', requireRole('student'), async (req, res) => {
  const { rows } = await query(
    `SELECT a.id AS assignment_id, a.title AS assignment_title, c.name AS classroom_name,
       fr.total_marks, fr.max_marks, fr.submission_status, fr.updated_at,
       COALESCE((SELECT json_agg(json_build_object('name', ac.name, 'marks', frc.marks, 'maxMarks', ac.max_marks) ORDER BY ac.position)
         FROM final_result_criteria frc JOIN assignment_criteria ac ON ac.id = frc.assignment_criterion_id
         WHERE frc.final_result_id = fr.id), '[]'::json) AS criteria
     FROM final_results fr JOIN assignments a ON a.id = fr.assignment_id
     JOIN classrooms c ON c.id = a.classroom_id
     WHERE fr.student_id = $1 AND a.released_at IS NOT NULL
       AND EXISTS (SELECT 1 FROM classroom_memberships cm WHERE cm.classroom_id = c.id AND cm.student_id = $1)
     ORDER BY a.due_at DESC`, [req.user.id],
  );
  res.json({ results: rows });
});

async function saveTeacherMarks(assignmentId, studentId, teacherId, input) {
  if (!Array.isArray(input)) throw new AppError(400, 'Criterion marks are required.', 'invalid_marks');
  return withTransaction(async (client) => {
    const assignment = await client.query('SELECT id FROM assignments WHERE id = $1 AND teacher_id = $2 FOR UPDATE', [assignmentId, teacherId]);
    if (!assignment.rowCount) throw new AppError(404, 'Assignment not found.', 'not_found');
    const latest = await client.query('SELECT id FROM submissions WHERE assignment_id = $1 AND student_id = $2 ORDER BY version DESC LIMIT 1', [assignmentId, studentId]);
    if (!latest.rowCount) throw new AppError(404, 'Submitted work not found.', 'not_found');
    const criteria = await client.query('SELECT id, max_marks FROM assignment_criteria WHERE assignment_id = $1 ORDER BY position', [assignmentId]);
    if (input.length !== criteria.rowCount) throw new AppError(400, 'Provide a mark for every rubric criterion.', 'invalid_marks');
    const valid = new Map(criteria.rows.map((criterion) => [criterion.id, Number(criterion.max_marks)]));
    const seen = new Set();
    let total = 0;
    const marks = input.map((item) => {
      const value = Number(item.marks);
      if (!valid.has(item.criterionId) || seen.has(item.criterionId) || !Number.isFinite(value) || value < 0 || value > valid.get(item.criterionId)) {
        throw new AppError(400, 'A criterion mark is invalid or exceeds its maximum.', 'invalid_marks');
      }
      seen.add(item.criterionId);
      total += value;
      return { id: item.criterionId, marks: value };
    });
    const maximum = [...valid.values()].reduce((sum, value) => sum + value, 0);
    const saved = await client.query(
      `INSERT INTO final_results (assignment_id, student_id, total_marks, max_marks, submission_status)
       VALUES ($1, $2, $3, $4, 'submitted') ON CONFLICT (assignment_id, student_id) DO UPDATE
       SET total_marks = EXCLUDED.total_marks, max_marks = EXCLUDED.max_marks, submission_status = 'submitted', updated_at = now()
       RETURNING *`, [assignmentId, studentId, total, maximum],
    );
    const finalResult = saved.rows[0];
    await client.query('DELETE FROM final_result_criteria WHERE final_result_id = $1', [finalResult.id]);
    for (const item of marks) await client.query(
      'INSERT INTO final_result_criteria (final_result_id, assignment_criterion_id, marks) VALUES ($1, $2, $3)', [finalResult.id, item.id, item.marks],
    );
    return finalResult;
  });
}

function csvCell(value) {
  const safe = String(value ?? '').replace(/^[=+\-@]/, "'$&");
  return `"${safe.replace(/"/g, '""')}"`;
}