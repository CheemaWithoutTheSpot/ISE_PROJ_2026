import express from 'express';
import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import helmet from 'helmet';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config/env.js';
import { pool } from './config/database.js';
import { verifyCsrf } from './middleware/csrf.js';
import { errorMiddleware } from './errors.js';
import { authRoutes } from './routes/authRoutes.js';
import { classroomRoutes } from './routes/classroomRoutes.js';
import { assignmentRoutes } from './routes/assignmentRoutes.js';
import { rubricRoutes } from './routes/rubricRoutes.js';
import { submissionRoutes } from './routes/submissionRoutes.js';
import { resultRoutes } from './routes/resultRoutes.js';

const PgSession = connectPgSimple(session);
const app = express();
const here = path.dirname(fileURLToPath(import.meta.url));

if (config.nodeEnv === 'production') app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(helmet({ crossOriginResourcePolicy: { policy: 'same-site' } }));
app.use(express.json({ limit: '1mb' }));
app.use(session({
  name: 'iseeebro.sid',
  secret: config.sessionSecret,
  store: new PgSession({ pool, createTableIfMissing: true, tableName: 'user_sessions' }),
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: config.nodeEnv === 'production',
    sameSite: 'lax',
    maxAge: 8 * 60 * 60 * 1000,
  },
}));
app.use('/api', verifyCsrf);
app.get('/api/health', async (req, res, next) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok' });
  } catch (error) { next(error); }
});
app.use('/api/auth', authRoutes);
app.use('/api/classrooms', classroomRoutes);
app.use('/api/assignments', assignmentRoutes);
app.use('/api/rubric-templates', rubricRoutes);
app.use('/api', submissionRoutes);
app.use('/api', resultRoutes);
app.use('/api', (req, res) => res.status(404).json({ error: 'API route not found.', code: 'not_found' }));

const frontendDist = path.resolve(here, '../../frontend/dist');
app.use(express.static(frontendDist, { index: false }));
app.get('/{*path}', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(frontendDist, 'index.html'), (error) => error && next(error));
});

app.use(errorMiddleware);

export default app;