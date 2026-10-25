import { describe, expect, it } from 'vitest';
import { MICRO } from '../cost';
import { askQuestion, budgetAvailable, budgetCaps, worstCaseQuestionMicro, type ServiceDeps } from '../service';
import { MemoryAskStore } from '../store/memory';
import { FIXTURE_CANONICAL, NOW, fakeProviders, firstOwnSourceId, ownRecordQuote, testConfig, type FakeScenario } from './helpers';
import type { JsonCallParams } from '../providers';

const QUESTION = 'Is there a truck driving ban in Czechia on 1 November 2026?';

const goodDraft = (params: JsonCallParams) => ({
  claims: [{ text: 'In Czechia the Sunday and public holiday driving ban applies on that day.', source_id: firstOwnSourceId(params), quote: ownRecordQuote(params) }],
  covers_question: true,
});

function service(scenario: FakeScenario = { draft: goodDraft }, configOverrides = {}, now = NOW) {
  const store = new MemoryAskStore();
  const providers = fakeProviders(scenario);
  const deps: ServiceDeps = {
    config: testConfig(configOverrides),
    store,
    providers,
    now: () => now,
    pipeline: { canonical: FIXTURE_CANONICAL, findings: [] },
  };
  return { store, providers, deps };
}

describe('daily limit: 3 questions per verified e-mail', () => {
  it('answers three questions, refuses the fourth without calling any provider', async () => {
    const { deps, providers } = service();
    for (let i = 1; i <= 3; i++) {
      const outcome = await askQuestion('user-1', QUESTION, 'en', deps);
      expect(outcome).toMatchObject({ status: 'answered', used: i, limit: 3 });
    }
    const callsBefore = providers.calls.openai.length;
    expect(await askQuestion('user-1', QUESTION, 'en', deps)).toEqual({ status: 'limit', limit: 3 });
    expect(providers.calls.openai.length).toBe(callsBefore);
  });

  it('counts UNKNOWN answers too', async () => {
    const { deps } = service({ draft: goodDraft, verify: () => ({ results: [] }) });
    for (let i = 0; i < 3; i++) {
      const outcome = await askQuestion('user-1', QUESTION, 'en', deps);
      expect(outcome.status === 'answered' && outcome.answer.level).toBe('UNKNOWN');
    }
    expect((await askQuestion('user-1', QUESTION, 'en', deps)).status).toBe('limit');
  });

  it('gives the question back only after a system error', async () => {
    const { deps, store } = service({ draft: goodDraft, failOn: 'verifier' });
    expect((await askQuestion('user-1', QUESTION, 'en', deps)).status).toBe('error');
    expect(await store.getDailyUsage('user-1', '2026-10-25')).toBe(0);
    expect(store.metrics.at(-1)).toMatchObject({ level: 'SYSTEM_ERROR' });
  });

  it('is per user and resets the next Prague day', async () => {
    const { deps, store } = service();
    for (let i = 0; i < 3; i++) await askQuestion('user-1', QUESTION, 'en', deps);
    expect((await askQuestion('user-2', QUESTION, 'en', deps)).status).toBe('answered');
    const tomorrow = { ...deps, now: () => new Date('2026-10-25T23:30:00Z') }; // 00:30 CET in Prague (summer time ended that night)
    expect((await askQuestion('user-1', QUESTION, 'en', tomorrow)).status).toBe('answered');
    expect(await store.getDailyUsage('user-1', '2026-10-26')).toBe(1);
  });

  it('holds under concurrent requests', async () => {
    const { deps } = service();
    const outcomes = await Promise.all(Array.from({ length: 6 }, () => askQuestion('user-1', QUESTION, 'en', deps)));
    expect(outcomes.filter((o) => o.status === 'answered')).toHaveLength(3);
    expect(outcomes.filter((o) => o.status === 'limit')).toHaveLength(3);
  });

  it('rejects empty and oversized questions without counting them', async () => {
    const { deps, store } = service();
    expect((await askQuestion('user-1', 'Hi', 'en', deps)).status).toBe('invalid');
    expect((await askQuestion('user-1', 'x'.repeat(1001), 'en', deps)).status).toBe('invalid');
    expect(await store.getDailyUsage('user-1', '2026-10-25')).toBe(0);
  });
});

describe('monthly cost cap: the feature switches itself off', () => {
  it('reserves the worst case up front and settles the actual cost', async () => {
    const { deps, store } = service();
    const outcome = await askQuestion('user-1', QUESTION, 'en', deps);
    expect(outcome.status).toBe('answered');
    const budget = await store.getBudget(budgetCaps(deps.config, NOW));
    expect(budget.monthReservedMicro).toBe(0);
    expect(budget.monthSpentMicro).toBeGreaterThan(0);
    expect(budget.monthSpentMicro).toBeLessThan(worstCaseQuestionMicro(deps.config));
    expect(store.metrics.at(-1)).toMatchObject({ level: 'VERIFIED', language: 'en', path: 'own', costMicro: budget.monthSpentMicro });
  });

  it('pauses once the monthly cap cannot take another question, before any provider call', async () => {
    const { deps, store, providers } = service();
    const caps = budgetCaps(deps.config, NOW);
    // 20 EUR budget almost used up.
    await store.settleBudget(caps, 0, 20 * MICRO - worstCaseQuestionMicro(deps.config) + 1);
    expect(await budgetAvailable(deps)).toBe(false);
    expect(await askQuestion('user-1', QUESTION, 'en', deps)).toEqual({ status: 'budget' });
    expect(providers.calls.openai).toHaveLength(0);
    // The refused question is not counted against the user.
    expect(await store.getDailyUsage('user-1', '2026-10-25')).toBe(0);
  });

  it('comes back automatically in the next month', async () => {
    const { deps, store } = service();
    await store.settleBudget(budgetCaps(deps.config, NOW), 0, 20 * MICRO);
    expect(await budgetAvailable(deps)).toBe(false);
    const november = { ...deps, now: () => new Date('2026-11-02T08:00:00Z') };
    expect(await budgetAvailable(november)).toBe(true);
  });

  it('also stops at the daily cap', async () => {
    const { deps, store } = service();
    await store.settleBudget(budgetCaps(deps.config, NOW), 0, 2 * MICRO);
    expect(await askQuestion('user-1', QUESTION, 'en', deps)).toEqual({ status: 'budget' });
    const tomorrow = { ...deps, now: () => new Date('2026-10-26T08:00:00Z') };
    expect((await askQuestion('user-1', QUESTION, 'en', tomorrow)).status).toBe('answered');
  });

  it('never exceeds the cap with concurrent questions', async () => {
    const { deps, store } = service(undefined, { dailyBudgetEur: null, monthlyBudgetEur: 1, dailyQueryLimit: 50 });
    const worst = worstCaseQuestionMicro(deps.config);
    const outcomes = await Promise.all(Array.from({ length: 20 }, (_, i) => askQuestion(`user-${i}`, QUESTION, 'en', deps)));
    const budget = await store.getBudget(budgetCaps(deps.config, NOW));
    expect(outcomes.some((o) => o.status === 'budget')).toBe(true);
    expect(budget.monthSpentMicro + budget.monthReservedMicro).toBeLessThanOrEqual(1 * MICRO);
    expect(outcomes.filter((o) => o.status === 'answered').length).toBeLessThanOrEqual(Math.floor(MICRO / worst));
  });

  it('charges a failed provider call at its worst case', async () => {
    const { deps, store } = service({ draft: goodDraft, failOn: 'answer' });
    await askQuestion('user-1', QUESTION, 'en', deps);
    const budget = await store.getBudget(budgetCaps(deps.config, NOW));
    expect(budget.monthReservedMicro).toBe(0);
    expect(budget.monthSpentMicro).toBeGreaterThan(0);
  });

  it('keeps the measurement free of user data and content', async () => {
    const { deps, store } = service();
    await askQuestion('user-1', QUESTION, 'en', deps);
    const row = store.metrics[0];
    expect(Object.keys(row).sort()).toEqual(['costMicro', 'day', 'language', 'latencyMs', 'level', 'path']);
    expect(JSON.stringify(store.metrics)).not.toMatch(/user-1|truck|Czechia/);
  });
});
