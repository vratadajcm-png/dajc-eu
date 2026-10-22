/** Read-only classification of canonical Driving Bans CI evidence.
 * Does not fetch legislation, refresh timestamps, or change source data.
 */
import { readFileSync, mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const source = resolve(process.argv[2] || 'artifacts/driving-bans/summary.json');
const target = resolve(process.argv[3] || 'artifacts/driving-bans/technical-status.json');
const summary = JSON.parse(readFileSync(source, 'utf8'));
const selected = summary.selected_jurisdictions;
if (summary.mode !== 'validate' || summary.tracked !== 76 ||
    !Array.isArray(selected) || selected.length !== 76 ||
    new Set(selected).size !== 76 || summary.external_source_review_performed !== false) {
  throw new Error('Invalid technical audit input: requires 76 distinct jurisdictions and explicit no-legal-review evidence');
}
const age = summary.sweep_age_days;
const reviewedSpanOk = summary.active_window_reviewed === true;
const recentEnough = typeof age === 'number' && Number.isFinite(age) && age >= 0 && age <= 8;
const stale = !reviewedSpanOk || !recentEnough;
const result = {
  mode: 'technical_only',
  technical_validation: 'passed',
  legal_review_performed: false,
  legal_freshness: stale ? 'stale_or_unconfirmed' : 'age_window_only_not_legally_rechecked',
  operational_state: stale ? 'NOT_CURRENTLY_VERIFIED' : 'NOT_LEGALLY_REVERIFIED',
  tracked: summary.tracked,
  dataset_version: summary.dataset_version,
  dataset_sha256: summary.canonical_sha256,
  generated_at: summary.generated_at,
  current_window: summary.window,
  reviewed_span: summary.reviewed_span,
  active_window_reviewed: reviewedSpanOk,
  last_sweep: summary.last_sweep,
  sweep_age_days: age,
  fully_verified_in_snapshot: summary.fully_verified,
  data_updated: false,
  published: false,
  message: stale
    ? 'The canonical dataset is stale or lacks current+next-month review. Do not claim updated Driving Bans or NO_BAN from this technical check.'
    : 'Schema/test checks passed. Source-law changes were NOT reviewed by this workflow.'
};
mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, JSON.stringify(result, null, 2) + '\n');
const md = [
  '# Driving Bans — read-only technical check',
  '',
  '- Technical checks: **PASS** (76 distinct jurisdictions)',
  '- Legal/source review performed: **NO**',
  '- Dataset: ' + result.dataset_version,
  '- Current public window: ' + (summary.window?.from || '?') + ' — ' + (summary.window?.to || '?'),
  '- Reviewed span contains active window: **' + (reviewedSpanOk ? 'YES' : 'NO') + '**',
  '- Last recorded sweep age: **' + (age === null ? 'unknown' : age + ' days') + '**',
  '- Operational trust: **' + result.operational_state + '**',
  '',
  result.message,
  '',
  '> This job never fetches legal sources, sets PRIMARY_VERIFIED, updates NO_BAN, publishes data, or writes to the repository.'
].join('\n');
console.log(md);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + '\n');
if (stale) console.log('::warning title=Driving Bans data not freshly verified::Technical audit passed; dataset is stale or lacks review coverage. No legal validation was performed.');
