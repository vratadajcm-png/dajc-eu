/** Repository-data migration only. No database, network, release or publishing. */
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, renameSync } from 'node:fs';
import { resolve, dirname, relative, join } from 'node:path';
import { createHash } from 'node:crypto';
import { migrateCanonicalCoverage } from './lib/geographic-migration.mjs';
import { scopeMonitoringDocument } from './lib/geographic-scope.mjs';
import { dajcEuropeCoverage, COVERAGE_VERSION } from '../config/europe-coverage.mjs';

const args = process.argv.slice(2);
const root = resolve(args.includes('--root') ? args[args.indexOf('--root') + 1] : '.');
const apply = args.includes('--apply');
const hash = text => createHash('sha256').update(text).digest('hex');
const plan = [], exclusions = [], manualReview = [];
const stage = (file, migrate) => {
  const before = readFileSync(file, 'utf8');
  const old = JSON.parse(before), value = migrate(old);
  if (JSON.stringify(old) !== JSON.stringify(value)) plan.push({ path: relative(root, file), file, before, after: JSON.stringify(value, null, before.match(/\n([ \t]+)"/)?.[1] || 2) + '\n' });
};
let canonicalReport;
stage(join(root, 'data/driving-bans/canonical.json'), old => {
  canonicalReport = migrateCanonicalCoverage(old);
  manualReview.push(...canonicalReport.manualReview);
  return canonicalReport.data;
});
const oversize = join(root, 'data/oversize');
for (const week of existsSync(oversize) ? readdirSync(oversize).sort() : []) {
  if (!/^\d{4}-W\d{2}$/.test(week)) continue;
  for (const name of ['findings.json', 'coverage.json']) {
    const file = join(oversize, week, name);
    if (!existsSync(file)) continue;
    stage(file, old => {
      const result = scopeMonitoringDocument(old);
      exclusions.push(...result.excluded.map(record => ({ file: relative(root, file), record })));
      return result.value;
    });
  }
}
const report = {
  coverage_version: COVERAGE_VERSION, retained: dajcEuropeCoverage.map(([code]) => code),
  removed_jurisdictions: Object.keys(canonicalReport.removedReviews).sort(),
  preserved_rule_count: canonicalReport.data.rules.length,
  migrated_rules: canonicalReport.migratedRules,
  removed_sources: canonicalReport.removedSources.map(s => s.source_id),
  manual_review: manualReview, excluded_monitoring_records: exclusions.length,
  changed_files: plan.map(p => p.path), apply,
};
if (apply && plan.length) {
  // Validate the complete plan first; back up ALL affected bytes before the
  // first mutation. Content-addressed, immutable backups support safe retries.
  const batch = hash(JSON.stringify(plan.map(p => [p.path, hash(p.before)]))).slice(0, 20);
  const archive = join(root, 'archive/geographic-coverage-20261022/batches', batch);
  const immutable = (path, bytes) => {
    mkdirSync(dirname(path), { recursive: true });
    if (existsSync(path)) {
      if (readFileSync(path, 'utf8') !== bytes) throw new Error(`Archive conflict: ${path}`);
    } else writeFileSync(path, bytes, { flag: 'wx' });
  };
  for (const p of plan) immutable(join(archive, 'original', p.path), p.before);
  immutable(join(archive, 'manifest.json'), JSON.stringify({ files: plan.map(p => ({ path: p.path, sha256: hash(p.before) })) }, null, 2) + '\n');
  immutable(join(archive, 'report.json'), JSON.stringify({ ...report, exclusions, removedRules: canonicalReport.removedRules }, null, 2) + '\n');
  for (const p of plan) {
    if (readFileSync(p.file, 'utf8') !== p.before) throw new Error(`Concurrent change: ${p.path}`);
    const temporary = `${p.file}.geo50.tmp`;
    writeFileSync(temporary, p.after, { flag: 'wx' });
    renameSync(temporary, p.file);
  }
}
console.log(JSON.stringify(report, null, 2));
