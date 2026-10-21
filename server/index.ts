import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import { createApp } from './app';
import { createPool, migrate } from './db';
import { safeFetchText } from './feedFetch';
import { loadVapid, makeWebPushSender } from './push';
import { startScheduler } from './scheduler';
import { fetchJson } from './catalog';

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(here, '../dist');

const pool = createPool();
await migrate(pool);
const vapid = await loadVapid(pool);
const send = makeWebPushSender(vapid);
let poke = () => {};
const app = createApp({
  pool,
  staticDir: fs.existsSync(dist) && process.env.SERVE_STATIC !== '0' ? dist : undefined,
  secureCookies: process.env.COOKIE_SECURE === '1',
  trustProxy: Number(process.env.TRUST_PROXY ?? 0),
  allowRegistration: process.env.ALLOW_REGISTRATION === '1',
  push: { publicKey: vapid.publicKey, send },
  onChange: () => poke(),
});
poke = startScheduler(pool, send, safeFetchText, { fetchCatalog: fetchJson }).poke;
const port = Number(process.env.PORT ?? 3001);
app.listen(port, () => console.log(`LifeOS API listening on http://localhost:${port}`));
