#!/usr/bin/env node
// Imports official documents of config/legal-library/manifest.json into the
// DAJC legal library (docs/DAJC_AI_LEGAL_LIBRARY.md).
//
//   DAJC_KB_IMPORT_DB_URL=... DAJC_KB_ARCHIVE=local:/path node scripts/kb-import.mjs [--source eu-eurlex] [--only <officialNumber>] [--lang cs] [--dry-run]
//       [--expect-role dajc_kb_importer] [--expect-environment dev]
//
// The database URL (dajc_kb_importer) and archive credentials come from the
// environment only and are never printed: in GitHub Actions their parts are
// masked, and every error message is redacted. With --expect-role and
// --expect-environment the import refuses any other role, a role with
// administrative attributes, and a database whose marker row in dajc_kb.deployment
// differs (src/lib/kb/db-guard.mjs). --dry-run downloads and checks without
// writing to the database.

import { readFileSync } from 'node:fs';
import { archiveFromEnv, MemoryArchive } from '../src/lib/kb/archive.mjs';
import { assertDatabaseTarget, maskInGitHubActions, redact } from '../src/lib/kb/db-guard.mjs';
import { fetchOfficialBytes, prepareVersion, writeVersion } from '../src/lib/kb/importer.mjs';

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const dryRun = flag('--dry-run');
const manifestPath = value('--manifest') || 'config/legal-library/manifest.json';
const only = value('--only');
const lang = value('--lang');
const sourceId = value('--source');
const dbUrl = process.env.DAJC_KB_IMPORT_DB_URL || '';
maskInGitHubActions(dbUrl);

const entries = JSON.parse(readFileSync(manifestPath, 'utf8')).entries
  .filter((e) => (!sourceId || e.sourceId === sourceId) && (!only || e.officialNumber === only) && (!lang || e.version.language === lang));
if (entries.length === 0) throw new Error('no manifest entry matches the filters');
const archive = dryRun && !process.env.DAJC_KB_ARCHIVE ? new MemoryArchive() : archiveFromEnv();
let sql = null;
if (!dryRun) {
  if (!dbUrl) throw new Error('DAJC_KB_IMPORT_DB_URL is not set');
  const { default: postgres } = await import('postgres');
  sql = postgres(dbUrl, { max: 1, prepare: false, onnotice: () => undefined });
  try {
    const target = await assertDatabaseTarget(sql, { role: value('--expect-role'), environment: value('--expect-environment') });
    console.log(`target: role ${target.role}, environment ${target.environment || 'not set'}`);
  } catch (error) {
    console.error(`REFUSED  ${redact(error?.message || error, dbUrl).slice(0, 300)}`);
    await sql.end({ timeout: 5 }).catch(() => undefined);
    process.exit(2);
  }
}

let failed = 0;
for (const entry of entries) {
  const name = `${entry.officialNumber} [${entry.version.language}]`;
  try {
    const download = await fetchOfficialBytes(entry.version.url);
    const prepared = await prepareVersion(entry, download, { archive });
    const counts = `${prepared.version.pageCount} pages, ${prepared.provisions.length} provisions, ${prepared.version.textExtraction}, ${prepared.version.provenance}`;
    if (dryRun) {
      console.log(`DRY  ${name}: ${counts}; sha256 ${prepared.version.sha256}${prepared.checks.length ? `; checks: ${prepared.checks.join('; ')}` : ''}`);
      continue;
    }
    const result = await writeVersion(sql, prepared, { actor: 'scripts/kb-import.mjs' });
    console.log(`${result.status.padEnd(9)} ${name}: ${counts}; version ${result.versionId}; sha256 ${prepared.version.sha256}${result.superseded?.length ? `; superseded ${result.superseded.length}` : ''}`);
  } catch (error) {
    failed++;
    console.error(`FAILED   ${name}: ${redact(error?.message || error, dbUrl).slice(0, 300)}`);
  }
}
await sql?.end();
process.exitCode = failed ? 1 : 0;
