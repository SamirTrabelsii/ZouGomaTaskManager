import crypto from 'node:crypto';
import { Router, type RequestHandler } from 'express';
import type pg from 'pg';

/**
 * The One Piece TCG card catalog, kept up to date from optcgapi.com: every set it lists, synced once a day into
 * `card_sets`, served to the app at GET /api/cards/catalog. Only card facts are stored, never art.
 */

export type Rarity = 'L' | 'C' | 'UC' | 'R' | 'SR' | 'SEC' | 'TR' | 'PR';
/**
 * base = regular print · parallel = alternate art · superParallel = super/red super alternate art · sp = Special card
 * (incl. gold/silver SP) · manga = manga rare · tr = Treasure Rare · special = other named chase prints (wanted
 * poster, signature, Pandaman art) · foil / reprint = Premium Booster prints · promo = never in packs (box toppers,
 * dash packs).
 */
export type Variant = 'base' | 'parallel' | 'superParallel' | 'sp' | 'manga' | 'tr' | 'special' | 'foil' | 'reprint' | 'promo';
/** booster = main OP set (incl. OP14-EB04 style combos) · extra = Extra Booster · premium = Premium Booster. */
export type SetKind = 'booster' | 'extra' | 'premium';

export interface CatalogCard {
  /** Stable print id, the key collections use. Prints optcgapi lists under the same id get "~variant" appended. */
  id: string;
  /** The art's file name on optcgapi.com ("OP16-011_l76oKss.jpg"); newer sets don't name files after the id. */
  img: string;
  number: string;
  name: string;
  rarity: Rarity;
  variant: Variant;
  color: string;
  type: string;
  price: number | null;
}

export interface CatalogSet {
  id: string;
  name: string;
  kind: SetKind;
  /** Order in optcgapi's list, which follows release order. */
  position: number;
  cards: CatalogCard[];
}

const RARITIES = new Set<Rarity>(['L', 'C', 'UC', 'R', 'SR', 'SEC', 'TR', 'PR']);
/** A card print id: "OP01-120_p2", "P-053_p3", "OP02-004_r1", "EB03_OP09-034_p1", "OP16-011~tr". */
export const CARD_ID = /^(?:[A-Z]{1,4}\d{0,2}_)?[A-Z]{1,4}\d{0,2}-\d{3}(?:_[a-z]\d{1,2})?(?:~[a-zA-Z]+\d*)?$/;
/** An image file name on optcgapi.com: letters, digits, "_" and "-" plus an image extension. */
export const IMAGE_FILE = /^[A-Za-z0-9_-]{3,60}\.(?:jpe?g|png|webp)$/;
const IMAGE_URL = /^https:\/\/optcgapi\.com\/media\/static\/Card_Images\/([A-Za-z0-9_.-]+)$/;

export function setKind(setId: string): SetKind {
  if (setId.startsWith('PRB')) return 'premium';
  if (setId.startsWith('EB')) return 'extra';
  return 'booster';
}

/** Name tags that mean a print variant. Others ("(Bentham)", "(Navy)", "(001)") only tell same-named cards apart. */
function variantOf(tags: Set<string>, rarity: Rarity, id: string, kind: SetKind): Variant {
  const has = (...t: string[]) => t.some((x) => tags.has(x));
  if (has('box topper', 'dash pack')) return 'promo';
  if ([...tags].some((t) => t.includes('manga'))) return 'manga';
  if (rarity === 'TR' || has('tr')) return 'tr';
  if (has('sp', 'spr')) return 'sp';
  // "Super Alternate Art", "Red Super Alternate Art", "Super Leader Alternate Art"…
  if ([...tags].some((t) => t.includes('super') && t.includes('alternate art'))) return 'superParallel';
  if (has('wanted poster', 'gold-stamped signature', 'pandaman art')) return 'special';
  if (kind === 'premium' && has('jolly roger foil', 'pirate foil', 'textured foil', 'full art')) return 'foil';
  if (has('reprint') || /_r\d+$/.test(id)) return 'reprint';
  if (has('alternate art', 'parallel') || /_p\d+$/.test(id)) return 'parallel';
  return 'base';
}

interface ApiRow {
  card_name?: unknown; card_set_id?: unknown; card_image_id?: unknown; card_image?: unknown; rarity?: unknown;
  card_color?: unknown; card_type?: unknown; market_price?: unknown;
}

/** "OP04-016_P1" → "OP04-016_p1", "OP09-078-r1" → "OP09-078_r1", "EB02-052_p2.jpg" → "EB02-052_p2". */
const cleanId = (raw: string) =>
  raw.trim().replace(/\.(jpe?g|png|webp)$/i, '').replace(/[-_]([PpRr])(\d{1,2})$/, (_, l: string, n: string) => `_${l.toLowerCase()}${n}`);

function imageFile(r: ApiRow, id: string): string | null {
  const m = typeof r.card_image === 'string' ? IMAGE_URL.exec(r.card_image) : null;
  const file = m ? m[1] : `${id}.jpg`;
  return IMAGE_FILE.test(file) ? file : null;
}

/** When prints share an id, the most regular one keeps it; the rest get "~variant". */
const VARIANT_RANK: Record<Variant, number> = {
  base: 0, reprint: 1, parallel: 2, foil: 3, special: 4, superParallel: 5, sp: 6, tr: 7, manga: 8, promo: 9,
};

/** Turns optcgapi rows into a set. Malformed or unknown rows are skipped (and counted), never fatal. */
export function parseSet(setId: string, name: string, position: number, rows: ApiRow[]): { set: CatalogSet; skipped: number } {
  const kind = setKind(setId);
  const parsed: (Omit<CatalogCard, 'id'> & { base: string })[] = [];
  let skipped = 0;
  for (const r of rows) {
    const base = typeof r.card_image_id === 'string' ? cleanId(r.card_image_id) : '';
    const raw = typeof r.card_name === 'string' ? r.card_name : '';
    const rarity = r.rarity as Rarity;
    const img = imageFile(r, base);
    if (!CARD_ID.test(base) || !raw || !RARITIES.has(rarity) || !img) { skipped++; continue; }
    const tags = new Set([...raw.matchAll(/\(([^)]+)\)/g)].map((m) => m[1].trim().toLowerCase()));
    parsed.push({
      base,
      img,
      number: typeof r.card_set_id === 'string' && r.card_set_id ? r.card_set_id : base.replace(/_[a-z]\d+$/, ''),
      // drop the tags and any " - Set (OP08)" suffix; keep the character name
      name: raw.replace(/\s*\([^)]*\)/g, '').replace(/\s+-\s+.*$/, '').trim() || raw,
      rarity,
      variant: variantOf(tags, rarity, base, kind),
      color: typeof r.card_color === 'string' ? r.card_color : '',
      type: typeof r.card_type === 'string' ? r.card_type : '',
      price: typeof r.market_price === 'number' && Number.isFinite(r.market_price) ? r.market_price : null,
    });
  }
  // optcgapi sometimes lists two prints (e.g. a card and its Treasure Rare) under one id. Ids are assigned in a fixed
  // order, not the API's row order, so a print never swaps ids with another between syncs.
  parsed.sort((a, b) => a.base.localeCompare(b.base) || VARIANT_RANK[a.variant] - VARIANT_RANK[b.variant] || a.img.localeCompare(b.img));
  const seen = new Set<string>();
  const cards = parsed.map(({ base, ...card }): CatalogCard => {
    let id = base;
    for (let n = 1; seen.has(id); n++) id = `${base}~${card.variant}${n > 1 ? n : ''}`;
    seen.add(id);
    return { id, ...card };
  });
  return { set: { id: setId, name, kind, position, cards }, skipped };
}

/* ───────── Storage + daily sync ───────── */

export const CATALOG_SCHEMA = `
CREATE TABLE IF NOT EXISTS card_sets (
  id        TEXT PRIMARY KEY,
  name      TEXT NOT NULL,
  kind      TEXT NOT NULL,
  position  INTEGER NOT NULL,
  cards     JSONB NOT NULL,
  hash      TEXT NOT NULL,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
`;

export type JsonFetcher = (url: string) => Promise<unknown>;

const API = 'https://optcgapi.com/api';
export const CATALOG_SYNC_EVERY_MS = 24 * 3600_000;
const ATTEMPT_KEY = 'catalog_attempt_at';

export const fetchJson: JsonFetcher = async (url) => {
  const res = await fetch(url, { signal: AbortSignal.timeout(60_000), redirect: 'error', headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`optcgapi ${res.status} for ${url}`);
  return res.json();
};

const hashOf = (s: CatalogSet) => crypto.createHash('sha256').update(JSON.stringify([s.name, s.kind, s.position, s.cards])).digest('hex').slice(0, 16);

async function lastAttempt(pool: pg.Pool): Promise<number | null> {
  const { rows } = await pool.query<{ value: string }>('SELECT value FROM server_settings WHERE key=$1', [ATTEMPT_KEY]);
  return rows[0] ? Number(rows[0].value) : null;
}

/**
 * Syncs the whole catalog if the last attempt is at least `everyMs` old. Sets are fetched one at a time (23 small
 * requests a day). A set that fails keeps its previous copy; sets are never deleted, since collections refer to them.
 */
export async function runDueCatalogSync(pool: pg.Pool, fetcher: JsonFetcher, now = Date.now(), everyMs = CATALOG_SYNC_EVERY_MS) {
  // claim the run atomically, so two server processes never sync at once
  const claim = await pool.query(
    `INSERT INTO server_settings (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value WHERE server_settings.value::bigint <= $3`,
    [ATTEMPT_KEY, String(now), now - everyMs]);
  if (!claim.rowCount) return null;

  const list = await fetcher(`${API}/allSets/`);
  if (!Array.isArray(list)) throw new Error('optcgapi allSets: unexpected answer');
  let changed = 0;
  let failed = 0;
  for (const [position, s] of list.entries()) {
    const id = (s as { set_id?: unknown }).set_id;
    const name = (s as { set_name?: unknown }).set_name;
    if (typeof id !== 'string' || !/^[A-Z0-9-]{3,16}$/.test(id) || typeof name !== 'string') continue;
    try {
      const rows = await fetcher(`${API}/sets/${encodeURIComponent(id)}/`);
      if (!Array.isArray(rows) || !rows.length) throw new Error('no cards');
      const { set } = parseSet(id, name, position, rows as ApiRow[]);
      const hash = hashOf(set);
      const r = await pool.query(
        `INSERT INTO card_sets (id, name, kind, position, cards, hash, synced_at) VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (id) DO UPDATE SET name=$2, kind=$3, position=$4, cards=$5, hash=$6, synced_at=$7 WHERE card_sets.hash <> $6`,
        [id, name, set.kind, position, JSON.stringify(set.cards), hash, new Date(now)]);
      changed += r.rowCount ?? 0;
    } catch (e) {
      failed++;
      console.error(`catalog sync ${id}:`, (e as Error).message);
    }
  }
  return { sets: list.length, changed, failed };
}

/** When the next daily sync is due: right away if it never ran. */
export async function nextCatalogSyncAt(pool: pg.Pool, everyMs = CATALOG_SYNC_EVERY_MS): Promise<number> {
  const last = await lastAttempt(pool);
  return last === null ? Date.now() : last + everyMs;
}

/* ───────── API ───────── */

/** Compact wire format: one array per card, [id, img, number, name, rarity, variant, color, type, price]. */
export type WireCard = [string, string, string, string, Rarity, Variant, string, string, number | null];
export const toWire = (c: CatalogCard): WireCard => [c.id, c.img, c.number, c.name, c.rarity, c.variant, c.color, c.type, c.price];
export interface WireCatalog {
  syncedAt: string | null;
  sets: { id: string; name: string; kind: SetKind; position: number; cards: WireCard[] }[];
}

export function catalogRouter(pool: pg.Pool, auth: RequestHandler) {
  let cached: { etag: string; body: string } | null = null;
  const router = Router();
  router.get('/catalog', auth, async (req, res, next) => {
    try {
      const { rows: heads } = await pool.query<{ hash: string; synced_at: Date }>('SELECT hash, synced_at FROM card_sets ORDER BY position, id');
      const etag = `"${crypto.createHash('sha256').update(heads.map((h) => h.hash).join()).digest('hex').slice(0, 20)}"`;
      res.set('Cache-Control', 'private, no-cache').set('ETag', etag);
      if (req.headers['if-none-match'] === etag) return res.status(304).end();
      if (cached?.etag !== etag) {
        const { rows } = await pool.query<{ id: string; name: string; kind: SetKind; position: number; cards: CatalogCard[] }>(
          'SELECT id, name, kind, position, cards FROM card_sets ORDER BY position, id');
        const latest = heads.reduce<Date | null>((m, h) => (!m || h.synced_at > m ? h.synced_at : m), null);
        const body: WireCatalog = {
          syncedAt: latest?.toISOString() ?? null,
          sets: rows.map((s) => ({
            id: s.id, name: s.name, kind: s.kind, position: s.position,
            cards: s.cards.map(toWire),
          })),
        };
        cached = { etag, body: JSON.stringify(body) };
      }
      res.type('application/json').send(cached.body);
    } catch (e) { next(e); }
  });
  return router;
}
