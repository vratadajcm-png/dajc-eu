import profileData from '../../../config/ai-research-models.json' with { type: 'json' };
import evidenceData from '../../../data/ai-benchmark/bakeoff-2026-10-25.json' with { type: 'json' };
import liveData from '../../../data/ai-benchmark/live-checks-2026-10.json' with { type: 'json' };
import { PROVIDER_CATALOG, PROVIDER_IDS, PRICING_ENV, REASONING_OPTIONS, parsePricing } from './providers.mjs';

/**
 * Model selection for the one DAJC AI orchestrator (config/ai-research-models.json).
 * Opt-in: DAJC_RESEARCH_MODEL_PROFILE=<profile_id>.
 *
 * Three layers, kept apart on purpose:
 * - evidence: the consolidated DAJC AI bake-off (scores per task from quality, reliability,
 *   cost and latency) and the DAJC AI Lab live checks (roles a model passed in a live run,
 *   account state per provider). An API failure is an account or request fact, never a
 *   quality score: such a model is NOT_BENCHMARKED or UNAVAILABLE, not "zero quality";
 * - evidence level per model and task (config evidence_levels): a benchmark counts only
 *   for the tasks its category says something about (benchmark_relevance);
 * - the approved policy (config policy): which model serves which task. Only the owner
 *   changes it, by a reviewed pull request. A model outside the policy is never used
 *   because of a good score; a policy model without eligible evidence is skipped.
 *   proposePolicyUpdate() turns new evidence into proposals, never into settings.
 */

export const PROFILE_TASKS = Object.freeze(['extract', 'verify', 'conflicts', 'explain']);
export const POLICY_ROLES = Object.freeze(['extract', 'extract_complex', 'verify', 'explain']);

export const MODEL_PROFILE = profileData;
export const BENCHMARK_EVIDENCE = evidenceData;
export const LIVE_EVIDENCE = liveData;

const keyOf = (provider, model) => `${provider}/${model}`;
const parseRef = ref => { const [provider, ...rest] = String(ref).split('/'); return { provider, model: rest.join('/') }; };

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
 * Roles each model filled in a live run whose draft passed every check and reached human
 * review, with the date of that run; models only served by the live smoke test.
 */
function liveRoles(live) {
  const roles = new Map(), dates = new Map(), smoke = new Set();
  const add = (part, role, at) => {
    if (!part?.provider || !part.model) return;
    const key = keyOf(part.provider, part.model);
    roles.set(key, new Set([...(roles.get(key) ?? []), role]));
    if (at && (!dates.get(key) || at > dates.get(key))) dates.set(key, at);
  };
  for (const run of live.runs) {
    const at = run.generated_at?.slice(0, 10) ?? null;
    for (const call of run.calls) if (call.check === 'smoke' && call.outcome === 'OK') smoke.add(keyOf(call.provider, call.requested_model));
    for (const draft of run.e2e?.drafts ?? []) {
      if (draft.state !== 'REVIEW_REQUIRED') continue;
      // An escalated extraction was a complex document; the second reading read the same document.
      const reading = draft.extraction?.escalated_from ? 'extract_complex' : 'extract';
      add(draft.extraction, reading, at);
      add(draft.second_extraction, reading, at);
      add(draft.cross_check, 'verify', at);
    }
  }
  return { roles, dates, smoke };
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
    const category = candidate.evidence_category ?? profile.evidence_category;
    if (candidate.excluded_until_smoke_test || !measured || completed < profile.minimum_completed_answers) {
      return { ...candidate, category, status: 'NOT_BENCHMARKED', reason: candidate.excluded_until_smoke_test ?? `Only ${completed} completed answers`, measured: measured ? { completed, cases: measured.consolidated.cases, classes: measured.consolidated.classes } : null, live: liveRow };
    }
    return {
      ...candidate, category, status: 'RANKED', live: liveRow,
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
 * Evidence level of one candidate for one task (config evidence_levels). UNAVAILABLE comes
 * first: an account refusal or an exclusion until a smoke test passes is not a quality result.
 */
export function evidenceLevel(candidate, task, { profile = MODEL_PROFILE, live = LIVE_EVIDENCE, roles = liveRoles(live), apiStatus = providerApiStatus(live) } = {}) {
  if (candidate.excluded_until_smoke_test || apiStatus[candidate.provider]?.status === 'ACCOUNT_BLOCKED') return 'UNAVAILABLE';
  const filled = roles.roles.get(keyOf(candidate.provider, candidate.model)) ?? new Set();
  // A complex document read correctly also covers ordinary extraction, never the reverse.
  if (task !== 'explain' && (filled.has(task) || (task === 'extract' && filled.has('extract_complex')))) return 'LIVE_EXTRACTION_VERIFIED';
  const relevance = profile.benchmark_relevance?.[candidate.category ?? candidate.evidence_category ?? profile.evidence_category]?.[task];
  if (candidate.status === 'RANKED' && relevance) return relevance;
  if (roles.smoke.has(keyOf(candidate.provider, candidate.model))) return 'API_SMOKE_ONLY';
  return 'NOT_BENCHMARKED';
}

/**
 * Ranked candidates for one task; candidates without evidence for this task follow,
 * unscored, with their reason. A benchmark of an unrelated category gives no score here.
 * @returns {Array<Record<string, any>>}
 */
export function rankModels(task, options = {}) {
  const profile = options.profile ?? MODEL_PROFILE;
  if (!PROFILE_TASKS.includes(task)) throw new Error(`Unknown profile task ${task}`);
  const live = options.live ?? LIVE_EVIDENCE;
  const context = { profile, live, roles: liveRoles(live), apiStatus: providerApiStatus(live) };
  const weights = profile.weights[task];
  const all = candidateEvidence({ profile, evidence: options.evidence ?? BENCHMARK_EVIDENCE, live });
  const relevant = item => Boolean(profile.benchmark_relevance?.[item.category]?.[task]);
  const ranked = all.filter(item => item.status === 'RANKED' && relevant(item));
  const maxCost = Math.max(...ranked.map(item => item.measured.cost_per_answer_usd));
  const maxLatency = Math.max(...ranked.map(item => item.measured.latency_ms));
  const scored = ranked.map(item => {
    const m = item.measured;
    const components = { quality: m.quality, reliability: m.reliability, cost: +(m.cost_per_answer_usd / maxCost).toFixed(3), latency: +(m.latency_ms / maxLatency).toFixed(3), unverified: m.unverified_claim_rate };
    const score = weights.quality * components.quality + weights.reliability * components.reliability - weights.cost * components.cost - weights.latency * components.latency - weights.unverified_claim_penalty * components.unverified;
    return { provider: item.provider, model: item.model, vendor: PROVIDER_CATALOG[item.provider].vendor, score: +score.toFixed(3), components, evidence_level: evidenceLevel(item, task, context), live: item.live, ...(item.min_interval_ms ? { min_interval_ms: item.min_interval_ms } : {}), ...(item.served_as ? { served_as: item.served_as } : {}) };
  }).sort((a, b) => b.score - a.score);
  const unscored = all.filter(item => !ranked.includes(item)).map(item => ({
    provider: item.provider, model: item.model, vendor: PROVIDER_CATALOG[item.provider].vendor, score: null, status: 'NOT_BENCHMARKED',
    reason: item.status === 'RANKED' ? `The ${item.category} benchmark says nothing about ${task}` : item.reason,
    evidence_level: evidenceLevel(item, task, context), live: item.live,
  }));
  return [...scored, ...unscored];
}

/** Strength for complex documents: measured quality weighted by reliability, so an unreliable model never wins on quality alone. */
const strength = item => item.components.quality * item.components.reliability;
const byStrength = (a, b) => strength(b) - strength(a);

/** The policy's models for one role, in order of use. */
function policyRefs(policy, role) {
  const task = policy.tasks[role];
  if (!task) return [];
  const list = role === 'verify' ? task.candidates ?? [] : [task.primary, task.escalation, ...(task.second_reading ?? []), ...(task.fallback && Array.isArray(task.fallback) ? task.fallback : [])];
  return list.filter(Boolean).map(parseRef);
}

/**
 * The approved policy resolved against the evidence: per role, each policy model with its
 * evidence level and whether it may serve (eligible_levels). Nothing outside the policy.
 */
export function policyAssignments(options = {}) {
  const profile = options.profile ?? MODEL_PROFILE;
  const live = options.live ?? LIVE_EVIDENCE;
  const context = { profile, live, roles: liveRoles(live), apiStatus: providerApiStatus(live) };
  const all = candidateEvidence({ profile, evidence: options.evidence ?? BENCHMARK_EVIDENCE, live });
  return Object.fromEntries(POLICY_ROLES.map(role => [role, policyRefs(profile.policy, role).map(ref => {
    const candidate = all.find(item => item.provider === ref.provider && item.model === ref.model);
    if (!candidate) return { ...ref, level: 'NOT_BENCHMARKED', eligible: false, reason: 'Not a catalog candidate' };
    const level = evidenceLevel(candidate, role, context);
    const eligible = (profile.policy.eligible_levels[role] ?? []).includes(level);
    return { ...ref, vendor: PROVIDER_CATALOG[ref.provider].vendor, level, eligible, ...(eligible ? {} : { reason: `Evidence ${level} is not enough for ${role}` }) };
  })]));
}

/**
 * The shared model catalog: one entry per candidate with what the policy and the people
 * reviewing it need (served model, tasks with evidence level, benchmark, latency, price,
 * last verification, API state, source, exclusion reason, policy roles).
 */
export function modelCatalog(options = {}) {
  const profile = options.profile ?? MODEL_PROFILE;
  const live = options.live ?? LIVE_EVIDENCE;
  const context = { profile, live, roles: liveRoles(live), apiStatus: providerApiStatus(live) };
  const assignments = policyAssignments(options);
  const servedLive = model => [...new Set(live.runs.flatMap(run => run.calls).filter(call => call.requested_model === model && call.outcome === 'OK' && call.served_model).map(call => call.served_model))];
  return candidateEvidence({ profile, evidence: options.evidence ?? BENCHMARK_EVIDENCE, live }).map(candidate => {
    const tasks = Object.fromEntries([...POLICY_ROLES, 'conflicts'].map(task => [task, evidenceLevel(candidate, task, context)]));
    const roles = POLICY_ROLES.filter(role => assignments[role].some(entry => entry.provider === candidate.provider && entry.model === candidate.model && entry.eligible));
    const liveDate = context.roles.dates.get(keyOf(candidate.provider, candidate.model)) ?? null;
    return {
      provider: candidate.provider, model: candidate.model, vendor: PROVIDER_CATALOG[candidate.provider].vendor,
      served_models: [...new Set([...(candidate.measured?.served_models ?? []), ...servedLive(candidate.model), ...(candidate.served_as ? [candidate.served_as] : [])])],
      capabilities: PROVIDER_CATALOG[candidate.provider].capabilities, tasks,
      benchmark: candidate.status === 'RANKED' ? { category: candidate.category, quality: candidate.measured.quality, completed: candidate.measured.completed, cases: candidate.measured.cases, reliability: candidate.measured.reliability } : null,
      latency_ms: candidate.measured?.latency_ms ?? null,
      price_usd_per_million_tokens: { input: candidate.input, output: candidate.output },
      last_verified: liveDate ?? (candidate.status === 'RANKED' ? profile.profile_id.replace(/^bakeoff-/, '') : null),
      api_status: context.apiStatus[candidate.provider],
      source: { benchmark: profile.evidence_file, live: live.source.import ? profile.ai_lab.live_evidence_file : null, lab: profile.ai_lab.repository },
      excluded_reason: candidate.excluded_until_smoke_test ?? (candidate.status === 'RANKED' ? null : candidate.reason),
      policy_roles: roles,
    };
  });
}

/**
 * Proposals for the owner from new evidence; never applied automatically. Flags policy
 * models that lost eligible evidence and models outside the policy that now have
 * stronger evidence for a role (live-verified, or a better score at an eligible level).
 */
export function proposePolicyUpdate(options = {}) {
  const profile = options.profile ?? MODEL_PROFILE;
  const assignments = policyAssignments(options);
  const catalog = modelCatalog(options);
  const proposals = [];
  for (const role of POLICY_ROLES) {
    for (const entry of assignments[role]) if (!entry.eligible) proposals.push({ role, kind: 'POLICY_MODEL_NOT_ELIGIBLE', model: keyOf(entry.provider, entry.model), level: entry.level, note: entry.reason });
    const inPolicy = new Set(assignments[role].map(entry => keyOf(entry.provider, entry.model)));
    const eligible = profile.policy.eligible_levels[role] ?? [];
    const scores = new Map(rankModels(role === 'extract_complex' ? 'extract' : role, options).filter(row => row.score !== null).map(row => [keyOf(row.provider, row.model), row.score]));
    const primary = assignments[role][0];
    const primaryScore = primary ? scores.get(keyOf(primary.provider, primary.model)) ?? null : null;
    for (const item of catalog) {
      const key = keyOf(item.provider, item.model);
      if (inPolicy.has(key) || !eligible.includes(item.tasks[role])) continue;
      const better = item.tasks[role] === 'LIVE_EXTRACTION_VERIFIED' || (primaryScore !== null && (scores.get(key) ?? -Infinity) > primaryScore);
      if (better) proposals.push({ role, kind: 'CANDIDATE_FOR_POLICY', model: key, level: item.tasks[role], score: scores.get(key) ?? null, note: 'Needs a reviewed policy change approved by the owner; not used until then.' });
    }
  }
  return { policy_id: profile.policy.policy_id, proposals, applied: false };
}

/**
 * Recommendation per task from the approved policy, with the evidence behind each choice:
 * ordinary extraction and its stronger second reading, complex documents, an independent
 * check at another vendor than the extraction, and explanations of verified data.
 * @returns {Record<string, any>}
 */
export function recommendModels(options = {}) {
  const profile = options.profile ?? MODEL_PROFILE;
  const live = options.live ?? LIVE_EVIDENCE;
  const assignments = policyAssignments(options);
  const rows = Object.fromEntries(['extract', 'verify', 'explain'].map(task => [task, rankModels(task, options)]));
  const row = (task, entry) => entry && { ...rows[task].find(item => item.provider === entry.provider && item.model === entry.model), provider: entry.provider, model: entry.model, vendor: entry.vendor, evidence_level: entry.level };
  const first = role => assignments[role].find(entry => entry.eligible) ?? null;
  const primary = row('extract', first('extract'));
  const escalationEntry = assignments.extract.slice(1).find(entry => entry.eligible && primary && entry.model !== primary.model) ?? null;
  const complex = row('extract', first('extract_complex'));
  const check = row('verify', assignments.verify.find(entry => entry.eligible && primary && entry.vendor !== primary.vendor) ?? null);
  const explain = row('explain', first('explain'));
  const explainEscalation = assignments.explain.slice(1).find(entry => entry.eligible) ?? null;
  return {
    profile_id: profile.profile_id, status: profile.status, policy_id: profile.policy.policy_id,
    extract: primary, extract_complex: complex, verify: check, explain,
    discover: { provider: profile.policy.tasks.discover.service, evidence: profile.search.evidence, fallback: profile.policy.tasks.discover.fallback },
    conflicts: profile.policy.tasks.conflicts,
    // The approved Driving Bans strategy: a stronger second reading when the ordinary extraction fails the checks.
    escalation: escalationEntry ? { when: 'ordinary extraction fails the deterministic checks', model: escalationEntry.model, provider: escalationEntry.provider } : null,
    explain_escalation: explainEscalation ? { when: 'complex or uncertain question', model: explainEscalation.model, provider: explainEscalation.provider } : null,
    not_benchmarked: rows.extract.filter(item => item.score === null).map(({ provider, model, reason, evidence_level }) => ({ provider, model, reason, evidence_level })),
    api_status: providerApiStatus(live),
    live_evidence: { source: { ...live.source, repository: labRepository(live), repository_at_run_time: live.source.repository }, runs: live.totals.runs, cost_usd: live.totals.cost_usd },
    caution: 'Provisional: the bake-off measured grounded answering, not extraction from legal documents. AI Lab live checks add direct but small evidence (see live per model); a person decides on changes to the strategy.',
  };
}

const envKey = (id, suffix = '') => `${PROVIDER_CATALOG[id].modelEnv}${suffix}`;

/**
 * Environment with the approved policy's models, prices, routes, intervals and reasoning
 * settings filled in for providers that have a key but no explicit setting. Returns env
 * unchanged unless DAJC_RESEARCH_MODEL_PROFILE selects this profile. Never adds a key, and
 * never uses a model the policy does not list or whose evidence is not eligible.
 */
export function applyModelProfile(env, options = {}) {
  const profile = options.profile ?? MODEL_PROFILE;
  if (env.DAJC_RESEARCH_MODEL_PROFILE !== profile.profile_id) return env;
  const out = { ...env };
  const pricing = parsePricing(env[PRICING_ENV]);
  const hasKey = id => Boolean(env[PROVIDER_CATALOG[id].keyEnv]?.trim());
  const assignments = policyAssignments(options);
  const usable = role => assignments[role].filter(entry => entry.eligible && hasKey(entry.provider));
  // Per provider and task: the first policy model of that provider for the role.
  const pick = (role, id) => usable(role).find(entry => entry.provider === id)?.model ?? null;
  for (const id of PROVIDER_IDS.filter(hasKey)) {
    if (id === 'perplexity' || env[envKey(id)]?.trim()) continue;
    const models = { extract: pick('extract', id), complex: pick('extract_complex', id), verify: pick('verify', id), explain: pick('explain', id), explainComplex: assignments.explain.filter(entry => entry.eligible && entry.provider === id).at(-1)?.model ?? null };
    const base = models.extract ?? models.complex ?? models.verify ?? models.explain;
    if (!base) continue;
    out[envKey(id)] = base;
    const set = (suffix, model) => { if (model && model !== base && !env[envKey(id, suffix)]) out[envKey(id, suffix)] = model; };
    set('_EXTRACT_COMPLEX', models.complex);
    set('_VERIFY', models.verify);
    set('_EXPLAIN', models.explain);
    if (models.explainComplex && models.explainComplex !== (models.explain ?? base) && !env[envKey(id, '_EXPLAIN_COMPLEX')]) out[envKey(id, '_EXPLAIN_COMPLEX')] = models.explainComplex;
    const used = [...new Set(Object.values(models).filter(Boolean))];
    const prices = Object.fromEntries(used.map(model => { const candidate = profile.candidates.find(c => c.provider === id && c.model === model); return [model, { input: candidate.input, output: candidate.output }]; }));
    pricing[id] = { ...(pricing[id] ?? {}), ...(pricing[id]?.input === undefined ? prices[base] : {}), models: { ...prices, ...(pricing[id]?.models ?? {}) } };
    const interval = Math.max(0, ...used.map(model => profile.candidates.find(c => c.provider === id && c.model === model)?.min_interval_ms ?? 0));
    const intervalKey = `DAJC_RESEARCH_${id.toUpperCase()}_MIN_INTERVAL_MS`;
    if (interval && !env[intervalKey]) out[intervalKey] = String(interval);
    // The reasoning setting the bake-off measured (OpenAI none, Grok low); one setting per provider.
    const reasoning = profile.candidates.find(c => c.provider === id && c.model === base)?.reasoning_effort;
    const option = REASONING_OPTIONS[id];
    if (reasoning && option?.values.includes(reasoning) && !env[option.env]) out[option.env] = reasoning;
  }
  if (hasKey('perplexity') && !pricing.perplexity) pricing.perplexity = { request: profile.search.price_per_request };
  out[PRICING_ENV] = JSON.stringify(pricing);
  // Provider order per task from the policy; providers outside it follow only with their own explicit model settings.
  const order = (...roles) => [...new Set(roles.flatMap(role => usable(role).map(entry => entry.provider)))];
  const rest = ['anthropic', 'openai', 'gemini', 'mistral', 'xai'];
  const route = (name, providers) => { if (!env[name]) out[name] = [...new Set([...providers, ...rest])].join(','); };
  route('DAJC_RESEARCH_ROUTE_EXTRACT', order('extract', 'extract_complex'));
  route('DAJC_RESEARCH_ROUTE_EXTRACT_COMPLEX', order('extract_complex', 'extract'));
  route('DAJC_RESEARCH_ROUTE_VERIFY', order('verify'));
  route('DAJC_RESEARCH_ROUTE_EXPLAIN', order('explain'));
  // Document languages with live-tested extraction; any other language takes the complex route.
  if (!env.DAJC_RESEARCH_TESTED_LANGUAGES && profile.policy.tested_languages?.languages?.length) out.DAJC_RESEARCH_TESTED_LANGUAGES = profile.policy.tested_languages.languages.join(',');
  return out;
}

export { byStrength };
