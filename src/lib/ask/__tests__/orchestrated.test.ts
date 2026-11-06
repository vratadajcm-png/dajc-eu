// DAJC AI on the shared orchestrator, with fake HTTP endpoints shaped like the
// real provider APIs (no network, no keys). Covers the failure recorded in the
// live checks of 2026-10-29: Anthropic refusing for credit/billing.

import { beforeEach, describe, expect, it } from 'vitest';
import { readAskConfig } from '../config';
import { CostMeter } from '../cost';
import { askAdapterEnv, orchestratedPricing, orchestratedProviders, orchestratedStatus, resetSharedBlocks } from '../orchestrated';
import { runPipeline } from '../pipeline';
import { aiUnavailable } from '../resilience';
import { FULL_ENV, fixtureView, NOW, supportAll, SUNDAY, testConfig } from './helpers';

const PRICING = { openai: { input: 1, output: 4 }, anthropic: { input: 3, output: 15 }, gemini: { input: 0.5, output: 2 }, xai: { input: 2, output: 10 }, perplexity: { request: 0.005 } };
const ENV: Record<string, string> = {
  DAJC_ASK_AI_ROUTING: 'orchestrator',
  DAJC_ASK_OPENAI_API_KEY: 'ask-openai-test-key', DAJC_ASK_OPENAI_MODEL: 'test-openai-model',
  DAJC_ASK_ANTHROPIC_API_KEY: 'ask-anthropic-test-key', DAJC_ASK_ANTHROPIC_MODEL: 'test-anthropic-model',
  DAJC_ASK_GEMINI_API_KEY: 'ask-gemini-test-key', DAJC_ASK_GEMINI_MODEL: 'test-gemini-model',
  DAJC_ASK_PERPLEXITY_API_KEY: 'ask-perplexity-test-key',
  DAJC_ASK_PROVIDER_PRICING_USD: JSON.stringify(PRICING),
};

type Role = 'classify' | 'draft' | 'verify';
type Behaviour = Partial<Record<'openai' | 'anthropic' | 'gemini' | 'xai' | 'perplexity', (role: Role) => Response | null>>;

function roleOf(schema: any): Role {
  if (schema?.properties?.in_scope) return 'classify';
  if (schema?.properties?.claims) return 'draft';
  return 'verify';
}

function answerFor(role: Role, user: string): unknown {
  if (role === 'classify') {
    return { language: 'en', in_scope: true, case_assessment: false, jurisdictions: ['CZ'], topic: 'driving_ban', dates: [SUNDAY], vehicle: { weight_t: null, width_m: null, height_m: null, length_m: null }, search_terms: [] };
  }
  if (role === 'draft') {
    const id = user.match(/id="(dajc:[^"]+)"/)?.[1] ?? 'missing';
    const quote = (user.split(`id="${id}"`)[1] || '').split('\n').find((line) => line.startsWith('Restriction:'))?.trim() ?? 'missing';
    return { claims: [{ text: 'In Czechia the Sunday and public holiday driving ban applies on that day.', source_id: id, quote }], covers_question: true };
  }
  return supportAll({ user } as never);
}

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

function fakeApis(behaviour: Behaviour = {}) {
  const log: Array<{ provider: string; role: Role | 'search'; key: string | null }> = [];
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body = JSON.parse(String(init?.body ?? '{}'));
    const headers = new Headers(init?.headers);
    const key = headers.get('authorization')?.replace('Bearer ', '') ?? headers.get('x-api-key') ?? headers.get('x-goog-api-key');
    if (url.includes('api.perplexity.ai')) {
      log.push({ provider: 'perplexity', role: 'search', key });
      return behaviour.perplexity?.('verify') ?? ok({ results: [] });
    }
    if (url.includes('api.openai.com')) {
      const role = roleOf(body.text.format.schema);
      log.push({ provider: 'openai', role, key });
      const user = body.input[1].content.find((c: any) => c.type === 'input_text')?.text ?? '';
      return behaviour.openai?.(role) ?? ok({ status: 'completed', model: body.model, usage: { input_tokens: 1000, output_tokens: 200 }, output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(answerFor(role, user)) }] }] });
    }
    if (url.includes('api.anthropic.com')) {
      const role = roleOf(body.output_config.format.schema);
      log.push({ provider: 'anthropic', role, key });
      const user = body.messages[0].content.find((c: any) => c.type === 'text')?.text ?? '';
      return behaviour.anthropic?.(role) ?? ok({ stop_reason: 'end_turn', model: body.model, usage: { input_tokens: 1000, output_tokens: 200 }, content: [{ type: 'text', text: JSON.stringify(answerFor(role, user)) }] });
    }
    if (url.includes('generativelanguage.googleapis.com')) {
      const role = roleOf(body.generationConfig.responseJsonSchema);
      log.push({ provider: 'gemini', role, key });
      const user = body.contents[0].parts.find((p: any) => typeof p.text === 'string')?.text ?? '';
      return behaviour.gemini?.(role) ?? ok({ modelVersion: 'test-gemini-model', usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 200 }, candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(answerFor(role, user)) }] } }] });
    }
    throw new Error(`unexpected URL ${url}`);
  }) as typeof fetch;
  return { fetchFn, log };
}

const creditRefusal = () => new Response(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'Your credit balance is too low to access the API.' } }), { status: 400 });
const overloaded = () => new Response('{}', { status: 503 });

async function ask(env: Record<string, string>, behaviour: Behaviour = {}, budgetUsd = 1) {
  const apis = fakeApis(behaviour);
  const providers = orchestratedProviders({ env, budgetUsd, fetchFn: apis.fetchFn, clock: () => NOW, sleep: async () => undefined });
  const config = { ...testConfig(), routing: 'orchestrator' as const, pricing: orchestratedPricing(env)! };
  const meter = new CostMeter(config);
  const result = await runPipeline(`Is there a driving ban in Czechia on ${SUNDAY}?`, 'en', { config, providers, meter, now: NOW, view: fixtureView(), findings: [] });
  return { result, apis, providers, meter };
}

beforeEach(() => resetSharedBlocks());

describe('DAJC AI on the shared orchestrator', () => {
  it('uses only DAJC_ASK_* keys - never the Driving Bans research keys', () => {
    const adapter = askAdapterEnv({ DAJC_RESEARCH_OPENAI_API_KEY: 'research-key', DAJC_ASK_GEMINI_API_KEY: 'ask-key', DAJC_ASK_OPENAI_ANSWER_MODEL: 'legacy-answer-model' });
    expect(adapter.DAJC_RESEARCH_OPENAI_API_KEY).toBeUndefined();
    expect(adapter.DAJC_RESEARCH_GEMINI_API_KEY).toBe('ask-key');
    expect(adapter.DAJC_RESEARCH_OPENAI_MODEL).toBe('legacy-answer-model');
    const shared = readAskConfig({ ...FULL_ENV, ...ENV, DAJC_RESEARCH_GEMINI_API_KEY: 'ask-gemini-test-key' });
    expect(shared.problems).toContain('DAJC_ASK_GEMINI_API_KEY must be a separate key from DAJC_RESEARCH_GEMINI_API_KEY');
  });

  it('is configured only with two vendors and derives upper-bound role prices', () => {
    const status = orchestratedStatus(ENV);
    expect(status).toMatchObject({ independent: true, search: true });
    expect(status.answerVendors.sort()).toEqual(['Anthropic', 'Google', 'OpenAI']);
    expect(orchestratedPricing(ENV)).toEqual({ classifier: { input: 3, output: 15 }, answer: { input: 3, output: 15 }, verifier: { input: 3, output: 15 }, searchRequest: 0.005 });
    const single = { DAJC_ASK_AI_ROUTING: 'orchestrator', DAJC_ASK_OPENAI_API_KEY: 'k', DAJC_ASK_OPENAI_MODEL: 'test-openai-model', DAJC_ASK_PROVIDER_PRICING_USD: JSON.stringify(PRICING) };
    expect(orchestratedStatus(single).independent).toBe(false);
    const config = readAskConfig({ ...FULL_ENV, ...single, DAJC_ASK_OPENAI_API_KEY: 'separate-openai-key' });
    expect(config.ok).toBe(false);
    expect(config.problems.join(' ')).toMatch(/at least two vendors/);
    expect(readAskConfig({ ...FULL_ENV, ...ENV }).config?.routing).toBe('orchestrator');
  });

  it('stays off in production and without a daily budget; preview and local runs are allowed', () => {
    expect(readAskConfig({ ...FULL_ENV, ...ENV, VERCEL_ENV: 'preview' }).config?.routing).toBe('orchestrator');
    const production = readAskConfig({ ...FULL_ENV, ...ENV, VERCEL_ENV: 'production' });
    expect(production.ok).toBe(false);
    expect(production.problems).toContain('DAJC_ASK_AI_ROUTING=orchestrator is not released for production (preview or local runs only)');
    // The direct routing is unaffected by this gate.
    expect(readAskConfig({ ...FULL_ENV, VERCEL_ENV: 'production' }).config?.routing).toBe('direct');
    const noDaily = readAskConfig({ ...FULL_ENV, ...ENV, DAJC_ASK_DAILY_BUDGET_EUR: '' });
    expect(noDaily.problems).toContain('DAJC_ASK_DAILY_BUDGET_EUR is missing');
  });

  it('answers with an independent check at another vendor', async () => {
    const { result, providers } = await ask(ENV);
    expect(result.answer.level).toBe('VERIFIED');
    const calls = providers.calls().filter((c) => c.outcome === 'OK');
    const answer = calls.find((c) => c.task === 'ask_answer')!;
    const verify = calls.find((c) => c.task === 'ask_verify')!;
    expect(answer.vendor).not.toBe(verify.vendor);
    expect(calls.every((c) => c.module === 'ask-dajc-ai')).toBe(true);
    // The audit never contains the question or a key.
    expect(JSON.stringify(providers.calls())).not.toMatch(/driving ban in Czechia|test-key/);
  });

  it('keeps working when Anthropic refuses for credit (as recorded on 2026-10-29) and remembers the block', async () => {
    const { result, apis, providers } = await ask(ENV, { anthropic: () => creditRefusal() });
    expect(result.answer.level).toBe('VERIFIED');
    const verify = providers.calls().find((c) => c.task === 'ask_verify' && c.outcome === 'OK')!;
    expect(verify.provider).toBe('gemini');
    expect(providers.calls().find((c) => c.provider === 'anthropic')).toMatchObject({ outcome: 'FAILED', error_category: 'CREDIT_OR_BILLING' });
    expect(apis.log.filter((l) => l.provider === 'anthropic')).toHaveLength(1);
    // The next question does not even try Anthropic.
    const next = await ask(ENV, { anthropic: () => creditRefusal() });
    expect(next.apis.log.some((l) => l.provider === 'anthropic')).toBe(false);
    expect(next.result.answer.level).toBe('VERIFIED');
  });

  it('fails over the answer when OpenAI is overloaded and still checks at a different vendor', async () => {
    const { result, providers } = await ask(ENV, { openai: (role) => (role === 'classify' ? null : overloaded()) });
    expect(result.answer.level).toBe('VERIFIED');
    const answer = providers.calls().find((c) => c.task === 'ask_answer' && c.outcome === 'OK')!;
    const verify = providers.calls().find((c) => c.task === 'ask_verify' && c.outcome === 'OK')!;
    expect(answer.vendor).not.toBe('OpenAI');
    expect(verify.vendor).not.toBe(answer.vendor);
  });

  it('fails closed when no second vendor is left for the independent check', async () => {
    const env = { ...ENV, DAJC_ASK_GEMINI_API_KEY: '' };
    await expect(ask(env, { anthropic: () => creditRefusal() })).rejects.toThrow(/No provider available for ask_verify/);
    expect(aiUnavailable(orchestratedProviders({ env, budgetUsd: 1, clock: () => NOW }))).toBe(true);
  });

  it('stops at the question budget before calling any provider', async () => {
    const apis = fakeApis();
    const providers = orchestratedProviders({ env: ENV, budgetUsd: 0.000001, fetchFn: apis.fetchFn, clock: () => NOW });
    await expect(providers.openaiJson({ model: 'x', system: 's', user: 'u', schemaName: 'dajc_question', schema: { properties: { in_scope: {} } }, maxOutputTokens: 100 })).rejects.toThrow(/Budget exhausted/);
    expect(apis.log).toEqual([]);
  });

  it('books the cost of the model actually used', async () => {
    const { meter } = await ask(ENV);
    // classify + answer at OpenAI (1000 in / 200 out at 1/4 USD per M) = 0.0018 USD each,
    // the check at Anthropic (3/15) = 0.006 USD, converted at 0.92 EUR/USD. No web search:
    // the verified registry already decides Czechia, so no search request is paid.
    const models = meter.calls.filter((c) => c.role !== 'search').map((c) => c.micro);
    expect(models).toEqual([1656, 1656, 5520]);
    expect(meter.calls.every((c) => !c.estimated)).toBe(true);
    expect(meter.total).toBe(1656 + 1656 + 5520);
  });

  it('sends consented personal context only as customer-consented data and a document only to PDF-capable models', async () => {
    const apis = fakeApis();
    const providers = orchestratedProviders({ env: ENV, budgetUsd: 1, fetchFn: apis.fetchFn, clock: () => NOW, personalData: true });
    await providers.openaiJson({ model: 'x', system: 's', user: 'u', schemaName: 'dajc_question', schema: { properties: { in_scope: {} } }, maxOutputTokens: 100 });
    expect(providers.calls()[0]).toMatchObject({ task: 'ask_classify', outcome: 'OK' });
    const pdf = await providers.openaiJson({ model: 'x', system: 's', user: 'u', schemaName: 'dajc_permit', schema: { properties: { in_scope: {} } }, maxOutputTokens: 100, file: { filename: 'p.pdf', base64: 'JVBERi0=' } });
    expect(pdf.provider).toBe('openai');
    expect(providers.calls().at(-1)).toMatchObject({ task: 'ask_document', outcome: 'OK' });
  });
});

describe('service wiring', () => {
  it('builds per-question providers limited to the question\'s reserved budget', async () => {
    const { askQuestion, worstCaseQuestionMicro } = await import('../service');
    const { MemoryAskStore } = await import('../store/memory');
    const store = new MemoryAskStore();
    const userId = await store.upsertUser('hmac-orchestrated', NOW);
    const config = { ...testConfig(), routing: 'orchestrator' as const, pricing: orchestratedPricing(ENV)! };
    const apis = fakeApis({ anthropic: () => creditRefusal() });
    const budgets: number[] = [];
    const outcome = await askQuestion(userId, `Is there a driving ban in Czechia on ${SUNDAY}?`, 'en', {
      config, store, providers: null as never, now: () => NOW, pipeline: { view: fixtureView(), findings: [] },
      providerFactory: ({ budgetMicro }) => {
        budgets.push(budgetMicro);
        return orchestratedProviders({ env: ENV, budgetUsd: budgetMicro / 1e6 / config.usdToEur, fetchFn: apis.fetchFn, clock: () => NOW });
      },
    });
    expect(outcome).toMatchObject({ status: 'answered', answer: { level: 'VERIFIED' } });
    expect(budgets).toEqual([worstCaseQuestionMicro(config)]);
  });
});

describe('boundary between DAJC AI and Driving Bans research (negative tests)', () => {
  it('only src/lib/ask/orchestrated.ts reaches lib/ai, and only the orchestrator core and adapters', async () => {
    const { readdirSync, readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const root = new URL('../', import.meta.url).pathname;
    const files = (function walk(dir: string): string[] {
      return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (e.name === '__tests__' ? [] : walk(join(dir, e.name))) : /\.(ts|mjs)$/.test(e.name) ? [join(dir, e.name)] : []));
    })(root);
    const importsAi = files.filter((f) => /from\s+['"][^'"]*(?:lib\/ai\/|\.\.\/ai\/)/.test(readFileSync(f, 'utf8')));
    expect(importsAi.map((f) => f.slice(root.length))).toEqual(['orchestrated.ts']);
    const code = readFileSync(join(root, 'orchestrated.ts'), 'utf8');
    expect([...code.matchAll(/from\s+['"](\.\.\/ai\/[^'"]+)['"]/g)].map((m) => m[1]).sort()).toEqual(['../ai/orchestrator.mjs', '../ai/providers.mjs']);
    expect(code).not.toMatch(/process\.env|driving-bans\/research|model-profile|\benv\s*(?:\.|\[\s*[`'"])DAJC_RESEARCH/);
    for (const file of files) expect(readFileSync(file, 'utf8'), file).not.toMatch(/driving-bans\/research\//);
  });

  it('the research orchestrator refuses DAJC AI tasks and user questions; DAJC AI refuses research tasks and unconsented customer data', async () => {
    const { createOrchestrator, ASK_POLICY } = await import('../../ai/orchestrator.mjs');
    const limits = { runBudgetUsd: 1, monthlyBudgetUsd: 1, maxRequestsPerRun: 5, maxInputTokensPerCall: 10_000, complexInputTokens: 1e9, maxRetryWaitMs: 0, minIntervalMs: {}, preferLowerCost: false, testedLanguages: null };
    const research = (createOrchestrator as any)({ providers: {}, limits });
    await expect(research.run('ask_answer', { system: 's', user: 'u' })).rejects.toThrow(/Unknown research task/);
    await expect(research.run('extract', { system: 's', user: 'u' }, { dataClass: 'user-question' })).rejects.toThrow(/Unknown data class/);
    let called = 0;
    const openai = { id: 'openai', configured: true, json: async () => { called += 1; throw new Error('must not be called'); } };
    const ask = (createOrchestrator as any)({ providers: { openai }, limits, policy: ASK_POLICY, routes: { ask_answer: ['openai'], ask_document: ['openai'] } });
    await expect(ask.run('extract', { system: 's', user: 'u' })).rejects.toThrow(/Unknown DAJC AI task/);
    await expect(ask.run('ask_answer', { system: 's', user: 'u' }, { dataClass: 'customer' })).rejects.toThrow(/Unknown data class/);
    await expect(ask.run('ask_answer', { system: 's', user: 'u' }, { dataClass: 'verified-registry' })).rejects.toThrow(/Unknown data class/);
    await expect(ask.run('ask_document', { system: 's', user: 'u' }, { dataClass: 'user-question' })).rejects.toThrow(/openai: data class user-question not allowed for DAJC AI answers/);
    expect(called).toBe(0);
  });

  it('keeps the check independent even when the answer vendor is first on the verify route', async () => {
    const env = { ...ENV, DAJC_ASK_ROUTE_ASK_VERIFY: 'openai,gemini' };
    const { result, providers } = await ask(env);
    expect(result.answer.level).toBe('VERIFIED');
    const answer = providers.calls().find((c) => c.task === 'ask_answer' && c.outcome === 'OK')!;
    const verify = providers.calls().find((c) => c.task === 'ask_verify' && c.outcome === 'OK')!;
    expect([answer.provider, verify.provider]).toEqual(['openai', 'gemini']);
  });

  it('sends providers neither e-mail addresses nor phone numbers from the question, and uses Ask keys only', async () => {
    const bodies: string[] = [];
    const apis = fakeApis();
    const recording = (async (input: RequestInfo | URL, init?: RequestInit) => {
      bodies.push(String(init?.body ?? ''));
      return apis.fetchFn(input, init);
    }) as typeof fetch;
    const providers = orchestratedProviders({ env: { ...ENV, DAJC_RESEARCH_OPENAI_API_KEY: 'research-only-key' }, budgetUsd: 1, fetchFn: recording, clock: () => NOW });
    const config = { ...testConfig(), routing: 'orchestrator' as const, pricing: orchestratedPricing(ENV)! };
    await runPipeline(`Driving ban in Czechia on ${SUNDAY}? Reply to jan.novak@firma.cz or +420 777 123 456`, 'en', { config, providers, meter: new CostMeter(config), now: NOW, view: fixtureView(), findings: [] });
    expect(bodies.length).toBeGreaterThan(0);
    expect(bodies.join(' ')).not.toMatch(/jan\.novak|firma\.cz|777 123 456/);
    expect(apis.log.every((l) => l.key?.startsWith('ask-'))).toBe(true);
  });
});
