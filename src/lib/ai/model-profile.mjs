import profileData from '../../../config/ai-research-models.json' with { type: 'json' };
import evidenceData from '../../../data/ai-benchmark/bakeoff-2026-10-25.json' with { type: 'json' };
import liveData from '../../../data/ai-benchmark/live-checks-2026-10.json' with { type: 'json' };
import { PROVIDER_CATALOG, PROVIDER_IDS, PRICING_ENV, REASONING_OPTIONS, parsePricing } from './providers.mjs';

/**
 * Model selection from measured evidence (config/ai-research-models.json over the
 * consolidated DAJC AI bake-off). Opt-in: DAJC_RESEARCH_MODEL_PROFILE=<profile_id>.
 * Scores rank models per task from quality, reliability, cost and latency measured in
 * the bake-off. A model with API errors only is NOT_BENCHMARKED, never "zero quality",
 * and is not selected by the profile until a smoke test passes. The bake-off measured
 * grounded answering, so extraction and verification scores are provisional.
 *
 * Live checks run in DAJC AI Lab (config ai_lab, scripts/ai-lab-live-evidence.mjs) are
 * attached per model and per provider as direct evidence: extraction readings and the API
 * state of each account. They inform people and the recommendation's notes; they never turn
 * an API failure into a quality score, and they do not change the approved strategy.
 */

export const PROFILE_TASKS = Object.freeze(['extract', 'verify', 'conflicts', 'explain']);
const EVIDENCE_LEVEL = { explain: 'BENCHMARK_DIRECT', extract: 'BENCHMARK_INDIRECT', verify: 'BENCHMARK_INDIRECT', conflicts: 'BENCHMARK_INDIRECT' };

export const MODEL_PROFILE = profileData;
export const BENCHMARK_EVIDENCE = evidenceData;
export const LIVE_EVIDENCE = liveData;

// Evidence records the repository name at run time; links use the AI Lab's current name.
const labRepository = live => (live.source.repository === profileData.ai_lab.former_repository ? profileData.ai_lab.repository : live.source.repository);

/** AI Lab live-check summary of one model, or null when the AI Lab has not run it. */
export function liveEvidenceFor(provider, model, live = LIVE_EVIDENCE) {
  const row = live.models.find(item => item.provider === provider && item.model === model);
  return row ? { calls: row.calls, ok: row.ok, failed_by_category: row.failed_by_category, extraction: row.extraction, used_in_review_required_draft: row.used_in_review_required_draft, source: labRepository(live) } : null;
}

/**
 * Account state per provider from the latest AI Lab live checks, for the AI Lab's own keys:
 * availability, not quality. Another environment (dajc-eu, production) has its own keys.
 */
export function providerApiStatus(live = LIVE_EVIDENCE) {
  return Object.fromEntries(PROVIDER_IDS.map(id => {
    const item = live.providers.find(row => row.provider === id);
    const state = !item ? { status: 'NOT_TESTED' } : item.last_account_block ? { status: 'ACCOUNT_BLOCKED', category: item.last_account_block.category, run_id: item.last_account_block.run_id } : item.last_smoke?.outcome === 'OK' ? { status: 'OK', run_id: item.last_smoke.run_id } : { status: 'UNVERIFIED', run_id: item.last_smoke?.run_id ?? null };
    return [id, { ...state, keys: labRepository(live) }];
  }));
}

/**
 * Measured components per candidate, or the reason it cannot be ranked.
 * @returns {Array<Record<string, any>>}
 */
export function candidateEvidence({ profile = MODEL_PROFILE, evidence = BENCHMARK_EVIDENCE, live = LIVE_EVIDENCE } = {}) {
  return profile.candidates.map(candidate => {
    const measured = evidence.models.find(row => row.provider === (candidate.provider === 'xai' ? 'grok' : candidate.provider) && row.model === candidate.model);
    const completed = measured?.consolidated.completed_answers ?? 0;
    const liveRow = liveEvidenceFor(candidate.provider, candidate.model, live);
    if (candidate.excluded_until_smoke_test || !measured || completed < profile.minimum_completed_answers) {
      return { ...candidate, status: 'NOT_BENCHMARKED', reason: candidate.excluded_until_smoke_test ?? `Only ${completed} completed answers`, measured: measured ? { completed, cases: measured.consolidated.cases, classes: measured.consolidated.classes } : null, live: liveRow };
    }
    return {
      ...candidate, status: 'RANKED', live: liveRow,
      measured: {
        completed, cases: measured.consolidated.cases,
        quality: measured.consolidated.correct_rate_of_completed,
        reliability: +(completed / measured.consolidated.cases).toFixed(3),
        first_attempt_reliability: +((measured.original_run.cases - measured.original_run.api_errors) / measured.original_run.cases).toFixed(3),
        cost_per_answer_usd: +(measured.cost_usd_reference_estimate / completed).toFixed(6),
        latency_ms: measured.latency_ms.avg_completed_original_run,
        unverified_claim_rate: +(measured.consolidated.unverified_claims_total / completed).toFixed(3),
        served_models: measured.reported_models,
      },
    };
  });
}

/**
 * Ranked candidates for one task; NOT_BENCHMARKED ones follow, unscored, with their reason.
 * @returns {Array<Record<string, any>>}
 */
export function rankModels(task, options = {}) {
  const profile = options.profile ?? MODEL_PROFILE;
  if (!PROFILE_TASKS.includes(task)) throw new Error(`Unknown profile task ${task}`);
  const weights = profile.weights[task];
  const all = candidateEvidence({ profile, evidence: options.evidence ?? BENCHMARK_EVIDENCE });
  const ranked = all.filter(item => item.status === 'RANKED');
  const maxCost = Math.max(...ranked.map(item => item.measured.cost_per_answer_usd));
  const maxLatency = Math.max(...ranked.map(item => item.measured.latency_ms));
  const scored = ranked.map(item => {
    const m = item.measured;
    const components = { quality: m.quality, reliability: m.reliability, cost: +(m.cost_per_answer_usd / maxCost).toFixed(3), latency: +(m.latency_ms / maxLatency).toFixed(3), unverified: m.unverified_claim_rate };
    const score = weights.quality * components.quality + weights.reliability * components.reliability - weights.cost * components.cost - weights.latency * components.latency - weights.unverified_claim_penalty * components.unverified;
    return { provider: item.provider, model: item.model, vendor: PROVIDER_CATALOG[item.provider].vendor, score: +score.toFixed(3), components, evidence_level: EVIDENCE_LEVEL[task], live: item.live, ...(item.min_interval_ms ? { min_interval_ms: item.min_interval_ms } : {}), ...(item.served_as ? { served_as: item.served_as } : {}) };
  }).sort((a, b) => b.score - a.score);
  return [...scored, ...all.filter(item => item.status !== 'RANKED').map(item => ({ provider: item.provider, model: item.model, vendor: PROVIDER_CATALOG[item.provider].vendor, score: null, status: 'NOT_BENCHMARKED', reason: item.reason, live: item.live }))];
}

/** Strength for complex documents: measured quality weighted by reliability, so an unreliable model never wins on quality alone. */
const strength = item => item.components.quality * item.components.reliability;
const byStrength = (a, b) => strength(b) - strength(a);

/**
 * Recommendation per research task: ordinary extraction, complex documents (quality x
 * reliability), and an independent check at another vendor than the extraction.
 */
export function recommendModels(options = {}) {
  const extract = rankModels('extract', options).filter(item => item.score !== null);
  const verify = rankModels('verify', options).filter(item => item.score !== null);
  const primary = extract[0] ?? null;
  const complex = [...extract].sort(byStrength)[0] ?? null;
  const check = verify.find(item => primary && item.vendor !== primary.vendor) ?? null;
  return {
    profile_id: (options.profile ?? MODEL_PROFILE).profile_id, status: (options.profile ?? MODEL_PROFILE).status,
    extract: primary, extract_complex: complex, verify: check, explain: rankModels('explain', options).find(item => item.score !== null) ?? null,
    discover: { provider: 'perplexity', evidence: (options.profile ?? MODEL_PROFILE).search.evidence },
    not_benchmarked: rankModels('extract', options).filter(item => item.score === null).map(({ provider, model, reason }) => ({ provider, model, reason })),
    // The approved Driving Bans strategy: a stronger second reading when the ordinary extraction fails the checks.
    escalation: complex && primary && complex.model !== primary.model ? { when: 'ordinary extraction fails the deterministic checks', model: complex.model, provider: complex.provider } : null,
    api_status: providerApiStatus(options.live ?? LIVE_EVIDENCE),
    live_evidence: { source: { ...(options.live ?? LIVE_EVIDENCE).source, repository: labRepository(options.live ?? LIVE_EVIDENCE), repository_at_run_time: (options.live ?? LIVE_EVIDENCE).source.repository }, runs: (options.live ?? LIVE_EVIDENCE).totals.runs, cost_usd: (options.live ?? LIVE_EVIDENCE).totals.cost_usd },
    caution: 'Provisional: the bake-off measured grounded answering, not extraction from legal documents. AI Lab live checks add direct but small evidence (see live per model); a person decides on changes to the strategy.',
  };
}

const envKey = (id, suffix = '') => `${PROVIDER_CATALOG[id].modelEnv}${suffix}`;

/**
 * Environment with the profile's model, price, route and interval choices filled in for
 * providers that have a key but no explicit setting. Returns env unchanged unless
 * DAJC_RESEARCH_MODEL_PROFILE selects this profile. Never adds a key.
 */
export function applyModelProfile(env, options = {}) {
  const profile = options.profile ?? MODEL_PROFILE;
  if (env.DAJC_RESEARCH_MODEL_PROFILE !== profile.profile_id) return env;
  const out = { ...env };
  const pricing = parsePricing(env[PRICING_ENV]);
  const hasKey = id => Boolean(env[PROVIDER_CATALOG[id].keyEnv]?.trim());
  const rankedFor = task => rankModels(task, options).filter(item => item.score !== null && hasKey(item.provider));
  const extract = rankedFor('extract'), verify = rankedFor('verify');
  for (const id of [...new Set(extract.map(item => item.provider))]) {
    if (env[envKey(id)]?.trim()) continue;
    const own = extract.filter(item => item.provider === id);
    const ordinary = own[0];
    const complex = [...own].sort(byStrength)[0];
    const check = verify.find(item => item.provider === id) ?? ordinary;
    out[envKey(id)] = ordinary.model;
    if (complex.model !== ordinary.model && !env[envKey(id, '_EXTRACT_COMPLEX')]) out[envKey(id, '_EXTRACT_COMPLEX')] = complex.model;
    if (check.model !== ordinary.model && !env[envKey(id, '_VERIFY')]) out[envKey(id, '_VERIFY')] = check.model;
    const models = Object.fromEntries([ordinary, complex, check].map(item => { const candidate = profile.candidates.find(c => c.provider === id && c.model === item.model); return [item.model, { input: candidate.input, output: candidate.output }]; }));
    pricing[id] = { ...(pricing[id] ?? {}), ...(pricing[id]?.input === undefined ? models[ordinary.model] : {}), models: { ...models, ...(pricing[id]?.models ?? {}) } };
    const interval = Math.max(0, ...own.map(item => item.min_interval_ms ?? 0));
    const intervalKey = `DAJC_RESEARCH_${id.toUpperCase()}_MIN_INTERVAL_MS`;
    if (interval && !env[intervalKey]) out[intervalKey] = String(interval);
    // The reasoning setting the bake-off measured (OpenAI none, Grok low); one setting per provider.
    const reasoning = profile.candidates.find(c => c.provider === id && c.model === ordinary.model)?.reasoning_effort;
    const option = REASONING_OPTIONS[id];
    if (reasoning && option?.values.includes(reasoning) && !env[option.env]) out[option.env] = reasoning;
  }
  if (hasKey('perplexity') && !pricing.perplexity) pricing.perplexity = { request: profile.search.price_per_request };
  out[PRICING_ENV] = JSON.stringify(pricing);
  // Provider order per task from the ranking; providers without evidence follow as fallbacks.
  const order = list => [...new Set([...list.map(item => item.provider)])];
  const rest = ['anthropic', 'openai', 'gemini', 'mistral', 'xai'];
  if (!env.DAJC_RESEARCH_ROUTE_EXTRACT) out.DAJC_RESEARCH_ROUTE_EXTRACT = [...new Set([...order(extract), ...rest])].join(',');
  if (!env.DAJC_RESEARCH_ROUTE_EXTRACT_COMPLEX) out.DAJC_RESEARCH_ROUTE_EXTRACT_COMPLEX = [...new Set([...order([...extract].sort(byStrength)), ...rest])].join(',');
  if (!env.DAJC_RESEARCH_ROUTE_VERIFY) out.DAJC_RESEARCH_ROUTE_VERIFY = [...new Set([...order(verify), ...rest])].join(',');
  return out;
}
