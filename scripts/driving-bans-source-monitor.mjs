#!/usr/bin/env node
// Automated official-source monitor for Driving Bans (read-only for the registry).
// Usage: node scripts/driving-bans-source-monitor.mjs [--output DIR] [--only AT,DE]
//        [--previous data/driving-bans-monitor/latest.json] [--state-dir data/driving-bans-monitor]
//        [--max-sources N] [--min-success-rate 0.6] [--fail-on-change]
// Exit codes: 0 ok; 2 official source text changed since the last run (with
// --fail-on-change); 3 degraded retrieval (success rate below the minimum).
// It never writes data/driving-bans/canonical.json and is not a legal review.
import { mkdirSync, readFileSync, writeFileSync, existsSync, appendFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { canonicalDrivingBans } from '../config/driving-ban-calendars/runtime.mjs';
import { officialAuthorityDomains } from '../config/official-authority-domains.mjs';
import { MONITOR_DEFAULTS } from '../config/driving-ban-sources/monitor-policy.mjs';
import { safeFetch } from '../src/lib/driving-bans/research/safe-fetch.mjs';
import { monitorSources, buildReverificationQueue, verifiedTextBaseline, monitorMarkdown, monitorAllowedHosts, NORMALIZER_VERSION } from '../src/lib/driving-bans/source-monitor.mjs';

const args = process.argv.slice(2);
const option = (name, fallback) => { const i = args.indexOf(name); if (i < 0) return fallback; if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`Missing value: ${name}`); return args[i + 1]; };
const out = resolve(option('--output', 'artifacts/driving-bans'));
const only = option('--only', '') ? option('--only', '').split(',').map((code) => code.trim().toUpperCase()).filter((code) => /^[A-Z]{2}$/.test(code)) : null;
const maxSourcesArg = option('--max-sources', 'Infinity');
if (maxSourcesArg !== 'Infinity' && !/^[1-9]\d*$/.test(maxSourcesArg)) throw new Error('--max-sources must be a positive integer');
const maxSources = Number(maxSourcesArg);
const minSuccessRate = Number(option('--min-success-rate', String(MONITOR_DEFAULTS.minSuccessRate)));
const previousPath = option('--previous', '');
const stateDir = option('--state-dir', '');
// A partial run (--only/--max-sources) lacks the other sources' last good
// fingerprints; persisting it as latest.json would erase them. Refuse before
// any network access.
if (stateDir && (only || maxSources !== Infinity)) throw new Error('--state-dir requires a full run: a partial run must never replace the persisted monitor state');
const previous = previousPath && existsSync(resolve(previousPath)) ? JSON.parse(readFileSync(resolve(previousPath), 'utf8')) : null;
if (previous && (previous.schema_version !== 1 || !Array.isArray(previous.results))) throw new Error('Invalid previous monitor state');
const baselinePath = resolve('data/driving-bans/source-monitor/text-baseline.json');
const baseline = existsSync(baselinePath) ? JSON.parse(readFileSync(baselinePath, 'utf8')).sources || {} : {};

// The allowlist is exactly the hosts of human-reviewed PRIMARY (official)
// canonical sources plus the configured national authorities and the RIS OGD
// mirror. Secondary hosts (press, associations, aggregators) are excluded so a
// redirect can never turn third-party content into official evidence.
const allowedHosts = monitorAllowedHosts(canonicalDrivingBans, [...Object.values(officialAuthorityDomains).flat(), 'ogd.ris.bka.gv.at']);

const report = await monitorSources({
  canonical: canonicalDrivingBans, baseline, previous, only, maxSources,
  fetcher: (url) => safeFetch(url, { allowedHosts }),
});
const queue = buildReverificationQueue({ canonical: canonicalDrivingBans, report, now: new Date(report.generated_at) });
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'source-monitor.json'), JSON.stringify(report, null, 2) + '\n');
writeFileSync(join(out, 'reverification-queue.json'), JSON.stringify(queue, null, 2) + '\n');
writeFileSync(join(out, 'text-baseline.proposed.json'), JSON.stringify({ schema_version: 1, normalizer_version: NORMALIZER_VERSION, generated_at: report.generated_at,
  note: 'Only sources whose retrieved bytes equal the reviewed content_sha256. Commit through a reviewed PR.', sources: verifiedTextBaseline(report) }, null, 2) + '\n');
const markdown = monitorMarkdown(report, queue);
writeFileSync(join(out, 'source-monitor.md'), markdown + '\n');
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, '\n' + markdown + '\n');
console.log(markdown);
// Persistable state is written last: a run that fails before this point
// leaves the loaded previous state untouched, so an alert can never be
// followed by persisting a change it did not describe.
if (stateDir) {
  // History and provenance for the data branch: latest state plus one
  // immutable record per run (no document bodies, only hashes and states).
  const dir = resolve(stateDir);
  mkdirSync(join(dir, 'history'), { recursive: true });
  const stamp = report.generated_at.replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z').replace(/^(\d{8})T(\d{4})\d{2}Z$/, (_, d, t) => `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}T${t}Z`);
  writeFileSync(join(dir, 'latest.json'), JSON.stringify(report, null, 2) + '\n');
  writeFileSync(join(dir, 'history', `${stamp}.json`), JSON.stringify(report, null, 2) + '\n');
}

// Alert on an actual change between runs (or degraded retrieval). Differences
// from the reviewed hash stay in the reviewer queue: dynamic pages would
// otherwise alert every week.
const changedSinceLastRun = report.summary.changed_since_last_run;
if (report.summary.success_rate !== null && report.summary.success_rate < minSuccessRate) {
  console.error(`::error::Driving Bans source monitor degraded: success rate ${report.summary.success_rate} < ${minSuccessRate}. Last reviewed data is kept.`);
  process.exitCode = 3;
} else if (changedSinceLastRun && args.includes('--fail-on-change')) {
  console.error(`::warning::${changedSinceLastRun} official Driving Bans source(s) changed since the last run: legal review required before the registry changes.`);
  process.exitCode = 2;
}
