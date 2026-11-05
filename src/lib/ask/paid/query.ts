// Paid DAJC AI questions (EUR 15 / month, no per-question charge) with
// transparent fair use. One flow, reusing what exists:
//   - the same verified Ask pipeline (pipeline.ts) and its independent check;
//   - the same Driving Bans registry through the paid read-only contract
//     (dajc-ai/paid-driving-bans.ts -> intelligence/driving-bans-ai-contract.ts);
//   - the subscription ledger as the only source of paid access.
// Fair use: questions per day and month, an AI cost cap per user and month,
// and the global Ask budget. A paid question that fails for a system reason
// is given back, like a free one.
// Personal context: saved vehicles, loads and routes are used by the
// deterministic registry tools; they reach an AI provider only with the
// AI_PERSONAL_CONTEXT consent. Permit PDFs reach a provider only with the
// DOCUMENT_ANALYSIS consent and are never stored.

import { answerPaidDrivingBans, type PaidBansResult } from '../../dajc-ai/paid-driving-bans';
import { isTrackedJurisdiction } from '../../../../config/europe-coverage.mjs';
import { hasConsent, memoryItem, rememberExchange, type AccountDeps } from '../account/service';
import { accessOf } from '../billing/service';
import type { AskConfig } from '../config';
import { CostMeter, eurToMicro } from '../cost';
import type { UiLang } from '../i18n';
import { isoDay, type DrivingBansView } from '../own-data';
import { LIMITS, redactPersonalData, runPipeline, type AskAnswer, type PipelineDeps } from '../pipeline';
import type { Classification } from '../prompts';
import type { Providers } from '../providers';
import { aiUnavailable } from '../resilience';
import { budgetCaps, worstCaseQuestionMicro, MIN_QUESTION_CHARS, type ProviderFactory } from '../service';
import type { AskStore } from '../store/types';
import type { PaidStore } from '../store/paid-types';
import type { PaidConfig } from './config';
import { PERMIT_EXTRACTION_SCHEMA, PERMIT_EXTRACTION_SYSTEM, sanitizeExtraction, validatePermitPdf, type PdfCheck } from './permits';

export interface PaidQueryDeps {
  askConfig: AskConfig;
  store: AskStore;
  providers: Providers;
  paid: PaidStore;
  paidConfig: PaidConfig;
  env: Record<string, string | undefined>;
  released: boolean;
  sessionToken: string | undefined;
  now?: () => Date;
  pipeline?: Partial<Pick<PipelineDeps, 'fetchPage' | 'view' | 'findings' | 'deadlineMs' | 'knowledge'>>;
  /** Orchestrated routing: providers for one question, limited to its reserved budget. */
  providerFactory?: ProviderFactory;
}

export interface PaidQueryInput {
  question?: unknown;
  vehicleId?: unknown;
  cargoId?: unknown;
  routeId?: unknown;
  jurisdictions?: unknown;
  dates?: unknown;
}

export interface RoutingProvider {
  /** Licensed routing / live traffic restrictions. None is contracted: DAJC never simulates a verified route. */
  status(): { available: false; reason: string };
}

export const NO_ROUTING: RoutingProvider = {
  status: () => ({ available: false, reason: 'DAJC has no licensed routing or live road-restriction data. Route planning information lists the verified rules per country only; the permitted route is decided by the authority.' }),
};

export type PaidQueryOutcome =
  | { status: 'answered'; answer: AskAnswer | null; registry: PaidBansResult | null; notices: string[]; routing: ReturnType<RoutingProvider['status']>; usage: PaidUsage; historySaved: boolean }
  | { status: 'invalid' | 'not_paid' | 'budget' | 'error' }
  | { status: 'limit'; scope: 'daily' | 'monthly' | 'cost'; usage: PaidUsage };

export interface PaidUsage {
  day: number;
  month: number;
  dailyLimit: number;
  monthlyLimit: number;
}

const nowOf = (deps: Pick<PaidQueryDeps, 'now'>) => deps.now?.() ?? new Date();
const DAY = /^\d{4}-\d{2}-\d{2}$/;

function accountDeps(deps: PaidQueryDeps): AccountDeps {
  return {
    paid: deps.paid, keyring: deps.paidConfig.keyring, now: deps.now, paidActive: true,
    retention: { historyDays: deps.paidConfig.historyRetentionDays, historyMaxEntries: deps.paidConfig.historyMaxEntries, memoryDays: deps.paidConfig.memoryRetentionDays, memoryMaxItems: deps.paidConfig.memoryMaxItems },
  };
}

async function usageOf(userId: string, deps: PaidQueryDeps, now: Date): Promise<PaidUsage> {
  const day = isoDay(now);
  const used = await deps.paid.getPaidUsage(userId, day, day.slice(0, 7));
  return { day: used.day, month: used.month, dailyLimit: deps.paidConfig.fairUse.dailyQuestions, monthlyLimit: deps.paidConfig.fairUse.monthlyQuestions };
}

/** Reserves one paid question: fair-use counters, the user's cost cap and the global budget. */
async function reserve(userId: string, deps: PaidQueryDeps, now: Date, worstMicro: number): Promise<{ ok: true; release: (actualMicro: number, refund: boolean) => Promise<void> } | { ok: false; outcome: PaidQueryOutcome }> {
  const day = isoDay(now);
  const month = day.slice(0, 7);
  const quota = await deps.paid.consumePaidQuestion(userId, day, month, deps.paidConfig.fairUse.dailyQuestions, deps.paidConfig.fairUse.monthlyQuestions);
  if (quota !== 'ok') return { ok: false, outcome: { status: 'limit', scope: quota, usage: await usageOf(userId, deps, now) } };
  if (!(await deps.paid.reserveUserCost(userId, month, worstMicro, eurToMicro(deps.paidConfig.fairUse.userMonthlyCostEur)))) {
    await deps.paid.refundPaidQuestion(userId, day, month);
    return { ok: false, outcome: { status: 'limit', scope: 'cost', usage: await usageOf(userId, deps, now) } };
  }
  const caps = budgetCaps(deps.askConfig, now);
  if (!(await deps.store.reserveBudget(caps, worstMicro))) {
    await deps.paid.refundPaidQuestion(userId, day, month);
    await deps.paid.settleUserCost(userId, month, worstMicro, 0);
    return { ok: false, outcome: { status: 'budget' } };
  }
  return {
    ok: true,
    async release(actualMicro: number, refund: boolean) {
      await deps.store.settleBudget(caps, worstMicro, actualMicro).catch(() => undefined);
      await deps.paid.settleUserCost(userId, month, worstMicro, actualMicro).catch(() => undefined);
      if (refund) await deps.paid.refundPaidQuestion(userId, day, month).catch(() => undefined);
    },
  };
}

function cleanList(value: unknown, test: (v: string) => boolean, max: number): string[] {
  return [...new Set((Array.isArray(value) ? value : []).map((v) => String(v).trim().toUpperCase()))].filter(test).slice(0, max);
}

/** Paid DAJC AI question. The caller has resolved userId from the session cookie. */
export async function askPaidQuestion(userId: string, input: PaidQueryInput, uiLang: UiLang, deps: PaidQueryDeps): Promise<PaidQueryOutcome> {
  const now = nowOf(deps);
  const question = typeof input.question === 'string' ? input.question.trim() : '';
  if (question.length < MIN_QUESTION_CHARS || question.length > LIMITS.questionChars) return { status: 'invalid' };
  if (!accessOf(userId, await deps.paid.getLedger(userId), deps, now).allowed) return { status: 'not_paid' };

  const account = accountDeps(deps);
  const vehicle = await memoryItem(userId, input.vehicleId, 'VEHICLE', account);
  const route = await memoryItem(userId, input.routeId, 'ROUTE', account);
  const cargo = await memoryItem(userId, input.cargoId, 'CARGO', account);
  const personalContext = (vehicle || cargo) && (await hasConsent(userId, 'AI_PERSONAL_CONTEXT', deps)) ? [
    vehicle ? `Vehicle parameters given by the user: ${JSON.stringify((vehicle as { vehicle?: unknown }).vehicle)}` : '',
    cargo ? `Load parameters given by the user: ${JSON.stringify({ ...cargo, name: undefined, kind: undefined })}` : '',
  ].filter(Boolean).join('\n') : '';

  const worst = worstCaseQuestionMicro(deps.askConfig);
  const reservation = await reserve(userId, deps, now, worst);
  if (!reservation.ok) return (reservation as { outcome: PaidQueryOutcome }).outcome;

  const meter = new CostMeter(deps.askConfig);
  const notices: string[] = [];
  let classification: Classification | null = null;
  let answer: AskAnswer | null = null;
  let systemError = false;
  const started = Date.now();
  const providers = deps.providerFactory ? deps.providerFactory({ budgetMicro: worst, personalData: Boolean(personalContext) }) : deps.providers;
  if (aiUnavailable(providers)) {
    notices.push('AI_UNAVAILABLE');
  } else {
    try {
      const fullQuestion = personalContext ? `${question}\n\n${redactPersonalData(personalContext)}`.slice(0, LIMITS.questionChars + 600) : question;
      const result = await runPipeline(fullQuestion, uiLang, {
        config: deps.askConfig, providers, meter, now, ...deps.pipeline,
        onClassified: (c) => { classification = c; },
      });
      answer = result.answer;
      if (result.reviewUrls.length > 0) await deps.store.enqueueReviewUrls(result.reviewUrls.map((entry) => ({ ...entry, day: isoDay(now) }))).catch(() => undefined);
    } catch (error) {
      systemError = true;
      notices.push('AI_UNAVAILABLE');
      console.error(`[dajc-ai] paid question system error: ${(error as Error)?.name || 'Error'}`);
    }
  }

  // Deterministic registry check: always available, AI or not.
  const c = classification as Classification | null;
  const jurisdictions = [...new Set([
    ...cleanList(input.jurisdictions, isTrackedJurisdiction, 20),
    ...cleanList((route as { jurisdictions?: unknown } | null)?.jurisdictions, isTrackedJurisdiction, 20),
    ...(c?.jurisdictions ?? []),
  ])].slice(0, 20);
  const dates = [...new Set([...cleanList(input.dates, (d) => DAY.test(d), 5), ...(c?.dates ?? [])])].sort().slice(0, 5);
  let registry: PaidBansResult | null = null;
  if (jurisdictions.length > 0 && dates.length > 0 && (!c || c.topic === 'driving_ban' || vehicle || route)) {
    // The asked local calendar days in Central European time (UTC+1/+2).
    const from = new Date(Date.parse(`${dates[0]}T00:00:00Z`) - 2 * 3_600_000).toISOString();
    const to = new Date(Date.parse(`${dates[dates.length - 1]}T00:00:00Z`) + 23 * 3_600_000).toISOString();
    registry = await answerPaidDrivingBans({
      store: deps.store,
      // Paid access was established above from the same ledger.
      findSubscription: (id) => deps.paid.getLedger(id),
      sessionToken: deps.sessionToken, tool: 'search_bans',
      input: { jurisdictions, from, to, ...(vehicle ? { vehicle: (vehicle as { vehicle: unknown }).vehicle } : {}) },
      now, env: deps.env, released: deps.released,
      view: deps.pipeline?.view as DrivingBansView | undefined,
    });
  } else if (!c || c.topic === 'driving_ban') {
    notices.push('REGISTRY_NEEDS_COUNTRY_AND_DATE');
  }
  if (route || c?.topic === 'road_restriction' || c?.topic === 'oversize_permit') notices.push('ROUTING_NOT_AVAILABLE');

  await reservation.release(meter.total, systemError && !registry);
  await deps.store.recordMetric({ day: isoDay(now), level: answer?.level ?? 'SYSTEM_ERROR', language: answer?.language ?? 'und', path: 'none', costMicro: meter.total, latencyMs: Date.now() - started }).catch(() => undefined);
  if (systemError && !registry) return { status: 'error' };

  const historySaved = await rememberExchange(userId, { question, answer: { answer, registry: registry?.answer ?? null, notices }, lang: uiLang, level: answer?.level ?? registry?.status ?? 'NONE' }, account).catch(() => false);
  return { status: 'answered', answer, registry, notices, routing: NO_ROUTING.status(), usage: await usageOf(userId, deps, now), historySaved };
}

export type PermitExtractOutcome =
  | { status: 'extracted'; isPermit: boolean; permit: Record<string, unknown>; quotes: Record<string, string>; pages: number; notice: string }
  | { status: 'invalid_file'; reason: Extract<PdfCheck, { ok: false }>['reason'] }
  | { status: 'no_consent' | 'not_paid' | 'budget' | 'error' }
  | { status: 'limit'; scope: 'daily' | 'monthly' | 'cost'; usage: PaidUsage };

export const EXTRACTION_PROMPT_CHARS = 150_000;
export const EXTRACTION_OUTPUT_TOKENS = 3000;

/** AI reading of an uploaded permit PDF; the user checks the result against the original. */
export async function extractPermit(userId: string, input: { fileBase64?: unknown; filename?: unknown }, deps: PaidQueryDeps): Promise<PermitExtractOutcome> {
  const now = nowOf(deps);
  if (!accessOf(userId, await deps.paid.getLedger(userId), deps, now).allowed) return { status: 'not_paid' };
  if (!(await hasConsent(userId, 'DOCUMENT_ANALYSIS', deps))) return { status: 'no_consent' };
  const file = validatePermitPdf(input.fileBase64);
  if (!file.ok) return { status: 'invalid_file', reason: (file as Extract<PdfCheck, { ok: false }>).reason };
  const meterProbe = new CostMeter(deps.askConfig);
  const worst = meterProbe.worstCase('answer', EXTRACTION_PROMPT_CHARS, EXTRACTION_OUTPUT_TOKENS);
  const reservation = await reserve(userId, deps, now, worst);
  if (!reservation.ok) return (reservation as { outcome: PaidQueryOutcome }).outcome as PermitExtractOutcome;
  const meter = new CostMeter(deps.askConfig);
  const providers = deps.providerFactory ? deps.providerFactory({ budgetMicro: worst, personalData: true }) : deps.providers;
  try {
    const result = await meter.track('answer', EXTRACTION_PROMPT_CHARS, EXTRACTION_OUTPUT_TOKENS, () => providers.openaiJson<unknown>({
      model: deps.askConfig.answerModel, system: PERMIT_EXTRACTION_SYSTEM,
      user: 'Extract the permit parameters from the attached document.',
      schemaName: 'dajc_permit', schema: PERMIT_EXTRACTION_SCHEMA as unknown as Record<string, unknown>, maxOutputTokens: EXTRACTION_OUTPUT_TOKENS,
      file: { filename: 'permit.pdf', base64: (file as Extract<PdfCheck, { ok: true }>).bytes.toString('base64') }, signal: AbortSignal.timeout(LIMITS.deadlineMs),
    }));
    await reservation.release(meter.total, false);
    const clean = sanitizeExtraction(result.json);
    await deps.paid.appendAudit({ actor: `user:${userId}`, action: 'PERMIT_EXTRACTED', subject: `user:${userId}`, details: { pages: file.pages, fields: Object.keys(clean.permit).length } }, now);
    return { status: 'extracted', ...clean, pages: (file as Extract<PdfCheck, { ok: true }>).pages, notice: 'AI_EXTRACTION_UNVERIFIED' };
  } catch (error) {
    await reservation.release(meter.total, true);
    console.error(`[dajc-ai] permit extraction failed: ${(error as Error)?.name || 'Error'}`);
    return { status: 'error' };
  }
}
