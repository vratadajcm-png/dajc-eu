import { createHash } from 'node:crypto';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { PROVIDER_CATALOG, PROVIDER_IDS, ProviderError } from './providers.mjs';

/**
 * One provider-neutral orchestration layer for DAJC research tasks:
 * - routing by task with configurable priorities (DAJC_RESEARCH_ROUTE_<TASK>);
 * - an independent check always runs at a different vendor than the extraction;
 * - a cheaper model for ordinary documents and an optional stronger one for complex
 *   documents (PDF, large input, a document language without tested extraction, or an
 *   escalation; DAJC_RESEARCH_<P>_MODEL_<TASK>_COMPLEX);
 * - explanations of verified registry data (task explain) through the same routes, limits
 *   and audit, under the module of the product that asks;
 * - optional preference for the cheaper eligible model (DAJC_RESEARCH_PREFER_LOWER_COST);
 * - a provider that refused for credit, tier, key, model or a malformed request is
 *   blocked for the rest of the run and never sent the same request again;
 * - rate limits are paced with the provider's retry delay (capped), transient errors
 *   retried with exponential backoff, a circuit breaker per provider, then failover;
 * - request limits and a budget per run and per month, booked per module, from actual usage;
 * - an audit entry per call (task class, provider, model, language, tokens, cost, outcome;
 *   never a prompt or key).
 * Exhausting the budget stops the work; it never produces a guessed result.
 */

export const RESEARCH_TASKS = Object.freeze(['discover', 'extract', 'verify', 'explain']);
export const DEFAULT_ROUTES = Object.freeze({
  discover: ['perplexity'],
  extract: ['anthropic', 'openai', 'gemini', 'mistral', 'xai'],
  // Complex documents (PDF, large input, untested language, escalation) may follow their own provider order.
  extract_complex: ['anthropic', 'openai', 'gemini', 'mistral', 'xai'],
  verify: ['openai', 'gemini', 'mistral', 'xai', 'anthropic'],
  explain: ['openai', 'gemini', 'xai', 'anthropic', 'mistral'],
});

/**
 * The task classes of the DAJC AI model policy mapped onto the orchestrator tasks.
 * CHANGE_ANALYSIS has no AI task of its own: the deterministic engine decides and the
 * independent check (verify) is its only AI supplement.
 */
export const TASK_CLASSES = Object.freeze({
  DISCOVERY: Object.freeze({ task: 'discover' }),
  EXTRACT_STANDARD: Object.freeze({ task: 'extract', complex: false }),
  EXTRACT_COMPLEX: Object.freeze({ task: 'extract', complex: true }),
  INDEPENDENT_VERIFICATION: Object.freeze({ task: 'verify' }),
  CHANGE_ANALYSIS: Object.freeze({ task: null, engine: 'deterministic (checkRules, detectChanges, sourceConflicts)', ai_supplement: 'verify' }),
  EXPLAIN_VERIFIED_DATA: Object.freeze({ task: 'explain' }),
});
/** Task class of one orchestrator call. */
export function taskClassOf(task, complex = false) {
  if (task === 'extract') return complex ? 'EXTRACT_COMPLEX' : 'EXTRACT_STANDARD';
  return Object.entries(TASK_CLASSES).find(([, spec]) => spec.task === task)?.[0] ?? null;
}

/**
 * Data that may go to an AI provider: public legal and official documents for research,
 * verified registry data for explanations. Customer data (vehicles, routes, organisations,
 * tenants) never goes to a provider from these tasks.
 */
export const DATA_CLASSES = Object.freeze(['public-legal', 'verified-registry', 'customer']);
export const TASK_DATA_CLASSES = Object.freeze({ discover: ['public-legal'], extract: ['public-legal'], verify: ['public-legal'], explain: ['verified-registry'] });
// Tasks that read a legal document, where the document language counts.
const DOCUMENT_TASKS = ['extract', 'verify'];

export class BudgetExceededError extends Error {
  constructor(message) { super(message); this.name = 'BudgetExceededError'; }
}
export class NoProviderError extends Error {
  constructor(task, reasons) { super(`No provider available for ${task}: ${reasons.join('; ') || 'none configured'}`); this.name = 'NoProviderError'; this.reasons = reasons; }
}

/**
 * DAJC_RESEARCH_ROUTE_EXTRACT="anthropic,openai" etc.; unknown ids are dropped.
 * DAJC_RESEARCH_ROUTE_EXTRACT_COMPLEX defaults to the extraction route.
 * @returns {{ discover: string[], extract: string[], extract_complex: string[], verify: string[], explain: string[] }}
 */
export function routesFromEnv(env = process.env) {
  const parse = name => { const raw = env[`DAJC_RESEARCH_ROUTE_${name.toUpperCase()}`]; const list = raw ? raw.split(',').map(value => value.trim()).filter(value => PROVIDER_IDS.includes(value)) : []; return list.length ? [...new Set(list)] : null; };
  const routes = Object.fromEntries(RESEARCH_TASKS.map(task => [task, parse(task) ?? [...DEFAULT_ROUTES[task]]]));
  const configuredExtract = parse('extract');
  return { discover: routes.discover, extract: routes.extract, extract_complex: parse('extract_complex') ?? (configuredExtract ? [...configuredExtract] : [...DEFAULT_ROUTES.extract_complex]), verify: routes.verify, explain: routes.explain };
}

const positive = (value, fallback) => { const parsed = Number(value); return value !== undefined && value !== '' && Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback; };
export function limitsFromEnv(env = process.env) {
  return {
    runBudgetUsd: positive(env.DAJC_RESEARCH_RUN_BUDGET_USD, 0),
    monthlyBudgetUsd: positive(env.DAJC_RESEARCH_MONTHLY_BUDGET_USD, 0),
    maxRequestsPerRun: Math.floor(positive(env.DAJC_RESEARCH_MAX_REQUESTS_PER_RUN, 200)),
    maxInputTokensPerCall: Math.floor(positive(env.DAJC_RESEARCH_MAX_INPUT_TOKENS_PER_CALL, 120_000)),
    complexInputTokens: Math.floor(positive(env.DAJC_RESEARCH_COMPLEX_INPUT_TOKENS, 30_000)),
    maxRetryWaitMs: Math.floor(positive(env.DAJC_RESEARCH_MAX_RETRY_WAIT_MS, 120_000)),
    minIntervalMs: Object.fromEntries(PROVIDER_IDS.map(id => [id, Math.floor(positive(env[`DAJC_RESEARCH_${id.toUpperCase()}_MIN_INTERVAL_MS`], 0))])),
    preferLowerCost: env.DAJC_RESEARCH_PREFER_LOWER_COST === 'true',
    // Document languages with tested extraction (e.g. "cs,de"); any other language counts as complex. Unset: no language criterion.
    testedLanguages: env.DAJC_RESEARCH_TESTED_LANGUAGES ? env.DAJC_RESEARCH_TESTED_LANGUAGES.split(',').map(value => value.trim().toLowerCase()).filter(Boolean) : null,
  };
}

const monthOf = date => date.toISOString().slice(0, 7);

/**
 * Spend ledger per month, module and provider. In memory, or persisted to a JSON
 * file (atomic rename) so a monthly cap survives between runs on the same store.
 */
export function createLedger({ file = null, clock = () => new Date() } = {}) {
  let data = file && existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
  const save = () => { if (!file) return; const tmp = `${file}.tmp-${process.pid}`; writeFileSync(tmp, JSON.stringify(data, null, 1) + '\n'); renameSync(tmp, file); };
  return {
    spentThisMonth(module) { return data[monthOf(clock())]?.[module]?.total_usd ?? 0; },
    book({ module, provider, task, costUsd, inputTokens = 0, outputTokens = 0, requests = 1 }) {
      const month = (data[monthOf(clock())] ??= {});
      const entry = (month[module] ??= { total_usd: 0, by_provider: {} });
      const row = (entry.by_provider[provider] ??= { usd: 0, requests: 0, input_tokens: 0, output_tokens: 0, by_task: {} });
      entry.total_usd = round(entry.total_usd + costUsd);
      row.usd = round(row.usd + costUsd); row.requests += requests; row.input_tokens += inputTokens; row.output_tokens += outputTokens;
      row.by_task[task] = round((row.by_task[task] ?? 0) + costUsd);
      save();
    },
    snapshot() { return structuredClone(data); },
  };
}
const round = value => Math.round(value * 1e6) / 1e6;

/** Conservative pre-call estimate: ~3 characters per token for multilingual legal text. */
export function estimateTokens(text) { return Math.ceil(String(text ?? '').length / 3); }
function costOf(price, { inputTokens = 0, outputTokens = 0, requests = 0 }) {
  if (!price) return null;
  if ('request' in price) return round(requests * price.request);
  return round((inputTokens * price.input + outputTokens * price.output) / 1e6);
}

const hash = value => createHash('sha256').update(value).digest('hex');

export function createOrchestrator({
  providers,
  routes = DEFAULT_ROUTES,
  limits,
  ledger = createLedger(),
  module = 'driving-bans-research',
  clock = () => new Date(),
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
  random = Math.random,
  maxRetries = 2,
  backoffMs = 1_000,
  breakerThreshold = 3,
  breakerCooldownMs = 5 * 60_000,
  onAudit = () => {},
  // Providers already refused earlier in the same run (id -> category), e.g. by a previous check.
  blocked = {},
}) {
  if (!limits) throw new Error('Explicit research limits are required');
  const state = new Map(PROVIDER_IDS.map(id => [id, { failures: 0, openUntil: 0, blocked: blocked[id] ?? null, lastCallAt: null }]));
  const calls = [];
  let runSpent = 0, requests = 0;

  const remaining = () => Math.min(limits.runBudgetUsd - runSpent, limits.monthlyBudgetUsd - ledger.spentThisMonth(module));
  const breakerOpen = id => state.get(id).openUntil > clock().getTime();
  const priceOf = (provider, task, complex) => typeof provider.priceFor === 'function' ? provider.priceFor(task, complex) : provider.price;

  // Why a call goes to the stronger route: a PDF, a long input, a document language without tested extraction, an escalation.
  function complexityOf(task, { pdf = false, estimatedInput = 0, meta = {} }) {
    if (task === 'discover') return [];
    const reasons = [];
    if (pdf) reasons.push('PDF');
    if (estimatedInput > limits.complexInputTokens) reasons.push('LONG_INPUT');
    // Only calls about a document state its language (null when unknown); a smoke test states none.
    if (DOCUMENT_TASKS.includes(task) && limits.testedLanguages?.length && meta.language !== undefined && !limits.testedLanguages.includes(meta.language)) reasons.push('UNTESTED_LANGUAGE');
    if (meta.escalate === true) reasons.push('ESCALATION');
    return reasons;
  }

  function candidates(task, { excludeVendors = [], needsPdf = false, dataClass, complex }) {
    if (!DATA_CLASSES.includes(dataClass)) throw new Error(`Unknown data class ${dataClass}`);
    const reasons = [];
    const eligible = [];
    for (const id of (task === 'extract' && complex ? routes.extract_complex ?? routes.extract : routes[task]) ?? []) {
      const provider = providers[id];
      const spec = PROVIDER_CATALOG[id];
      if (!provider?.configured) { reasons.push(`${id}: not configured`); continue; }
      // Customer data (vehicles, routes, organisations, tenants) never goes to a provider.
      if (!TASK_DATA_CLASSES[task].includes(dataClass)) { reasons.push(`${id}: data class ${dataClass} not allowed for ${task === 'explain' ? 'explanations' : 'research'}`); continue; }
      if (state.get(id).blocked) { reasons.push(`${id}: blocked for this run (${state.get(id).blocked})`); continue; }
      if (excludeVendors.includes(spec.vendor)) { reasons.push(`${id}: same vendor as the checked step`); continue; }
      if (needsPdf && !spec.capabilities.includes('pdf')) { reasons.push(`${id}: no PDF input`); continue; }
      if (task === 'discover' ? !spec.capabilities.includes('search') : !spec.capabilities.includes('json')) { reasons.push(`${id}: lacks capability for ${task}`); continue; }
      if (breakerOpen(id)) { reasons.push(`${id}: circuit open`); continue; }
      eligible.push(provider);
    }
    if (limits.preferLowerCost) eligible.sort((a, b) => unitPrice(priceOf(a, task, complex)) - unitPrice(priceOf(b, task, complex)));
    return { eligible, reasons };
  }
  const unitPrice = price => price ? ('request' in price ? price.request * 1000 : price.input + price.output) : Infinity;

  function audit(entry) {
    const record = { at: clock().toISOString(), module, ...entry };
    calls.push(record);
    onAudit(record);
  }
  const block = (id, category) => { state.get(id).blocked = category; };

  async function pace(id) {
    const interval = limits.minIntervalMs?.[id] ?? 0;
    const last = state.get(id).lastCallAt;
    if (interval && last !== null) { const wait = last + interval - clock().getTime(); if (wait > 0) await sleep(wait); }
    state.get(id).lastCallAt = clock().getTime();
  }

  async function attempt(provider, task, request) {
    let lastError, waited = 0, attempts = 0;
    for (let tryNo = 0; tryNo <= maxRetries; tryNo++) {
      attempts = tryNo + 1;
      try {
        await pace(provider.id);
        const started = clock().getTime();
        const result = task === 'discover' ? await provider.search(request) : await provider.json(request);
        state.get(provider.id).failures = 0;
        return { result, attempts: tryNo + 1, latencyMs: clock().getTime() - started, waitedMs: waited };
      } catch (error) {
        lastError = error;
        if (!(error instanceof ProviderError)) break;
        // Credit, key, tier, model or malformed request: the same request would only fail again.
        if (error.blockProvider) { block(provider.id, error.category); break; }
        if (!error.retryable || tryNo === maxRetries) break;
        const delay = error.retryAfterMs ?? backoffMs * 2 ** tryNo + Math.floor(random() * backoffMs);
        if (delay > limits.maxRetryWaitMs) { block(provider.id, `${error.category}_DEFERRED`); break; }
        waited += delay;
        await sleep(delay);
      }
    }
    // Rate limits that persist after the retries stop the provider for this run, as the bake-off recovery did.
    if (lastError instanceof ProviderError && ['RATE_LIMIT', 'QUOTA_EXHAUSTED'].includes(lastError.category) && !state.get(provider.id).blocked) block(provider.id, `${lastError.category}_PERSISTENT`);
    const breaker = state.get(provider.id);
    breaker.failures += 1;
    if (breaker.failures >= breakerThreshold) breaker.openUntil = clock().getTime() + breakerCooldownMs;
    if (lastError instanceof ProviderError) lastError.attempts = attempts;
    throw lastError;
  }

  /**
   * Run one task at the first eligible provider; fail over on errors.
   * request: provider request; meta: { purpose, subject, dataClass, excludeVendors, needsPdf, language, escalate }.
   */
  async function run(task, request, meta = {}) {
    if (!RESEARCH_TASKS.includes(task)) throw new Error(`Unknown research task ${task}`);
    const dataClass = meta.dataClass ?? (task === 'explain' ? 'verified-registry' : 'public-legal');
    // A PDF is estimated at one token per 20 bytes, deliberately on the high side.
    const estimatedInput = task === 'discover' ? 0 : estimateTokens(request.system) + estimateTokens(request.user) + (request.document ? Math.ceil(request.document.base64.length * 0.75 / 20) : 0);
    if (task !== 'discover' && estimatedInput > limits.maxInputTokensPerCall) throw new BudgetExceededError(`Input of about ${estimatedInput} tokens exceeds the per-call limit ${limits.maxInputTokensPerCall}`);
    // A PDF, a long text, an untested document language or an escalation after a failed cheaper extraction goes to the stronger route.
    const complexReasons = complexityOf(task, { pdf: Boolean(request.document), estimatedInput, meta });
    const complex = complexReasons.length > 0;
    const context = { task_class: taskClassOf(task, complex), complex_reasons: complexReasons, language: task === 'discover' ? null : meta.language ?? null };
    const { eligible, reasons } = candidates(task, { excludeVendors: meta.excludeVendors ?? [], needsPdf: meta.needsPdf ?? false, dataClass, complex });
    const failures = [...reasons];
    let budgetBlocked = false, callFailed = false;
    for (const provider of eligible) {
      if (requests >= limits.maxRequestsPerRun) throw new BudgetExceededError(`Request limit of ${limits.maxRequestsPerRun} per run reached`);
      const price = priceOf(provider, task, complex);
      const estimate = costOf(price, task === 'discover' ? { requests: 1 } : { inputTokens: estimatedInput, outputTokens: request.maxOutputTokens ?? 4_000 });
      if (estimate === null) { failures.push(`${provider.id}: no price`); continue; }
      if (estimate > remaining()) { budgetBlocked = true; failures.push(`${provider.id}: estimated ${estimate} USD exceeds the remaining budget`); continue; }
      requests += 1;
      const requestedModel = task === 'discover' ? null : typeof provider.modelFor === 'function' ? provider.modelFor(task, complex) : provider.model;
      try {
        const { result, attempts, latencyMs, waitedMs } = await attempt(provider, task, task === 'discover' ? request : { ...request, task, complex });
        const usage = task === 'discover' ? { requests: 1 } : result.usage;
        // Cost is booked from the usage the provider reports, not from the estimate.
        const cost = costOf(price, usage);
        runSpent = round(runSpent + cost);
        ledger.book({ module, provider: provider.id, task, costUsd: cost, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens });
        audit({ task, ...context, purpose: meta.purpose ?? null, subject: meta.subject ?? null, provider: provider.id, vendor: provider.vendor, requested_model: requestedModel, model: result.model ?? requestedModel, complex, outcome: 'OK', attempts, latency_ms: latencyMs, waited_ms: waitedMs, input_tokens: usage.inputTokens ?? 0, output_tokens: usage.outputTokens ?? 0, cost_usd: cost, request_sha256: hash(JSON.stringify(request.queries ?? [request.system, request.user, request.document?.base64?.length ?? 0])) });
        return { ...result, provider: provider.id, vendor: provider.vendor, model: result.model ?? requestedModel, requested_model: requestedModel, cost_usd: cost, attempts, complex, complex_reasons: complexReasons, task_class: context.task_class };
      } catch (error) {
        callFailed = true;
        const known = error instanceof ProviderError;
        // A truncated, refused or malformed answer was still generated and billed: book its reported usage.
        const usage = known && error.usage ? error.usage : null;
        const cost = usage ? costOf(price, usage) ?? 0 : 0;
        if (usage) {
          runSpent = round(runSpent + cost);
          ledger.book({ module, provider: provider.id, task, costUsd: cost, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens });
        }
        audit({ task, ...context, purpose: meta.purpose ?? null, subject: meta.subject ?? null, provider: provider.id, vendor: provider.vendor, requested_model: requestedModel, model: null, complex, outcome: 'FAILED', error_category: known ? error.category : 'INTERNAL', http_status: known ? error.status : null, provider_code: known ? error.code : null, attempts: known ? error.attempts ?? 1 : null, blocked_for_run: state.get(provider.id).blocked, input_tokens: usage?.inputTokens ?? 0, output_tokens: usage?.outputTokens ?? 0, cost_usd: cost });
        failures.push(`${provider.id}: ${known ? error.message : 'internal error'}`);
      }
    }
    if (budgetBlocked && !callFailed) throw new BudgetExceededError(`Budget exhausted for ${task}: ${failures.join('; ')}`);
    throw new NoProviderError(task, failures);
  }

  /** The provider and model a task would go to first, without calling it (e.g. before an escalation). */
  function next(task, meta = {}) {
    const complex = complexityOf(task, { pdf: meta.needsPdf === true, meta }).length > 0;
    const [provider] = candidates(task, { excludeVendors: meta.excludeVendors ?? [], needsPdf: meta.needsPdf ?? false, dataClass: meta.dataClass ?? (task === 'explain' ? 'verified-registry' : 'public-legal'), complex }).eligible;
    return provider ? { provider: provider.id, model: task === 'discover' ? null : typeof provider.modelFor === 'function' ? provider.modelFor(task, complex) : provider.model } : null;
  }

  return {
    run,
    next,
    calls: () => calls.slice(),
    spentThisRun: () => runSpent,
    remainingBudget: () => round(Math.max(0, remaining())),
    breakerState: () => Object.fromEntries([...state].map(([id, entry]) => [id, { failures: entry.failures, open: breakerOpen(id), blocked: entry.blocked }])),
    ledger,
  };
}
