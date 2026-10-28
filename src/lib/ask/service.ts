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

import type { AskConfig } from './config';
import { CostMeter, eurToMicro, searchCostMicroEur } from './cost';
import type { UiLang } from './i18n';
import { isoDay } from './own-data';
import { LIMITS, WORST_CASE_PROMPT_CHARS, runPipeline, type AskAnswer, type PipelineDeps } from './pipeline';
import type { Providers } from './providers';
import type { AskStore, BudgetCaps } from './store/types';

export const MIN_QUESTION_CHARS = 5;

export type QueryOutcome =
  | { status: 'answered'; answer: AskAnswer; used: number; limit: number }
  | { status: 'invalid' }
  | { status: 'limit'; limit: number }
  | { status: 'budget' }
  | { status: 'error' };

export interface ServiceDeps {
  config: AskConfig;
  store: AskStore;
  providers: Providers;
  now?: () => Date;
  pipeline?: Partial<Pick<PipelineDeps, 'fetchPage' | 'view' | 'findings' | 'deadlineMs'>>;
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
