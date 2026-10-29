import { createHash } from 'node:crypto';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { PROVIDER_CATALOG, PROVIDER_IDS, ProviderError } from './providers.mjs';

/**
 * One provider-neutral orchestration layer for DAJC research tasks:
 * - routing by task with configurable priorities (DAJC_RESEARCH_ROUTE_<TASK>);
 * - an independent check always runs at a different vendor than the extraction;
 * - optional preference for the cheaper eligible model (DAJC_RESEARCH_PREFER_LOWER_COST);
 * - retry with exponential backoff, a circuit breaker per provider and failover;
 * - request limits and a budget per run and per month, booked per module;
 * - an audit entry per call (provider, model, tokens, cost, outcome; never a prompt or key).
 * Exhausting the budget stops the work; it never produces a guessed result.
 */

export const RESEARCH_TASKS = Object.freeze(['discover', 'extract', 'verify']);
export const DEFAULT_ROUTES = Object.freeze({
  discover: ['perplexity'],
  extract: ['anthropic', 'openai', 'gemini', 'mistral', 'xai'],
  verify: ['openai', 'gemini', 'mistral', 'xai', 'anthropic'],
});
/** Only public legal and official documents may go to an AI provider from research. */
export const DATA_CLASSES = Object.freeze(['public-legal', 'customer']);

export class BudgetExceededError extends Error {
  constructor(message) { super(message); this.name = 'BudgetExceededError'; }
}
export class NoProviderError extends Error {
  constructor(task, reasons) { super(`No provider available for ${task}: ${reasons.join('; ') || 'none configured'}`); this.name = 'NoProviderError'; this.reasons = reasons; }
}

/**
 * DAJC_RESEARCH_ROUTE_EXTRACT="anthropic,openai" etc.; unknown ids are dropped.
 * @returns {{ discover: string[], extract: string[], verify: string[] }}
 */
export function routesFromEnv(env = process.env) {
  return Object.fromEntries(RESEARCH_TASKS.map(task => {
    const raw = env[`DAJC_RESEARCH_ROUTE_${task.toUpperCase()}`];
    const list = raw ? raw.split(',').map(value => value.trim()).filter(value => PROVIDER_IDS.includes(value)) : [];
    return [task, list.length ? [...new Set(list)] : [...DEFAULT_ROUTES[task]]];
  }));
}

const positive = (value, fallback) => { const parsed = Number(value); return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback; };
export function limitsFromEnv(env = process.env) {
  return {
    runBudgetUsd: positive(env.DAJC_RESEARCH_RUN_BUDGET_USD, 0),
    monthlyBudgetUsd: positive(env.DAJC_RESEARCH_MONTHLY_BUDGET_USD, 0),
    maxRequestsPerRun: Math.floor(positive(env.DAJC_RESEARCH_MAX_REQUESTS_PER_RUN, 200)),
    maxInputTokensPerCall: Math.floor(positive(env.DAJC_RESEARCH_MAX_INPUT_TOKENS_PER_CALL, 120_000)),
    preferLowerCost: env.DAJC_RESEARCH_PREFER_LOWER_COST === 'true',
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
}) {
  if (!limits) throw new Error('Explicit research limits are required');
  const breakers = new Map(PROVIDER_IDS.map(id => [id, { failures: 0, openUntil: 0 }]));
  const calls = [];
  let runSpent = 0, requests = 0;

  const remaining = () => Math.min(limits.runBudgetUsd - runSpent, limits.monthlyBudgetUsd - ledger.spentThisMonth(module));
  const breakerOpen = id => breakers.get(id).openUntil > clock().getTime();

  function candidates(task, { excludeVendors = [], needsPdf = false, dataClass }) {
    if (!DATA_CLASSES.includes(dataClass)) throw new Error(`Unknown data class ${dataClass}`);
    const reasons = [];
    const eligible = [];
    for (const id of routes[task] ?? []) {
      const provider = providers[id];
      const spec = PROVIDER_CATALOG[id];
      if (!provider?.configured) { reasons.push(`${id}: not configured`); continue; }
      // Customer data (vehicles, routes, organisations) never goes to a research provider.
      if (dataClass !== 'public-legal') { reasons.push(`${id}: data class ${dataClass} not allowed for research`); continue; }
      if (excludeVendors.includes(spec.vendor)) { reasons.push(`${id}: same vendor as the checked step`); continue; }
      if (needsPdf && !spec.capabilities.includes('pdf')) { reasons.push(`${id}: no PDF input`); continue; }
      if (task === 'discover' ? !spec.capabilities.includes('search') : !spec.capabilities.includes('json')) { reasons.push(`${id}: lacks capability for ${task}`); continue; }
      if (breakerOpen(id)) { reasons.push(`${id}: circuit open`); continue; }
      eligible.push(provider);
    }
    if (limits.preferLowerCost) eligible.sort((a, b) => unitPrice(a) - unitPrice(b));
    return { eligible, reasons };
  }
  const unitPrice = provider => provider.price ? ('request' in provider.price ? provider.price.request * 1000 : provider.price.input + provider.price.output) : Infinity;

  function audit(entry) {
    const record = { at: clock().toISOString(), module, ...entry };
    calls.push(record);
    onAudit(record);
  }

  async function attempt(provider, task, request) {
    let lastError;
    for (let tryNo = 0; tryNo <= maxRetries; tryNo++) {
      try {
        const started = clock().getTime();
        const result = task === 'discover' ? await provider.search(request) : await provider.json(request);
        breakers.get(provider.id).failures = 0;
        return { result, attempts: tryNo + 1, latencyMs: clock().getTime() - started };
      } catch (error) {
        lastError = error;
        if (!(error instanceof ProviderError) || !error.retryable || tryNo === maxRetries) break;
        await sleep(backoffMs * 2 ** tryNo + Math.floor(random() * backoffMs));
      }
    }
    const breaker = breakers.get(provider.id);
    breaker.failures += 1;
    if (breaker.failures >= breakerThreshold) breaker.openUntil = clock().getTime() + breakerCooldownMs;
    throw lastError;
  }

  /**
   * Run one task at the first eligible provider; fail over on errors.
   * request: provider request; meta: { purpose, subject, dataClass, excludeVendors, needsPdf }.
   */
  async function run(task, request, meta = {}) {
    if (!RESEARCH_TASKS.includes(task)) throw new Error(`Unknown research task ${task}`);
    const dataClass = meta.dataClass ?? 'public-legal';
    const { eligible, reasons } = candidates(task, { excludeVendors: meta.excludeVendors ?? [], needsPdf: meta.needsPdf ?? false, dataClass });
    // A PDF is estimated at one token per 20 bytes, deliberately on the high side.
    const estimatedInput = task === 'discover' ? 0 : estimateTokens(request.system) + estimateTokens(request.user) + (request.document ? Math.ceil(request.document.base64.length * 0.75 / 20) : 0);
    if (task !== 'discover' && estimatedInput > limits.maxInputTokensPerCall) throw new BudgetExceededError(`Input of about ${estimatedInput} tokens exceeds the per-call limit ${limits.maxInputTokensPerCall}`);
    const failures = [...reasons];
    let budgetBlocked = false, callFailed = false;
    for (const provider of eligible) {
      if (requests >= limits.maxRequestsPerRun) throw new BudgetExceededError(`Request limit of ${limits.maxRequestsPerRun} per run reached`);
      const estimate = costOf(provider.price, task === 'discover' ? { requests: 1 } : { inputTokens: estimatedInput, outputTokens: request.maxOutputTokens ?? 4_000 });
      if (estimate === null) { failures.push(`${provider.id}: no price`); continue; }
      if (estimate > remaining()) { budgetBlocked = true; failures.push(`${provider.id}: estimated ${estimate} USD exceeds the remaining budget`); continue; }
      requests += 1;
      try {
        const { result, attempts, latencyMs } = await attempt(provider, task, request);
        const usage = task === 'discover' ? { requests: 1 } : result.usage;
        const cost = costOf(provider.price, usage);
        runSpent = round(runSpent + cost);
        ledger.book({ module, provider: provider.id, task, costUsd: cost, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens });
        audit({ task, purpose: meta.purpose ?? null, subject: meta.subject ?? null, provider: provider.id, vendor: provider.vendor, model: result.model ?? provider.model ?? null, outcome: 'OK', attempts, latency_ms: latencyMs, input_tokens: usage.inputTokens ?? 0, output_tokens: usage.outputTokens ?? 0, cost_usd: cost, request_sha256: hash(JSON.stringify(request.queries ?? [request.system, request.user, request.document?.base64?.length ?? 0])) });
        return { ...result, provider: provider.id, vendor: provider.vendor, model: result.model ?? provider.model ?? null, cost_usd: cost, attempts };
      } catch (error) {
        callFailed = true;
        audit({ task, purpose: meta.purpose ?? null, subject: meta.subject ?? null, provider: provider.id, vendor: provider.vendor, model: provider.model ?? null, outcome: 'FAILED', error: error instanceof ProviderError ? error.message : 'internal error', cost_usd: 0 });
        failures.push(`${provider.id}: ${error instanceof ProviderError ? error.message : 'internal error'}`);
      }
    }
    if (budgetBlocked && !callFailed) throw new BudgetExceededError(`Budget exhausted for ${task}: ${failures.join('; ')}`);
    throw new NoProviderError(task, failures);
  }

  return {
    run,
    calls: () => calls.slice(),
    spentThisRun: () => runSpent,
    remainingBudget: () => round(Math.max(0, remaining())),
    breakerState: () => Object.fromEntries([...breakers].map(([id, state]) => [id, { failures: state.failures, open: breakerOpen(id) }])),
    ledger,
  };
}
