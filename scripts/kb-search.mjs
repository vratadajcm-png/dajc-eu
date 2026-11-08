#!/usr/bin/env node
// Runs a library search the way DAJC AI does (for review and tests).
//
//   DAJC_KB_SEARCH_DB_URL=... node scripts/kb-search.mjs --country CZ --lang cs --date 2026-11-08 [--mass 40] [--allow AUTO_CHECKED] "doba řízení přestávka"

import { postgresQuery, searchLibrary } from '../src/lib/kb/search.mjs';

const args = process.argv.slice(2);
const value = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const terms = args.filter((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--'));
if (!process.env.DAJC_KB_SEARCH_DB_URL) throw new Error('DAJC_KB_SEARCH_DB_URL is not set');
const { default: postgres } = await import('postgres');
const sql = postgres(process.env.DAJC_KB_SEARCH_DB_URL, { max: 1, prepare: false, onnotice: () => undefined });
try {
  const hits = await searchLibrary(postgresQuery(sql), {
    terms, question: terms.join(' '), languages: (value('--lang') || 'en').split(','), countries: (value('--country') || 'CZ').split(','),
    onDate: value('--date') || new Date().toISOString().slice(0, 10), massT: value('--mass') ? Number(value('--mass')) : null,
    allowedProvenance: (value('--allow') || 'HUMAN_VERIFIED').split(','),
  });
  for (const h of hits) console.log(`${h.rank.toFixed(3)}  ${h.citation}  [${h.applicability}, mass ${h.massCheck}, ${h.provenance}]\n        ${h.url}\n        ${h.text.slice(0, 220).replace(/\n/g, ' ')}`);
  if (hits.length === 0) console.log('no answerable provision found');
} finally {
  await sql.end();
}
