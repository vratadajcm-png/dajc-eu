// One question end to end: daily limit, cost reservation, pipeline,
// settlement and measurement (§47.7 Phase 1).
//
// - Limit: DAJC_ASK_DAILY_QUERY_LIMIT questions per verified e-mail and
//   Prague calendar day. Every answered question counts, UNKNOWN included;
//   a question is given back only after a system error (owner decision).
// - Cost: before any provider call the worst-case cost of the whole
//   question is reserved against the monthly and the daily cap; afterwards
//   the reservation is replaced by the actual cost. When a cap cannot take
//   another worst case, the feature pauses itself until the next period.
// - Measurement: one metrics row per answered question - level, language,
//   path, actual cost, latency - with no user reference and no content.

import { createHash } from 'node:crypto';
import type { AskConfig } from './config';
import { CostMeter, eurToMicro, searchCostMicroEur } from './cost';
import type { UiLang } from './i18n';
import { isoDay, publishedView } from './own-data';
import { LIMITS, WORST_CASE_PROMPT_CHARS, redactPersonalData, runPipeline, type AskAnswer, type PipelineDeps } from './pipeline';
import type { Providers } from './providers';
import type { AskStore, BudgetCaps } from './store/types';
import type { PaidStore } from './store/paid-types';

export const MIN_QUESTION_CHARS = 5;

export type QueryOutcome =
  | { status: 'answered'; answer: AskAnswer; used: number; limit: number; cached?: boolean }
  | { status: 'invalid' }
  | { status: 'limit'; limit: number }
  | { status: 'budget' }
  | { status: 'error' };

export interface ServiceDeps {
  config: AskConfig;
  store: AskStore;
  providers: Providers;
  now?: () => Date;
  pipeline?: Partial<Pick<PipelineDeps, 'fetchPage' | 'view' | 'findings' | 'deadlineMs' | 'onClassified' | 'knowledge'>>;
  cache?: AnswerCache;
}

/** Checked generic answers shared by identical questions on the same data and day. */
export interface AnswerCache {
  get(key: string, now: Date): Promise<AskAnswer | null>;
  put(key: string, answer: AskAnswer, expiresAt: Date): Promise<void>;
}

const CACHEABLE = new Set(['VERIFIED', 'PARTIAL', 'INSUFFICIENT_VERIFIED_DATA']);
const CACHE_TTL_MS = 6 * 3_600_000;

export function answerCacheFrom(store: Pick<PaidStore, 'getCachedAnswer' | 'putCachedAnswer'>): AnswerCache {
  return {
    async get(key, now) {
      return (await store.getCachedAnswer(key, now)) as AskAnswer | null;
    },
    put: (key, answer, expiresAt) => store.putCachedAnswer(key, answer, expiresAt),
  };
}

/**
 * Same redacted question, interface language, Driving Bans dataset version
 * and Prague day -> same key. The key is a hash: the question itself is not stored.
 */
export function answerCacheKey(question: string, uiLang: UiLang, datasetVersion: string, day: string): string {
  const normalized = redactPersonalData(question).toLowerCase().normalize('NFKC').replace(/\s+/g, ' ').replace(/[?!.\s]+$/, '').trim();
  return createHash('sha256').update(`v1|${uiLang}|${datasetVersion}|${day}|${normalized}`, 'utf8').digest('hex');
}

export function worstCaseQuestionMicro(config: Pick<AskConfig, 'pricing' | 'usdToEur'>): number {
  const meter = new CostMeter(config);
  return meter.worstCase('classifier', WORST_CASE_PROMPT_CHARS.classifier, LIMITS.classifierOutputTokens)
    + meter.worstCase('answer', WORST_CASE_PROMPT_CHARS.answer, LIMITS.answerOutputTokens)
    + meter.worstCase('verifier', WORST_CASE_PROMPT_CHARS.verifier, LIMITS.verifierOutputTokens)
    + searchCostMicroEur(config, 1);
}

export function budgetCaps(config: Pick<AskConfig, 'monthlyBudgetEur' | 'dailyBudgetEur'>, now: Date): BudgetCaps {
  const day = isoDay(now);
  return {
    monthKey: day.slice(0, 7),
    dayKey: day,
    monthlyCapMicro: eurToMicro(config.monthlyBudgetEur),
    dailyCapMicro: config.dailyBudgetEur === null ? null : eurToMicro(config.dailyBudgetEur),
  };
}

/** True while both caps can still take one more worst-case question. */
export async function budgetAvailable(deps: Pick<ServiceDeps, 'config' | 'store' | 'now'>): Promise<boolean> {
  const now = deps.now?.() ?? new Date();
  const caps = budgetCaps(deps.config, now);
  const status = await deps.store.getBudget(caps);
  const need = worstCaseQuestionMicro(deps.config);
  const monthOk = status.monthSpentMicro + status.monthReservedMicro + need <= caps.monthlyCapMicro;
  const dayOk = caps.dailyCapMicro === null || status.daySpentMicro + status.dayReservedMicro + need <= caps.dailyCapMicro;
  return monthOk && dayOk;
}

export async function getUsage(userId: string, deps: Pick<ServiceDeps, 'config' | 'store' | 'now'>) {
  const now = deps.now?.() ?? new Date();
  const used = await deps.store.getDailyUsage(userId, isoDay(now));
  return { used, limit: deps.config.dailyQueryLimit, remaining: Math.max(0, deps.config.dailyQueryLimit - used) };
}

export async function askQuestion(userId: string, rawQuestion: unknown, uiLang: UiLang, deps: ServiceDeps): Promise<QueryOutcome> {
  const question = typeof rawQuestion === 'string' ? rawQuestion.trim() : '';
  if (question.length < MIN_QUESTION_CHARS || question.length > LIMITS.questionChars) return { status: 'invalid' };

  const now = deps.now?.() ?? new Date();
  const day = isoDay(now);
  const { config, store } = deps;

  if (!(await store.consumeDailyQuestion(userId, day, config.dailyQueryLimit))) return { status: 'limit', limit: config.dailyQueryLimit };

  // A checked answer to the identical question on today's data costs no model call.
  let cacheKey: string | null = null;
  if (deps.cache) {
    try {
      const view = deps.pipeline?.view ?? publishedView(now);
      cacheKey = answerCacheKey(question, uiLang, view.dataset_version, day);
      const cached = await deps.cache.get(cacheKey, now);
      if (cached) {
        await store.recordMetric({ day, level: cached.level, language: cached.language, path: 'cache', costMicro: 0, latencyMs: 0 }).catch(() => undefined);
        return { status: 'answered', answer: cached, used: await store.getDailyUsage(userId, day), limit: config.dailyQueryLimit, cached: true };
      }
    } catch {
      cacheKey = null; // the cache is an optimisation only
    }
  }

  const caps = budgetCaps(config, now);
  const reserved = worstCaseQuestionMicro(config);
  if (!(await store.reserveBudget(caps, reserved))) {
    await store.refundDailyQuestion(userId, day);
    return { status: 'budget' };
  }

  const meter = new CostMeter(config);
  const started = Date.now();
  try {
    const result = await runPipeline(question, uiLang, {
      config,
      providers: deps.providers,
      meter,
      now,
      ...deps.pipeline,
    });
    await store.settleBudget(caps, reserved, meter.total);
    await store.recordMetric({ day, level: result.answer.level, language: result.answer.language, path: result.path, costMicro: meter.total, latencyMs: Date.now() - started });
    if (result.reviewUrls.length > 0) {
      await store.enqueueReviewUrls(result.reviewUrls.map((entry) => ({ ...entry, day })));
    }
    if (cacheKey && deps.cache && CACHEABLE.has(result.answer.level)) {
      await deps.cache.put(cacheKey, result.answer, new Date(now.getTime() + CACHE_TTL_MS)).catch(() => undefined);
    }
    const used = await store.getDailyUsage(userId, day);
    return { status: 'answered', answer: result.answer, used, limit: config.dailyQueryLimit };
  } catch (error) {
    console.error(`[ask] system error: ${(error as Error)?.name || 'Error'}: ${(error as Error)?.message || ''}`.slice(0, 300));
    // A failed provider call is charged at its worst case (cost.ts).
    await store.settleBudget(caps, reserved, meter.total).catch(() => undefined);
    await store.refundDailyQuestion(userId, day).catch(() => undefined);
    await store.recordMetric({ day, level: 'SYSTEM_ERROR', language: 'und', path: 'none', costMicro: meter.total, latencyMs: Date.now() - started }).catch(() => undefined);
    return { status: 'error' };
  }
}
