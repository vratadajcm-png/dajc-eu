import { createProviders } from '../ai/providers.mjs';
import { createLedger, createOrchestrator, limitsFromEnv, routesFromEnv } from '../ai/orchestrator.mjs';
import { applyModelProfile } from '../ai/model-profile.mjs';
import { authorizeFeature, type IntelligenceEntitlement } from './entitlements';
import type { IntelligenceSubject } from './subscription-scope';
import type { AiAnswer } from './driving-bans-ai-contract';

/**
 * Plain-language explanation of a verified DAJC AI answer (task class EXPLAIN_VERIFIED_DATA)
 * through the central orchestrator and the approved model policy: GPT-6 Luna, GPT-6 Sol for
 * complex or uncertain answers when the caller's access policy and the budget allow it.
 * Shared by paid DAJC AI and DAJC Intelligence; not mounted on any route and not released.
 * - Authorised server-side per call (feature ai-assistant, the subject's own organisation).
 * - Only the verified answer goes to the model, as data class verified-registry: facts from
 *   the registry, sources, validity, completeness, warnings and outcomes. Never the
 *   organisation, user, vehicle figures or route: a vehicle evaluation is reduced to its status.
 * - The deterministic answer (status, outcomes, sources, warnings, disclaimer) is returned
 *   unchanged; the model only adds text. An explanation that cites a rule or source the
 *   answer does not hold, or claims an authorisation to drive, an exception or a permit, is
 *   dropped and the deterministic answer stands alone.
 * - Own keys, budget and ledger module (DAJC_AI_*, module dajc-ai-explain), apart from research.
 * The free "Ask DAJC AI" (PR #78) does not use this module and gains no paid access from it.
 */

export const EXPLAIN_MODULE = 'dajc-ai-explain';
const PRODUCT_PREFIX = 'DAJC_AI_';
// The provider layer and the orchestrator read their settings under this prefix.
const LAYER_PREFIX = 'DAJC_RESEARCH_';

/**
 * The environment of DAJC AI explanations: DAJC_AI_<SETTING> becomes the provider-layer
 * DAJC_RESEARCH_<SETTING> (keys, models, prices, budgets, routes, profile), and research
 * settings are dropped, so research keys and budgets never serve DAJC AI and vice versa.
 */
export function dajcAiEnvironment(env: Record<string, string | undefined> = process.env): Record<string, string | undefined> {
  const mapped: Record<string, string | undefined> = {};
  for (const [name, value] of Object.entries(env)) {
    if (name.startsWith(PRODUCT_PREFIX) && name !== 'DAJC_AI_DRIVING_BANS_ENABLED') mapped[LAYER_PREFIX + name.slice(PRODUCT_PREFIX.length)] = value;
  }
  return applyModelProfile(mapped);
}

/** The orchestrator for explanations; without DAJC_AI budgets it refuses every call. */
export function createExplainOrchestrator({ env = process.env, fetchFn = fetch, ledgerFile = null, clock }: { env?: Record<string, string | undefined>; fetchFn?: typeof fetch; ledgerFile?: string | null; clock?: () => Date } = {}) {
  const product = dajcAiEnvironment(env);
  return createOrchestrator({ providers: createProviders({ env: product, fetchFn }), routes: routesFromEnv(product), limits: limitsFromEnv(product), ledger: createLedger({ file: ledgerFile, clock }), module: EXPLAIN_MODULE, clock });
}

// Registry fields of a fact that may go to the model; anything else (vehicle reasons, route segments) stays.
const FACT_FIELDS = ['classification', 'uid', 'ban_id', 'jurisdiction', 'title', 'starts_at', 'ends_at', 'local_time', 'roads', 'regions', 'direction', 'vehicle_scope', 'legal_basis',
  'occurrences', 'exceptions', 'weight_threshold', 'adr', 'exceptional_transport', 'certainty', 'change_id', 'type', 'legal_effective_from', 'impact', 'detected_at',
  'source_id', 'url', 'authority', 'role', 'version', 'checked_at', 'backs_published_rules'] as const;

/** The verified answer reduced to registry data (data class verified-registry). */
export function verifiedPayload(answer: AiAnswer) {
  return {
    tool: answer.tool, status: answer.status, dataset_version: answer.dataset_version, validity: answer.validity,
    facts: answer.facts.map(fact => {
      const kept: Record<string, unknown> = Object.fromEntries(FACT_FIELDS.filter(field => field in fact).map(field => [field, fact[field]]));
      const vehicle = fact.vehicle as { status?: unknown } | null | undefined;
      if (vehicle && typeof vehicle.status === 'string') kept.applies_to_vehicle = vehicle.status;
      return kept;
    }),
    sources: answer.sources, rule_versions: answer.rule_versions, completeness: answer.completeness, warnings: answer.warnings,
    authority_check_required: answer.authority_check_required, next_step: answer.next_step,
  };
}

const EXPLAIN_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['explanation', 'cited_ban_ids', 'cited_source_ids'],
  properties: { explanation: { type: 'string' }, cited_ban_ids: { type: 'array', items: { type: 'string' } }, cited_source_ids: { type: 'array', items: { type: 'string' } } },
};

const SYSTEM_PROMPT = [
  'You explain verified DAJC Driving Bans data to a transport professional in plain language.',
  '1. Use only the DATA. Do not add rules, dates, roads, exceptions or sources it does not contain.',
  '2. Keep every status and outcome exactly as given. INSUFFICIENT_VERIFIED_DATA means the registry cannot decide; it is never evidence that there is no ban.',
  '3. Never say that a journey is allowed or authorised, that an exception applies or that a permit is granted or not needed. Say what the data shows and what must be checked with the competent authority.',
  '4. List in cited_ban_ids and cited_source_ids exactly the ban_id and source_id values you used.',
].join('\n');

// Claims the model must never make (an authorisation, an exception or a permit), in the explanation languages.
const FORBIDDEN_CLAIMS = [
  /\b(?:you|the (?:vehicle|truck|lorry|driver))\s+(?:may|can|are allowed to|is allowed to|are permitted to|is permitted to)\s+(?:drive|travel|run|proceed|go)\b/i,
  /\b(?:journey|trip|transport|drive)\s+is\s+(?:allowed|permitted|authori[sz]ed|legal)\b/i,
  /\bexception\s+(?:applies|covers you)\b/i, /\bpermit\s+(?:is\s+)?(?:granted|not\s+(?:needed|required))\b/i,
  /\b(?:můžete|smíte)\s+jet\b/i, /\bjízda\s+je\s+(?:povolena|dovolena|legální)\b/i, /\bvýjimka\s+se\s+na\s+vás\s+vztahuje\b/i, /\bpovolení\s+(?:nepotřebujete|není\s+potřeba)\b/i,
  /\b(?:dürfen|können)\s+Sie\s+fahren\b/i, /\bFahrt\s+ist\s+(?:erlaubt|zulässig)\b/i,
];

export type ExplainedAnswer = {
  answer: AiAnswer;
  explanation: null | { text: string; provider: string; model: string; task_class: string; escalated: boolean; cited_ban_ids: string[]; cited_source_ids: string[]; cost_usd: number };
  explanation_status: 'EXPLAINED' | 'NOT_EXPLAINED';
  reason: null | 'FEATURE_DISABLED' | 'AUTHENTICATION_REQUIRED' | 'NOT_ENTITLED' | 'TENANT_MISMATCH' | 'NOTHING_TO_EXPLAIN' | 'BUDGET_EXHAUSTED' | 'NO_PROVIDER' | 'OUTPUT_INVALID' | 'CITED_UNKNOWN_DATA' | 'FORBIDDEN_CLAIM';
};

/** Uncertain or broad answers go to the stronger model when the access policy allows it. */
function needsStrongerModel(answer: AiAnswer): boolean {
  return answer.status === 'INSUFFICIENT_VERIFIED_DATA' || answer.tool === 'check_route' || answer.facts.length > 8 || answer.completeness.length > 1 || answer.completeness.some(row => row.outcome === 'INSUFFICIENT_VERIFIED_DATA');
}

/**
 * Explain one verified answer. The caller computed `answer` with answerDrivingBansQuery for
 * the same subject; access is checked again here, per call, before anything is sent.
 */
export async function explainVerifiedAnswer(args: {
  answer: AiAnswer;
  subject: IntelligenceSubject | null | undefined;
  entitlement: IntelligenceEntitlement | null | undefined;
  now: Date;
  orchestrator: { run: (task: string, request: Record<string, unknown>, meta?: Record<string, unknown>) => Promise<any> };
  language?: 'cs' | 'en' | 'de' | 'sk' | 'pl';
  /** From the caller's access policy: may complex or uncertain answers use the stronger model? */
  allowStrongerModel?: boolean;
  env?: Record<string, string | undefined>;
  released?: boolean;
}): Promise<ExplainedAnswer> {
  const { answer } = args;
  const none = (reason: ExplainedAnswer['reason']): ExplainedAnswer => ({ answer, explanation: null, explanation_status: 'NOT_EXPLAINED', reason });
  const access = authorizeFeature({ feature: 'ai-assistant', subject: args.subject, entitlement: args.entitlement, now: args.now, env: args.env, released: args.released });
  if (access.allowed === false) return none(access.reason);
  // Refusals and empty answers say everything themselves; no model is asked to add to them.
  if (!['OK', 'INSUFFICIENT_VERIFIED_DATA'].includes(answer.status) || !answer.facts.length) return none('NOTHING_TO_EXPLAIN');

  const payload = verifiedPayload(answer);
  const request = { system: SYSTEM_PROMPT, user: `Answer language: ${args.language ?? 'en'}.\nDATA:\n${JSON.stringify(payload)}`, schema: EXPLAIN_SCHEMA, schemaName: 'dajc_explanation', maxOutputTokens: 1_500 };
  const meta = { purpose: 'explanation of verified Driving Bans data', subject: `${answer.tool}:${answer.dataset_version ?? 'unknown'}`, dataClass: 'verified-registry' };
  const escalate = args.allowStrongerModel === true && needsStrongerModel(answer);
  let result;
  try {
    result = await args.orchestrator.run('explain', request, { ...meta, escalate });
  } catch (error) {
    const name = (error as Error).name;
    // The stronger model did not fit the budget: the standard model may still explain; nothing is guessed otherwise.
    if (escalate && name === 'BudgetExceededError') {
      try { result = await args.orchestrator.run('explain', request, { ...meta, escalate: false }); }
      catch (retry) { return none((retry as Error).name === 'BudgetExceededError' ? 'BUDGET_EXHAUSTED' : 'NO_PROVIDER'); }
    } else return none(name === 'BudgetExceededError' ? 'BUDGET_EXHAUSTED' : 'NO_PROVIDER');
  }

  const json = result.json as { explanation?: unknown; cited_ban_ids?: unknown; cited_source_ids?: unknown } | null;
  const strings = (value: unknown) => Array.isArray(value) && value.every(item => typeof item === 'string') ? value as string[] : null;
  const text = typeof json?.explanation === 'string' ? json.explanation.trim() : '';
  const bans = strings(json?.cited_ban_ids), sources = strings(json?.cited_source_ids);
  if (!text || !bans || !sources) return none('OUTPUT_INVALID');
  const knownBans = new Set(payload.facts.map(fact => fact.ban_id).filter(Boolean));
  const knownSources = new Set([...answer.sources.map(source => source.source_id), ...payload.facts.map(fact => fact.source_id).filter(Boolean)]);
  if (bans.some(id => !knownBans.has(id)) || sources.some(id => !knownSources.has(id))) return none('CITED_UNKNOWN_DATA');
  if (FORBIDDEN_CLAIMS.some(pattern => pattern.test(text))) return none('FORBIDDEN_CLAIM');
  return {
    answer,
    explanation: { text, provider: result.provider, model: result.model, task_class: result.task_class ?? 'EXPLAIN_VERIFIED_DATA', escalated: Boolean(result.complex), cited_ban_ids: bans, cited_source_ids: sources, cost_usd: result.cost_usd },
    explanation_status: 'EXPLAINED', reason: null,
  };
}
