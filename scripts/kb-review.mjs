#!/usr/bin/env node
// A named reviewer confirms or rejects a library document version after
// checking its origin, version and validity on the publisher's own site.
//
//   DAJC_KB_IMPORT_DB_URL=... node scripts/kb-review.mjs <versionId> --reviewer "Name" --decision HUMAN_VERIFIED|REJECTED [--note "..."]

import { reviewVersion } from '../src/lib/kb/importer.mjs';

const [versionId, ...rest] = process.argv.slice(2);
const value = (name) => (rest.includes(name) ? rest[rest.indexOf(name) + 1] : null);
if (!versionId || !value('--reviewer') || !value('--decision')) {
  console.error('usage: kb-review.mjs <versionId> --reviewer "Name" --decision HUMAN_VERIFIED|REJECTED [--note "..."]');
  process.exit(2);
}
if (!process.env.DAJC_KB_IMPORT_DB_URL) throw new Error('DAJC_KB_IMPORT_DB_URL is not set');
const { default: postgres } = await import('postgres');
const sql = postgres(process.env.DAJC_KB_IMPORT_DB_URL, { max: 1, prepare: false, onnotice: () => undefined });
try {
  await reviewVersion(sql, { versionId, reviewer: value('--reviewer'), decision: value('--decision'), note: value('--note') });
  console.log(`${value('--decision')}: ${versionId}`);
} finally {
  await sql.end();
}
