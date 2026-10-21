import { afterEach, describe, expect, it } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { cardImageRouter, imageSourceUrl, type ImageFetcher } from './cardImages';

let server: Server | null = null;
afterEach(() => { server?.close(); server = null; });

/** Runs the router alone (no database); `signedIn` stands in for the real requireAuth. */
function start(fetcher: ImageFetcher, opts: { signedIn?: boolean; maxBytes?: number } = {}) {
  const app = express();
  const auth: express.RequestHandler = (_req, res, next) => (opts.signedIn ?? true ? next() : res.status(401).json({ error: 'Sign in' }));
  app.use('/api/cards', cardImageRouter(auth, fetcher, opts.maxBytes));
  server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return (path: string) => fetch(base + path);
}

const fakeFetcher = () => {
  const calls: string[] = [];
  const fetcher: ImageFetcher = async (url) => {
    calls.push(url);
    if (url.includes('OP99')) throw Object.assign(new Error('missing'), { status: 404 });
    return { type: 'image/jpeg', body: Buffer.alloc(100, 1) };
  };
  return { calls, fetcher };
};

describe('card image proxy', () => {
  it('serves the image with a long private cache, fetching upstream only once', async () => {
    const { calls, fetcher } = fakeFetcher();
    const get = start(fetcher);
    const a = await get('/api/cards/img/OP01-120_p2');
    expect(a.status).toBe(200);
    expect(a.headers.get('content-type')).toBe('image/jpeg');
    expect(a.headers.get('cache-control')).toContain('max-age=31536000');
    expect((await a.arrayBuffer()).byteLength).toBe(100);
    await get('/api/cards/img/OP01-120_p2');
    expect(calls).toEqual([imageSourceUrl('OP01-120_p2')]);
  });

  it('only accepts card ids, so it can never be pointed at another URL', async () => {
    const { calls, fetcher } = fakeFetcher();
    const get = start(fetcher);
    for (const bad of ['..%2F..%2Fetc', 'OP01-001.jpg', 'http%3A%2F%2Fevil.test', 'op01-001', 'OP01-001_p1x']) {
      expect((await get(`/api/cards/img/${bad}`)).status).toBe(400);
    }
    expect(calls).toEqual([]);
  });

  it('needs a signed-in user', async () => {
    const { calls, fetcher } = fakeFetcher();
    expect((await start(fetcher, { signedIn: false })('/api/cards/img/OP01-001')).status).toBe(401);
    expect(calls).toEqual([]);
  });

  it('passes on a missing card as 404 and does not cache failures', async () => {
    const { calls, fetcher } = fakeFetcher();
    const get = start(fetcher);
    expect((await get('/api/cards/img/OP99-001')).status).toBe(404);
    expect((await get('/api/cards/img/OP99-001')).status).toBe(404);
    expect(calls).toHaveLength(2);
  });

  it('drops the least recently used images when the cache is full', async () => {
    const { calls, fetcher } = fakeFetcher();
    const get = start(fetcher, { maxBytes: 250 }); // room for two 100-byte images
    await get('/api/cards/img/OP01-001');
    await get('/api/cards/img/OP01-002');
    await get('/api/cards/img/OP01-001'); // now most recent
    await get('/api/cards/img/OP01-003'); // evicts OP01-002
    await get('/api/cards/img/OP01-001');
    await get('/api/cards/img/OP01-002');
    expect(calls.map((u) => u.match(/OP01-\d+/)![0])).toEqual(['OP01-001', 'OP01-002', 'OP01-003', 'OP01-002']);
  });
});
