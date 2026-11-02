import { createProviders, providerStatus, PROVIDER_CATALOG } from '../../ai/providers.mjs';
import { createLedger, createOrchestrator, limitsFromEnv, routesFromEnv } from '../../ai/orchestrator.mjs';
import { applyModelProfile, recommendModels } from '../../ai/model-profile.mjs';

/**
 * Research is off unless DAJC_DRIVING_BANS_RESEARCH_ENABLED is the exact string
 * "true" AND a run budget and a monthly budget are set AND extraction and the
 * independent check can run at two different vendors. Anything missing keeps it off.
 * DAJC_RESEARCH_MODEL_PROFILE=bakeoff-2026-10-25 fills in measured model choices for
 * providers that have a key but no explicit model (src/lib/ai/model-profile.mjs).
 */
export const RESEARCH_FLAG = 'DAJC_DRIVING_BANS_RESEARCH_ENABLED';

/** The environment research actually uses: explicit settings, plus the opt-in model profile. */
export const researchEnvironment = (env = process.env) => applyModelProfile(env);

export function researchReadiness(rawEnv = process.env) {
  const env = researchEnvironment(rawEnv);
  const status = providerStatus(env);
  const routes = routesFromEnv(env);
  const limits = limitsFromEnv(env);
  const configured = id => status.find(item => item.id === id)?.configured;
  const vendors = task => [...new Set(routes[task].filter(configured).map(id => PROVIDER_CATALOG[id].vendor))];
  const blockers = [];
  if (env[RESEARCH_FLAG] !== 'true') blockers.push(`${RESEARCH_FLAG} is not "true"`);
  if (!(limits.runBudgetUsd > 0)) blockers.push('DAJC_RESEARCH_RUN_BUDGET_USD is not set');
  if (!(limits.monthlyBudgetUsd > 0)) blockers.push('DAJC_RESEARCH_MONTHLY_BUDGET_USD is not set');
  const extract = vendors('extract'), verify = vendors('verify');
  // The orchestrator extracts at the first configured provider; the check must then find another vendor.
  if (!extract.length) blockers.push('No configured provider for extraction');
  else if (!verify.some(vendor => vendor !== extract[0])) blockers.push(`The independent check needs a configured vendor other than ${extract[0]}`);
  if (!vendors('discover').length) blockers.push('No configured search provider: only registry sources and leads are re-checked');
  const hard = blockers.filter(item => !item.startsWith('No configured search provider'));
  const filled = Object.keys(env).filter(name => env[name] !== rawEnv[name] && name.startsWith('DAJC_RESEARCH_')).sort();
  return {
    enabled: hard.length === 0, blockers, providers: status, routes,
    limits: { run_budget_usd: limits.runBudgetUsd, monthly_budget_usd: limits.monthlyBudgetUsd, max_requests_per_run: limits.maxRequestsPerRun, max_input_tokens_per_call: limits.maxInputTokensPerCall, complex_input_tokens: limits.complexInputTokens, max_retry_wait_ms: limits.maxRetryWaitMs, min_interval_ms: Object.fromEntries(Object.entries(limits.minIntervalMs).filter(([, value]) => value)), prefer_lower_cost: limits.preferLowerCost },
    model_profile: { selected: rawEnv.DAJC_RESEARCH_MODEL_PROFILE ?? null, filled_settings: filled, recommendation: recommendModels() },
  };
}

export function createResearchOrchestrator({ env: rawEnv = process.env, fetchFn = fetch, ledgerFile = null, clock, onAudit } = {}) {
  const env = researchEnvironment(rawEnv);
  return createOrchestrator({ providers: createProviders({ env, fetchFn }), routes: routesFromEnv(env), limits: limitsFromEnv(env), ledger: createLedger({ file: ledgerFile, clock }), clock, onAudit });
}
