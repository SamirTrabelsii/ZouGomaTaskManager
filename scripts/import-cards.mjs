// Snapshots one One Piece TCG set from optcgapi.com into src/data/cards/<SET>.json.
//   node scripts/import-cards.mjs OP-01
// Only card facts are stored (number, name, rarity, colour, type, a price snapshot). Card art is never committed:
// the app loads it through the server's /api/cards/img route, which fetches it from optcgapi.com on demand.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const setId = process.argv[2];
if (!/^[A-Z]{2,3}-\d{2}$/.test(setId ?? '')) {
  console.error('Usage: node scripts/import-cards.mjs OP-01');
  process.exit(1);
}

const res = await fetch(`https://optcgapi.com/api/sets/${setId}/`);
if (!res.ok) throw new Error(`optcgapi.com answered ${res.status}`);
const rows = await res.json();
if (!Array.isArray(rows) || !rows.length) throw new Error('No cards returned.');

const RARITIES = new Set(['L', 'C', 'UC', 'R', 'SR', 'SEC']);
/** "Shanks (Parallel) (Manga) (Alternate Art)" → tags + "Shanks". Numbers like "(001)" only disambiguate names. */
function parseName(raw) {
  const tags = [...raw.matchAll(/\(([^)]+)\)/g)].map((m) => m[1].toLowerCase());
  return { name: raw.replace(/\s*\([^)]*\)/g, '').trim(), tags };
}

const cards = rows.map((r) => {
  const { name, tags } = parseName(r.card_name);
  if (!RARITIES.has(r.rarity)) throw new Error(`Unknown rarity ${r.rarity} on ${r.card_image_id}`);
  const variant = tags.includes('box topper') ? 'boxTopper'
    : tags.includes('manga') ? 'manga'
    : tags.includes('parallel') || /_p\d+$/.test(r.card_image_id) ? 'parallel'
    : 'base';
  return {
    id: r.card_image_id,
    number: r.card_set_id,
    name,
    rarity: r.rarity,
    variant,
    color: r.card_color,
    type: r.card_type,
    price: typeof r.market_price === 'number' ? r.market_price : null,
  };
}).sort((a, b) => a.id.localeCompare(b.id));

const ids = new Set(cards.map((c) => c.id));
if (ids.size !== cards.length) throw new Error('Duplicate card ids.');

const out = {
  id: setId,
  name: rows[0].set_name,
  source: 'optcgapi.com',
  snapshotAt: new Date().toISOString().slice(0, 10),
  cards,
};
const here = path.dirname(fileURLToPath(import.meta.url));
const file = path.resolve(here, `../src/data/cards/${setId}.json`);
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, JSON.stringify(out, null, 1) + '\n');
const count = (v) => cards.filter((c) => c.variant === v).length;
console.log(`${setId} ${out.name}: ${cards.length} cards (${count('base')} base, ${count('parallel')} parallel, ${count('manga')} manga, ${count('boxTopper')} box toppers) → ${path.relative(process.cwd(), file)}`);
