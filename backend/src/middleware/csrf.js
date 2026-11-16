import { randomBytes, timingSafeEqual } from 'node:crypto';
import { AppError } from '../errors.js';

const safeMethods = new Set(['GET', 'HEAD', 'OPTIONS']);

export function csrfToken(req, res) {
  if (!req.session.csrfToken) req.session.csrfToken = randomBytes(32).toString('hex');
  res.json({ csrfToken: req.session.csrfToken });
}

export function verifyCsrf(req, res, next) {
  if (safeMethods.has(req.method)) return next();
  const token = req.get('x-csrf-token') || '';
  const expected = req.session.csrfToken || '';
  const tokenBuffer = Buffer.from(token);
  const expectedBuffer = Buffer.from(expected);
  if (!token || tokenBuffer.length !== expectedBuffer.length || !timingSafeEqual(tokenBuffer, expectedBuffer)) {
    return next(new AppError(403, 'Security token expired. Refresh and try again.', 'csrf_invalid'));
  }
  next();
}