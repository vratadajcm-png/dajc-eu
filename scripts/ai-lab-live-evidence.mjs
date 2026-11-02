#!/usr/bin/env node
/**
 * DAJC AI Lab → DAJC.eu: turns downloaded live-check artifacts of the AI Lab workflow
 * "DAJC-eu research live check" into sanitized evidence for the model catalog
 * (data/ai-benchmark/live-checks-*.json). A person runs it on artifacts they downloaded and
 * brings the result into dajc-eu by pull request; nothing is fetched or written elsewhere.
 *
 * Only metadata survives: providers, models, outcomes, error categories, token counts,
 * costs, latencies, finding codes and draft states. No prompts, document text, quotes,
 * extracted rules or provider messages. Anything that looks like a credential stops the
 * import, so a key that slipped into an artifact can never reach the public repository.
 * The command line also prints what the evidence would change in the approved model policy,
 * as proposals for the owner (proposePolicyUpdate); nothing is applied.
 *
 *   node scripts/ai-lab-live-evidence.mjs --repository vratadajcm-png/dajc-ai-lab \
 *     --run 40974550043=DIR@19e69f4 [--run ...] --out data/ai-benchmark/live-checks-2026-10.json
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

export const CREDENTIAL_PATTERNS = Object.freeze([
  /\bsk-(?:proj-|ant-)?[A-Za-z0-9_-]{20,}/, /\bAIza[0-9A-Za-z_-]{30,}/, /\bxai-[A-Za-z0-9]{20,}/, /\bpplx-[A-Za-z0-9]{20,}/,
  /\bgh[pousr]_[A-Za-z0-9]{30,}/, /Bearer\s+[A-Za-z0-9._~+/-]{20,}/i, /"(?:x-api-key|authorization|api[_-]?key)"\s*:\s*"[^"]{8,}"/i,
]);
const ARTIFACT_FILES = Object.freeze(['summary.json', 'smoke.json', 'scenario.json', 'fallback.json', 'e2e.json']);

/** Throws when a text holds anything that looks like a credential; never echoes the match. */
export function assertNoCredentials(text, label) {
  const hit = CREDENTIAL_PATTERNS.findIndex(pattern => pattern.test(text));
  if (hit >= 0) throw new Error(`${label}: credential-like content (pattern ${hit}); the artifact is not imported`);
}

const num = value => (typeof value === 'number' && Number.isFinite(value) ? value : null);
const str = value => (typeof value === 'string' && value.length <= 200 ? value : null);
const codes = list => [...new Set((list ?? []).map(item => (typeof item === 'string' ? item : item?.code)).filter(code => typeof code === 'string' && /^[A-Z][A-Z0-9_]{1,80}$/.test(code)))].sort();

function call(check, row) {
  return {
    check, task: str(row.task), purpose: str(row.purpose), provider: str(row.provider), requested_model: str(row.requested_model), served_model: str(row.model),
    complex: Boolean(row.complex), outcome: row.outcome === 'OK' ? 'OK' : 'FAILED', error_category: str(row.error_category) ?? null, http_status: num(row.http_status), provider_code: str(row.provider_code) ?? null,
    attempts: num(row.attempts), input_tokens: num(row.input_tokens) ?? 0, output_tokens: num(row.output_tokens) ?? 0, cost_usd: num(row.cost_usd) ?? 0, latency_ms: num(row.latency_ms),
  };
}

/** Sanitized evidence of one AI Lab run directory (an unpacked artifact). */
export function runEvidence(dir, { runId, commit }) {
  const read = name => {
    const file = join(dir, name);
    if (!existsSync(file)) return null;
    const text = readFileSync(file, 'utf8');
    assertNoCredentials(text, `${runId}/${name}`);
    return JSON.parse(text);
  };
  const summary = read('summary.json');
  if (!summary || !Array.isArray(summary.checks)) throw new Error(`${runId}: summary.json missing or not a live-check summary`);
  const [smoke, scenario, fallback, e2e] = ARTIFACT_FILES.slice(1).map(read);
  const draftsDir = join(dir, 'research-store', 'drafts');
  const drafts = existsSync(draftsDir) ? readdirSync(draftsDir).filter(name => /^rdraft-[0-9a-f]{16}\.json$/.test(name)).sort().map(name => {
    const text = readFileSync(join(draftsDir, name), 'utf8');
    assertNoCredentials(text, `${runId}/drafts/${name}`);
    const draft = JSON.parse(text);
    return {
      draft_id: draft.draft_id, jurisdiction: draft.jurisdiction, state: draft.state, phases: draft.phases,
      document: { kind: draft.document?.kind ?? null, parts: draft.document?.parts?.length ?? 1 },
      extraction: { provider: draft.extraction?.provider ?? null, model: draft.extraction?.model ?? null, escalated_from: draft.extraction?.escalated_from ?? null },
      cross_check: draft.cross_check ? { provider: draft.cross_check.provider, model: draft.cross_check.model, overall: draft.cross_check.overall, ok: draft.cross_check.ok } : null,
      second_extraction: draft.second_extraction ? { provider: draft.second_extraction.provider, model: draft.second_extraction.model, agreed: draft.second_extraction.agreed } : null,
      blocking_findings: codes((draft.findings ?? []).filter(f => f.blocking_state !== 'NOTE')), notes: codes((draft.findings ?? []).filter(f => f.blocking_state === 'NOTE')),
    };
  }) : [];
  const calls = [
    ...(smoke?.results ?? []).flatMap(row => (row.audit ?? []).map(entry => call('smoke', entry))),
    ...(scenario?.results ?? []).flatMap(row => (row.audit ?? []).map(entry => call('scenario', entry))),
    ...(fallback?.audit ?? []).map(entry => call('fallback', entry)),
    ...(e2e?.audit ?? []).map(entry => call('e2e', entry)),
  ];
  return {
    run_id: String(runId), dajc_eu_commit: commit ?? null, generated_at: str(summary.generated_at), checks: summary.checks,
    cost_usd: num(summary.total_cost_usd), run_budget_usd: num(summary.run_budget_usd), providers_blocked_for_run: summary.providers_blocked_for_run ?? {},
    canonical_unchanged: summary.canonical_unchanged === true, promoted: summary.promoted === true,
    smoke: smoke ? smoke.results.map(row => ({ provider: row.provider, outcome: row.outcome, served_model: row.served_model ?? null, blocked_for_run: row.blocked_for_run ?? row.audit?.[0]?.blocked_for_run ?? null })) : null,
    scenario: scenario ? { case_id: scenario.case_id, retrieval_ok: scenario.retrieval?.ok === true, results: scenario.results.map(row => ({
      provider: row.provider, outcome: row.outcome ?? (row.schema_valid === undefined ? null : 'OK'), served_model: row.served_model ?? null, schema_valid: row.schema_valid ?? null, rules: row.rules ?? null,
      registry_match: row.registry_comparison?.matched ?? null, blocking_findings: row.findings ? row.findings.filter(f => f.blocking_state !== 'NOTE').length : (row.deterministic_findings ?? null)?.length ?? null, finding_codes: codes(row.deterministic_findings),
    })) } : null,
    fallback: fallback ? { first: fallback.first, second: fallback.second, first_provider_requests: fallback.first_provider_requests, first_provider_blocked: fallback.first_provider_state?.blocked ?? null, served_by: (fallback.outcomes ?? []).map(o => o.served_by ?? null) } : null,
    e2e: e2e ? { jurisdiction: e2e.jurisdiction, retrieval: { discovered: e2e.steps?.retrieval?.discovered ?? null, retrieved: e2e.steps?.retrieval?.retrieved ?? null, unavailable: (e2e.steps?.retrieval?.unavailable ?? []).length }, independent_check: e2e.steps?.independent_check ?? null, drafts } : null,
    calls,
  };
}

/** Per model and per provider, with API failures kept apart from extraction quality. */
export function aggregate(runs) {
  const models = new Map();
  const model = (provider, id) => {
    const key = `${provider}/${id}`;
    if (!models.has(key)) models.set(key, { provider, model: id, calls: 0, ok: 0, failed_by_category: {}, cost_usd: 0, extraction: { readings: 0, schema_valid: 0, registry_match: 0, without_blocking_findings: 0 }, used_in_review_required_draft: 0 });
    return models.get(key);
  };
  for (const run of runs) {
    for (const entry of run.calls) {
      // A deliberately unknown model (failover check) says nothing about a real model.
      if (!entry.provider || !entry.requested_model || entry.requested_model === 'dajc-nonexistent-model-check') continue;
      const row = model(entry.provider, entry.requested_model);
      row.calls += 1;
      row.cost_usd = Math.round((row.cost_usd + entry.cost_usd) * 1e6) / 1e6;
      if (entry.outcome === 'OK') row.ok += 1; else row.failed_by_category[entry.error_category ?? 'UNKNOWN'] = (row.failed_by_category[entry.error_category ?? 'UNKNOWN'] ?? 0) + 1;
    }
    for (const result of run.scenario?.results ?? []) {
      if (!result.served_model || result.schema_valid === null) continue;
      const requested = run.calls.find(entry => entry.check === 'scenario' && entry.provider === result.provider)?.requested_model ?? result.served_model;
      const row = model(result.provider, requested);
      row.extraction.readings += 1;
      if (result.schema_valid) row.extraction.schema_valid += 1;
      if (result.registry_match) row.extraction.registry_match += 1;
      if (result.blocking_findings === 0) row.extraction.without_blocking_findings += 1;
    }
    for (const draft of run.e2e?.drafts ?? []) if (draft.state === 'REVIEW_REQUIRED') {
      for (const part of [draft.extraction, draft.cross_check, draft.second_extraction]) if (part?.provider && part.model) model(part.provider, part.model).used_in_review_required_draft += 1;
    }
  }
  const latest = [...runs].reverse();
  const providers = [...new Set(runs.flatMap(run => [...(run.smoke ?? []).map(row => row.provider), ...Object.keys(run.providers_blocked_for_run)]))].sort().map(provider => {
    const blocked = latest.find(run => run.providers_blocked_for_run[provider]);
    const lastSmoke = latest.find(run => run.smoke?.some(row => row.provider === provider));
    const smoke = lastSmoke?.smoke.find(row => row.provider === provider);
    return { provider, last_smoke: smoke ? { run_id: lastSmoke.run_id, outcome: smoke.outcome } : null, last_account_block: blocked ? { run_id: blocked.run_id, category: blocked.providers_blocked_for_run[provider] } : null };
  });
  return { models: [...models.values()].sort((a, b) => `${a.provider}/${a.model}`.localeCompare(`${b.provider}/${b.model}`)), providers };
}

export function buildLiveEvidence({ repository, runs }) {
  const { models, providers } = aggregate(runs);
  return {
    evidence_version: 1,
    source: { lab: 'DAJC AI Lab – Multi-Model Research & Testing', repository, workflow: '.github/workflows/dajc-eu-research-live.yml', import: 'scripts/ai-lab-live-evidence.mjs' },
    scope: 'Capped live checks of the Driving Bans research integration: provider smoke tests, failover with a real API error, the bake-off reference case cz-sun on the live Czech act and one E2E research run on an official Austrian order. API failures are account or request facts, never model quality.',
    totals: { runs: runs.length, cost_usd: Math.round(runs.reduce((sum, run) => sum + (run.cost_usd ?? 0), 0) * 1e6) / 1e6, canonical_unchanged: runs.every(run => run.canonical_unchanged), promoted: runs.some(run => run.promoted) },
    providers, models, runs,
  };
}

export function main(argv = process.argv.slice(2)) {
  const { values } = parseArgs({ args: argv, options: { repository: { type: 'string' }, run: { type: 'string', multiple: true }, out: { type: 'string' } } });
  if (!values.repository || !/^[\w.-]+\/[\w.-]+$/.test(values.repository) || !values.run?.length) throw new Error('Usage: ai-lab-live-evidence.mjs --repository owner/repo --run RUN_ID=DIR[@COMMIT] ... [--out FILE]');
  const runs = values.run.map(spec => {
    const match = /^(\d+)=([^@]+)(?:@([0-9a-f]{7,40}))?$/.exec(spec);
    if (!match) throw new Error(`Invalid --run ${spec}`);
    return runEvidence(resolve(match[2]), { runId: match[1], commit: match[3] ?? null });
  });
  const evidence = buildLiveEvidence({ repository: values.repository, runs });
  const text = JSON.stringify(evidence, null, 1) + '\n';
  assertNoCredentials(text, 'output');
  if (values.out) writeFileSync(values.out, text);
  return evidence;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const evidence = main();
  // What the new evidence would change in the approved model policy: proposals for the owner, never applied.
  const { proposePolicyUpdate } = await import('../src/lib/ai/model-profile.mjs');
  console.log(JSON.stringify({ runs: evidence.totals.runs, cost_usd: evidence.totals.cost_usd, models: evidence.models.length, providers: evidence.providers.map(p => `${p.provider}:${p.last_account_block?.category ?? p.last_smoke?.outcome ?? 'n/a'}`), policy_proposals: proposePolicyUpdate({ live: evidence }) }, null, 1));
}
