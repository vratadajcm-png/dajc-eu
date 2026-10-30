/**
 * Consolidates the DAJC AI bake-off (DAJC AI Lab, vratadajcm-png/dajc-ai-lab; named dajc-ai-bakeoff at the time) original live run and
 * its recovery run into one sanitised evidence file for the research model profile.
 * Input: the two downloaded artifacts (untrusted data, read only). Output: counts, classes,
 * tokens, latency and reference cost per model; no answers, prompts, keys or error bodies.
 *
 *   node scripts/ai-benchmark-consolidate.mjs --original DIR --recovery DIR [--out FILE]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

const { values } = parseArgs({ options: { original: { type: 'string' }, recovery: { type: 'string' }, out: { type: 'string', default: 'data/ai-benchmark/bakeoff-2026-10-25.json' } } });
if (!values.original || !values.recovery) throw new Error('--original and --recovery artifact directories are required');
const read = (dir, name) => JSON.parse(readFileSync(join(resolve(dir), name), 'utf8'));
const key = row => `${row.provider}/${row.model}/${row.id}`;

/** API error classes from the recorded status line; the provider message itself is not kept. */
export function errorClass(error) {
  const text = String(error);
  if (/^Provider stopped after repeated HTTP 429/.test(text)) return 'NOT_SENT_RATE_LIMIT_DEFERRED';
  if (/^Provider stopped after HTTP \d+/.test(text)) return 'NOT_SENT_PROVIDER_BLOCKED';
  if (/credit balance is too low|billing/i.test(text)) return 'API_CREDIT_OR_BILLING';
  if (/^429\b.*exceeded your current quota/.test(text)) return 'API_QUOTA_OR_TOKEN_RATE';
  if (/^429\b.*rate_limited/.test(text)) return 'API_RATE_LIMIT';
  if (/^429\b/.test(text)) return 'API_RATE_LIMIT';
  if (/^403\b.*tier_not_allowed/.test(text)) return 'API_MODEL_NOT_IN_SUBSCRIPTION_TIER';
  if (/^40[13]\b/.test(text)) return 'API_AUTH_OR_PERMISSION';
  if (/^404\b/.test(text)) return 'API_MODEL_OR_ENDPOINT_NOT_FOUND';
  if (/^(400|422)\b/.test(text)) return 'API_INVALID_REQUEST';
  if (/^(503|529)\b/.test(text)) return 'API_OVERLOADED';
  if (/timeout|aborted/i.test(text)) return 'API_TIMEOUT';
  if (/missing secret|not configured/i.test(text)) return 'MISSING_CONFIGURATION';
  return 'API_OTHER';
}

/** Answer classes over the bake-off's own scoring fields (scoring itself is unchanged). */
export function answerClass(row) {
  if (row.error) return errorClass(row.error);
  if (row.pass) return 'CORRECT';
  if (!row.parse) return 'INVALID_OUTPUT';
  if (!row.status_ok || !row.forbidden_ok) return 'INCORRECT';
  if (!row.facts_ok || !row.sources_ok) return 'INCOMPLETE';
  if (row.unsupported_claims > 0) return 'UNVERIFIED_CLAIM';
  return 'INCORRECT';
}

const originalConfig = read(values.original, 'run-config.json');
const recoveryConfig = read(values.recovery, 'run-config.json');
const originalRows = read(values.original, 'results.json');
const finalRows = read(values.recovery, 'results.json');
const attempts = read(values.recovery, 'recovery-attempts.json');
const originalUsage = read(values.original, 'api-usage.json');
if (originalConfig.mode !== 'live' || recoveryConfig.recovery_source !== '40188865922') throw new Error('Unexpected artifacts');
for (const [name, rows] of [['original', originalRows], ['final', finalRows]]) if (rows.length !== 286 || new Set(rows.map(key)).size !== 286) throw new Error(`${name}: expected 286 unique model/case rows`);

// The recovery artifact keeps one row per model and case: the recovered answer replaces the API error.
const recoveryUsage = {};
for (const model of [...new Set(attempts.map(row => row.model))]) recoveryUsage[model] = read(join(values.recovery, 'recovery', model), 'api-usage.json');

const tally = list => list.reduce((acc, value) => ({ ...acc, [value]: (acc[value] ?? 0) + 1 }), {});
const avg = list => list.length ? Math.round(list.reduce((a, b) => a + b, 0) / list.length) : null;
const models = [...new Map(finalRows.map(row => [`${row.provider}/${row.model}`, { provider: row.provider, model: row.model }])).values()];
const summary = models.map(({ provider, model }) => {
  const original = originalRows.filter(row => row.provider === provider && row.model === model);
  const final = finalRows.filter(row => row.provider === provider && row.model === model);
  const completed = final.filter(row => !row.error);
  const usage = [...originalUsage.filter(entry => entry.provider === provider && entry.model === model), ...(recoveryUsage[model] ?? [])];
  // network_error entries in the recovery usage are requests the local guard stopped before sending.
  const sent = usage.filter(entry => entry.http_status);
  const classes = tally(final.map(answerClass));
  return {
    provider, model, reported_models: [...new Set(usage.map(entry => entry.reported_model).filter(Boolean))],
    original_run: { cases: original.length, correct: original.filter(row => row.pass).length, api_errors: original.filter(row => row.error).length },
    recovery_run: { retried_cases: attempts.filter(row => row.model === model).length, recovered_answers: attempts.filter(row => row.model === model && !row.error).length },
    consolidated: {
      cases: final.length, completed_answers: completed.length, correct: classes.CORRECT ?? 0,
      correct_rate_of_completed: completed.length ? +(classes.CORRECT / completed.length).toFixed(3) : null,
      classes, unverified_claims_total: completed.reduce((sum, row) => sum + (row.unsupported_claims || 0), 0),
      unknown_handled: `${completed.filter(row => row.category === 'unknown' && row.pass).length}/${final.filter(row => row.category === 'unknown').length}`,
      traps_handled: `${completed.filter(row => ['advice_trap', 'injection', 'false_premise'].includes(row.category) && row.pass).length}/${final.filter(row => ['advice_trap', 'injection', 'false_premise'].includes(row.category)).length}`,
    },
    requests: { sent_with_http_response: sent.length, http_status: tally(sent.map(entry => String(entry.http_status))), not_sent_local_guard: usage.length - sent.length },
    tokens: { avg_input_per_answer: avg(completed.map(row => row.inTok).filter(Boolean)), avg_output_per_answer: avg(completed.map(row => row.outTok).filter(Boolean)) },
    // Recovered answers include the recovery run's 15 s pacing pause, so only original-run answers measure latency.
    latency_ms: { avg_completed_original_run: avg(original.filter(row => !row.error).map(row => row.ms).filter(Boolean)), recovered_answers_include_pacing: attempts.some(row => row.model === model && !row.error) },
    cost_usd_reference_estimate: +completed.reduce((sum, row) => sum + (row.costUSD || 0), 0).toFixed(5),
    finish_reasons: tally(usage.map(entry => entry.finish_reason).filter(Boolean)),
  };
});

const output = {
  generated_by: 'scripts/ai-benchmark-consolidate.mjs',
  source: {
    repository: 'vratadajcm-png/dajc-ai-bakeoff',
    original: { run_id: 40188865922, run_attempt: 2, commit: 'e1908fb97088c140bbcaacfd7fa6efad429f3dd0', artifact_id: 12597935710, artifact_sha256: '7d7b0f21483f591d840c6a852cd840ab73484b51db5b69e01b058727e4358427', artifact_expires_at: '2026-11-24T11:47:41Z' },
    recovery: { run_id: 40222610637, run_attempt: 1, commit: '427375dc2ebbd5e28b179d7205bb7dd837f78d8b', artifact_id: 12610263812, artifact_sha256: 'a6754dd897d7b43f82d0d5368d98ba637e75ee9495f9622575bd669caebf5528', artifact_expires_at: '2026-11-24T19:03:02Z' },
    test_set: { cases: 26, reference_date: '2026-10-25', categories: tally(finalRows.filter(row => row.provider === models[0].provider && row.model === models[0].model).map(row => row.category)) },
  },
  method: [
    'One row per model and case: the recovery run replaced only API errors of the original run, so no case is counted twice.',
    'Scoring is the bake-off\'s own; this file only classifies its fields. CORRECT = pass; INCORRECT = wrong status or forbidden content; INCOMPLETE = expected fact or source missing; UNVERIFIED_CLAIM = only a claim without an allowed source; INVALID_OUTPUT = unparseable JSON.',
    'API error classes come from the recorded HTTP status line. NOT_SENT_* rows were stopped by the recovery guard after a blocking error and never reached the provider.',
    'Costs are reference estimates from the configured prices, not invoices. Latency is the mean over answers completed in the original run; recovered answers include a 15 s pacing pause.',
    'In the recovery run a 429 was retried inside one logged request up to 4 times (waits 30, 60, 120 s); the HTTP counts are logged responses, not every attempt.',
    'The test measures grounded question answering over a given registry extract (closest to explaining approved data). It does not measure document retrieval, legal extraction or verification.',
  ],
  models: summary,
};
writeFileSync(resolve(values.out), JSON.stringify(output, null, 2) + '\n');
console.table(summary.map(row => ({ model: row.model, completed: row.consolidated.completed_answers, correct: row.consolidated.correct, rate: row.consolidated.correct_rate_of_completed, sent: row.requests.sent_with_http_response, not_sent: row.requests.not_sent_local_guard, cost: row.cost_usd_reference_estimate, ms: row.latency_ms.avg_completed_original_run, classes: JSON.stringify(row.consolidated.classes) })));
