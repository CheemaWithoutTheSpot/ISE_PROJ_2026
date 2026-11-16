import { Router } from 'express';
import multer from 'multer';
import { withTransaction } from '../config/database.js';
import { AppError } from '../errors.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { saveAssignmentQuestionPdf } from '../services/assignmentDocumentService.js';
import { createAssignment, getAssignment, listAssignments, updateAssignment } from '../services/assignmentService.js';
import { validateCriteria } from '../validation.js';

export const assignmentRoutes = Router();
const questionUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1 } });
assignmentRoutes.use(requireAuth);

assignmentRoutes.get('/', async (req, res) => res.json({ assignments: await listAssignments(req.user) }));
assignmentRoutes.post('/', requireRole('teacher'), async (req, res) => res.status(201).json({ assignment: await createAssignment(req.user, req.body) }));
assignmentRoutes.post('/:id/questions-document', requireRole('teacher'), questionUpload.single('file'), async (req, res) => {
	const document = await saveAssignmentQuestionPdf(req.user, req.params.id, req.file);
	res.status(201).json({ document });
});
assignmentRoutes.post('/:id/rubric/from-template', requireRole('teacher'), async (req, res) => {
	const result = await withTransaction(async (client) => {
		const assignment = await client.query('SELECT id, teacher_id, rubric_locked FROM assignments WHERE id = $1 AND teacher_id = $2 FOR UPDATE', [req.params.id, req.user.id]);
		if (!assignment.rowCount) throw new AppError(404, 'Assignment not found.', 'not_found');
		if (assignment.rows[0].rubric_locked) throw new AppError(409, 'The rubric is locked because submissions have begun.', 'rubric_locked');
		const template = await client.query('SELECT id FROM rubric_templates WHERE id = $1 AND teacher_id = $2', [req.body.templateId, req.user.id]);
		if (!template.rowCount) throw new AppError(404, 'Rubric template not found.', 'not_found');
		const templateCriteria = await client.query('SELECT name, description, max_marks FROM rubric_template_criteria WHERE template_id = $1 ORDER BY position', [req.body.templateId]);
		const criteria = validateCriteria(templateCriteria.rows.map((item) => ({ ...item, maxMarks: item.max_marks })));
		const existing = await client.query('SELECT 1 FROM submissions WHERE assignment_id = $1 LIMIT 1', [req.params.id]);
		if (existing.rowCount) throw new AppError(409, 'The rubric is locked because submissions have begun.', 'rubric_locked');
		await client.query('DELETE FROM assignment_criteria WHERE assignment_id = $1', [req.params.id]);
		for (const criterion of criteria) {
			await client.query(
				`INSERT INTO assignment_criteria (assignment_id, position, name, description, max_marks)
				 VALUES ($1, $2, $3, $4, $5)`,
				[req.params.id, criterion.position, criterion.name, criterion.description, criterion.maxMarks],
			);
		}
		return criteria;
	});
	res.json({ criteria: result });
});
assignmentRoutes.get('/:id', async (req, res) => res.json({ assignment: await getAssignment(req.user, req.params.id) }));
assignmentRoutes.patch('/:id', requireRole('teacher'), async (req, res) => res.json({ assignment: await updateAssignment(req.user, req.params.id, req.body) }));