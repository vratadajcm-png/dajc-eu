#!/usr/bin/env node
// Daily DAJC Europe oversize monitor. Reads configured official sources,
// stores findings, and writes an explicit geographic coverage audit for the
// complete DAJC Europe matrix so missing jurisdictions remain visible.

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { oversizeSources } from '../config/oversize-sources/index.mjs';
import { dajcEuropeCoverage } from '../config/europe-coverage.mjs';
import { fetchSourceFindings } from './lib/fetch-source.mjs';
import { mergeFindings, markExpired } from './lib/findings.mjs';
import { loadWeekFindings, saveWeekFindings } from './lib/store.mjs';
import { isoWeekLabel } from './lib/week.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const PARENT_SOURCE = {
  ENG: 'UK', SCT: 'UK', WLS: 'UK', NIR: 'UK', GG: 'UK', JE: 'UK', IM: 'UK', GI: 'UK',
  AX: 'FI', FO: 'DK', GL: 'DK', SJ: 'NO', SBA: 'CY', NCY: 'CY',
  CEU: 'ES', MLL: 'ES', CAN: 'ES', CAT: 'ES', BAS: 'ES', GAL: 'ES',
  AZO: 'PT', MAD: 'PT', FLA: 'BE', WAL: 'BE', BRU: 'BE',
  FBIH: 'BA', RSBA: 'BA', TRN: 'MD', GAG: 'MD', AB: 'GE', SO: 'GE', RSM: 'SM',
};

async function main() {
  const now = new Date();
  const weekLabel = isoWeekLabel(now);
  const nowIso = now.toISOString();

  console.log(`DAJC European Oversize monitor - ${nowIso}`);
  console.log(`ISO week: ${weekLabel}`);
  console.log(`Sources configured: ${oversizeSources.length}`);
  console.log(`Coverage jurisdictions: ${dajcEuropeCoverage.length}\n`);

  const existing = await loadWeekFindings(weekLabel);
  const beforeCount = existing.size;

  let sourcesFeed = 0;
  let sourcesHtml = 0;
  let sourcesUnavailable = 0;
  const unavailable = [];
  const allCandidates = [];
  const sourceResults = [];

  const results = new Array(oversizeSources.length);
  let nextIndex = 0;

  async function worker() {
    while (true) {
      const index = nextIndex++;
      if (index >= oversizeSources.length) return;
      const source = oversizeSources[index];
      results[index] = await fetchSourceFindings(source, { now: nowIso });
    }
  }

  await Promise.all(Array.from({ length: Math.min(6, oversizeSources.length) }, () => worker()));

  for (let i = 0; i < oversizeSources.length; i += 1) {
    const source = oversizeSources[i];
    const result = results[i];
    sourceResults.push({ source, result });

    if (result.status === 'ok') {
      if (result.method === 'feed') sourcesFeed += 1;
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

  const findingsByCountry = new Map();
  for (const finding of merged.values()) {
    const code = oversizeSources.find((s) => s.name === finding.sourceName || s.authority === finding.sourceName)?.country;
    if (code) findingsByCountry.set(code, (findingsByCountry.get(code) || 0) + 1);
  }

  const coverage = dajcEuropeCoverage.map(([code, name]) => {
    const effectiveCode = PARENT_SOURCE[code] || code;
    const relevant = sourceResults.filter(({ source }) => source.country === effectiveCode);
    const ok = relevant.filter(({ result }) => result.status === 'ok');
    const unavailableForJurisdiction = relevant.filter(({ result }) => result.status !== 'ok');
    const findingCount = findingsByCountry.get(effectiveCode) || 0;

    let status;
    if (ok.length > 0 && findingCount > 0) status = 'checked-major-or-short-update-candidates-found';
    else if (ok.length > 0) status = 'checked-no-material-development-found';
    else if (relevant.length > 0) status = 'checked-source-availability-limited';
    else status = 'checked-source-availability-limited';

    return {
      code,
      name,
      sourceScope: effectiveCode,
      status,
      configuredSources: relevant.map(({ source }) => source.id),
      reachableSources: ok.map(({ source }) => source.id),
      unavailableSources: unavailableForJurisdiction.map(({ source, result }) => ({ id: source.id, error: result.error || 'unreachable' })),
      candidateFindings: findingCount,
    };
  });

  const coverageDir = path.join(ROOT, 'data', 'oversize', weekLabel);
  await mkdir(coverageDir, { recursive: true });
  await writeFile(
    path.join(coverageDir, 'coverage.json'),
    `${JSON.stringify({ week: weekLabel, checkedAt: nowIso, jurisdictions: coverage }, null, 2)}\n`,
    'utf-8'
  );

  console.log('\n=== SUMMARY ===');
  console.log(`sources checked: ${oversizeSources.length}`);
  console.log(`jurisdictions audited: ${coverage.length}`);
  console.log(`sources read via RSS/Atom: ${sourcesFeed}`);
  console.log(`sources read via official HTML: ${sourcesHtml}`);
  console.log(`sources unavailable: ${sourcesUnavailable}`);
  console.log(`findings before this run: ${beforeCount}`);
  console.log(`findings after this run: ${merged.size}`);
  console.log(`new findings: ${statusCounts.new}`);
  console.log(`updated findings: ${statusCounts.updated}`);
  console.log(`active (unchanged) findings: ${statusCounts.active}`);
  console.log(`expired findings: ${statusCounts.expired}`);
  console.log(`superseded findings: ${statusCounts.superseded}`);

  if (unavailable.length > 0) {
    console.log('\nUnavailable official sources (visible for maintenance):');
    for (const item of unavailable) console.log(`  - ${item.id} (${item.country}): ${item.error}`);
  }

  const limited = coverage.filter((x) => x.status === 'checked-source-availability-limited');
  if (limited.length > 0) {
    console.log(`\nCoverage with limited/no reachable configured source: ${limited.length}`);
    for (const item of limited) console.log(`  - ${item.code} ${item.name}`);
  }

  console.log(`\nWritten to data/oversize/${weekLabel}/findings.json`);
  console.log(`Coverage audit: data/oversize/${weekLabel}/coverage.json`);
}

main().catch((err) => {
  console.error('Daily oversize monitor failed:', err);
  process.exitCode = 1;
});
