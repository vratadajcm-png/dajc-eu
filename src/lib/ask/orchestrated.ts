// Ask DAJC AI / paid DAJC AI on the shared AI orchestrator
// (src/lib/ai/orchestrator.mjs, ASK_POLICY) and its model adapters
// (src/lib/ai/providers.mjs: OpenAI, Anthropic, Gemini, xAI, Mistral,
// Perplexity). Enabled with DAJC_ASK_AI_ROUTING=orchestrator; the direct
// two-vendor clients (providers.ts) remain the default.
//
// What the orchestrator adds for DAJC AI:
// - routing per task (classify / answer / verify / discover / document) with
//   configurable priorities (DAJC_ASK_ROUTE_<TASK>) and per-task models;
// - the independent check always runs at ANOTHER VENDOR than the answer, among
//   all configured vendors (excludeVendors) - so one vendor's outage or a credit
//   block (as recorded for Anthropic on 2026-10-29) no longer stops DAJC AI;
// - retries with backoff, a circuit breaker and failover per call, plus a
//   cross-request block list for credit/auth/model refusals;
// - a per-question budget (the reservation made in Postgres) and an audit entry
//   per call (provider, model, tokens, cost; never a prompt or key);
// - data classes: a question can only go to user-question tasks, a consented
//   document or personal context only as customer-consented.
//
// Keys stay separate from Driving Bans research: the adapters are given a view
// of the environment in which DAJC_RESEARCH_* names are filled ONLY from
// DAJC_ASK_* variables, never from the research variables.

import { ASK_POLICY, askRoutesFromEnv, createLedger, createOrchestrator } from '../ai/orchestrator.mjs';
import { createProviders as createModelProviders, modelFor, parsePricing, priceFor, PROVIDER_CATALOG, PROVIDER_IDS, providerStatus } from '../ai/providers.mjs';
import type { AskPricing, AskModelPrice, AskEnv } from './config';
import { ProviderError, type JsonCallParams, type ModelResult, type Providers } from './providers';

export type ModelProviderId = 'openai' | 'anthropic' | 'gemini' | 'xai' | 'mistral' | 'perplexity';
const ENV_NAME: Record<ModelProviderId, string> = { openai: 'OPENAI', anthropic: 'ANTHROPIC', gemini: 'GEMINI', xai: 'XAI', mistral: 'MISTRAL', perplexity: 'PERPLEXITY' };
const TASK_SUFFIXES = ['ASK_CLASSIFY', 'ASK_ANSWER', 'ASK_VERIFY', 'ASK_DOCUMENT'];
const REASONING: Record<string, string> = { ANTHROPIC: 'EFFORT', OPENAI: 'REASONING_EFFORT', XAI: 'REASONING_EFFORT' };

/** The adapters' variable names, filled only from DAJC_ASK_* (and the earlier Ask model names). */
export function askAdapterEnv(env: AskEnv): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const id of PROVIDER_IDS as ModelProviderId[]) {
    const P = ENV_NAME[id];
    out[`DAJC_RESEARCH_${P}_API_KEY`] = env[`DAJC_ASK_${P}_API_KEY`];
    if (id === 'perplexity') continue;
    out[`DAJC_RESEARCH_${P}_MODEL`] = env[`DAJC_ASK_${P}_MODEL`];
    for (const suffix of TASK_SUFFIXES) out[`DAJC_RESEARCH_${P}_MODEL_${suffix}`] = env[`DAJC_ASK_${P}_MODEL_${suffix}`];
    if (REASONING[P]) out[`DAJC_RESEARCH_${P}_${REASONING[P]}`] = env[`DAJC_ASK_${P}_${REASONING[P]}`];
  }
  // The models of the two-vendor setup keep working under orchestration.
  out.DAJC_RESEARCH_OPENAI_MODEL ??= env.DAJC_ASK_OPENAI_ANSWER_MODEL;
  out.DAJC_RESEARCH_OPENAI_MODEL_ASK_CLASSIFY ??= env.DAJC_ASK_OPENAI_CLASSIFIER_MODEL;
  out.DAJC_RESEARCH_ANTHROPIC_MODEL ??= env.DAJC_ASK_ANTHROPIC_VERIFIER_MODEL;
  out.DAJC_RESEARCH_PRICING_USD = env.DAJC_ASK_PROVIDER_PRICING_USD;
  return out;
}

export interface OrchestratedStatus {
  providers: Array<{ id: string; vendor: string; region: string; configured: boolean; missing: string[] }>;
  /** Vendors that can draft an answer and vendors that can check it. */
  answerVendors: string[];
  verifyVendors: string[];
  search: boolean;
  /** At least two vendors: the answer and its independent check never share one. */
  independent: boolean;
}

export function orchestratedStatus(env: AskEnv): OrchestratedStatus {
  const adapterEnv = askAdapterEnv(env);
  const status = providerStatus(adapterEnv) as OrchestratedStatus['providers'];
  const routes = askRoutesFromEnv(env) as Record<string, string[]>;
  const configured = new Set(status.filter((s) => s.configured).map((s) => s.id));
  const vendorsOf = (task: string) => [...new Set(routes[task].filter((id) => configured.has(id) && id !== 'perplexity').map((id) => (PROVIDER_CATALOG as Record<string, { vendor: string }>)[id].vendor))];
  const answerVendors = vendorsOf('ask_answer');
  const verifyVendors = vendorsOf('ask_verify');
  const independent = answerVendors.length > 0 && verifyVendors.length > 0 && new Set([...answerVendors, ...verifyVendors]).size >= 2;
  return { providers: status, answerVendors, verifyVendors, search: configured.has('perplexity') && routes.discover.includes('perplexity'), independent };
}

/**
 * Upper-bound role prices for the Postgres cost reservation: the most expensive
 * configured model on each role's route, so a failover can never exceed it.
 */
export function orchestratedPricing(env: AskEnv): AskPricing | null {
  const adapterEnv = askAdapterEnv(env);
  const pricing = parsePricing(adapterEnv.DAJC_RESEARCH_PRICING_USD) as Record<string, any>;
  const routes = askRoutesFromEnv(env) as Record<string, string[]>;
  const configured = new Set((providerStatus(adapterEnv) as Array<{ id: string; configured: boolean }>).filter((s) => s.configured).map((s) => s.id));
  const maxFor = (task: string): AskModelPrice | null => {
    let best: AskModelPrice | null = null;
    for (const id of routes[task]) {
      if (!configured.has(id) || id === 'perplexity') continue;
      const price = priceFor(pricing, id, modelFor(adapterEnv, id, task), modelFor(adapterEnv, id));
      if (!price) continue;
      best = { input: Math.max(best?.input ?? 0, price.input), output: Math.max(best?.output ?? 0, price.output) };
    }
    return best;
  };
  const classifier = maxFor('ask_classify');
  const answer = maxFor('ask_answer');
  const verifier = maxFor('ask_verify');
  if (!classifier || !answer || !verifier) return null;
  const search = configured.has('perplexity') ? Number(pricing.perplexity?.request ?? 0) : 0;
  return { classifier, answer, verifier, searchRequest: search };
}

// Refusals that will not heal within a question (credit, key, tier, model) and
// repeated transient failures, remembered across questions of this instance.
const BLOCK_MS: Record<string, number> = { CREDIT_OR_BILLING: 60 * 60_000, AUTHENTICATION: 60 * 60_000, PERMISSION_OR_TIER: 60 * 60_000, MODEL_NOT_FOUND: 60 * 60_000, QUOTA_EXHAUSTED: 30 * 60_000, NOT_CONFIGURED: 60 * 60_000 };
const sharedBlocks = new Map<string, { category: string; until: number; failures: number }>();

export function resetSharedBlocks(): void {
  sharedBlocks.clear();
}

export interface OrchestratedOptions {
  env: AskEnv;
  /** Per-question budget: the cost reserved for this question, in USD. */
  budgetUsd: number;
  fetchFn?: typeof fetch;
  timeoutMs?: number;
  clock?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  onAudit?: (entry: Record<string, unknown>) => void;
  /** The question carries consented personal context (vehicle, load, document). */
  personalData?: boolean;
}

export interface OrchestratedProviders extends Providers {
  calls(): Array<Record<string, unknown>>;
  /** True when no independent answer + check pair is currently possible. */
  unavailable(): boolean;
}

export function orchestratedProviders(options: OrchestratedOptions): OrchestratedProviders {
  const clock = options.clock ?? (() => new Date());
  const adapterEnv = askAdapterEnv(options.env);
  const models = createModelProviders({ env: adapterEnv, fetchFn: options.fetchFn ?? fetch, timeoutMs: options.timeoutMs ?? 25_000 });
  const now = () => clock().getTime();
  const blocked = Object.fromEntries([...sharedBlocks].filter(([, b]) => b.until > now()).map(([id, b]) => [id, b.category]));
  // The JavaScript orchestrator's inferred defaults describe the research policy; DAJC AI passes ASK_POLICY.
  const create = createOrchestrator as unknown as (settings: Record<string, unknown>) => {
    run(task: string, request: Record<string, unknown>, meta?: Record<string, unknown>): Promise<any>;
    calls(): Array<Record<string, unknown>>;
  };
  const orchestrator = create({
    providers: models,
    routes: askRoutesFromEnv(options.env),
    limits: {
      runBudgetUsd: Math.max(0, options.budgetUsd),
      // The global and per-user monthly caps are enforced by the Ask budget tables.
      monthlyBudgetUsd: Number.MAX_SAFE_INTEGER,
      maxRequestsPerRun: 16,
      maxInputTokensPerCall: 80_000,
      complexInputTokens: Number.MAX_SAFE_INTEGER,
      maxRetryWaitMs: 4_000,
      minIntervalMs: {},
      preferLowerCost: options.env.DAJC_ASK_PREFER_LOWER_COST === 'true',
      testedLanguages: null,
    },
    ledger: createLedger({ clock }),
    module: 'ask-dajc-ai',
    clock,
    sleep: options.sleep,
    maxRetries: 1,
    backoffMs: 500,
    breakerThreshold: 2,
    breakerCooldownMs: 60_000,
    blocked,
    policy: ASK_POLICY,
    onAudit: (entry: Record<string, any>) => {
      const id = String(entry.provider ?? '');
      if (entry.outcome === 'OK') sharedBlocks.delete(id);
      else if (entry.outcome === 'FAILED' && id) {
        const previous = sharedBlocks.get(id);
        const failures = (previous?.failures ?? 0) + 1;
        const lasting = BLOCK_MS[String(entry.error_category)];
        const until = lasting ? now() + lasting : failures >= 3 ? now() + 60_000 : previous?.until ?? 0;
        sharedBlocks.set(id, { category: lasting ? String(entry.error_category) : 'REPEATED_FAILURES', until, failures });
      }
      options.onAudit?.(entry);
    },
  });
  const dataClass = options.personalData ? 'customer-consented' : 'user-question';
  let answerVendor: string | null = null;

  const toResult = <T>(result: any): ModelResult<T> => ({ json: result.json as T, usage: result.usage, costUsd: result.cost_usd, provider: result.provider, model: result.model });
  const request = (params: JsonCallParams) => ({
    system: params.system, user: params.user, schema: params.schema, schemaName: params.schemaName, maxOutputTokens: params.maxOutputTokens,
    ...(params.file ? { document: { mediaType: 'application/pdf', base64: params.file.base64 } } : {}),
  });

  return {
    async openaiJson<T>(params: JsonCallParams): Promise<ModelResult<T>> {
      const task = params.file ? 'ask_document' : params.schemaName === 'dajc_question' ? 'ask_classify' : 'ask_answer';
      const result = await orchestrator.run(task, request(params), { dataClass: params.file ? 'customer-consented' : dataClass, purpose: task, needsPdf: Boolean(params.file) });
      if (task === 'ask_answer') answerVendor = result.vendor;
      return toResult<T>(result);
    },
    async anthropicJson<T>(params: JsonCallParams): Promise<ModelResult<T>> {
      // Without a known answer vendor the check cannot be shown to be independent.
      if (!answerVendor) throw new ProviderError('anthropic', 'no answer to verify');
      const result = await orchestrator.run('ask_verify', request(params), { dataClass, purpose: 'ask_verify', excludeVendors: [answerVendor] });
      return toResult<T>(result);
    },
    async search({ queries, domains, maxResults }) {
      const result = await orchestrator.run('discover', { queries, domains, maxResults }, { dataClass: 'public-legal', purpose: 'official-domain search' });
      return (Array.isArray(result.results) ? result.results : []).map((r: { url: string; title?: string }) => ({ url: r.url, title: String(r.title || '').slice(0, 250) }));
    },
    calls: () => orchestrator.calls(),
    unavailable() {
      const state = orchestratedStatus(options.env);
      const live = (vendors: string[]) => vendors.filter((vendor) => (PROVIDER_IDS as string[]).some((id) => (PROVIDER_CATALOG as Record<string, { vendor: string }>)[id].vendor === vendor && !(sharedBlocks.get(id)?.until! > now())));
      const answers = live(state.answerVendors);
      const checks = live(state.verifyVendors);
      return answers.length === 0 || checks.length === 0 || new Set([...answers, ...checks]).size < 2;
    },
  };
}
