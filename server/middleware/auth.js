import { HTB_API_KEY } from '../lib/env.js';

export function apiKeyAuth(req, res, next) {
  if (!HTB_API_KEY) {
    return next();
  }

  // Public routes (no secrets): needed before the UI can prompt for a key
  if (req.path === '/health' || req.path === '/meta') {
    return next();
  }

  const header = req.headers.authorization || '';
  const bearer = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  const apiKeyHeader = (req.headers['x-api-key'] || '').trim();
  const token = bearer || apiKeyHeader;

  if (token !== HTB_API_KEY.trim()) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  next();
}
