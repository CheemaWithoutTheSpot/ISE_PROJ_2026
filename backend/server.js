import app from './src/app.js';
import { config } from './src/config/env.js';
import { pool } from './src/config/database.js';
import { startEvaluationWorker } from './src/workers/evaluationWorker.js';

await pool.query('SELECT 1');
const stopWorker = startEvaluationWorker();
const server = app.listen(config.port, () => {
  console.log(`API listening on http://localhost:${config.port}`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close(async () => {
      await stopWorker();
      await pool.end();
      process.exit(0);
    });
  });
}