import { Router } from 'express';
import multer from 'multer';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { AppError } from '../errors.js';
import { createReceipt, getAuthorizedSubmission, getStoredFile, acceptSubmission } from '../services/submissionService.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1 } });
export const submissionRoutes = Router();
submissionRoutes.use(requireAuth);

submissionRoutes.post('/assignments/:assignmentId/submissions', requireRole('student'), upload.single('file'), async (req, res) => {
  const submission = await acceptSubmission(req.user, req.params.assignmentId, req.file);
  res.status(201).json({ submission, receiptUrl: `/api/submissions/${submission.id}/receipt` });
});

submissionRoutes.get('/submissions/:id/receipt', async (req, res) => {
  const submission = await getAuthorizedSubmission(req.user, req.params.id);
  const receipt = await createReceipt(submission);
  res.status(200).type('html').attachment(`receipt-${submission.id}.html`).send(receipt);
});

submissionRoutes.get('/submissions/:id/file', async (req, res) => {
  const submission = await getAuthorizedSubmission(req.user, req.params.id);
  const filePath = await getStoredFile(submission);
  res.download(filePath, submission.original_filename, (error) => {
    if (error && !res.headersSent) res.status(error.statusCode || 404).json({ error: 'Submission file not found.', code: 'not_found' });
  });
});