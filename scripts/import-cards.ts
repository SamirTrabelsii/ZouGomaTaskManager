// Snapshots one One Piece TCG set from optcgapi.com into src/data/cards/<SET>.json, the catalog the app falls back
// to before the server's daily sync has run (and in local-only mode). Uses the server's parser, so the snapshot and
// the live catalog always classify cards the same way.
//   npx tsx scripts/import-cards.ts OP-01
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchJson, parseSet } from '../server/catalog';

const setId = process.argv[2];
if (!/^[A-Z0-9-]{3,16}$/.test(setId ?? '')) {
  console.error('Usage: npx tsx scripts/import-cards.ts OP-01');
  process.exit(1);
}

const sets = (await fetchJson('https://optcgapi.com/api/allSets/')) as { set_id: string; set_name: string }[];
const position = sets.findIndex((s) => s.set_id === setId);
if (position < 0) throw new Error(`${setId} is not in optcgapi's set list.`);
const rows = await fetchJson(`https://optcgapi.com/api/sets/${setId}/`);
if (!Array.isArray(rows) || !rows.length) throw new Error('No cards returned.');
const { set, skipped } = parseSet(setId, sets[position].set_name, position, rows);

const out = { ...set, source: 'optcgapi.com', snapshotAt: new Date().toISOString().slice(0, 10) };
const here = path.dirname(fileURLToPath(import.meta.url));
const file = path.resolve(here, `../src/data/cards/${setId}.json`);
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, JSON.stringify(out, null, 1) + '\n');
const byVariant = Object.entries(set.cards.reduce<Record<string, number>>((m, c) => ({ ...m, [c.variant]: (m[c.variant] ?? 0) + 1 }), {}));
console.log(`${setId} ${set.name}: ${set.cards.length} cards (${byVariant.map(([v, n]) => `${n} ${v}`).join(', ')}), ${skipped} skipped → ${path.relative(process.cwd(), file)}`);
