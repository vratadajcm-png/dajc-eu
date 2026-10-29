import { createProviders, providerStatus, PROVIDER_CATALOG } from '../../ai/providers.mjs';
import { createLedger, createOrchestrator, limitsFromEnv, routesFromEnv } from '../../ai/orchestrator.mjs';

/**
 * Research is off unless DAJC_DRIVING_BANS_RESEARCH_ENABLED is the exact string
 * "true" AND a run budget and a monthly budget are set AND extraction and the
 * independent check can run at two different vendors. Anything missing keeps it off.
 */
export const RESEARCH_FLAG = 'DAJC_DRIVING_BANS_RESEARCH_ENABLED';

export function researchReadiness(env = process.env) {
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
  return { enabled: hard.length === 0, blockers, providers: status, routes, limits: { run_budget_usd: limits.runBudgetUsd, monthly_budget_usd: limits.monthlyBudgetUsd, max_requests_per_run: limits.maxRequestsPerRun, max_input_tokens_per_call: limits.maxInputTokensPerCall, prefer_lower_cost: limits.preferLowerCost } };
}

export function createResearchOrchestrator({ env = process.env, fetchFn = fetch, ledgerFile = null, clock, onAudit } = {}) {
  return createOrchestrator({ providers: createProviders({ env, fetchFn }), routes: routesFromEnv(env), limits: limitsFromEnv(env), ledger: createLedger({ file: ledgerFile, clock }), clock, onAudit });
}
