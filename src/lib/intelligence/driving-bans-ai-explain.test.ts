import { describe, expect, it } from 'vitest';
import { getDrivingBansSnapshot } from '../../../config/driving-ban-calendars/runtime.mjs';
import { FEATURE_FLAG_ENV, type IntelligenceEntitlement } from './entitlements';
import { answerDrivingBansQuery, answerFreeAskQuery } from './driving-bans-ai-contract';
import { createExplainOrchestrator, dajcAiEnvironment, explainVerifiedAnswer, verifiedPayload, EXPLAIN_MODULE } from './driving-bans-ai-explain';
import { createMockAiFetch } from '../../../tests/fixtures/driving-bans-research/mock-ai.mjs';

// SYNTHETIC: the provider HTTP APIs are a scripted stub; no live API call and no key.
const NOW = new Date('2026-10-22T10:00:00Z');
const view = getDrivingBansSnapshot(NOW);
const ON = { released: true, env: Object.fromEntries(Object.values(FEATURE_FLAG_ENV).map(name => [name, 'true'])) };
const subjectA = { organizationId: 'org-a-7731', userId: 'user-5531' };
const entitlementA: IntelligenceEntitlement = { organizationId: 'org-a-7731', features: ['ai-assistant'], validUntil: '2027-12-31T00:00:00.000Z' };
const truck = { configuration: 'ARTICULATED' as const, motorVehicleMassKg: 18_350, combinationMassKg: 39_870 };
const PRODUCT_ENV = { DAJC_AI_MODEL_PROFILE: 'bakeoff-2026-10-25', DAJC_AI_OPENAI_API_KEY: 'test-key-dajc-ai', DAJC_AI_RUN_BUDGET_USD: '0.2', DAJC_AI_MONTHLY_BUDGET_USD: '2' };
const paid = (tool: string, input: unknown) => answerDrivingBansQuery({ tool, input, subject: subjectA, entitlement: entitlementA, now: NOW, view, ...ON });
const sunday = () => paid('evaluate_vehicle', { jurisdiction: 'AT', at: '2026-10-25T10:00:00.000Z', vehicle: truck });
const cz = () => paid('explain_rule', { ban_id: 'cz-sunday' });

function setup(reply: (input: { user: string; model: string }) => any, env: Record<string, string> = PRODUCT_ENV) {
  const ai = createMockAiFetch({ brain: { extract: ({ user, model }: any) => reply({ user, model }) } });
  return { ai, orchestrator: createExplainOrchestrator({ env, fetchFn: ai.fetchFn as typeof fetch, clock: () => NOW }) };
}
const cite = (answer: any, text = 'The Sunday ban applies to this combination; confirm exceptions with the authority.') => ({ explanation: text, cited_ban_ids: [answer.facts[0].ban_id], cited_source_ids: [answer.sources[0].source_id] });

describe('DAJC AI explanations of verified answers (not mounted, not released)', () => {
  it('uses its own DAJC_AI_* keys and budget, never the research settings, and the approved Luna/Sol policy', () => {
    const env = dajcAiEnvironment({ ...PRODUCT_ENV, DAJC_RESEARCH_GEMINI_API_KEY: 'research-key', DAJC_RESEARCH_RUN_BUDGET_USD: '1.5', DAJC_AI_DRIVING_BANS_ENABLED: 'true' });
    expect(env.DAJC_RESEARCH_OPENAI_API_KEY).toBe('test-key-dajc-ai');
    expect(env.DAJC_RESEARCH_GEMINI_API_KEY).toBeUndefined();
    expect(env.DAJC_RESEARCH_RUN_BUDGET_USD).toBe('0.2');
    expect(env).toMatchObject({ DAJC_RESEARCH_OPENAI_MODEL_EXPLAIN: 'gpt-6-luna', DAJC_RESEARCH_OPENAI_MODEL_EXPLAIN_COMPLEX: 'gpt-6-sol' });
    expect(env.DAJC_RESEARCH_ROUTE_EXPLAIN).toMatch(/^openai,/);
    expect(Object.keys(env).some(name => name.includes('DRIVING_BANS_ENABLED'))).toBe(false);
  });

  it('17/23: sends nothing while the feature is unreleased or the subject is not entitled, and isolates tenants', async () => {
    const { ai, orchestrator } = setup(() => { throw new Error('must not be called'); });
    const answer = cz();
    const ask = (extra: any) => explainVerifiedAnswer({ answer, subject: subjectA, entitlement: entitlementA, now: NOW, orchestrator, ...extra });
    expect(await ask({})).toMatchObject({ explanation_status: 'NOT_EXPLAINED', reason: 'FEATURE_DISABLED' });
    expect(await ask({ ...ON, subject: { organizationId: 'org-b', userId: 'u' } })).toMatchObject({ reason: 'TENANT_MISMATCH' });
    expect(await ask({ ...ON, entitlement: { ...entitlementA, features: ['alerts'] } })).toMatchObject({ reason: 'NOT_ENTITLED' });
    expect(await ask({ ...ON, subject: null })).toMatchObject({ reason: 'AUTHENTICATION_REQUIRED' });
    expect(ai.log).toHaveLength(0);
  });

  it('sends verified registry data only: no organisation, user, vehicle figures or route', async () => {
    const answer = sunday();
    const { ai, orchestrator } = setup(() => cite(answer));
    const result = await explainVerifiedAnswer({ answer, subject: subjectA, entitlement: entitlementA, now: NOW, orchestrator, ...ON });
    expect(result.explanation_status).toBe('EXPLAINED');
    const sent = JSON.stringify(ai.log.map(entry => entry.body));
    for (const secret of ['org-a-7731', 'user-5531', '18350', '39870', 'test-key-dajc-ai']) expect(sent).not.toContain(secret);
    expect(verifiedPayload(answer).facts.every((fact: any) => !('vehicle' in fact) && typeof fact.applies_to_vehicle === 'string')).toBe(true);
    // The deterministic answer is returned as it was: status, outcomes, warnings and disclaimer.
    expect(result.answer).toBe(answer);
    expect(result.answer.status).toBe('INSUFFICIENT_VERIFIED_DATA');
    expect(result.answer.completeness[0].outcome).toBe('BAN_FOUND');
    expect(result.explanation).toMatchObject({ task_class: 'EXPLAIN_VERIFIED_DATA', provider: 'openai' });
    expect(orchestrator.calls().at(-1)).toMatchObject({ module: EXPLAIN_MODULE, task: 'explain', task_class: 'EXPLAIN_VERIFIED_DATA' });
  });

  it('uses GPT-6 Luna for a simple answer and GPT-6 Sol for an uncertain one only when the access policy allows it', async () => {
    const simple = cz();
    expect(simple.status).toBe('OK');
    const uncertain = sunday();
    const { orchestrator } = setup(({ user }) => cite(user.includes('at-sunday') ? uncertain : simple));
    const run = (answer: any, allowStrongerModel = false) => explainVerifiedAnswer({ answer, subject: subjectA, entitlement: entitlementA, now: NOW, orchestrator, allowStrongerModel, ...ON });
    expect((await run(simple, true)).explanation).toMatchObject({ model: 'gpt-6-luna', escalated: false });
    expect((await run(uncertain)).explanation).toMatchObject({ model: 'gpt-6-luna', escalated: false });
    expect((await run(uncertain, true)).explanation).toMatchObject({ model: 'gpt-6-sol', escalated: true });
  });

  it('drops an explanation that cites data the answer does not hold or claims an authorisation, keeping the verified answer', async () => {
    const answer = cz();
    const reply = { value: cite(answer) as any };
    const { orchestrator } = setup(() => reply.value);
    const run = () => explainVerifiedAnswer({ answer, subject: subjectA, entitlement: entitlementA, now: NOW, orchestrator, ...ON });
    reply.value = { ...cite(answer), cited_ban_ids: ['de-sunday'] };
    expect(await run()).toMatchObject({ explanation: null, reason: 'CITED_UNKNOWN_DATA', answer });
    for (const text of ['After 22:00 you may drive through the Czech Republic.', 'Po 22:00 můžete jet bez omezení.', 'The exception applies to your load.']) {
      reply.value = cite(answer, text);
      expect(await run()).toMatchObject({ explanation: null, reason: 'FORBIDDEN_CLAIM' });
    }
    reply.value = { explanation: 42 };
    expect(await run()).toMatchObject({ reason: 'OUTPUT_INVALID' });
  });

  it('10: without a DAJC AI budget nothing is sent and the deterministic answer stands', async () => {
    const { ai, orchestrator } = setup(() => cite(cz()), { DAJC_AI_MODEL_PROFILE: 'bakeoff-2026-10-25', DAJC_AI_OPENAI_API_KEY: 'test-key-dajc-ai' });
    const answer = cz();
    expect(await explainVerifiedAnswer({ answer, subject: subjectA, entitlement: entitlementA, now: NOW, orchestrator, ...ON })).toMatchObject({ reason: 'BUDGET_EXHAUSTED', answer });
    expect(ai.log).toHaveLength(0);
  });

  it('18: the free Ask DAJC AI keeps its own scope and gets no explanation access from this module', async () => {
    const free = answerFreeAskQuery({ tool: 'explain_rule', input: { ban_id: 'cz-sunday' }, view });
    expect(free.status).toBe('OK');
    const { ai, orchestrator } = setup(() => cite(free));
    // Ask has no paid subject or entitlement: the explanation is refused before any call.
    expect(await explainVerifiedAnswer({ answer: free, subject: null, entitlement: null, now: NOW, orchestrator, ...ON })).toMatchObject({ reason: 'AUTHENTICATION_REQUIRED' });
    expect(answerFreeAskQuery({ tool: 'evaluate_vehicle', input: {}, view }).status).toBe('NOT_ENTITLED');
    expect(ai.log).toHaveLength(0);
  });
});
