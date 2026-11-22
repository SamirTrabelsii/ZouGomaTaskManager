/**
 * The stream deck: a floating window of buttons on the owner's PC (lifeos-agent's `deck/` app). LifeOS keeps the layout; the
 * deck fetches it when it starts or when its ⟳ is clicked, and runs every action itself. See server/deck.ts.
 */

export type DeckActionType = 'website' | 'app' | 'script' | 'sound';

export type DeckAction =
  | { type: 'website'; url: string; browser: 'default' | 'chrome'; profile: string }
  | { type: 'app'; target: string }
  | { type: 'script'; file: string }
  | { type: 'sound'; file: string; volume: number };

/** A One Piece card from the binder as the button's face (its art file and name). */
export interface DeckCard { img: string; name: string }
export interface DeckButton { id: string; label: string; icon: string; color: string; card?: DeckCard; action: DeckAction }

export type DeckFileKind = 'sound' | 'script';
/** A sound or script uploaded in LifeOS; the deck copies it into its folder when it syncs. */
export interface DeckFile { kind: DeckFileKind; name: string; sha256: string; size: number; updatedAt: string }
export const MAX_SOUND_BYTES = 3 * 1024 * 1024;
export const MAX_SCRIPT_BYTES = 64 * 1024;

/** Which folder a file goes to, from its name; null when it is neither a sound nor a script. */
export function fileKindOf(name: string): DeckFileKind | null {
  if (/^[\w .()-]{1,80}\.(wav|mp3|ogg)$/i.test(name)) return 'sound';
  if (/^[\w .()-]{1,80}\.(ps1|bat|cmd)$/i.test(name)) return 'script';
  return null;
}

/** The names a picker offers: what the deck reported from its folder, plus what was uploaded here. */
export function offeredFiles(o: DeckOverview, kind: DeckFileKind): string[] {
  const local = kind === 'sound' ? o.deck.sounds : o.deck.scripts;
  const uploaded = (o.files ?? []).filter((f) => f.kind === kind).map((f) => f.name);
  return [...new Set([...local, ...uploaded])].sort((a, b) => a.localeCompare(b));
}

/** A Chrome profile on the PC, as the deck reports it: its folder, its name in Chrome, and the account partly hidden. */
export interface ChromeProfile { dir: string; name: string; account: string }

export interface DeckToken { id: string; name: string; hint: string; createdAt: string; lastUsedAt: string | null }

export interface DeckOverview {
  columns: number;
  buttons: DeckButton[];
  /** Goes up by one on every save. */
  revision: number;
  updatedAt: string | null;
  /** What the deck on the PC last reported. */
  deck: { syncedAt: string | null; syncedRevision: number; version: string; scripts: string[]; sounds: string[]; chromeProfiles?: ChromeProfile[] };
  tokens: DeckToken[];
  files?: DeckFile[];
}

export const MAX_BUTTONS = 32;
export const MIN_COLUMNS = 2;
export const MAX_COLUMNS = 8;
export const MAX_LABEL = 24;

export const ACTION_LABELS: Record<DeckActionType, string> = {
  website: 'Open a website',
  app: 'Open an app',
  script: 'Run a script',
  sound: 'Play a sound',
};

/** The colours offered for a button face (any #rrggbb is accepted). */
export const BUTTON_COLORS = ['#3a4256', '#4f7a52', '#2e86de', '#8e44ad', '#c0392b', '#d35400', '#b8860b', '#16a085'];

/** A fresh action of a type, with sensible defaults. */
export function blankAction(type: DeckActionType): DeckAction {
  switch (type) {
    case 'website': return { type, url: 'https://', browser: 'default', profile: '' };
    case 'app': return { type, target: '' };
    case 'script': return { type, file: '' };
    case 'sound': return { type, file: '', volume: 80 };
  }
}

export function newButton(id: string): DeckButton {
  return { id, label: 'New button', icon: '⭐', color: BUTTON_COLORS[0], action: blankAction('website') };
}

/** One line saying what the button does, for the editor and the room. */
export function describeAction(a: DeckAction): string {
  switch (a.type) {
    case 'website': {
      let host = a.url;
      try { host = new URL(a.url).host || a.url; } catch { /* show as typed */ }
      return `Opens ${host}${a.browser === 'chrome' ? ` in Chrome${a.profile ? ` (${a.profile})` : ''}` : ''}`;
    }
    case 'app':
      if (/^ms-screenclip:/i.test(a.target)) return 'Opens the screen capture';
      return a.target ? `Opens ${a.target.split('\\').pop()}` : 'Opens an app';
    case 'script': return a.file ? `Runs ${a.file}` : 'Runs a script';
    case 'sound': return a.file ? `Plays ${a.file}` : 'Plays a sound';
  }
}

/** The first examples, offered on an empty deck: screen capture, LifeOS in Chrome, applause. */
export function starterButtons(origin: string, makeId: () => string): DeckButton[] {
  return [
    { id: makeId(), label: 'Capture', icon: '📸', color: '#2e86de', action: { type: 'app', target: 'ms-screenclip:' } },
    { id: makeId(), label: 'LifeOS', icon: '🏝️', color: '#4f7a52', action: { type: 'website', url: origin.startsWith('http') ? `${origin}/` : 'https://', browser: 'chrome', profile: 'Default' } },
    { id: makeId(), label: 'Applause', icon: '👏', color: '#d35400', action: { type: 'sound', file: 'applause.wav', volume: 80 } },
  ];
}

/**
 * How Brook Bot looks after the deck:
 *  - unplugged: no deck has ever connected;
 *  - outdated: the buttons changed since the deck last fetched them (click ⟳ on the deck);
 *  - ready: the deck has the current buttons.
 */
export type DeckMood = 'unplugged' | 'outdated' | 'ready';

export function deckMood(o: DeckOverview | null): DeckMood {
  if (!o || !o.deck.syncedAt) return 'unplugged';
  return o.revision > o.deck.syncedRevision ? 'outdated' : 'ready';
}

export function deckSummary(o: DeckOverview | null): { summary: string; prompt: string | null } {
  if (!o) return { summary: 'Stream deck', prompt: null };
  const n = o.buttons.length;
  const buttons = `${n} button${n === 1 ? '' : 's'}`;
  switch (deckMood(o)) {
    case 'unplugged': return { summary: n ? `${buttons} · deck not connected` : 'No buttons yet', prompt: 'Set up your stream deck' };
    case 'outdated': return { summary: `${buttons} · click ⟳ on the deck`, prompt: null };
    case 'ready': return { summary: `${buttons} · deck up to date`, prompt: null };
  }
}

/** A short problem with a button, or null. Mirrors the server's checks so the editor can flag them before saving. */
export function buttonProblem(b: DeckButton): string | null {
  if (!b.label.trim()) return 'Give it a label.';
  if (b.label.trim().length > MAX_LABEL) return `Keep the label under ${MAX_LABEL + 1} characters.`;
  if ([...b.icon.trim()].length > 4) return 'The icon is one emoji (or up to 4 characters).';
  const a = b.action;
  switch (a.type) {
    case 'website': {
      try { const u = new URL(a.url); if (u.protocol !== 'https:' && u.protocol !== 'http:') return 'The address must start with https://.'; } catch { return 'Type the full address, starting with https://.'; }
      if (a.browser === 'chrome' && a.profile && !/^[A-Za-z0-9][\w -]{0,59}$/.test(a.profile)) return 'The Chrome profile is a folder name such as “Default” or “Profile 2”.';
      return null;
    }
    case 'app':
      return /^[A-Za-z]:\\[^<>"|?*\r\n]{1,255}\.(exe|lnk)$/i.test(a.target) || /^(?!(?:https?|file|javascript|data|vbscript):)[a-z][a-z0-9+.-]{1,30}:[^\s"<>]{0,200}$/i.test(a.target)
        ? null : 'Use the full path of a program or shortcut (C:\\…\\app.exe or .lnk), or a Windows link such as ms-screenclip:.';
    case 'script':
      return /^[\w .()-]{1,80}\.(ps1|bat|cmd)$/i.test(a.file) ? null : 'Pick a .ps1, .bat or .cmd file from the deck’s scripts folder.';
    case 'sound':
      return /^[\w .()-]{1,80}\.(wav|mp3|ogg)$/i.test(a.file) ? null : 'Pick a .wav, .mp3 or .ogg file from the deck’s sounds folder.';
  }
}

/** Moves the item at `from` by `delta` places, staying inside the list. */
export function moveItem<T>(list: T[], from: number, delta: number): T[] {
  const to = Math.min(list.length - 1, Math.max(0, from + delta));
  if (to === from) return list;
  const next = list.slice();
  const [it] = next.splice(from, 1);
  next.splice(to, 0, it);
  return next;
}

/**
 * A layout as a string that only changes when the layout does: key order does not count (the editor adds a card at the end
 * of a button, the server stores it before the action) and neither does a card left as undefined.
 */
export function layoutKey(columns: number, buttons: DeckButton[]): string {
  const sorted = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sorted);
    if (v && typeof v === 'object') {
      return Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, sorted(x)]));
    }
    return v;
  };
  return JSON.stringify(sorted([columns, buttons]));
}
