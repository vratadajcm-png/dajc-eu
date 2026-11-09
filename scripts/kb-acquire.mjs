#!/usr/bin/env node
// Official legal acquisition: Discovery -> Acquisition -> Text extraction ->
// SHA-256 -> archive (Neon Object Storage, S3-compatible) -> PostgreSQL ->
// read-back -> audit. Neon DEV only (db-guard); AI verification runs afterwards
// with kb-ai-verify on versions that are new or changed.
//
//   node scripts/kb-acquire.mjs --jurisdiction DE [--dry-run] [--max N] [--report r.json]
//        [--expect-role dajc_kb_importer --expect-environment dev]
//   env: DAJC_KB_IMPORT_DB_URL, DAJC_KB_ARCHIVE=s3 + DAJC_KB_S3_* (GitHub Environment secrets)
//
// DE: Gesetze im Internet catalogue + xml.zip. AT: RIS OGD API (needs the
// publisher's access arrangement, else ROBOTS_DISALLOWED). HR: discovery only
// (reuse terms not verified). Failures are classified per document and never
// hidden; a transient 503 is retried and then reported as TRANSIENT_EXHAUSTED.

import { writeFileSync } from 'node:fs';
import { archiveFromEnv, MemoryArchive } from '../src/lib/kb/archive.mjs';
import { assertDatabaseTarget, maskInGitHubActions, redact } from '../src/lib/kb/db-guard.mjs';
import { AcquireError, PoliteClient } from '../src/lib/kb/acquire/polite-fetch.mjs';
import { GII_TOC_URL, parseGiiToc, parseGiiXml, readZip, selectDeLaws } from '../src/lib/kb/acquire/de-gii.mjs';
import { prepareStructuredVersion } from '../src/lib/kb/acquire/structured.mjs';
import { storeVersion } from '../src/lib/kb/acquire/pipeline.mjs';
import { discoverAtChanges, risClient } from '../src/lib/kb/acquire/at-ris.mjs';
import { discoverHrChanges, nnClient } from '../src/lib/kb/acquire/hr-nn.mjs';

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const value = (n) => (args.includes(n) ? args[args.indexOf(n) + 1] : null);
const jurisdiction = value('--jurisdiction') || 'DE';
const dryRun = flag('--dry-run');
const max = Number(value('--max')) || Infinity;
const today = new Date().toISOString().slice(0, 10);
const dbUrl = process.env.DAJC_KB_IMPORT_DB_URL || '';
maskInGitHubActions(dbUrl);
const report = { jurisdiction, startedOn: new Date().toISOString(), dryRun, discovery: null, results: [] };
const fail = (e) => ({ status: e instanceof AcquireError ? e.kind : 'FAILED', reason: redact(e?.message || e, dbUrl).slice(0, 300) });

let sql = null;
let archive = null;
if (jurisdiction === 'DE') {
  archive = dryRun && !process.env.DAJC_KB_ARCHIVE ? new MemoryArchive() : archiveFromEnv();
  if (!dryRun) {
    if (!dbUrl) throw new Error('DAJC_KB_IMPORT_DB_URL is not set');
    const { default: postgres } = await import('postgres');
    sql = postgres(dbUrl, { max: 1, prepare: false, onnotice: () => undefined });
    try { await assertDatabaseTarget(sql, { role: value('--expect-role'), environment: value('--expect-environment') }); } catch (e) {
      console.error(`REFUSED  ${redact(e?.message || e, dbUrl).slice(0, 300)}`); await sql.end({ timeout: 5 }).catch(() => undefined); process.exit(2);
    }
  }
}

try {
  if (jurisdiction === 'DE') {
    const client = new PoliteClient({ minIntervalMs: 1500 });
    const toc = parseGiiToc(new TextDecoder().decode((await client.get(GII_TOC_URL, { accept: 'application/xml' })).bytes));
    const laws = selectDeLaws(toc);
    report.discovery = { catalogueEntries: toc.length, relevantLaws: laws.length, laws: laws.map((l) => l.slug) };
    console.log(`discovery: ${toc.length} catalogue entries, ${laws.length} relevant to road freight`);
    for (const law of laws.slice(0, max)) {
      const line = { slug: law.slug, title: law.title };
      try {
        const got = await client.get(law.url, { accept: 'application/zip' });
        const files = readZip(got.bytes);
        const xmlFile = files.find((f) => f.name.endsWith('.xml'));
        if (!xmlFile) throw new Error('no XML file in the archive');
        const { meta, pages } = parseGiiXml(new TextDecoder('utf-8').decode(xmlFile.data));
        const entry = {
          sourceId: 'de-gesetze', jurisdiction: 'DE', officialNumber: meta.abbreviation || law.slug, title: law.title, legalCategory: law.legalCategory,
          issuingBody: 'Bund (veröffentlicht durch das Bundesministerium der Justiz)', topics: law.topics, legalAreas: law.areas,
          version: { label: `${law.title}, Stand ${meta.standComment ?? 'nicht angegeben'} (abgerufen ${today})`, language: 'de', url: law.url, authenticity: 'CONSOLIDATED_DOCUMENTATION',
            issuedOn: meta.issuedOn && /^\d{4}-\d{2}-\d{2}$/.test(meta.issuedOn) ? meta.issuedOn : null, effectiveFrom: today, effectiveTo: null, validity: 'IN_FORCE', validityCheckedOn: today,
            validityEvidenceUrl: GII_TOC_URL, notes: 'Not the authentic Bundesgesetzblatt. effective_from is the retrieval date of the consolidated text; the entry into force of the last amendment was not checked.' },
        };
        const prepared = prepareStructuredVersion(entry, { bytes: got.bytes, finalUrl: got.finalUrl, mediaType: 'application/zip', extension: 'zip', pages, extractionNote: `Text extracted from ${xmlFile.name} (${meta.norms} norms); pages are notional segments.` });
        Object.assign(line, { sha256: prepared.version.sha256, provisions: prepared.provisions.length, provenance: prepared.version.provenance });
        if (dryRun) { line.status = 'DRY_RUN'; } else Object.assign(line, await storeVersion({ sql, archive, prepared, actor: 'scripts/kb-acquire.mjs' }));
      } catch (e) { Object.assign(line, fail(e)); }
      report.results.push(line);
      console.log(`${String(line.status).padEnd(20)} ${law.slug}${line.reason ? `: ${line.reason}` : ''}`);
      if (['WAF_BLOCKED', 'RATE_LIMITED'].includes(line.status)) break;
    }
  } else if (jurisdiction === 'AT') {
    const found = await discoverAtChanges(risClient(), { from: new Date(Date.now() - 35 * 86_400_000).toISOString().slice(0, 10), to: today });
    report.discovery = { changedDocuments: found.length };
    console.log(`AT discovery: ${found.length} changed documents (acquisition not run: see docs)`);
  } else if (jurisdiction === 'HR') {
    const found = await discoverHrChanges(nnClient(), { since: new Date(Date.now() - 35 * 86_400_000).toISOString().slice(0, 10) });
    report.discovery = { changedEntries: found.length, imported: 0, note: 'Reuse terms of narodne-novine.nn.hr not verified: discovery only.' };
    console.log(`HR discovery: ${found.length} changed sitemap entries (no import: terms not verified)`);
  } else throw new Error(`no acquisition implemented for ${jurisdiction}`);
} catch (e) {
  report.error = fail(e);
  console.error(`${report.error.status}: ${report.error.reason}`);
  process.exitCode = 1;
}
await sql?.end();
const n = (s) => report.results.filter((r) => r.status === s).length;
console.log(`\n${n('IMPORTED')} imported, ${n('UNCHANGED')} unchanged, ${n('DRY_RUN')} dry-run, ${report.results.filter((r) => !['IMPORTED', 'UNCHANGED', 'DRY_RUN'].includes(r.status)).length} not acquired.`);
if (value('--report')) writeFileSync(value('--report'), `${JSON.stringify(report, null, 1)}\n`);
if (report.results.some((r) => ['FAILED', 'TRANSIENT_EXHAUSTED', 'ROBOTS_UNAVAILABLE', 'WAF_BLOCKED', 'RATE_LIMITED', 'NETWORK_ERROR', 'ROBOTS_DISALLOWED', 'PERMANENT_HTTP'].includes(r.status))) process.exitCode = 1;
