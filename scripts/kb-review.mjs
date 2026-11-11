#!/usr/bin/env node
// A named reviewer confirms or rejects a library document version after
// checking its origin, version and validity on the publisher's own site.
//
//   DAJC_KB_REVIEW_DB_URL=... node scripts/kb-review.mjs <versionId> --reviewer "Name" --decision HUMAN_VERIFIED|REJECTED [--note "..."]
//
// Runs only as the role dajc_kb_reviewer (drizzle-kb/0001), used by a person
// from their own machine - never the import role, never CI. The connection
// string is never printed.

import { assertDatabaseTarget, redact } from '../src/lib/kb/db-guard.mjs';
import { reviewVersion } from '../src/lib/kb/importer.mjs';

const [versionId, ...rest] = process.argv.slice(2);
const value = (name) => (rest.includes(name) ? rest[rest.indexOf(name) + 1] : null);
if (!versionId || !value('--reviewer') || !value('--decision')) {
  console.error('usage: kb-review.mjs <versionId> --reviewer "Name" --decision HUMAN_VERIFIED|REJECTED [--note "..."]');
  process.exit(2);
}
const dbUrl = process.env.DAJC_KB_REVIEW_DB_URL || '';
if (!dbUrl) throw new Error('DAJC_KB_REVIEW_DB_URL is not set (role dajc_kb_reviewer)');
const { default: postgres } = await import('postgres');
const sql = postgres(dbUrl, { max: 1, prepare: false, onnotice: () => undefined });
try {
  await assertDatabaseTarget(sql, { role: 'dajc_kb_reviewer' });
  await reviewVersion(sql, { versionId, reviewer: value('--reviewer'), decision: value('--decision'), note: value('--note') });
  console.log(`${value('--decision')}: ${versionId}`);
} catch (error) {
  console.error(`FAILED   ${redact(error?.message || error, dbUrl).slice(0, 300)}`);
  process.exitCode = 1;
} finally {
  await sql.end();
}
