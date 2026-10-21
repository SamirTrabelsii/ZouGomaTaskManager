import { Router, type RequestHandler } from 'express';
import { IMAGE_FILE } from './catalog';
import { CARD_BACK, PACK_ART } from './packArt';

/**
 * Card art proxy: GET /api/cards/img/:file serves one One Piece TCG card image (the catalog's `img`, e.g.
 * "OP16-011_l76oKss.jpg"), fetched once from optcgapi.com and then kept in memory. Browsers may cache the answer for a
 * year, so a device asks at most once per card.
 *
 * GET /api/cards/pack/:setId does the same for a set's official booster pack picture, and GET /api/cards/back for the
 * official card back (see packArt.ts).
 *
 * It is not an open proxy: a card must be a plain image file name, fetched only from optcgapi.com's card-image folder,
 * and a pack must be a set listed in PACK_ART, fetched only from its listed URL.
 */

export type ImageFetcher = (url: string) => Promise<{ type: string; body: Buffer }>;

const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const TIMEOUT_MS = 15_000;
export const imageSourceUrl = (file: string) => `https://optcgapi.com/media/static/Card_Images/${file}`;

export const fetchImage: ImageFetcher = async (url) => {
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), redirect: 'error' });
  if (!res.ok) throw Object.assign(new Error(`upstream ${res.status}`), { status: res.status === 404 ? 404 : 502 });
  const type = res.headers.get('content-type') ?? '';
  if (!type.startsWith('image/')) throw Object.assign(new Error('not an image'), { status: 502 });
  const body = Buffer.from(await res.arrayBuffer());
  if (body.length > MAX_IMAGE_BYTES) throw Object.assign(new Error('image too large'), { status: 502 });
  return { type, body };
};

/** Least-recently-used images are dropped once the cache holds more than `maxBytes`. */
export function cardImageRouter(auth: RequestHandler, fetcher: ImageFetcher = fetchImage, maxBytes = 64 * 1024 * 1024) {
  const cache = new Map<string, { type: string; body: Buffer }>();
  const pending = new Map<string, Promise<{ type: string; body: Buffer }>>();
  let bytes = 0;

  const remember = (id: string, img: { type: string; body: Buffer }) => {
    cache.set(id, img);
    bytes += img.body.length;
    for (const [k, v] of cache) {
      if (bytes <= maxBytes) break;
      cache.delete(k);
      bytes -= v.body.length;
    }
  };

  const load = (id: string, url: string) => {
    const hit = cache.get(id);
    if (hit) {
      cache.delete(id); // re-insert = most recently used
      cache.set(id, hit);
      return Promise.resolve(hit);
    }
    // concurrent requests for the same card share one upstream fetch
    let p = pending.get(id);
    if (!p) {
      p = fetcher(url).then((img) => { remember(id, img); return img; }).finally(() => pending.delete(id));
      pending.set(id, p);
    }
    return p;
  };

  const router = Router();
  router.get('/img/:file', auth, async (req, res) => {
    const id = String(req.params.file);
    if (!IMAGE_FILE.test(id)) return res.status(400).json({ error: 'Unknown card' });
    try {
      const img = await load(id, imageSourceUrl(id));
      res.set('Cache-Control', 'private, max-age=31536000, immutable').type(img.type).send(img.body);
    } catch (e) {
      const status = (e as { status?: number }).status ?? 502;
      res.status(status).json({ error: status === 404 ? 'Unknown card' : 'Card image unavailable right now' });
    }
  });
  router.get('/back', auth, async (_req, res) => {
    try {
      const img = await load('back', CARD_BACK.url);
      res.set('Cache-Control', 'private, max-age=604800').type(img.type).send(img.body);
    } catch (e) {
      res.status((e as { status?: number }).status ?? 502).json({ error: 'Card back unavailable right now' });
    }
  });
  router.get('/pack/:setId', auth, async (req, res) => {
    const setId = String(req.params.setId);
    const art = Object.hasOwn(PACK_ART, setId) ? PACK_ART[setId] : null;
    if (!art) return res.status(404).json({ error: 'No pack picture for this set' });
    try {
      const img = await load(`pack:${setId}`, art.url);
      // a set's picture can be replaced (a better scan, a fixed URL), so it is cached for a week, not forever
      res.set('Cache-Control', 'private, max-age=604800').type(img.type).send(img.body);
    } catch (e) {
      const status = (e as { status?: number }).status ?? 502;
      res.status(status).json({ error: 'Pack picture unavailable right now' });
    }
  });
  return router;
}
