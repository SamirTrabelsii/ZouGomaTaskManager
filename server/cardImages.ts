import { Router, type RequestHandler } from 'express';

/**
 * Card art proxy: GET /api/cards/img/:id serves one One Piece TCG card image, fetched once from optcgapi.com and then
 * kept in memory. Browsers may cache the answer for a year, so a device asks at most once per card.
 *
 * It is not an open proxy: the id must look like a card print id ("OP01-120", "OP01-120_p2"), and the only URL it
 * ever fetches is that card's image on optcgapi.com.
 */

export type ImageFetcher = (url: string) => Promise<{ type: string; body: Buffer }>;

const ID = /^[A-Z]{2,3}\d{2}-\d{3}(?:_p\d{1,2})?$/;
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const TIMEOUT_MS = 15_000;
export const imageSourceUrl = (id: string) => `https://optcgapi.com/media/static/Card_Images/${id}.jpg`;

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

  const load = (id: string) => {
    const hit = cache.get(id);
    if (hit) {
      cache.delete(id); // re-insert = most recently used
      cache.set(id, hit);
      return Promise.resolve(hit);
    }
    // concurrent requests for the same card share one upstream fetch
    let p = pending.get(id);
    if (!p) {
      p = fetcher(imageSourceUrl(id)).then((img) => { remember(id, img); return img; }).finally(() => pending.delete(id));
      pending.set(id, p);
    }
    return p;
  };

  const router = Router();
  router.get('/img/:id', auth, async (req, res) => {
    const id = String(req.params.id);
    if (!ID.test(id)) return res.status(400).json({ error: 'Unknown card' });
    try {
      const img = await load(id);
      res.set('Cache-Control', 'private, max-age=31536000, immutable').type(img.type).send(img.body);
    } catch (e) {
      const status = (e as { status?: number }).status ?? 502;
      res.status(status).json({ error: status === 404 ? 'Unknown card' : 'Card image unavailable right now' });
    }
  });
  return router;
}
