#!/usr/bin/env node
// Verifies the imported versions of the legal library - read-only.
//
//   DAJC_KB_VERIFY_DB_URL=... [DAJC_KB_ARCHIVE=local:/path] node scripts/kb-verify.mjs
//       [--source eu-eurlex] [--only <officialNumber>] [--lang cs] [--online] [--date YYYY-MM-DD]
//       [--expect-role dajc_kb_importer] [--expect-environment dev] [--report report.json]
//
// For every manifest entry: catalogue, source, validity, integrity, content,
// search and citation checks (src/lib/kb/verify.mjs). --online also downloads
// the official original again (the citation link must serve the stored bytes)
// and reads the act's status page on EUR-Lex (in force; the stored version is
// the current consolidated one). Without an archive the content check uses the
// fresh download. Falls back to DAJC_KB_IMPORT_DB_URL (same CI secret). The
// connection string is masked and redacted; exit code 1 when any check fails.

import { readFileSync, writeFileSync } from 'node:fs';
import { archiveFromEnv, sha256Hex } from '../src/lib/kb/archive.mjs';
import { assertDatabaseTarget, maskInGitHubActions, redact } from '../src/lib/kb/db-guard.mjs';
import { fetchOfficialBytes, prepareVersion } from '../src/lib/kb/importer.mjs';
import { legalSourceForUrl } from '../src/lib/kb/legal-sources.mjs';
import { citationLabel, postgresQuery, searchLibrary } from '../src/lib/kb/search.mjs';
import { ASK_TOPIC_TO_KB } from '../src/lib/kb/taxonomy.mjs';
import {
  baseActCelex, celexOf, checkStoredVersion, consolidationDate, digestRows, eurlexStatusUrl, parseEurlexStatus, textOnPages,
} from '../src/lib/kb/verify.mjs';

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

const statusCache = new Map();
async function eurlexStatus(baseCelex) {
  if (!statusCache.has(baseCelex)) {
    statusCache.set(baseCelex, (async () => {
      const page = await fetchOfficialBytes(eurlexStatusUrl(baseCelex), { maxBytes: 5 * 1024 * 1024 });
      return parseEurlexStatus(new TextDecoder().decode(page.bytes));
    })());
  }
  return statusCache.get(baseCelex);
}

const CHECKS = ['catalogue', 'source', 'validity', 'integrity', 'content', 'search', 'citation'];
const report = [];
for (const entry of entries) {
  const v = entry.version;
  const name = `${entry.officialNumber} [${v.language}]`;
  const problems = Object.fromEntries(CHECKS.map((c) => [c, []]));
  const facts = {};
  try {
    const rows = await sql`
      select dv.*, d.official_number, d.title from dajc_kb.document_versions dv join dajc_kb.documents d on d.id = dv.document_id
      where d.jurisdiction = ${entry.jurisdiction} and d.official_number = ${entry.officialNumber} and dv.language = ${v.language} and dv.official_url = ${v.url}`;
    if (rows.length !== 1) {
      problems.catalogue.push(rows.length === 0 ? 'not imported' : `${rows.length} stored versions for one URL`);
      throw new Error('skip');
    }
    const row = rows[0];
    facts.versionId = row.id;
    facts.sha256 = row.sha256;
    facts.pages = row.page_count;
    const [ranges] = await sql`
      select count(*)::int as count, count(*) filter (where anchor_type in ('ARTICLE', 'SECTION', 'ANNEX'))::int as citable,
             count(*) filter (where page_from < 1 or page_to > ${row.page_count} or page_to < page_from)::int as outside
      from dajc_kb.provisions where version_id = ${row.id}`;
    facts.provisions = ranges.count;
    const stored = checkStoredVersion({ entry, row, provisionRanges: ranges, onDate, source: legalSourceForUrl(row.official_url) });
    for (const k of ['catalogue', 'source', 'validity']) problems[k].push(...stored[k]);

    // Validity at the publisher: in force, and this text is the current consolidated one.
    const celex = celexOf(row.official_url);
    if (online && entry.sourceId === 'eu-eurlex') {
      const status = await eurlexStatus(baseActCelex(celex));
      facts.publisherStatus = status.statusText;
      facts.currentConsolidated = status.currentConsolidated;
      if (row.validity === 'IN_FORCE' && status.inForce !== true) problems.validity.push(`EUR-Lex status: ${status.statusText || 'not readable'}`);
      if (celex && /-\d{8}$/.test(celex) && status.currentConsolidated !== celex) {
        problems.validity.push(status.currentConsolidated
          ? `EUR-Lex lists ${consolidationDate(status.currentConsolidated)} as the current consolidated version, stored ${consolidationDate(celex)}`
          : 'EUR-Lex shows no current consolidated version');
      }
    }

    // Integrity: archived original and the official URL serve the stored bytes.
    let bytes = null;
    if (archive) {
      bytes = await archive.get(row.storage_key);
      if (!bytes) problems.integrity.push('original missing in the archive');
      else if (sha256Hex(bytes) !== row.sha256 || bytes.length !== row.byte_size) problems.integrity.push('archived original differs from the catalogue');
    }
    if (online) {
      const fresh = await fetchOfficialBytes(row.official_url);
      if (sha256Hex(fresh.bytes) !== row.sha256) problems.integrity.push('the official URL now serves different bytes');
      bytes = bytes || fresh.bytes;
    }

    // Content: re-extraction of the original equals what is stored.
    if (bytes) {
      const prepared = await prepareVersion(entry, { bytes, finalUrl: row.official_url });
      const pages = await sql`select page_no, text from dajc_kb.pages where version_id = ${row.id} order by page_no`;
      const provisions = await sql`
        select ordinal, anchor_type, anchor_label, anchor_number, heading, page_from, page_to, text
        from dajc_kb.provisions where version_id = ${row.id} order by ordinal`;
      const pageFields = ['page_no', 'text'];
      const provisionFields = ['ordinal', 'anchor_type', 'anchor_label', 'anchor_number', 'heading', 'page_from', 'page_to', 'text'];
      const fresh = {
        pages: prepared.pages.map((p) => ({ page_no: p.pageNo, text: p.text })),
        provisions: prepared.provisions.map((p) => ({ ordinal: p.ordinal, anchor_type: p.anchorType, anchor_label: p.anchorLabel, anchor_number: p.anchorNumber ?? null,
          heading: p.heading ?? null, page_from: p.pageFrom, page_to: p.pageTo, text: p.text })),
      };
      if (digestRows(pages, pageFields) !== digestRows(fresh.pages, pageFields)) problems.content.push(`pages differ from the original (${pages.length} stored, ${fresh.pages.length} extracted)`);
      if (digestRows(provisions, provisionFields) !== digestRows(fresh.provisions, provisionFields)) {
        const first = fresh.provisions.find((p, i) => digestRows([p], provisionFields) !== digestRows([provisions[i] || {}], provisionFields));
        problems.content.push(`provisions differ from the original (${provisions.length} stored, ${fresh.provisions.length} extracted${first ? `; first at ${first.anchor_label}` : ''})`);
      }
    }

    // Search exactly as DAJC AI asks (src/lib/ask/library.ts), then the citation of the expected provision.
    const check = searchChecks.find((c) => c.officialNumber === entry.officialNumber);
    const asked = check?.questions?.[v.language];
    if (!asked) problems.search.push('no search check defined for this language');
    else {
      const hits = await searchLibrary(postgresQuery(sql), {
        terms: [...asked.terms, asked.question], question: asked.question, languages: [v.language], countries: ['CZ'], onDate,
        topics: ASK_TOPIC_TO_KB[check.askTopic] ?? null, allowedProvenance: ['AUTO_CHECKED', 'HUMAN_VERIFIED'], limit: modelSources * 2,
      });
      const anchorRe = new RegExp(`(^|\\s)${check.anchorNumber}$`);
      const position = hits.findIndex((h) => h.url.startsWith(`${row.official_url}#`) && anchorRe.test(h.anchorLabel));
      facts.search = { question: asked.question, top: hits.slice(0, modelSources).map((h) => h.citation), position: position < 0 ? null : position + 1 };
      if (position < 0) problems.search.push(`Article ${check.anchorNumber} not found (top: ${hits.slice(0, 3).map((h) => h.citation).join(' | ') || 'nothing'})`);
      else if (position >= modelSources) problems.search.push(`Article ${check.anchorNumber} at position ${position + 1}, after the ${modelSources} sources the model receives`);
      if (position >= 0) {
        const hit = hits[position];
        facts.citation = hit.citation;
        if (hit.citation !== citationLabel({ ...hit, versionLabel: row.version_label }) || !hit.citation.startsWith(row.version_label)) problems.citation.push('citation label incomplete');
        if (hit.url !== `${row.official_url}#page=${hit.pageFrom}`) problems.citation.push('citation URL is not the official URL with the page');
        if (hit.pageFrom < 1 || hit.pageTo > row.page_count) problems.citation.push(`cited pages ${hit.pageFrom}-${hit.pageTo} outside the document (${row.page_count})`);
        if (hit.sha256 !== row.sha256) problems.citation.push('citation SHA-256 differs from the version');
        const [onPages] = await sql`select string_agg(text, ' ' order by page_no) as text from dajc_kb.pages where version_id = ${row.id} and page_no between ${hit.pageFrom} and ${hit.pageTo}`;
        if (!textOnPages(hit.text, onPages?.text || '')) problems.citation.push(`quoted text not found on page ${hit.pageFrom}${hit.pageTo !== hit.pageFrom ? `-${hit.pageTo}` : ''}`);
      }
    }
  } catch (error) {
    if (error?.message !== 'skip') problems.catalogue.push(`error: ${redact(error?.message || error, dbUrl).slice(0, 200)}`);
  }
  const failed = CHECKS.filter((c) => problems[c].length > 0);
  report.push({ name, officialNumber: entry.officialNumber, language: v.language, url: v.url, result: failed.length ? 'FAIL' : 'PASS', problems, facts });
  const marks = CHECKS.map((c) => `${c} ${problems[c].length ? '✗' : '✓'}`).join('  ');
  console.log(`${failed.length ? 'FAIL' : 'PASS'}  ${name}: ${marks}${facts.citation ? `\n      ${facts.citation} (search position ${facts.search?.position})` : ''}`);
  for (const c of failed) for (const p of problems[c]) console.log(`      ${c}: ${p}`);
}
await sql.end();

const failedCount = report.filter((r) => r.result === 'FAIL').length;
console.log(`\n${report.length - failedCount}/${report.length} versions passed every check${online ? ' (online)' : ''}.`);
if (value('--report')) writeFileSync(value('--report'), `${JSON.stringify({ checkedOn: onDate, online, results: report }, null, 2)}\n`);
process.exitCode = failedCount ? 1 : 0;
