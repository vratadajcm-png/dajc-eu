#!/usr/bin/env node
// Daily EU Oversize monitor - run by .github/workflows/daily-oversize-monitor.yml
// every morning. Walks config/oversize-sources, fetches whatever feeds it
// can, normalizes results into findings, deduplicates against the current
// ISO week's data/oversize/<week>/findings.json, and writes the result back.
//
// Never touches content/news - this script only maintains the raw dataset
// that the Friday editorial pipeline (generate-weekly-article.mjs) reads
// from. A source being down or a feed being unparseable is logged and
// skipped, never a fatal error (see docs/NEWS_AUTOMATION.md).

import { oversizeSources } from '../config/oversize-sources/index.mjs';
import { fetchSourceFindings } from './lib/fetch-source.mjs';
import { mergeFindings, markExpired } from './lib/findings.mjs';
import { loadWeekFindings, saveWeekFindings } from './lib/store.mjs';
import { isoWeekLabel } from './lib/week.mjs';

async function main() {
  const now = new Date();
  const weekLabel = isoWeekLabel(now);
  const nowIso = now.toISOString();

  console.log(`EU Oversize daily monitor - ${nowIso}`);
  console.log(`ISO week: ${weekLabel}`);
  console.log(`Sources configured: ${oversizeSources.length}\n`);

  const existing = await loadWeekFindings(weekLabel);
  const beforeCount = existing.size;

  let sourcesOk = 0;
  let sourcesNoFeed = 0;
  const allCandidates = [];

  for (const source of oversizeSources) {
    process.stdout.write(`[${source.id}] (${source.country}) ... `);
    const result = await fetchSourceFindings(source, { now: nowIso });
    if (result.status === 'ok') {
      sourcesOk += 1;
      console.log(`OK - ${result.findings.length} item(s) from ${result.feedUrlUsed}`);
      allCandidates.push(...result.findings);
    } else {
      sourcesNoFeed += 1;
      console.log('no feed reachable - skipped');
    }
  }

  let merged = mergeFindings(existing, allCandidates, nowIso);
  merged = markExpired(merged, now);

  const statusCounts = { new: 0, updated: 0, active: 0, expired: 0, superseded: 0 };
  for (const finding of merged.values()) statusCounts[finding.status] += 1;

  await saveWeekFindings(weekLabel, merged);

  console.log('\n=== SUMMARY ===');
  console.log(`sources checked: ${oversizeSources.length}`);
  console.log(`sources with a readable feed: ${sourcesOk}`);
  console.log(`sources with no reachable feed: ${sourcesNoFeed}`);
  console.log(`findings before this run: ${beforeCount}`);
  console.log(`findings after this run: ${merged.size}`);
  console.log(`new findings: ${statusCounts.new}`);
  console.log(`updated findings: ${statusCounts.updated}`);
  console.log(`active (unchanged) findings: ${statusCounts.active}`);
  console.log(`expired findings: ${statusCounts.expired}`);
  console.log(`superseded findings: ${statusCounts.superseded}`);
  console.log(`\nWritten to data/oversize/${weekLabel}/findings.json`);
}

main().catch((err) => {
  // Isolated failures inside fetchSourceFindings never reach here - if we
  // get here, something unexpected broke (e.g. disk write failure). Exit
  // non-zero so the GitHub Action surfaces it, but note that any content
  // already published earlier is entirely unaffected by this script failing.
  console.error('Daily oversize monitor failed:', err);
  process.exitCode = 1;
});
