import { randomBytes } from 'node:crypto';
import { Router } from 'express';
import { csrfToken } from '../middleware/csrf.js';
import { requireAuth } from '../middleware/auth.js';
import { authenticate, register } from '../services/authService.js';

export const authRoutes = Router();

authRoutes.get('/csrf', csrfToken);
for (const role of ['teacher', 'student']) {
  authRoutes.post(`/register/${role}`, async (req, res, next) => {
    try {
      const user = await register(req.body, role);
      req.session.regenerate((error) => {
        if (error) return next(error);
        req.session.user = user;
        req.session.csrfToken = cryptoToken();
        req.session.save((saveError) => saveError ? next(saveError) : res.status(201).json({ user, csrfToken: req.session.csrfToken }));
      });
    } catch (error) {
      next(error);
    }
  });
}

authRoutes.post('/login', async (req, res, next) => {
  try {
    const user = await authenticate(req.body);
    req.session.regenerate((error) => {
      if (error) return next(error);
      req.session.user = user;
      req.session.csrfToken = cryptoToken();
      req.session.save((saveError) => saveError ? next(saveError) : res.json({ user, csrfToken: req.session.csrfToken }));
    });
  } catch (error) {
    next(error);
  }
});

authRoutes.post('/logout', requireAuth, (req, res, next) => {
  req.session.destroy((error) => {
    if (error) return next(error);
    res.clearCookie('iseeebro.sid');
    res.status(204).end();
  });
});

authRoutes.get('/me', requireAuth, (req, res) => res.json({ user: req.user }));

function cryptoToken() {
  return randomBytes(32).toString('hex');
}