#!/usr/bin/env node
// Change monitoring of the legal library (config/legal-library/monitor.json).
//
//   node scripts/kb-monitor.mjs [--tier monthly] [--write] [--report monitor.json]
//
// For every EUR-Lex act of the manifest, reads the act's own status page
// (robots.txt and crawl delay respected) and reports:
//   UNCHANGED          - in force, the stored consolidation is still the current one;
//   NEW_CONSOLIDATION  - EUR-Lex lists a newer consolidated version;
//   NO_LONGER_IN_FORCE - EUR-Lex no longer shows the act in force;
//   UNREADABLE         - the status could not be read. Never evidence that
//                        nothing changed: the versions stay as they are, and the
//                        next verification fails closed until the source answers.
// With --write a new consolidation is added to the manifest (all languages of
// the stored act); the next import then supersedes the older version and keeps
// it for history, and the next AI verification run revokes an AI_VERIFIED
// state that relies on an outdated text (layer 1 fails: fail closed). The
// monitor itself never writes to the database.

import { readFileSync, writeFileSync } from 'node:fs';
import { consolidatedLabel, consolidatedPdfUrl, eurlexStatusUrl, parseEurlexDocumentInfo } from '../src/lib/kb/eurlex.mjs';
import { fetchOfficialBytes } from '../src/lib/kb/importer.mjs';
import { baseActCelex, celexOf, consolidationDate } from '../src/lib/kb/verify.mjs';

const args = process.argv.slice(2);
const value = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const tier = value('--tier') || 'monthly';
const checkedOn = new Date().toISOString().slice(0, 10);
const manifestPath = 'config/legal-library/manifest.json';
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const tiers = JSON.parse(readFileSync('config/legal-library/monitor.json', 'utf8')).tiers;
if (!tiers[tier]) throw new Error(`unknown tier ${tier}`);

// Newest stored consolidation per act (the manifest keeps older ones for history).
const acts = new Map();
for (const e of manifest.entries.filter((x) => x.sourceId === 'eu-eurlex')) {
  const celex = celexOf(e.version.url);
  const base = baseActCelex(celex);
  if (!base || (tiers[tier].celex && !tiers[tier].celex.includes(base))) continue;
  const act = acts.get(base) ?? { base, officialNumber: e.officialNumber, latest: null, entries: [] };
  act.entries.push(e);
  if (!act.latest || celex > act.latest) act.latest = celex;
  acts.set(base, act);
}

const results = [];
const added = [];
for (const act of acts.values()) {
  const result = { celex: act.base, officialNumber: act.officialNumber, stored: act.latest, checkedOn, evidenceUrl: eurlexStatusUrl(act.base) };
  try {
    const page = await fetchOfficialBytes(eurlexStatusUrl(act.base), { maxBytes: 5 * 1024 * 1024 });
    const info = parseEurlexDocumentInfo(new TextDecoder().decode(page.bytes));
    Object.assign(result, { publisherStatus: info.statusText, current: info.currentConsolidated });
    if (info.inForce !== true) result.outcome = info.inForce === false ? 'NO_LONGER_IN_FORCE' : 'UNREADABLE';
    else if (!info.currentConsolidated) result.outcome = 'UNREADABLE';
    else if (info.currentConsolidated === act.latest) result.outcome = 'UNCHANGED';
    else if (info.currentConsolidated > act.latest && consolidationDate(info.currentConsolidated) <= checkedOn) {
      result.outcome = 'NEW_CONSOLIDATION';
      const template = act.entries.filter((e) => celexOf(e.version.url) === act.latest);
      for (const e of template) {
        const effectiveFrom = consolidationDate(info.currentConsolidated);
        added.push({ ...e, version: { ...e.version,
          label: consolidatedLabel(e.officialNumber, e.version.language, effectiveFrom) ?? `${e.version.label} (consolidation ${effectiveFrom})`,
          url: consolidatedPdfUrl(e.version.language, info.currentConsolidated), effectiveFrom, validityCheckedOn: checkedOn,
          notes: `New consolidation found by scripts/kb-monitor.mjs on ${checkedOn}; ${e.version.notes ?? ''}`.trim() } });
      }
    } else result.outcome = 'UNREADABLE';
  } catch (error) {
    Object.assign(result, { outcome: 'UNREADABLE', reason: String(error?.message || error).slice(0, 200) });
  }
  results.push(result);
  console.log(`${result.outcome.padEnd(18)} ${act.officialNumber}: stored ${act.latest}${result.current && result.current !== act.latest ? `, current ${result.current}` : ''}${result.reason ? ` (${result.reason})` : ''}`);
}

if (args.includes('--write') && added.length > 0) {
  manifest.entries.push(...added);
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 1)}\n`);
}
const summary = Object.fromEntries(['UNCHANGED', 'NEW_CONSOLIDATION', 'NO_LONGER_IN_FORCE', 'UNREADABLE'].map((k) => [k, results.filter((r) => r.outcome === k).length]));
if (value('--report')) writeFileSync(value('--report'), `${JSON.stringify({ checkedOn, tier, summary, results }, null, 1)}\n`);
console.log(`\n${JSON.stringify(summary)}; ${added.length} new manifest entries${args.includes('--write') ? ' written' : ' (--write to add)'}.`);
// An unreadable source or a repealed act needs attention; a new consolidation is routine.
process.exitCode = summary.UNREADABLE + summary.NO_LONGER_IN_FORCE > 0 ? 1 : 0;
