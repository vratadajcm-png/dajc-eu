#!/usr/bin/env node
// Daily EU Oversize monitor - run by .github/workflows/daily-oversize-monitor.yml
// every morning. Walks config/oversize-sources, reads known RSS/Atom feeds
// and official HTML fallbacks, normalizes results into findings, deduplicates
// against the current ISO week's data/oversize/<week>/findings.json, and
// writes the result back.
//
// Never touches content/news - this script only maintains the raw dataset
// that the Friday editorial pipeline (generate-weekly-article.mjs) reads.
// One source being down is logged and isolated, never fatal.

import { oversizeSources } from '../config/oversize-sources/index.mjs';
import { fetchSourceFindings } from './lib/fetch-source.mjs';
import { mergeFindings, markExpired } from './lib/findings.mjs';
import { loadWeekFindings, saveWeekFindings } from './lib/store.mjs';
import { isoWeekLabel } from './lib/week.mjs';
import { coverageForSources, oversizeJurisdictions } from '../config/oversize-jurisdictions/index.mjs';

async function main() {
  const now = new Date();
  const weekLabel = isoWeekLabel(now);
  const nowIso = now.toISOString();

  console.log(`EU Oversize daily monitor - ${nowIso}`);
  console.log(`ISO week: ${weekLabel}`);
  console.log(`Sources configured: ${oversizeSources.length}\n`);

  const existing = await loadWeekFindings(weekLabel);
  const beforeCount = existing.size;

  let sourcesFeed = 0;
  let sourcesHtml = 0;
  let sourcesHybrid = 0;
  let sourcesUnavailable = 0;
  const unavailable = [];
  const allCandidates = [];

  // A bounded worker pool keeps the pan-European scan fast without hammering
  // authorities. Sequential fetching makes a handful of 12s timeouts add
  // minutes to every daily/Friday run; six concurrent sources keeps that
  // failure mode bounded while remaining polite.
  const results = new Array(oversizeSources.length);
  let nextIndex = 0;

  async function worker() {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= oversizeSources.length) return;
      const source = oversizeSources[index];
      results[index] = await fetchSourceFindings(source, { now: nowIso });
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(6, oversizeSources.length) }, () => worker())
  );

  for (let i = 0; i < oversizeSources.length; i += 1) {
    const source = oversizeSources[i];
    const result = results[i];

    if (result.status === 'ok') {
      if (result.method === 'feed') sourcesFeed += 1;
      else if (result.method === 'hybrid') sourcesHybrid += 1;
      else sourcesHtml += 1;

      const via = result.method || 'official source';
      const used = result.sourceUrlUsed || source.url;
      console.log(`[${source.id}] (${source.country}) OK - ${result.findings.length} item(s) via ${via} from ${used}`);
      allCandidates.push(...result.findings);
    } else {
      sourcesUnavailable += 1;
      unavailable.push({ id: source.id, country: source.country, error: result.error || 'unreachable' });
      console.log(`[${source.id}] (${source.country}) UNAVAILABLE - ${result.error || 'no official endpoint reachable'}`);
    }
  }

  let merged = mergeFindings(existing, allCandidates, nowIso);
  merged = markExpired(merged, now);

  const statusCounts = { new: 0, updated: 0, active: 0, expired: 0, superseded: 0 };
  for (const finding of merged.values()) statusCounts[finding.status] += 1;

  await saveWeekFindings(weekLabel, merged);

  console.log('\n=== SUMMARY ===');
  console.log(`sources checked: ${oversizeSources.length}`);
  console.log(`sources read via RSS/Atom: ${sourcesFeed}`);
  console.log(`sources read via official HTML only: ${sourcesHtml}`);
  console.log(`sources read via RSS/Atom + official HTML: ${sourcesHybrid}`);
  console.log(`sources unavailable: ${sourcesUnavailable}`);

  const jurisdictionCoverage = coverageForSources(oversizeSources);
  const coverageGaps = jurisdictionCoverage.filter((item) => !item.covered);
  console.log(`mandatory jurisdictions/territories covered by configured source mapping: ${jurisdictionCoverage.length - coverageGaps.length}/${oversizeJurisdictions.length}`);
  if (coverageGaps.length > 0) {
    console.error('Mandatory geographic coverage gaps:');
    for (const gap of coverageGaps) console.error(`  - ${gap.nameCs} [${gap.id}]`);
    process.exitCode = 1;
  }
  console.log(`findings before this run: ${beforeCount}`);
  console.log(`findings after this run: ${merged.size}`);
  console.log(`new findings: ${statusCounts.new}`);
  console.log(`updated findings: ${statusCounts.updated}`);
  console.log(`active (unchanged) findings: ${statusCounts.active}`);
  console.log(`expired findings: ${statusCounts.expired}`);
  console.log(`superseded findings: ${statusCounts.superseded}`);

  if (unavailable.length > 0) {
    console.log('\nUnavailable official sources (kept visible for maintenance):');
    for (const item of unavailable) {
      console.log(`  - ${item.id} (${item.country}): ${item.error}`);
    }
  }

  console.log(`\nWritten to data/oversize/${weekLabel}/findings.json`);
}

main().catch((err) => {
  console.error('Daily oversize monitor failed:', err);
  process.exitCode = 1;
});
