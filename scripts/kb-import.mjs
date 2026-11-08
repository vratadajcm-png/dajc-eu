#!/usr/bin/env node
// Imports official documents of config/legal-library/manifest.json into the
// DAJC legal library (docs/DAJC_AI_LEGAL_LIBRARY.md).
//
//   DAJC_KB_IMPORT_DB_URL=... DAJC_KB_ARCHIVE=local:/path node scripts/kb-import.mjs [--only <officialNumber>] [--lang cs] [--dry-run]
//
// The database URL (owner or dajc_kb_importer) and archive credentials come
// from the environment only and are never printed. --dry-run downloads and
// checks without writing to the database.

import { readFileSync } from 'node:fs';
import { archiveFromEnv, MemoryArchive } from '../src/lib/kb/archive.mjs';
import { fetchOfficialBytes, prepareVersion, writeVersion } from '../src/lib/kb/importer.mjs';

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const dryRun = flag('--dry-run');
const manifestPath = value('--manifest') || 'config/legal-library/manifest.json';
const only = value('--only');
const lang = value('--lang');

const entries = JSON.parse(readFileSync(manifestPath, 'utf8')).entries
  .filter((e) => (!only || e.officialNumber === only) && (!lang || e.version.language === lang));
const archive = dryRun && !process.env.DAJC_KB_ARCHIVE ? new MemoryArchive() : archiveFromEnv();
let sql = null;
if (!dryRun) {
  if (!process.env.DAJC_KB_IMPORT_DB_URL) throw new Error('DAJC_KB_IMPORT_DB_URL is not set');
  const { default: postgres } = await import('postgres');
  sql = postgres(process.env.DAJC_KB_IMPORT_DB_URL, { max: 1, prepare: false, onnotice: () => undefined });
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
    console.error(`FAILED   ${name}: ${String(error?.message || error).slice(0, 300)}`);
  }
}
await sql?.end();
process.exitCode = failed ? 1 : 0;
