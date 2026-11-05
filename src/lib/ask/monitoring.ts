// Operational monitoring for DAJC AI (scheduler, on-call). Two read-only views
// behind the maintenance secret:
//
// - health: outbox backlog and dead letters, provider events refused in the
//   last 24 h, renewal problems, reviews waiting, Ask budget use and a hash
//   check of the most recent audit records;
// - preflight: which settings are missing or unsafe, by NAME only, and
//   whether the orchestrated routing may be switched on in this environment.
//
// Neither returns a secret value, an e-mail address, a question, an answer
// or a payment payload.

import { verifyAuditWindow } from './audit';
import { DAJC_ASK_ORCHESTRATOR_PRODUCTION_RELEASED, isAskFlagOn, readAskConfig, type AskConfig, type AskEnv } from './config';
import { parseDataKeys } from './crypto';
import { orchestratedPricing, orchestratedStatus } from './orchestrated';
import { readAccountingConfig, DAJC_ACCOUNTING_LIVE_RELEASED } from './accounting/config';
import { DAJC_AI_LIVE_PAYMENTS_RELEASED, paidReleased, readPaidConfig } from './paid/config';
import { DAJC_AI_PAID_RELEASED } from './paid/subscription';
import { budgetCaps } from './service';
import type { AskStore } from './store/types';
import type { PaidStore } from './store/paid-types';

export const HEALTH_WINDOW_MS = 24 * 3_600_000;
export const HEALTH_AUDIT_RECORDS = 500;
/** A pending accounting document older than this means the outbox is not draining. */
export const OUTBOX_STALE_MS = 6 * 3_600_000;
export const BUDGET_WARN_RATIO = 0.8;

export type HealthAlert =
  | 'AUDIT_CHAIN_BROKEN'
  | 'OUTBOX_DEAD_LETTER'
  | 'OUTBOX_STALE'
  | 'PAYMENT_EVENTS_REJECTED'
  | 'WEBHOOK_REJECTED'
  | 'RENEWAL_PROBLEM'
  | 'REFUNDS_WAITING'
  | 'KNOWLEDGE_WAITING'
  | 'ASK_BUDGET_HIGH';

const CRITICAL: HealthAlert[] = ['AUDIT_CHAIN_BROKEN', 'OUTBOX_DEAD_LETTER'];

export interface HealthReport {
  status: 'ok' | 'attention' | 'critical';
  alerts: HealthAlert[];
  checkedAt: string;
  outbox: {
    pending: number;
    dead: number;
    oldestPendingMinutes: number | null;
    deadItems: Array<{ idemKey: string; kind: string; attempts: number; lastError: string | null }>;
  };
  last24h: {
    paymentEvents: { applied: number; ignored: number; rejected: number };
    webhooksRejected: number;
    renewals: { submitted: number; declined: number; errors: number; blocked: number };
  };
  reviews: { refundsPendingReview: number; knowledgeAwaitingReview: number };
  audit: { checkedRecords: number; brokenAtId: number | null };
  askBudget: { monthUsed: number; dayUsed: number | null } | null;
}

/** Outbox errors come from ABRA; keep them short and without e-mail addresses. */
function redactError(error: string | null): string | null {
  if (!error) return null;
  return error.replace(/[^\s@]+@[^\s@]+/g, '[e-mail]').slice(0, 200);
}

const ratio = (used: number, cap: number) => (cap > 0 ? Math.round((used / cap) * 1000) / 1000 : 0);

export async function operationalHealth(deps: {
  paid: PaidStore;
  ask?: { store: AskStore; config: Pick<AskConfig, 'monthlyBudgetEur' | 'dailyBudgetEur'> } | null;
  now: Date;
}): Promise<HealthReport> {
  const { paid, now } = deps;
  const since = new Date(now.getTime() - HEALTH_WINDOW_MS);
  const summary = await paid.operationalSummary(since);
  const dead = summary.outbox.dead > 0 ? await paid.listOutbox('DEAD') : [];
  const audit = await paid.listAudit(null, HEALTH_AUDIT_RECORDS);
  const brokenAtId = verifyAuditWindow(audit);
  const recent = audit.filter((row) => row.at >= since);
  const countAction = (action: string) => recent.filter((row) => row.action === action).length;
  const renewals = {
    submitted: countAction('RENEWAL_SUBMITTED'),
    declined: countAction('RENEWAL_DECLINED'),
    errors: countAction('RENEWAL_ERROR'),
    blocked: countAction('RENEWAL_BLOCKED'),
  };

  let askBudget: HealthReport['askBudget'] = null;
  if (deps.ask) {
    const caps = budgetCaps(deps.ask.config, now);
    const status = await deps.ask.store.getBudget(caps);
    askBudget = {
      monthUsed: ratio(status.monthSpentMicro + status.monthReservedMicro, caps.monthlyCapMicro),
      dayUsed: caps.dailyCapMicro === null ? null : ratio(status.daySpentMicro + status.dayReservedMicro, caps.dailyCapMicro),
    };
  }

  const oldest = summary.outbox.oldestPendingAt;
  const alerts: HealthAlert[] = [];
  if (brokenAtId !== null) alerts.push('AUDIT_CHAIN_BROKEN');
  if (summary.outbox.dead > 0) alerts.push('OUTBOX_DEAD_LETTER');
  if (oldest && now.getTime() - oldest.getTime() > OUTBOX_STALE_MS) alerts.push('OUTBOX_STALE');
  if (summary.paymentEvents.rejected > 0) alerts.push('PAYMENT_EVENTS_REJECTED');
  const webhooksRejected = countAction('WEBHOOK_REJECTED');
  if (webhooksRejected > 0) alerts.push('WEBHOOK_REJECTED');
  if (renewals.declined + renewals.errors + renewals.blocked > 0) alerts.push('RENEWAL_PROBLEM');
  if (summary.refundsPendingReview > 0) alerts.push('REFUNDS_WAITING');
  if (summary.knowledgeAwaitingReview > 0) alerts.push('KNOWLEDGE_WAITING');
  if (askBudget && (askBudget.monthUsed >= BUDGET_WARN_RATIO || (askBudget.dayUsed ?? 0) >= BUDGET_WARN_RATIO)) alerts.push('ASK_BUDGET_HIGH');

  return {
    status: alerts.some((a) => CRITICAL.includes(a)) ? 'critical' : alerts.length > 0 ? 'attention' : 'ok',
    alerts,
    checkedAt: now.toISOString(),
    outbox: {
      pending: summary.outbox.pending,
      dead: summary.outbox.dead,
      oldestPendingMinutes: oldest ? Math.floor((now.getTime() - oldest.getTime()) / 60_000) : null,
      deadItems: dead.slice(0, 50).map((item) => ({ idemKey: item.idemKey, kind: item.kind, attempts: item.attempts, lastError: redactError(item.lastError) })),
    },
    last24h: { paymentEvents: summary.paymentEvents, webhooksRejected, renewals },
    reviews: { refundsPendingReview: summary.refundsPendingReview, knowledgeAwaitingReview: summary.knowledgeAwaitingReview },
    audit: { checkedRecords: audit.length, brokenAtId },
    askBudget,
  };
}

// --- Preflight ----------------------------------------------------------------

/** Orchestrator variable names as the operator sets them (DAJC_ASK_*). */
function askName(name: string): string {
  return name.replace('DAJC_RESEARCH_PRICING_USD', 'DAJC_ASK_PROVIDER_PRICING_USD').replace(/^DAJC_RESEARCH_/, 'DAJC_ASK_');
}

export interface Preflight {
  environment: string;
  ask: { enabled: boolean; routing: 'direct' | 'orchestrator'; ready: boolean; problems: string[] };
  orchestrator: {
    requested: boolean;
    allowedInThisEnvironment: boolean;
    configuredProviders: string[];
    missing: Record<string, string[]>;
    answerVendors: string[];
    verifyVendors: string[];
    independent: boolean;
    search: boolean;
    pricing: boolean;
    budgets: { monthly: boolean; daily: boolean };
    separateKeys: boolean;
    /** Every condition for switching DAJC_ASK_AI_ROUTING=orchestrator on here. */
    ready: boolean;
  };
  account: { enabled: boolean; dataKeys: string };
  paid: { enabled: boolean; released: boolean; staging: boolean; livePaymentsReleased: boolean; ready: boolean; problems: string[] };
  accounting: { liveReleased: boolean; ready: boolean; problems: string[] };
}

export function preflight(env: AskEnv): Preflight {
  const environment = env.VERCEL_ENV?.trim() || 'local';
  const routing = env.DAJC_ASK_AI_ROUTING === 'orchestrator' ? 'orchestrator' : 'direct';
  const ask = readAskConfig(env);
  // The orchestrator view is computed as if the routing were requested, so it
  // can be checked before anyone switches it on.
  const asOrchestrator = routing === 'orchestrator' ? ask : readAskConfig({ ...env, DAJC_ASK_AI_ROUTING: 'orchestrator' });
  const status = orchestratedStatus(env);
  const allowedInThisEnvironment = environment !== 'production' || DAJC_ASK_ORCHESTRATOR_PRODUCTION_RELEASED;
  const separateKeys = !asOrchestrator.problems.some((p) => p.includes('must be a separate key'));
  const budgets = { monthly: Boolean(env.DAJC_ASK_MONTHLY_BUDGET_EUR?.trim()), daily: Boolean(env.DAJC_ASK_DAILY_BUDGET_EUR?.trim()) };
  const pricing = orchestratedPricing(env) !== null;
  const missing: Record<string, string[]> = {};
  for (const provider of status.providers) {
    if (!provider.configured) missing[provider.id] = [...new Set(provider.missing.map(askName))];
  }

  const paidFlag = env.DAJC_AI_PAID_ENABLED === 'true';
  const paid = readPaidConfig(env);
  const gate = paidReleased(env);
  const accounting = readAccountingConfig(env);
  const dataKeys = parseDataKeys(env.DAJC_AI_DATA_KEYS);

  return {
    environment,
    ask: { enabled: isAskFlagOn(env), routing, ready: ask.ok, problems: ask.problems },
    orchestrator: {
      requested: routing === 'orchestrator',
      allowedInThisEnvironment,
      configuredProviders: status.providers.filter((p) => p.configured).map((p) => p.id),
      missing,
      answerVendors: status.answerVendors,
      verifyVendors: status.verifyVendors,
      independent: status.independent,
      search: status.search,
      pricing,
      budgets,
      separateKeys,
      ready: allowedInThisEnvironment && asOrchestrator.ok && status.independent && pricing && budgets.monthly && budgets.daily && separateKeys,
    },
    account: { enabled: env.DAJC_AI_ACCOUNT_ENABLED === 'true', dataKeys: dataKeys.problem ?? (dataKeys.keyring ? 'ok' : 'DAJC_AI_DATA_KEYS is missing') },
    paid: {
      enabled: paidFlag,
      released: DAJC_AI_PAID_RELEASED,
      staging: gate.staging,
      livePaymentsReleased: DAJC_AI_LIVE_PAYMENTS_RELEASED,
      ready: paidFlag && paid.ok,
      problems: paid.problems,
    },
    accounting: { liveReleased: DAJC_ACCOUNTING_LIVE_RELEASED, ready: accounting.ok, problems: accounting.problems },
  };
}
