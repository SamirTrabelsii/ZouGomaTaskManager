// Quick-add parser for the popup: "Call the bank tomorrow #perso !" → title, due date, scope, priority.
// French and English. Pure functions (no chrome.*), so they are unit-tested in parse.test.js.

/** YYYY-MM-DD in local time. */
export const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const validDay = (y, m, day) => { const d = new Date(y, m, day); return d.getFullYear() === y && d.getMonth() === m && d.getDate() === day ? d : null; };

/** Lower case without accents, same length as the input, so a match in it is a match at the same place in the original. */
export function fold(s) {
  let out = '';
  for (const c of s) {
    const n = c.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    out += n.length === c.length ? n : c.toLowerCase().length === c.length ? c.toLowerCase() : c;
  }
  return out;
}

const WEEKDAYS = {
  dimanche: 0, lundi: 1, mardi: 2, mercredi: 3, jeudi: 4, vendredi: 5, samedi: 6,
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6,
};
const B = '(?<![\\p{L}\\d])'; // word start
const E = '(?![\\p{L}\\d])';  // word end
// optional little words before a date: "pour demain", "le 20", "on friday", "by monday", "ce vendredi"
const PRE = '(?:(?:pour|avant|d\'ici|ce|cette|le|on|by|due|for|this|next)\\s+)?';

/** [pattern, (match, today) => Date | null]. Tried in order; the first that gives a date wins. */
const RULES = [
  [`${PRE}(?:apres[- ]demain|day after tomorrow)`, (_m, t) => addDays(t, 2)],
  [`${PRE}(?:aujourd'?hui|auj|today|tdy|ce soir|tonight)`, (_m, t) => t],
  [`${PRE}(?:demain|tomorrow|tmrw?)`, (_m, t) => addDays(t, 1)],
  [`(?:semaine prochaine|next week)`, (_m, t) => addDays(t, ((8 - t.getDay()) % 7) || 7)], // next Monday
  [`(?:dans|in)\\s+(\\d{1,3})\\s+(jours?|days?|semaines?|weeks?)`, (m, t) => addDays(t, Number(m[1]) * (/^(semaine|week)/.test(m[2]) ? 7 : 1))],
  [`${PRE}(${Object.keys(WEEKDAYS).join('|')})(?:\\s+(?:prochain|next))?`, (m, t) => {
    const want = WEEKDAYS[m[1]];
    return addDays(t, ((want - t.getDay() + 7) % 7) || 7); // the next one, never today
  }],
  [`(\\d{4})-(\\d{2})-(\\d{2})`, (m) => validDay(Number(m[1]), Number(m[2]) - 1, Number(m[3]))],
  [`${PRE}(\\d{1,2})[/.](\\d{1,2})(?:[/.](\\d{2}|\\d{4}))?`, (m, t) => {
    const day = Number(m[1]); const mon = Number(m[2]) - 1;
    if (m[3]) return validDay(m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]), mon, day);
    const d = validDay(t.getFullYear(), mon, day);
    return d && d < t ? validDay(t.getFullYear() + 1, mon, day) : d; // a past date means next year
  }],
  [`(?:le|on the|the)\\s+(\\d{1,2})(?:er|st|nd|rd|th)?`, (m, t) => {
    const day = Number(m[1]);
    const d = validDay(t.getFullYear(), t.getMonth(), day);
    if (d && d >= t) return d;
    return validDay(t.getFullYear() + (t.getMonth() === 11 ? 1 : 0), (t.getMonth() + 1) % 12, day); // already past: next month
  }],
];
const COMPILED = RULES.map(([src, fn]) => [new RegExp(`${B}${src}${E}`, 'u'), fn]);

/** Scope whose title (folded, without emoji or spaces) equals or starts with the typed word. */
const key = (s) => fold(s).replace(/[^\p{L}\p{N}]/gu, '');
export function matchScopes(word, scopes) {
  const k = key(word);
  if (!k) return scopes.slice();
  const exact = scopes.filter((s) => key(s.title) === k);
  return exact.length ? exact : scopes.filter((s) => key(s.title).startsWith(k));
}

/**
 * Reads the quick-add text. Returns { title, dueDate, priority, scopeId, scopeQuery }:
 * - dueDate: YYYY-MM-DD or null; priority: 'high' or null; scopeId: a matched scope or null;
 * - scopeQuery: the "#word" being typed at the very end (for suggestions), or null.
 * What is understood is taken out of the title; anything else stays as typed.
 */
export function parseQuickAdd(text, { scopes = [], now = new Date() } = {}) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let s = String(text ?? '');
  const out = { title: '', dueDate: null, priority: null, scopeId: null, scopeQuery: null };

  const tail = /(?:^|\s)#([^\s#]*)$/u.exec(s);
  if (tail) out.scopeQuery = tail[1];

  // priority: a lone "!" (or "!!") anywhere, or "!" glued to the last word
  if (/(?:^|\s)!{1,3}(?=\s|$)/.test(s) || /!\s*$/.test(s)) {
    out.priority = 'high';
    s = s.replace(/(?:^|\s)!{1,3}(?=\s|$)/g, ' ').replace(/!+\s*$/, '');
  }

  // scope: the first #word that names a scope
  for (const m of s.matchAll(/(?:^|\s)#([^\s#]+)/gu)) {
    const hit = matchScopes(m[1], scopes);
    if (hit.length === 1 || (hit.length > 1 && key(hit[0].title) === key(m[1]))) {
      out.scopeId = hit[0].id;
      s = s.slice(0, m.index) + ' ' + s.slice(m.index + m[0].length);
      break;
    }
  }

  // due date: the first phrase that reads as one
  const folded = fold(s);
  for (const [re, fn] of COMPILED) {
    const m = re.exec(folded);
    if (!m) continue;
    const d = fn(m, today);
    if (!d) continue;
    out.dueDate = ymd(d);
    s = s.slice(0, m.index) + ' ' + s.slice(m.index + m[0].length);
    break;
  }

  out.title = s.replace(/\s+/g, ' ').trim();
  return out;
}
