import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import { createApp } from './app';
import { createPool, migrate } from './db';
import { startFeedScheduler } from './feeds';
import { loadVapid, makeWebPushSender, startScheduler } from './push';

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(here, '../dist');

const pool = createPool();
await migrate(pool);
const vapid = await loadVapid(pool);
const send = makeWebPushSender(vapid);
const app = createApp({
  pool,
  staticDir: fs.existsSync(dist) && process.env.SERVE_STATIC !== '0' ? dist : undefined,
  secureCookies: process.env.COOKIE_SECURE === '1',
  trustProxy: Number(process.env.TRUST_PROXY ?? 0),
  allowRegistration: process.env.ALLOW_REGISTRATION === '1',
  push: { publicKey: vapid.publicKey, send },
});
startScheduler(pool, send);
startFeedScheduler(pool);
const port = Number(process.env.PORT ?? 3001);
app.listen(port, () => console.log(`LifeOS API listening on http://localhost:${port}`));
