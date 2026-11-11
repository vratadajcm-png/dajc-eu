#!/usr/bin/env node
// Discovers the current official version of EU acts on EUR-Lex and turns them
// into manifest entries (config/legal-library/eurlex-candidates.json).
//
//   node scripts/kb-eurlex-discover.mjs [--write] [--only <celex>]
//
// For each candidate the act's own EUR-Lex status page is read (robots.txt and
// the 10 s crawl delay respected): only an act shown "In force" with a current
// consolidated version yields entries for cs, de, en, pl and sk; anything else
// is recorded with its reason in config/legal-library/candidates-status.json
// (DISCOVERED -> SOURCE_CONFIRMED -> MANIFESTED, or BLOCKED). --write adds new
// entries to the manifest; existing entries are never changed here (a newer
// consolidation of a stored act is the monitor's job, scripts/kb-monitor.mjs).

import { readFileSync, writeFileSync } from 'node:fs';
import { entriesFromStatus, eurlexStatusUrl, parseEurlexDocumentInfo } from '../src/lib/kb/eurlex.mjs';
import { fetchOfficialBytes, validateManifestEntry } from '../src/lib/kb/importer.mjs';

const args = process.argv.slice(2);
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;
const write = args.includes('--write');
const checkedOn = new Date().toISOString().slice(0, 10);
const manifestPath = 'config/legal-library/manifest.json';
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const { candidates } = JSON.parse(readFileSync('config/legal-library/eurlex-candidates.json', 'utf8'));
const known = new Set(manifest.entries.map((e) => `${e.officialNumber}|${e.version.language}`));

const status = [];
const added = [];
for (const candidate of candidates.filter((c) => !only || c.celex === only)) {
  const record = { celex: candidate.celex, officialNumber: candidate.officialNumber, legalAreas: candidate.legalAreas, checkedOn, evidenceUrl: eurlexStatusUrl(candidate.celex) };
  try {
    const page = await fetchOfficialBytes(eurlexStatusUrl(candidate.celex), { maxBytes: 5 * 1024 * 1024 });
    const info = parseEurlexDocumentInfo(new TextDecoder().decode(page.bytes));
    Object.assign(record, { publisherStatus: info.statusText, currentConsolidated: info.currentConsolidated, dateOfDocument: info.dateOfDocument, form: info.form });
    const { entries, reason } = entriesFromStatus(candidate, info, { checkedOn });
    const problems = entries.flatMap((e) => validateManifestEntry(e).map((p) => `${e.version.language}: ${p}`));
    if (reason || problems.length) {
      Object.assign(record, { status: 'SOURCE_CONFIRMED', reason: reason || problems.join('; ') });
    } else {
      const fresh = entries.filter((e) => !known.has(`${e.officialNumber}|${e.version.language}`));
      added.push(...fresh);
      Object.assign(record, { status: 'MANIFESTED', languages: entries.map((e) => e.version.language), newEntries: fresh.length });
    }
  } catch (error) {
    Object.assign(record, { status: 'BLOCKED', reason: String(error?.message || error).slice(0, 200) });
  }
  status.push(record);
  console.log(`${record.status.padEnd(16)} ${candidate.officialNumber}: ${record.reason || `${record.currentConsolidated}, document of ${record.dateOfDocument}, ${record.newEntries} new entries`}`);
}

writeFileSync('config/legal-library/candidates-status.json', `${JSON.stringify({
  $comment: 'Result of scripts/kb-eurlex-discover.mjs: DISCOVERED (listed), SOURCE_CONFIRMED (official page read, not importable automatically yet: reason), MANIFESTED (entries in the manifest), BLOCKED (official page not readable).',
  checkedOn, candidates: status,
}, null, 1)}\n`);
if (write && added.length > 0) {
  manifest.entries.push(...added);
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 1)}\n`);
}
console.log(`\n${added.length} new manifest entries${write ? ' written' : ' (dry run; --write to add)'}; ${status.filter((s) => s.status !== 'MANIFESTED').length} candidates not importable yet.`);
