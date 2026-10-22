import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dajcEuropeCoverage, dajcCoverageCodes, COVERAGE_VERSION } from '../config/europe-coverage.mjs';
import { canonicalDrivingBans } from '../config/driving-ban-calendars/runtime.mjs';
import { oversizeSources } from '../config/oversize-sources/index.mjs';
import { SEARCH_GROUPS } from './lib/web-search.mjs';
import { scopeMonitoringDocument } from './lib/geographic-scope.mjs';
import { buildDrivingBanVerificationPlan } from '../config/driving-ban-calendars/verification.mjs';

const codes = dajcEuropeCoverage.map(([code]) => code);
assert.equal(new Set(codes).size, codes.length);
assert.deepEqual(Object.keys(canonicalDrivingBans.jurisdiction_reviews).sort(), [...codes].sort());
assert.deepEqual(SEARCH_GROUPS.flatMap(group => group.codes).sort(), [...codes].sort());
assert.deepEqual(buildDrivingBanVerificationPlan().jurisdictions.map(row=>row.jurisdiction).sort(), [...codes].sort());
assert(oversizeSources.every(source => dajcCoverageCodes.has(source.country) && !source.jurisdictionId));
let documents = 0;
for (const week of readdirSync('data/oversize').filter(name => /^\d{4}-W\d{2}$/.test(name))) {
  for (const name of readdirSync(`data/oversize/${week}`).filter(name => /^(findings|coverage)\.json$/.test(name))) {
    const document = JSON.parse(readFileSync(`data/oversize/${week}/${name}`, 'utf8'));
    assert.deepEqual(scopeMonitoringDocument(document).value, document, `Unmigrated active document ${week}/${name}`);
    if (document.jurisdictions) assert.deepEqual(document.jurisdictions.map(row => row.code).sort(), [...codes].sort());
    documents++;
  }
}
const migration = JSON.parse(execFileSync(process.execPath, ['scripts/migrate-geographic-coverage.mjs'], {encoding:'utf8'}));
assert.deepEqual(migration.changed_files, [], 'Migration must be a no-op on current data');
// Archived evidence is never a runtime input, including indirect imports.
const trackedFiles = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', 'src', 'config', 'scripts'], {encoding:'utf8'}).split('\0').filter(Boolean);
for (const path of trackedFiles) {
  if (!/\.(?:mjs|ts|astro)$/.test(path) || /(?:__tests__|\.test\.)/.test(path)) continue;
  const code = readFileSync(path, 'utf8');
  assert(!/(?:from\s*|import\s*\()\s*['"][^'"]*(?:archive\/|driving-bans-legacy\/)/.test(code), `Runtime imports archive: ${path}`);
  assert(!/(?:===|!==|length,\s*)\s*104\b/.test(code), `Hardcoded retired coverage count: ${path}`);
}
console.log(JSON.stringify({ coverage_version: COVERAGE_VERSION, jurisdictions: codes.length, official_sources: oversizeSources.length, search_groups: SEARCH_GROUPS.length, active_documents: documents, migration_idempotent: true, archive_isolated: true }, null, 2));
