import { describe, expect, it } from 'vitest';
import { classifyHttpError, createProviders, providerStatus, ERROR_CATEGORIES } from '../../ai/providers.mjs';
import { createOrchestrator, limitsFromEnv, routesFromEnv } from '../../ai/orchestrator.mjs';
import { EXTRACTION_SCHEMA } from './extraction.mjs';
import { createMockAiFetch, testEnv } from '../../../../tests/fixtures/driving-bans-research/mock-ai.mjs';
import { extraction } from '../../../../tests/fixtures/driving-bans-research/cz-scenarios.mjs';

// Error bodies in the shapes the DAJC AI bake-off recorded on 25 October 2026 (messages shortened).
const RECORDED = {
  anthropicCredit: { status: 400, body: { type: 'error', error: { type: 'invalid_request_error', message: 'Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.' }, request_id: 'req_test' } },
  geminiQuota: { status: 429, body: { error: { code: 429, message: 'You exceeded your current quota, please check your plan and billing details.', status: 'RESOURCE_EXHAUSTED', details: [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '7s' }] } } },
  geminiDemand: { status: 503, body: { error: { code: 503, message: 'This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later.', status: 'UNAVAILABLE' } } },
  mistralRate: { status: 429, body: { object: 'error', message: 'Rate limit exceeded', type: 'rate_limited', param: null, code: '1300', raw_status_code: 429 } },
  mistralTier: { status: 403, body: { object: 'error', message: 'This model is not available in your subscription tier', type: 'tier_not_allowed', param: null, code: '1910', raw_status_code: 403 } },
};
const OTHER = {
  openaiModel: { status: 404, body: { error: { message: 'The model `gpt-x` does not exist or you do not have access to it.', type: 'invalid_request_error', param: null, code: 'model_not_found' } } },
  openaiParam: { status: 400, body: { error: { message: "Unsupported parameter: 'temperature' is not supported with this model.", type: 'invalid_request_error', param: 'temperature', code: 'unsupported_parameter' } } },
  openaiQuota: { status: 429, body: { error: { message: 'You exceeded your current quota, please check your plan and billing details.', type: 'insufficient_quota', code: 'insufficient_quota' } } },
  anthropicKey: { status: 401, body: { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } } },
  geminiDaily: { status: 429, body: { error: { code: 429, message: 'Quota exceeded for metric generate_content_free_tier_requests, limit: GenerateRequestsPerDayPerProjectPerModel-FreeTier', status: 'RESOURCE_EXHAUSTED' } } },
};
const NOW = new Date('2026-11-02T08:00:00Z');
const request = { system: 'You are the legal data extraction step.', user: 'FIXTURE-KEY: none', schema: EXTRACTION_SCHEMA, schemaName: 'driving_ban_extraction', maxOutputTokens: 1000 };
const brain = { extract: () => extraction([]) };
const headers = (values: Record<string, string> = {}) => new Headers(values);

function setup({ env = testEnv(), failures = {}, transform }: { env?: Record<string, string>; failures?: any; transform?: any } = {}) {
  const ai = createMockAiFetch({ brain, failures, transform });
  let now = NOW.getTime();
  const sleeps: number[] = [];
  const orchestrator = createOrchestrator({ providers: createProviders({ env, fetchFn: ai.fetchFn }), routes: routesFromEnv(env), limits: limitsFromEnv(env), clock: () => new Date(now), sleep: async (ms: number) => { sleeps.push(ms); now += ms; }, random: () => 0 });
  return { ai, orchestrator, sleeps, sent: (provider: string) => ai.log.filter(entry => entry.provider === provider).length };
}

describe('error classes of the bake-off failures', () => {
  it('classifies every recorded failure without keeping the provider message', () => {
    const cases: Array<[string, { status: number; body: any }, string, Headers?]> = [
      ['anthropic', RECORDED.anthropicCredit, 'CREDIT_OR_BILLING'],
      ['gemini', RECORDED.geminiQuota, 'RATE_LIMIT'],
      ['gemini', RECORDED.geminiDemand, 'OVERLOADED'],
      ['mistral', RECORDED.mistralRate, 'RATE_LIMIT'],
      ['mistral', RECORDED.mistralTier, 'PERMISSION_OR_TIER'],
      ['openai', OTHER.openaiModel, 'MODEL_NOT_FOUND'],
      ['openai', OTHER.openaiParam, 'INVALID_REQUEST'],
      ['openai', OTHER.openaiQuota, 'CREDIT_OR_BILLING'],
      ['anthropic', OTHER.anthropicKey, 'AUTHENTICATION'],
      ['gemini', OTHER.geminiDaily, 'QUOTA_EXHAUSTED'],
    ];
    for (const [provider, recorded, category] of cases) {
      const error = classifyHttpError(provider, recorded.status, recorded.body, headers());
      expect(error.category, `${provider} ${recorded.status}`).toBe(category);
      expect(error.retryable).toBe(ERROR_CATEGORIES[category as keyof typeof ERROR_CATEGORIES].retryable);
      expect(error.message).not.toMatch(/credit balance is too low|exceeded your current quota|subscription tier|high demand|invalid x-api-key|gpt-x|Unsupported parameter|Rate limit exceeded/i);
    }
    expect(classifyHttpError('mistral', 403, RECORDED.mistralTier.body, headers()).code).toBe('tier_not_allowed:1910');
    expect(classifyHttpError('anthropic', 400, RECORDED.anthropicCredit.body, headers()).blockProvider).toBe(true);
    expect(classifyHttpError('gemini', 429, RECORDED.geminiQuota.body, headers()).retryAfterMs).toBe(7000);
    expect(classifyHttpError('mistral', 429, RECORDED.mistralRate.body, headers({ 'retry-after': '12' })).retryAfterMs).toBe(12000);
    expect(classifyHttpError('gemini', 503, RECORDED.geminiDemand.body, headers()).blockProvider).toBe(false);
  });
});

describe('the orchestrator never resends what cannot succeed', () => {
  it('blocks a provider without credit after one request and fails over (bake-off: Anthropic)', async () => {
    const { ai, orchestrator, sent } = setup({ failures: { anthropic: { ...RECORDED.anthropicCredit, remaining: 99 } } });
    expect((await orchestrator.run('extract', request)).provider).toBe('openai');
    expect((await orchestrator.run('extract', request)).provider).toBe('openai');
    expect(sent('anthropic')).toBe(1);
    expect(orchestrator.breakerState().anthropic.blocked).toBe('CREDIT_OR_BILLING');
    const failed = orchestrator.calls().find(call => call.provider === 'anthropic')!;
    expect(failed).toMatchObject({ outcome: 'FAILED', error_category: 'CREDIT_OR_BILLING', http_status: 400, provider_code: 'invalid_request_error', blocked_for_run: 'CREDIT_OR_BILLING' });
    expect(JSON.stringify(orchestrator.calls())).not.toMatch(/credit balance/);
    void ai;
  });

  it('blocks a model outside the subscription tier and an unknown model or parameter (bake-off: Mistral Large)', async () => {
    const env = testEnv({ DAJC_RESEARCH_ROUTE_EXTRACT: 'mistral,openai' });
    const tier = setup({ env, failures: { mistral: { ...RECORDED.mistralTier, remaining: 99 } } });
    expect((await tier.orchestrator.run('extract', request)).provider).toBe('openai');
    await tier.orchestrator.run('extract', request);
    expect(tier.sent('mistral')).toBe(1);
    for (const failure of [OTHER.openaiModel, OTHER.openaiParam]) {
      const run = setup({ env: testEnv({ DAJC_RESEARCH_ROUTE_EXTRACT: 'openai,gemini' }), failures: { openai: { ...failure, remaining: 99 } } });
      expect((await run.orchestrator.run('extract', request)).provider).toBe('gemini');
      await run.orchestrator.run('extract', request);
      expect(run.sent('openai')).toBe(1);
    }
  });

  it('paces a token-rate 429 with the provider retry delay and then succeeds (bake-off: Gemini)', async () => {
    const env = testEnv({ DAJC_RESEARCH_ROUTE_EXTRACT: 'gemini' });
    const { orchestrator, sleeps, sent } = setup({ env, failures: { gemini: { ...RECORDED.geminiQuota, remaining: 1 } } });
    const result = await orchestrator.run('extract', request);
    expect([result.provider, result.attempts, sent('gemini')]).toEqual(['gemini', 2, 2]);
    expect(sleeps).toEqual([7000]);
    expect(orchestrator.calls()[0]).toMatchObject({ outcome: 'OK', waited_ms: 7000 });
  });

  it('retries a 503 high-demand answer with backoff (bake-off: Gemini 3.6 Flash)', async () => {
    const env = testEnv({ DAJC_RESEARCH_ROUTE_EXTRACT: 'gemini' });
    const { orchestrator, sleeps } = setup({ env, failures: { gemini: { ...RECORDED.geminiDemand, remaining: 2 } } });
    expect((await orchestrator.run('extract', request)).attempts).toBe(3);
    expect(sleeps).toEqual([1000, 2000]);
  });

  it('stops a provider whose rate limit persists, and never waits longer than the cap (bake-off: Mistral Small/Medium)', async () => {
    const env = testEnv({ DAJC_RESEARCH_ROUTE_EXTRACT: 'mistral,openai' });
    const persistent = setup({ env, failures: { mistral: { ...RECORDED.mistralRate, headers: { 'retry-after': '2' }, remaining: 99 } } });
    expect((await persistent.orchestrator.run('extract', request)).provider).toBe('openai');
    expect(persistent.sent('mistral')).toBe(3);
    expect(persistent.orchestrator.breakerState().mistral.blocked).toBe('RATE_LIMIT_PERSISTENT');
    await persistent.orchestrator.run('extract', request);
    expect(persistent.sent('mistral')).toBe(3);
    const long = setup({ env, failures: { mistral: { ...RECORDED.mistralRate, headers: { 'retry-after': '600' }, remaining: 99 } } });
    expect((await long.orchestrator.run('extract', request)).provider).toBe('openai');
    expect([long.sent('mistral'), long.sleeps]).toEqual([1, []]);
    expect(long.orchestrator.breakerState().mistral.blocked).toBe('RATE_LIMIT_DEFERRED');
  });

  it('retries timeouts and network errors, then fails over', async () => {
    const { orchestrator, sent } = setup({ failures: { anthropic: { throws: 'TimeoutError', remaining: 2 } } });
    const result = await orchestrator.run('extract', request);
    expect([result.provider, result.attempts, sent('anthropic')]).toEqual(['anthropic', 3, 3]);
    const down = setup({ failures: { anthropic: { throws: 'TypeError', remaining: 99 } } });
    expect((await down.orchestrator.run('extract', request)).provider).toBe('openai');
    expect(down.orchestrator.calls()[0]).toMatchObject({ outcome: 'FAILED', error_category: 'NETWORK' });
  });
});

describe('answers that are not results', () => {
  const truncated: Record<string, (r: any) => any> = {
    anthropic: r => ({ ...r, stop_reason: 'max_tokens' }),
    openai: r => ({ ...r, status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } }),
    gemini: r => ({ ...r, candidates: [{ ...r.candidates[0], finishReason: 'MAX_TOKENS' }] }),
    xai: r => ({ ...r, choices: [{ ...r.choices[0], finish_reason: 'length' }] }),
  };
  it('treats a truncated answer as INCOMPLETE_RESPONSE, without retrying it', async () => {
    for (const [provider, change] of Object.entries(truncated)) {
      const env = testEnv({ DAJC_RESEARCH_ROUTE_EXTRACT: `${provider},mistral` });
      const { orchestrator, sent } = setup({ env, transform: (p: string, r: any) => p === provider ? change(r) : r });
      expect((await orchestrator.run('extract', request)).provider, provider).toBe('mistral');
      expect(sent(provider)).toBe(1);
      expect(orchestrator.calls()[0]).toMatchObject({ provider, outcome: 'FAILED', error_category: 'INCOMPLETE_RESPONSE' });
    }
  });

  it('books the reported usage of a truncated answer: it was billed (live check 2026-10-29: gpt-6-sol)', async () => {
    const env = testEnv({ DAJC_RESEARCH_ROUTE_EXTRACT: 'openai,mistral' });
    const { orchestrator } = setup({ env, transform: (p: string, r: any) => p === 'openai' ? { ...r, status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, usage: { input_tokens: 5_000, output_tokens: 12_000 } } : r });
    const served = await orchestrator.run('extract', request);
    // openai 2 / 8 USD per 1M tokens in the test prices: 5000 * 2 + 12000 * 8 = 0.106 USD.
    expect(orchestrator.calls()[0]).toMatchObject({ provider: 'openai', outcome: 'FAILED', error_category: 'INCOMPLETE_RESPONSE', attempts: 1, input_tokens: 5_000, output_tokens: 12_000, cost_usd: 0.106 });
    expect(orchestrator.spentThisRun()).toBeCloseTo(0.106 + served.cost_usd, 6);
    expect(orchestrator.ledger.spentThisMonth('driving-bans-research')).toBeCloseTo(orchestrator.spentThisRun(), 6);
    const broken = setup({ transform: (p: string, r: any) => p === 'anthropic' ? { ...r, content: [{ type: 'text', text: 'not json' }] } : r });
    await broken.orchestrator.run('extract', request);
    expect(broken.orchestrator.calls()[0]).toMatchObject({ provider: 'anthropic', error_category: 'INVALID_RESPONSE', input_tokens: 1200, output_tokens: 600 });
    expect(broken.orchestrator.calls()[0].cost_usd).toBeGreaterThan(0);
  });

  it('treats invalid JSON and refusals as failures of that provider only', async () => {
    const broken = setup({ transform: (p: string, r: any) => p === 'anthropic' ? { ...r, content: [{ type: 'text', text: 'Sure! Here is the data: {' }] } : r });
    expect((await broken.orchestrator.run('extract', request)).provider).toBe('openai');
    expect(broken.orchestrator.calls()[0]).toMatchObject({ error_category: 'INVALID_RESPONSE' });
    const refused = setup({ transform: (p: string, r: any) => p === 'anthropic' ? { ...r, stop_reason: 'refusal' } : r });
    expect((await refused.orchestrator.run('extract', request)).provider).toBe('openai');
    expect(refused.orchestrator.calls()[0]).toMatchObject({ error_category: 'REFUSAL' });
    expect(refused.orchestrator.breakerState().anthropic.blocked).toBeNull();
  });

  it('records the model the provider actually served (bake-off: 3.5 Flash routed to 3.6)', async () => {
    const env = testEnv({ DAJC_RESEARCH_ROUTE_EXTRACT: 'gemini', DAJC_RESEARCH_GEMINI_MODEL: 'gemini-3.5-flash' });
    const { orchestrator } = setup({ env, transform: (p: string, r: any) => p === 'gemini' ? { ...r, modelVersion: 'gemini-3.6-flash' } : r });
    const result = await orchestrator.run('extract', request);
    expect([result.requested_model, result.model]).toEqual(['gemini-3.5-flash', 'gemini-3.6-flash']);
    expect(orchestrator.calls()[0]).toMatchObject({ requested_model: 'gemini-3.5-flash', model: 'gemini-3.6-flash' });
  });
});

describe('cost-aware model and request settings', () => {
  const pricing = { openai: { input: 0.1, output: 0.5, models: { 'gpt-6-sol': { input: 2, output: 10 } } }, anthropic: { input: 3, output: 15 }, gemini: { input: 0.3, output: 2.5 }, xai: { input: 2, output: 6 }, mistral: { input: 0.15, output: 0.6 }, perplexity: { request: 0.005 } };
  const env = testEnv({ DAJC_RESEARCH_ROUTE_EXTRACT: 'openai', DAJC_RESEARCH_OPENAI_MODEL: 'gpt-6-luna', DAJC_RESEARCH_OPENAI_MODEL_EXTRACT_COMPLEX: 'gpt-6-sol', DAJC_RESEARCH_PRICING_USD: JSON.stringify(pricing) });

  it('uses the cheaper model for ordinary input and the stronger one for complex documents, priced per model', async () => {
    const { ai, orchestrator } = setup({ env });
    const small = await orchestrator.run('extract', request);
    const pdf = await orchestrator.run('extract', { ...request, document: { mediaType: 'application/pdf', base64: Buffer.from('%PDF-1.7').toString('base64') } }, { needsPdf: true });
    const large = await orchestrator.run('extract', { ...request, user: 'x'.repeat(120_000) });
    expect(ai.log.map(entry => entry.body.model)).toEqual(['gpt-6-luna', 'gpt-6-sol', 'gpt-6-sol']);
    expect([small.cost_usd, pdf.cost_usd]).toEqual([(1200 * 0.1 + 600 * 0.5) / 1e6, (1200 * 2 + 600 * 10) / 1e6]);
    expect(orchestrator.calls().map(call => call.complex)).toEqual([false, true, true]);
    void large;
    const unpriced = providerStatus(testEnv({ DAJC_RESEARCH_OPENAI_MODEL_VERIFY: 'gpt-7-unknown', DAJC_RESEARCH_PRICING_USD: JSON.stringify(pricing) })).find(item => item.id === 'openai')!;
    expect(unpriced).toMatchObject({ configured: false, missing: ['DAJC_RESEARCH_PRICING_USD.openai.models.gpt-7-unknown'] });
  });

  it('passes reasoning settings only when configured and rejects invalid values', async () => {
    const tuned = testEnv({ DAJC_RESEARCH_ANTHROPIC_EFFORT: 'low', DAJC_RESEARCH_OPENAI_REASONING_EFFORT: 'none', DAJC_RESEARCH_XAI_REASONING_EFFORT: 'low' });
    const { ai } = setup({ env: tuned });
    const providers = createProviders({ env: tuned, fetchFn: ai.fetchFn });
    for (const id of ['anthropic', 'openai', 'xai', 'gemini']) await providers[id].json(request);
    const body = (id: string) => ai.log.find(entry => entry.provider === id)!.body;
    expect(body('anthropic').output_config).toMatchObject({ effort: 'low', format: { type: 'json_schema' } });
    expect(body('openai').reasoning).toEqual({ effort: 'none' });
    expect(body('xai').reasoning_effort).toBe('low');
    expect(body('gemini').generationConfig).not.toHaveProperty('temperature');
    expect(createProviders({ env: testEnv(), fetchFn: ai.fetchFn }).anthropic).toMatchObject({ configured: true });
    expect(providerStatus(testEnv({ DAJC_RESEARCH_ANTHROPIC_EFFORT: 'extreme' })).find(item => item.id === 'anthropic')).toMatchObject({ configured: false, missing: ['DAJC_RESEARCH_ANTHROPIC_EFFORT (invalid value)'] });
  });

  it('keeps a minimum interval between requests to a rate-limited provider', async () => {
    const paced = testEnv({ DAJC_RESEARCH_ROUTE_EXTRACT: 'gemini', DAJC_RESEARCH_GEMINI_MIN_INTERVAL_MS: '15000' });
    const { orchestrator, sleeps } = setup({ env: paced });
    await orchestrator.run('extract', request);
    await orchestrator.run('extract', request);
    expect(sleeps).toEqual([15000]);
  });
});
