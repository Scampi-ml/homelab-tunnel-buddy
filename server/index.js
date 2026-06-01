import 'dotenv/config';
import { createApp } from './app.js';
import { PORT } from './lib/env.js';

const app = await createApp();

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Homelab Tunnel Buddy listening on http://0.0.0.0:${PORT}`);
});
