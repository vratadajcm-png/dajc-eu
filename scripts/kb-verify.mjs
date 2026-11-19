#!/usr/bin/env node
// Verifies the imported versions of the legal library - read-only.
//
//   DAJC_KB_VERIFY_DB_URL=... [DAJC_KB_ARCHIVE=local:/path] node scripts/kb-verify.mjs
//       [--source eu-eurlex] [--only <officialNumber>] [--lang cs] [--online] [--date YYYY-MM-DD]
//       [--expect-role dajc_kb_importer] [--expect-environment dev] [--report report.json] [--entries-from import.json]
//
// For every manifest entry: catalogue, source, validity, integrity, content,
// search and citation checks (src/lib/kb/verify.mjs). --online also downloads
// the official original again (the citation link must serve the stored bytes)
// and reads the act's status page on EUR-Lex (in force; the stored version is
// the current consolidated one). Without an archive the content check uses the
// fresh download. Falls back to DAJC_KB_IMPORT_DB_URL (same CI secret). The
// connection string is masked and redacted; exit code 1 when any check fails.

import { readFileSync, writeFileSync } from 'node:fs';
import { archiveFromEnv } from '../src/lib/kb/archive.mjs';
import { assertDatabaseTarget, maskInGitHubActions, redact } from '../src/lib/kb/db-guard.mjs';
import { DETERMINISTIC_CHECKS, eurlexStatusReader, verifyEntry } from '../src/lib/kb/verify-entry.mjs';

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const online = flag('--online');
const onDate = value('--date') || new Date().toISOString().slice(0, 10);
const dbUrl = process.env.DAJC_KB_VERIFY_DB_URL || process.env.DAJC_KB_IMPORT_DB_URL || '';
maskInGitHubActions(dbUrl);
if (!dbUrl) throw new Error('DAJC_KB_VERIFY_DB_URL (or DAJC_KB_IMPORT_DB_URL) is not set');

const manifest = JSON.parse(readFileSync(value('--manifest') || 'config/legal-library/manifest.json', 'utf8'));
const verification = JSON.parse(readFileSync(value('--verification') || 'config/legal-library/verification.json', 'utf8'));
const searchChecks = verification.checks;
const modelSources = verification.modelSources;
const entries = manifest.entries.filter((e) => (!value('--source') || e.sourceId === value('--source'))
  && (!value('--only') || e.officialNumber === value('--only')) && (!value('--lang') || e.version.language === value('--lang')));
// --entries-from <import report>: only the versions imported in that run (the others were verified when imported).
if (value('--entries-from')) {
  const imported = new Set(JSON.parse(readFileSync(value('--entries-from'), 'utf8')).results
    .filter((r) => r.status === 'IMPORTED').map((r) => `${r.officialNumber}|${r.language}`));
  entries.splice(0, entries.length, ...entries.filter((e) => imported.has(`${e.officialNumber}|${e.version.language}`)));
  if (entries.length === 0) {
    console.log('nothing newly imported to verify');
    process.exit(0);
  }
}
if (entries.length === 0) throw new Error('no manifest entry matches the filters');
const archive = process.env.DAJC_KB_ARCHIVE ? archiveFromEnv() : null;
if (!archive && !online) throw new Error('integrity and content checks need DAJC_KB_ARCHIVE or --online');

const { default: postgres } = await import('postgres');
const sql = postgres(dbUrl, { max: 1, prepare: false, onnotice: () => undefined });
try {
  const target = await assertDatabaseTarget(sql, { role: value('--expect-role'), environment: value('--expect-environment') });
  console.log(`target: role ${target.role}${target.environment ? `, environment ${target.environment}` : ''}; check day ${onDate}; ${online ? 'online' : 'offline'}`);
} catch (error) {
  console.error(`REFUSED  ${redact(error?.message || error, dbUrl).slice(0, 300)}`);
  await sql.end({ timeout: 5 }).catch(() => undefined);
  process.exit(2);
}

const eurlexStatus = eurlexStatusReader();
const CHECKS = DETERMINISTIC_CHECKS;
const report = [];
for (const entry of entries) {
  const v = entry.version;
  const name = `${entry.officialNumber} [${v.language}]`;
  const { problems, facts } = await verifyEntry({
    sql, entry, archive, online, onDate, searchChecks, modelSources, eurlexStatus, redactError: (m) => redact(m, dbUrl),
  });
  const failed = CHECKS.filter((c) => problems[c].length > 0);
  report.push({ name, officialNumber: entry.officialNumber, language: v.language, url: v.url, result: failed.length ? 'FAIL' : 'PASS', problems, facts });
  const marks = CHECKS.map((c) => `${c} ${problems[c].length ? '✗' : '✓'}`).join('  ');
  console.log(`${failed.length ? 'FAIL' : 'PASS'}  ${name}: ${marks}${facts.citation ? `\n      ${facts.citation} (search position ${facts.search?.position})` : ''}${facts.search?.skipped ? `\n      search: ${facts.search.skipped}` : ''}`);
  for (const c of failed) for (const p of problems[c]) console.log(`      ${c}: ${p}`);
}
await sql.end();

const failedCount = report.filter((r) => r.result === 'FAIL').length;
console.log(`\n${report.length - failedCount}/${report.length} versions passed every check${online ? ' (online)' : ''}.`);
if (value('--report')) writeFileSync(value('--report'), `${JSON.stringify({ checkedOn: onDate, online, results: report }, null, 2)}\n`);
process.exitCode = failedCount ? 1 : 0;
