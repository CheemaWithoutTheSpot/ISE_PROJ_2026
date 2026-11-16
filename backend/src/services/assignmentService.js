import { query, withTransaction } from '../config/database.js';
import { AppError } from '../errors.js';
import { parseDate, requiredText, validateCriteria } from '../validation.js';

export async function listAssignments(user) {
  const teacher = user.role === 'teacher';
  const { rows } = await query(
    `SELECT a.id, a.classroom_id, a.title, a.instructions, a.due_at, a.rubric_locked, a.released_at,
            c.name AS classroom_name,
            (SELECT count(*)::int FROM submissions s WHERE s.assignment_id = a.id) AS submission_count,
            (SELECT count(*)::int FROM classroom_memberships cm WHERE cm.classroom_id = a.classroom_id) AS student_count,
            (SELECT COALESCE(sum(ac.max_marks), 0) FROM assignment_criteria ac WHERE ac.assignment_id = a.id) AS max_marks,
            (SELECT count(*)::int FROM submissions s JOIN processing_jobs j ON j.submission_id = s.id
             WHERE s.assignment_id = a.id AND j.status IN ('pending', 'processing')
               AND s.id = (SELECT latest.id FROM submissions latest WHERE latest.assignment_id = a.id AND latest.student_id = s.student_id ORDER BY latest.version DESC LIMIT 1)) AS pending_count,
            (SELECT count(*)::int FROM submissions s JOIN evaluations e ON e.submission_id = s.id
             WHERE s.assignment_id = a.id
               AND s.id = (SELECT latest.id FROM submissions latest WHERE latest.assignment_id = a.id AND latest.student_id = s.student_id ORDER BY latest.version DESC LIMIT 1)) AS evaluated_count
     FROM assignments a JOIN classrooms c ON c.id = a.classroom_id
     WHERE ${teacher ? 'a.teacher_id = $1' : `EXISTS (SELECT 1 FROM classroom_memberships cm WHERE cm.classroom_id = a.classroom_id AND cm.student_id = $1)`}
     ORDER BY a.due_at DESC`, [user.id],
  );
  return rows;
}

export async function createAssignment(user, body) {
  const classroomId = requiredText(body.classroomId, 'Classroom', 64);
  const title = requiredText(body.title, 'Assignment title', 180);
  const instructions = typeof body.instructions === 'string' ? body.instructions.slice(0, 20000) : '';
  const dueAt = parseDate(body.dueAt);
  const criteria = validateCriteria(body.criteria);
  return withTransaction(async (client) => {
    const classroom = await client.query('SELECT id FROM classrooms WHERE id = $1 AND teacher_id = $2 FOR UPDATE', [classroomId, user.id]);
    if (!classroom.rowCount) throw new AppError(404, 'Classroom not found.', 'not_found');
    const inserted = await client.query(
      `INSERT INTO assignments (classroom_id, teacher_id, title, instructions, due_at)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [classroomId, user.id, title, instructions, dueAt],
    );
    const assignment = inserted.rows[0];
    const storedCriteria = [];
    for (const criterion of criteria) {
      const saved = await client.query(
        `INSERT INTO assignment_criteria (assignment_id, position, name, description, max_marks)
         VALUES ($1, $2, $3, $4, $5) RETURNING id, name, description, max_marks`,
        [assignment.id, criterion.position, criterion.name, criterion.description, criterion.maxMarks],
      );
      storedCriteria.push({ ...saved.rows[0], maxMarks: saved.rows[0].max_marks });
    }
    return { ...assignment, criteria: storedCriteria };
  });
}

export async function getAssignment(user, assignmentId) {
  const { rows } = await query(
    `SELECT a.*, c.name AS classroom_name,
      (a.teacher_id = $2) AS is_teacher
     FROM assignments a JOIN classrooms c ON c.id = a.classroom_id
     WHERE a.id = $1 AND (a.teacher_id = $2 OR EXISTS (
       SELECT 1 FROM classroom_memberships cm WHERE cm.classroom_id = a.classroom_id AND cm.student_id = $2
     ))`, [assignmentId, user.id],
  );
  if (!rows.length) throw new AppError(404, 'Assignment not found.', 'not_found');
  const assignment = rows[0];
  const criteria = await query('SELECT id, name, description, max_marks FROM assignment_criteria WHERE assignment_id = $1 ORDER BY position', [assignmentId]);
  return { ...assignment, criteria: criteria.rows };
}

export async function updateAssignment(user, assignmentId, body) {
  const title = body.title === undefined ? undefined : requiredText(body.title, 'Assignment title', 180);
  const instructions = body.instructions === undefined ? undefined : String(body.instructions).slice(0, 20000);
  const dueAt = body.dueAt === undefined ? undefined : parseDate(body.dueAt);
  const hasCriteria = body.criteria !== undefined;
  const criteria = hasCriteria ? validateCriteria(body.criteria) : null;

  return withTransaction(async (client) => {
    const { rows } = await client.query('SELECT * FROM assignments WHERE id = $1 AND teacher_id = $2 FOR UPDATE', [assignmentId, user.id]);
    if (!rows.length) throw new AppError(404, 'Assignment not found.', 'not_found');
    const assignment = rows[0];
    if (hasCriteria) {
      const submitted = await client.query('SELECT 1 FROM submissions WHERE assignment_id = $1 LIMIT 1', [assignmentId]);
      if (assignment.rubric_locked || submitted.rowCount) throw new AppError(409, 'The rubric is locked because submissions have begun.', 'rubric_locked');
      await client.query('DELETE FROM assignment_criteria WHERE assignment_id = $1', [assignmentId]);
      for (const criterion of criteria) {
        await client.query(
          `INSERT INTO assignment_criteria (assignment_id, position, name, description, max_marks)
           VALUES ($1, $2, $3, $4, $5)`,
          [assignmentId, criterion.position, criterion.name, criterion.description, criterion.maxMarks],
        );
      }
    }
    const updated = await client.query(
      `UPDATE assignments SET title = COALESCE($1, title), instructions = COALESCE($2, instructions),
        due_at = COALESCE($3, due_at), updated_at = now() WHERE id = $4 RETURNING *`,
      [title ?? null, instructions ?? null, dueAt ?? null, assignmentId],
    );
    return updated.rows[0];
  });
}