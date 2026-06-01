import express from 'express';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { apiKeyAuth } from './middleware/auth.js';
import { router as apiRouter, initTunnelManager } from './routes/api.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = join(__dirname, '..', 'public');

export async function createApp() {
  await initTunnelManager();

  const app = express();
  app.use(express.json());

  app.use('/api', apiKeyAuth, apiRouter);

  app.use(express.static(publicDir));

  app.get('*', (_req, res) => {
    res.sendFile(join(publicDir, 'index.html'));
  });

  app.use((err, _req, res, _next) => {
    console.error(err);
    const status = err.status || 500;
    res.status(status).json({
      error: err.message || 'Internal server error'
    });
  });

  return app;
}
