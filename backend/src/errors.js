export class AppError extends Error {
  constructor(status, message, code = 'request_error') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function errorMiddleware(error, req, res, next) {
  if (res.headersSent) return next(error);
  if (error.code === '23505') return res.status(409).json({ error: 'This record already exists.', code: 'conflict' });
  if (error.code === '23503' || error.code === '23514') return res.status(400).json({ error: 'The submitted data is not valid.', code: 'invalid_data' });
  if (error.name === 'MulterError') return res.status(400).json({ error: error.code === 'LIMIT_FILE_SIZE' ? 'Files must be 10 MB or smaller.' : 'The uploaded file could not be accepted.', code: 'invalid_upload' });
  const status = Number.isInteger(error.status) ? error.status : 500;
  if (status >= 500) console.error(error);
  res.status(status).json({ error: status >= 500 ? 'An unexpected server error occurred.' : error.message, code: error.code || 'server_error' });
}