import { AppError } from '../errors.js';

export function requireAuth(req, res, next) {
  if (!req.session.user) return next(new AppError(401, 'Please sign in to continue.', 'unauthorized'));
  req.user = req.session.user;
  next();
}

export function requireRole(role) {
  return (req, res, next) => {
    if (req.user?.role !== role) return next(new AppError(403, 'You do not have permission to do that.', 'forbidden'));
    next();
  };
}