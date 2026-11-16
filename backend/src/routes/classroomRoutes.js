import { randomBytes } from 'node:crypto';
import { Router } from 'express';
import { query, withTransaction } from '../config/database.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { AppError } from '../errors.js';
import { requiredText } from '../validation.js';

export const classroomRoutes = Router();
classroomRoutes.use(requireAuth);

classroomRoutes.get('/', async (req, res) => {
  const teacher = req.user.role === 'teacher';
  const { rows } = await query(teacher
    ? `SELECT c.*, count(DISTINCT cm.student_id)::int AS student_count
       FROM classrooms c LEFT JOIN classroom_memberships cm ON cm.classroom_id = c.id
       WHERE c.teacher_id = $1 GROUP BY c.id ORDER BY c.created_at DESC`
    : `SELECT c.id, c.name, c.subject, c.grade_level, c.teacher_id, cm.joined_at,
              count(DISTINCT other.student_id)::int AS student_count
       FROM classroom_memberships cm JOIN classrooms c ON c.id = cm.classroom_id
       LEFT JOIN classroom_memberships other ON other.classroom_id = c.id
       WHERE cm.student_id = $1 GROUP BY c.id, cm.joined_at ORDER BY cm.joined_at DESC`,
  [req.user.id]);
  res.json({ classrooms: rows });
});

classroomRoutes.post('/', requireRole('teacher'), async (req, res) => {
  const name = requiredText(req.body.name, 'Classroom name', 120);
  const subject = typeof req.body.subject === 'string' ? req.body.subject.trim().slice(0, 100) : '';
  const gradeLevel = typeof req.body.gradeLevel === 'string' ? req.body.gradeLevel.trim().slice(0, 40) : '';
  const joiningCode = await uniqueJoiningCode();
  const { rows } = await query(
    `INSERT INTO classrooms (teacher_id, name, subject, grade_level, joining_code)
     VALUES ($1, $2, $3, $4, $5) RETURNING id, name, subject, grade_level, joining_code, created_at`,
    [req.user.id, name, subject, gradeLevel, joiningCode],
  );
  res.status(201).json({ classroom: { ...rows[0], student_count: 0 } });
});

classroomRoutes.post('/join', requireRole('student'), async (req, res) => {
  const code = requiredText(req.body.code, 'Joining code', 12).toUpperCase();
  const { rows } = await query(
    `INSERT INTO classroom_memberships (classroom_id, student_id)
     SELECT id, $2 FROM classrooms WHERE joining_code = $1
     ON CONFLICT DO NOTHING RETURNING classroom_id`, [code, req.user.id],
  );
  if (!rows.length) {
    const existing = await query('SELECT id FROM classrooms WHERE joining_code = $1', [code]);
    if (!existing.rowCount) throw new AppError(404, 'That joining code is not valid.', 'invalid_code');
    throw new AppError(409, 'You have already joined this classroom.', 'already_member');
  }
  res.status(201).json({ joined: true, classroomId: rows[0].classroom_id });
});

classroomRoutes.get('/:id', async (req, res) => {
  const { rows } = await query(
    `SELECT c.id, c.name, c.subject, c.grade_level, c.created_at,
            CASE WHEN c.teacher_id = $2 THEN c.joining_code END AS joining_code,
            count(DISTINCT cm.student_id)::int AS student_count
     FROM classrooms c LEFT JOIN classroom_memberships cm ON cm.classroom_id = c.id
     WHERE c.id = $1 AND (c.teacher_id = $2 OR EXISTS (
       SELECT 1 FROM classroom_memberships mine WHERE mine.classroom_id = c.id AND mine.student_id = $2
     )) GROUP BY c.id`, [req.params.id, req.user.id],
  );
  if (!rows.length) throw new AppError(404, 'Classroom not found.', 'not_found');
  res.json({ classroom: rows[0] });
});

classroomRoutes.get('/:id/members', requireRole('teacher'), async (req, res) => {
  const { rows } = await query(
    `SELECT u.id, u.full_name, u.email, cm.joined_at FROM classroom_memberships cm
     JOIN classrooms c ON c.id = cm.classroom_id JOIN users u ON u.id = cm.student_id
     WHERE cm.classroom_id = $1 AND c.teacher_id = $2 ORDER BY u.full_name`, [req.params.id, req.user.id],
  );
  const owned = rows.length || (await query('SELECT 1 FROM classrooms WHERE id = $1 AND teacher_id = $2', [req.params.id, req.user.id])).rowCount;
  if (!owned) throw new AppError(404, 'Classroom not found.', 'not_found');
  res.json({ members: rows });
});

classroomRoutes.post('/:id/regenerate-code', requireRole('teacher'), async (req, res) => {
  const joiningCode = await uniqueJoiningCode();
  const { rows } = await query(
    'UPDATE classrooms SET joining_code = $1 WHERE id = $2 AND teacher_id = $3 RETURNING joining_code',
    [joiningCode, req.params.id, req.user.id],
  );
  if (!rows.length) throw new AppError(404, 'Classroom not found.', 'not_found');
  res.json({ joiningCode: rows[0].joining_code });
});

classroomRoutes.delete('/:id/members/:studentId', requireRole('teacher'), async (req, res) => {
  const removed = await withTransaction(async (client) => {
    const room = await client.query('SELECT id FROM classrooms WHERE id = $1 AND teacher_id = $2 FOR UPDATE', [req.params.id, req.user.id]);
    if (!room.rowCount) throw new AppError(404, 'Classroom not found.', 'not_found');
    return client.query('DELETE FROM classroom_memberships WHERE classroom_id = $1 AND student_id = $2 RETURNING student_id', [req.params.id, req.params.studentId]);
  });
  if (!removed.rowCount) throw new AppError(404, 'Student membership not found.', 'not_found');
  res.status(204).end();
});

classroomRoutes.delete('/:id/membership', requireRole('student'), async (req, res) => {
  const { rowCount } = await query('DELETE FROM classroom_memberships WHERE classroom_id = $1 AND student_id = $2', [req.params.id, req.user.id]);
  if (!rowCount) throw new AppError(404, 'Classroom membership not found.', 'not_found');
  res.status(204).end();
});

async function uniqueJoiningCode() {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = randomBytes(4).toString('hex').toUpperCase();
    const exists = await query('SELECT 1 FROM classrooms WHERE joining_code = $1', [code]);
    if (!exists.rowCount) return code;
  }
  throw new AppError(503, 'A joining code could not be generated. Try again.', 'code_unavailable');
}