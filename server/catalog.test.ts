import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createPool, migrate } from './db';
import { catalogRouter, nextCatalogSyncAt, parseSet, runDueCatalogSync, setKind, type JsonFetcher, type WireCatalog } from './catalog';

const row = (id: string, name: string, rarity: string, extra: object = {}) => ({
  card_image_id: id, card_name: name, rarity, card_set_id: id.replace(/_.*$/, ''), card_color: 'Red', card_type: 'Character',
  market_price: 1.5, card_image: `https://optcgapi.com/media/static/Card_Images/${id}.jpg`, ...extra,
});

describe('parsing a set', () => {
  it('classifies prints by their variant tags, ignoring tags that only tell names apart', () => {
    const { set } = parseSet('OP-17', 'Strongest', 21, [
      row('OP17-001', 'Kid (001)', 'L'),
      row('OP17-001_p1', 'Kid (001) (Alternate Art)', 'L'),
      row('OP17-010_p2', 'Ace (SP) (Gold)', 'SR'),
      row('OP17-020_p3', 'Shanks (Manga)', 'SEC'),
      row('OP17-030_p1', 'Mr.2 (Bentham) (Parallel)', 'R'),
      row('OP17-040_p2', 'Zephyr (Navy)', 'R'),
      row('OP17-050', 'Kingdew (Pandaman Art)', 'C'),
      row('OP17-060_p1', 'Monet (Dash Pack)', 'R'),
      row('OP17-070_p2', 'Sabo (Super Alternate Art)', 'SEC'),
      row('OP17-080_p2', 'Newgate (TR)', 'TR'),
    ]);
    expect(Object.fromEntries(set.cards.map((c) => [c.id, c.variant]))).toEqual({
      'OP17-001': 'base', 'OP17-001_p1': 'parallel', 'OP17-010_p2': 'sp', 'OP17-020_p3': 'manga', 'OP17-030_p1': 'parallel',
      'OP17-040_p2': 'parallel', 'OP17-050': 'special', 'OP17-060_p1': 'promo', 'OP17-070_p2': 'superParallel', 'OP17-080_p2': 'tr',
    });
    expect(set.cards.find((c) => c.id === 'OP17-030_p1')!.name).toBe('Mr.2');
  });

  it('keeps each print\'s real image file, since newer sets don\'t name files after the id', () => {
    const { set } = parseSet('OP-16', 'Battle', 20, [row('OP16-011', 'Vista', 'R', { card_image: 'https://optcgapi.com/media/static/Card_Images/OP16-011_67MW6R6.jpg' })]);
    expect(set.cards[0]).toMatchObject({ id: 'OP16-011', img: 'OP16-011_67MW6R6.jpg' });
  });

  it('keeps two prints listed under one id apart, with the same ids whatever order the API sends them in', () => {
    const base = row('OP16-011', 'Vista', 'R', { card_image: 'https://optcgapi.com/media/static/Card_Images/OP16-011_a.jpg' });
    const tr = row('OP16-011', 'Vista (TR)', 'TR', { card_image: 'https://optcgapi.com/media/static/Card_Images/OP16-011_b.jpg' });
    const ids = (rows: object[]) => parseSet('OP-16', 'Battle', 20, rows).set.cards.map((c) => `${c.id}=${c.img}`).sort();
    expect(ids([base, tr])).toEqual(['OP16-011=OP16-011_a.jpg', 'OP16-011~tr=OP16-011_b.jpg']);
    expect(ids([tr, base])).toEqual(ids([base, tr]));
  });

  it('repairs sloppy ids and skips rows it cannot trust', () => {
    const { set, skipped } = parseSet('PRB-02', 'Best 2', 15, [
      row('OP04-016_P1', 'Kick (Alternate Art)', 'R'),
      row('OP09-078-r1', 'Gum-Gum Giant (Reprint)', 'R'),
      row('EB02-052_p2.jpg', 'Luffy (Alternate Art)', 'SR', { card_image: 'https://optcgapi.com/media/static/Card_Images/EB02-052_p2.jpg' }),
      row('../etc', 'Evil', 'R'),
      row('OP01-001', 'Odd', 'ZZ'),
      row('OP01-002', 'Elsewhere', 'C', { card_image: 'https://evil.test/x.jpg' }),
    ]);
    expect(set.cards.map((c) => c.id)).toEqual(['EB02-052_p2', 'OP01-002', 'OP04-016_p1', 'OP09-078_r1']);
    expect(set.cards.find((c) => c.id === 'OP01-002')!.img).toBe('OP01-002.jpg'); // foreign host ignored
    expect(skipped).toBe(2);
  });

  it('knows the product type from the set id', () => {
    expect([setKind('OP-17'), setKind('OP14-EB04'), setKind('EB-03'), setKind('PRB-02')]).toEqual(['booster', 'booster', 'extra', 'premium']);
  });
});

const URL_ = process.env.TEST_DATABASE_URL ?? 'postgres://lifeos:lifeos-dev-password@localhost:5433/lifeos_test';
const pool = createPool(URL_);
let reachable = false;
try { await pool.query('SELECT 1'); reachable = true; } catch { /* skipped */ }

describe.skipIf(!reachable)('daily catalog sync and API', () => {
  const NOW = Date.UTC(2026, 9, 21, 6);
  let server: Server | null = null;
  beforeAll(async () => {
    if (!/_test$/.test(new URL(URL_).pathname.replace(/^\//, ''))) throw new Error('Refusing to run destructive tests on a non-test database');
    await migrate(pool);
  });
  beforeEach(async () => {
    await pool.query('TRUNCATE card_sets');
    await pool.query("DELETE FROM server_settings WHERE key='catalog_attempt_at'");
  });
  afterEach(() => { server?.close(); server = null; });
  afterAll(async () => { await pool.end(); });

  const api = (sets: Record<string, object[]>, calls: string[] = []): JsonFetcher => async (url) => {
    calls.push(url);
    if (url.endsWith('/allSets/')) return Object.keys(sets).map((id) => ({ set_id: id, set_name: `Set ${id}` }));
    const id = decodeURIComponent(url.split('/sets/')[1].replace(/\/$/, ''));
    if (sets[id] === undefined) throw new Error('down');
    return sets[id];
  };
  const get = (headers: Record<string, string> = {}) => {
    const app = express();
    app.use('/api/cards', catalogRouter(pool, (_q, _s, n) => n()));
    server = app.listen(0);
    return fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/cards/catalog`, { headers });
  };

  it('stores every set, then waits a day before asking again', async () => {
    const calls: string[] = [];
    const r = await runDueCatalogSync(pool, api({ 'OP-01': [row('OP01-001', 'Zoro', 'L')], 'OP-02': [row('OP02-001', 'Newgate', 'L')] }, calls), NOW);
    expect(r).toEqual({ sets: 2, changed: 2, failed: 0 });
    expect(await runDueCatalogSync(pool, api({}, calls), NOW + 3600_000)).toBeNull();
    expect(calls).toHaveLength(3);
    expect(await nextCatalogSyncAt(pool)).toBe(NOW + 24 * 3600_000);
  });

  it('a set that fails to download keeps its previous copy, and unchanged sets are not rewritten', async () => {
    await runDueCatalogSync(pool, api({ 'OP-01': [row('OP01-001', 'Zoro', 'L')], 'OP-02': [row('OP02-001', 'Newgate', 'L')] }), NOW);
    const later = NOW + 25 * 3600_000;
    const r = await runDueCatalogSync(pool, api({ 'OP-01': [row('OP01-001', 'Zoro', 'L')], 'OP-02': undefined as unknown as object[] }), later);
    expect(r).toEqual({ sets: 2, changed: 0, failed: 1 });
    const { rows } = await pool.query('SELECT id FROM card_sets ORDER BY id');
    expect(rows.map((x) => x.id)).toEqual(['OP-01', 'OP-02']);
  });

  it('serves the catalog compactly, and answers 304 when nothing changed', async () => {
    await runDueCatalogSync(pool, api({ 'OP-01': [row('OP01-001', 'Zoro', 'L')] }), NOW);
    const res = await get();
    expect(res.status).toBe(200);
    const body = (await res.json()) as WireCatalog;
    expect(body.sets[0]).toMatchObject({ id: 'OP-01', kind: 'booster', cards: [['OP01-001', 'OP01-001.jpg', 'OP01-001', 'Zoro', 'L', 'base', 'Red', 'Character', 1.5]] });
    server?.close();
    expect((await get({ 'if-none-match': res.headers.get('etag')! })).status).toBe(304);
  });
});
