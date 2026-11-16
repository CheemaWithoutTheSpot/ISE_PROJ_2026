import { Router } from 'express';
import { query, withTransaction } from '../config/database.js';
import { AppError } from '../errors.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { requiredText, validateCriteria } from '../validation.js';

export const rubricRoutes = Router();
rubricRoutes.use(requireAuth, requireRole('teacher'));

rubricRoutes.get('/', async (req, res) => {
  const { rows } = await query(
    `SELECT t.id, t.name, t.created_at, t.updated_at,
      COALESCE(json_agg(json_build_object('id', c.id, 'name', c.name, 'description', c.description, 'maxMarks', c.max_marks, 'position', c.position) ORDER BY c.position)
        FILTER (WHERE c.id IS NOT NULL), '[]'::json) AS criteria
     FROM rubric_templates t LEFT JOIN rubric_template_criteria c ON c.template_id = t.id
     WHERE t.teacher_id = $1 GROUP BY t.id ORDER BY t.updated_at DESC`, [req.user.id],
  );
  res.json({ templates: rows });
});

rubricRoutes.post('/', async (req, res) => {
  const name = requiredText(req.body.name, 'Template name', 120);
  const criteria = validateCriteria(req.body.criteria);
  const template = await withTransaction(async (client) => {
    const inserted = await client.query('INSERT INTO rubric_templates (teacher_id, name) VALUES ($1, $2) RETURNING id, name, created_at, updated_at', [req.user.id, name]);
    const row = inserted.rows[0];
    for (const criterion of criteria) {
      await client.query(
        `INSERT INTO rubric_template_criteria (template_id, position, name, description, max_marks)
         VALUES ($1, $2, $3, $4, $5)`, [row.id, criterion.position, criterion.name, criterion.description, criterion.maxMarks],
      );
    }
    return { ...row, criteria };
  });
  res.status(201).json({ template });
});

rubricRoutes.patch('/:id', async (req, res) => {
  const name = requiredText(req.body.name, 'Template name', 120);
  const criteria = validateCriteria(req.body.criteria);
  const template = await withTransaction(async (client) => {
    const owned = await client.query('UPDATE rubric_templates SET name = $1, updated_at = now() WHERE id = $2 AND teacher_id = $3 RETURNING id, name, created_at, updated_at', [name, req.params.id, req.user.id]);
    if (!owned.rowCount) throw new AppError(404, 'Rubric template not found.', 'not_found');
    await client.query('DELETE FROM rubric_template_criteria WHERE template_id = $1', [req.params.id]);
    for (const criterion of criteria) {
      await client.query(
        `INSERT INTO rubric_template_criteria (template_id, position, name, description, max_marks)
         VALUES ($1, $2, $3, $4, $5)`, [req.params.id, criterion.position, criterion.name, criterion.description, criterion.maxMarks],
      );
    }
    return { ...owned.rows[0], criteria };
  });
  res.json({ template });
});

rubricRoutes.delete('/:id', async (req, res) => {
  const { rowCount } = await query('DELETE FROM rubric_templates WHERE id = $1 AND teacher_id = $2', [req.params.id, req.user.id]);
  if (!rowCount) throw new AppError(404, 'Rubric template not found.', 'not_found');
  res.status(204).end();
});