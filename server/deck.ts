import crypto from 'node:crypto';
import { Router, type Request, type RequestHandler } from 'express';
import type pg from 'pg';
import { listTokens, makeRequireAgent, tokenRoutes, agentUserOf, type Limiter } from './agent';

/**
 * The stream deck: a small window of buttons floating on the owner's PC (the `deck/` app of lifeos-agent). LifeOS only keeps
 * its layout; the deck runs every action itself, on the PC.
 *
 * The deck signs in with a bearer token of scope 'deck', which opens one route: POST /sync. That call reports what the PC
 * has (the scripts and sounds in its folders, never their content, and its Chrome profiles by name) and returns the buttons. The deck makes it when it starts
 * and when the owner clicks refresh, never on a timer, so it does not keep a sleeping database awake.
 *
 * LifeOS never sends a command line. A script is named, and the deck only runs files from its own scripts folder. The deck
 * also asks the owner once, on the PC, before it runs any action it has not seen before.
 */

export const DECK_SCHEMA = `
CREATE TABLE IF NOT EXISTS deck_config (
  user_id         BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  columns         INTEGER NOT NULL DEFAULT 4,
  buttons         JSONB NOT NULL DEFAULT '[]',
  revision        INTEGER NOT NULL DEFAULT 0,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  synced_at       TIMESTAMPTZ,
  synced_revision INTEGER NOT NULL DEFAULT 0,
  deck_version    TEXT NOT NULL DEFAULT '',
  inventory       JSONB NOT NULL DEFAULT '{"scripts":[],"sounds":[]}'
);
`;

export const MAX_BUTTONS = 32;
export const MIN_COLUMNS = 2;
export const MAX_COLUMNS = 8;
export const MAX_LABEL = 24;
const MAX_INVENTORY = 200;

export const SCRIPT_FILE = /^[\w .()-]{1,80}\.(ps1|bat|cmd)$/i;
export const SOUND_FILE = /^[\w .()-]{1,80}\.(wav|mp3|ogg)$/i;
/** An absolute Windows path to a program or a shortcut. */
const APP_PATH = /^[A-Za-z]:\\[^<>"|?*\r\n]{1,255}\.(exe|lnk)$/i;
/** A Windows protocol link such as ms-screenclip: or ms-settings:display (web and file links are not apps). */
const APP_URI = /^(?!(?:https?|file|javascript|data|vbscript):)[a-z][a-z0-9+.-]{1,30}:[^\s"<>]{0,200}$/i;
/** A Chrome profile folder name, e.g. "Default" or "Profile 2" (never something that reads as a command-line switch). */
const CHROME_PROFILE = /^[A-Za-z0-9][\w -]{0,59}$/;

export type DeckAction =
  | { type: 'website'; url: string; browser: 'default' | 'chrome'; profile: string }
  | { type: 'app'; target: string }
  | { type: 'script'; file: string }
  | { type: 'sound'; file: string; volume: number };

export interface DeckButton { id: string; label: string; icon: string; color: string; action: DeckAction }

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

function parseAction(v: unknown): DeckAction | string {
  if (!isObj(v)) return 'Each button needs an action.';
  switch (v.type) {
    case 'website': {
      const url = text(v.url);
      let ok = false;
      try { const u = new URL(url); ok = (u.protocol === 'https:' || u.protocol === 'http:') && url.length <= 500; } catch { /* not a url */ }
      if (!ok) return 'A website needs a full address starting with https:// (or http://).';
      const browser = v.browser === 'chrome' ? 'chrome' : 'default';
      const profile = text(v.profile);
      if (profile && !CHROME_PROFILE.test(profile)) return 'The Chrome profile is a folder name such as “Default” or “Profile 2”.';
      return { type: 'website', url, browser, profile: browser === 'chrome' ? profile : '' };
    }
    case 'app': {
      const target = text(v.target);
      if (!APP_PATH.test(target) && !APP_URI.test(target)) {
        return 'An app is the full path of a program or shortcut (C:\\…\\app.exe or .lnk), or a Windows link such as ms-screenclip:.';
      }
      return { type: 'app', target };
    }
    case 'script': {
      const file = text(v.file);
      if (!SCRIPT_FILE.test(file)) return 'A script is the name of a .ps1, .bat or .cmd file in the deck’s scripts folder (no folder, no arguments).';
      return { type: 'script', file };
    }
    case 'sound': {
      const file = text(v.file);
      if (!SOUND_FILE.test(file)) return 'A sound is the name of a .wav, .mp3 or .ogg file in the deck’s sounds folder.';
      const volume = typeof v.volume === 'number' && Number.isFinite(v.volume) ? Math.round(Math.min(100, Math.max(0, v.volume))) : 80;
      return { type: 'sound', file, volume };
    }
    default: return 'Unknown action type.';
  }
}

/** Checks a whole layout from the owner. Returns the clean layout, or the first problem as a message. */
export function parseDeck(body: unknown): { columns: number; buttons: DeckButton[] } | string {
  if (!isObj(body)) return 'Send { columns, buttons }.';
  const columns = body.columns;
  if (!Number.isInteger(columns) || (columns as number) < MIN_COLUMNS || (columns as number) > MAX_COLUMNS) {
    return `Columns must be a whole number from ${MIN_COLUMNS} to ${MAX_COLUMNS}.`;
  }
  if (!Array.isArray(body.buttons)) return 'buttons must be a list.';
  if (body.buttons.length > MAX_BUTTONS) return `A deck holds at most ${MAX_BUTTONS} buttons.`;
  const buttons: DeckButton[] = [];
  const ids = new Set<string>();
  for (const [i, raw] of body.buttons.entries()) {
    if (!isObj(raw)) return 'Each button must be an object.';
    const n = `Button ${i + 1}`;
    const label = text(raw.label).replace(/\s+/g, ' ');
    if (!label || label.length > MAX_LABEL) return `${n}: give it a label of up to ${MAX_LABEL} characters.`;
    const icon = text(raw.icon);
    if ([...icon].length > 4) return `${n}: the icon is one emoji or up to 4 characters.`;
    const color = text(raw.color) || '#3a4256';
    if (!/^#[0-9a-f]{6}$/i.test(color)) return `${n}: the colour must look like #3a4256.`;
    let id = typeof raw.id === 'string' && /^[\w-]{1,64}$/.test(raw.id) ? raw.id : crypto.randomUUID();
    if (ids.has(id)) id = crypto.randomUUID();
    ids.add(id);
    const action = parseAction(raw.action);
    if (typeof action === 'string') return `${n} (${label}): ${action}`;
    buttons.push({ id, label, icon, color: color.toLowerCase(), action });
  }
  return { columns: columns as number, buttons };
}

export interface ChromeProfile { dir: string; name: string; account: string }
/**
 * The Chrome profiles the deck reports: folder, name, and the account with all but its first letter hidden (the deck masks
 * it; anything still looking like a full address is dropped here).
 */
function cleanProfiles(v: unknown): ChromeProfile[] {
  if (!Array.isArray(v)) return [];
  const out: ChromeProfile[] = [];
  for (const p of v.slice(0, 50)) {
    if (!isObj(p) || typeof p.dir !== 'string' || !CHROME_PROFILE.test(p.dir)) continue;
    const name = typeof p.name === 'string' ? p.name.trim().slice(0, 60) : '';
    const account = typeof p.account === 'string' && /^[^@\s]…@[^@\s]{1,70}$/.test(p.account) ? p.account : '';
    out.push({ dir: p.dir, name: name || p.dir, account });
  }
  return out;
}

/** The file names the deck reports, kept only when they are plain names of the right kind. */
function cleanList(v: unknown, re: RegExp): string[] {
  if (!Array.isArray(v)) return [];
  return [...new Set(v.filter((x): x is string => typeof x === 'string' && re.test(x)))].sort((a, b) => a.localeCompare(b)).slice(0, MAX_INVENTORY);
}

export function deckRouter(
  pool: pg.Pool,
  requireAuth: RequestHandler,
  userIdOf: (req: Request) => number,
  limits: { perToken: Limiter; failures: Limiter },
) {
  const router = Router();
  const requireDeck = makeRequireAgent(pool, limits, 'deck');

  const read = async (userId: number) => {
    const { rows } = await pool.query(
      'SELECT columns, buttons, revision, updated_at, synced_at, synced_revision, deck_version, inventory FROM deck_config WHERE user_id=$1', [userId]);
    return rows[0] as undefined | {
      columns: number; buttons: DeckButton[]; revision: number; updated_at: Date; synced_at: Date | null;
      synced_revision: number; deck_version: string; inventory: { scripts?: string[]; sounds?: string[]; chromeProfiles?: ChromeProfile[] };
    };
  };

  /* ── owner (signed-in session) ── */

  /** The layout, what the deck last reported and the deck tokens, in one call for the panel and the room. */
  router.get('/', requireAuth, async (req, res, next) => {
    try {
      const userId = userIdOf(req);
      const [row, tokens] = await Promise.all([read(userId), listTokens(pool, userId, 'deck')]);
      res.json({
        columns: row?.columns ?? 4, buttons: row?.buttons ?? [], revision: row?.revision ?? 0, updatedAt: row?.updated_at ?? null,
        deck: {
          syncedAt: row?.synced_at ?? null, syncedRevision: row?.synced_revision ?? 0, version: row?.deck_version ?? '',
          scripts: row?.inventory.scripts ?? [], sounds: row?.inventory.sounds ?? [], chromeProfiles: row?.inventory.chromeProfiles ?? [],
        },
        tokens,
      });
    } catch (e) { next(e); }
  });

  router.put('/', requireAuth, async (req, res, next) => {
    try {
      const parsed = parseDeck(req.body);
      if (typeof parsed === 'string') return res.status(400).json({ error: parsed });
      const { rows } = await pool.query(
        `INSERT INTO deck_config (user_id, columns, buttons, revision, updated_at) VALUES ($1, $2, $3, 1, now())
         ON CONFLICT (user_id) DO UPDATE SET columns=$2, buttons=$3, revision=deck_config.revision + 1, updated_at=now()
         RETURNING revision, updated_at`,
        [userIdOf(req), parsed.columns, JSON.stringify(parsed.buttons)]);
      res.json({ ...parsed, revision: rows[0].revision, updatedAt: rows[0].updated_at });
    } catch (e) { next(e); }
  });

  tokenRoutes(router, pool, requireAuth, userIdOf, 'deck');

  /* ── the deck on the PC (bearer token of scope 'deck') ── */

  router.post('/sync', requireDeck, async (req, res, next) => {
    try {
      const userId = agentUserOf(req);
      const b = isObj(req.body) ? req.body : {};
      const version = typeof b.version === 'string' ? b.version.slice(0, 40) : '';
      const inventory = { scripts: cleanList(b.scripts, SCRIPT_FILE), sounds: cleanList(b.sounds, SOUND_FILE), chromeProfiles: cleanProfiles(b.chromeProfiles) };
      const { rows } = await pool.query(
        `INSERT INTO deck_config (user_id, synced_at, deck_version, inventory) VALUES ($1, now(), $2, $3)
         ON CONFLICT (user_id) DO UPDATE SET synced_at=now(), synced_revision=deck_config.revision, deck_version=$2, inventory=$3
         RETURNING columns, buttons, revision`,
        [userId, version, JSON.stringify(inventory)]);
      res.json({ columns: rows[0].columns, buttons: rows[0].buttons, revision: rows[0].revision });
    } catch (e) { next(e); }
  });

  return router;
}
