import { describe, expect, it } from 'vitest';
import { applyModelProfile, candidateEvidence, rankModels, recommendModels, MODEL_PROFILE, BENCHMARK_EVIDENCE } from '../../ai/model-profile.mjs';
import { providerStatus } from '../../ai/providers.mjs';
import { createProviders } from '../../ai/providers.mjs';
import { createOrchestrator, limitsFromEnv, routesFromEnv } from '../../ai/orchestrator.mjs';
import { researchReadiness } from './config.mjs';
import { EXTRACTION_SCHEMA } from './extraction.mjs';
import { createMockAiFetch } from '../../../../tests/fixtures/driving-bans-research/mock-ai.mjs';
import { extraction } from '../../../../tests/fixtures/driving-bans-research/cz-scenarios.mjs';

const KEYS = { DAJC_RESEARCH_OPENAI_API_KEY: 'test-key-openai', DAJC_RESEARCH_GEMINI_API_KEY: 'test-key-gemini', DAJC_RESEARCH_PERPLEXITY_API_KEY: 'test-key-perplexity' };
const PROFILE = { DAJC_RESEARCH_MODEL_PROFILE: MODEL_PROFILE.profile_id };

describe('benchmark evidence', () => {
  it('is the consolidated bake-off without double counting, with API failures kept apart from quality', () => {
    expect(BENCHMARK_EVIDENCE.models).toHaveLength(11);
    for (const model of BENCHMARK_EVIDENCE.models) {
      const classes = Object.values(model.consolidated.classes as Record<string, number>).reduce((a, b) => a + b, 0);
      expect(classes, model.model).toBe(26);
      expect(model.original_run.cases).toBe(26);
    }
    const sonnet = BENCHMARK_EVIDENCE.models.find((m: any) => m.model === 'claude-sonnet-5-5')!;
    expect(sonnet.consolidated).toMatchObject({ completed_answers: 0, correct_rate_of_completed: null });
    expect(sonnet.consolidated.classes).toEqual({ API_CREDIT_OR_BILLING: 1, NOT_SENT_PROVIDER_BLOCKED: 25 });
    expect(JSON.stringify(BENCHMARK_EVIDENCE)).not.toMatch(/"answer"|credit balance is too low|api[_-]?key/i);
  });

  it('never ranks a model that only produced API errors as zero quality', () => {
    const evidence = candidateEvidence();
    for (const id of ['claude-sonnet-5-5', 'claude-haiku-5-5', 'mistral-small-2603', 'mistral-medium-3-5', 'mistral-large-2512']) {
      expect(evidence.find(item => item.model === id)).toMatchObject({ status: 'NOT_BENCHMARKED' });
    }
    const ranked = rankModels('extract');
    expect(ranked.filter(item => item.score !== null).map(item => item.model).sort()).toEqual(['gemini-3.5-flash', 'gemini-3.5-flash-lite', 'gpt-5.4-mini', 'gpt-6-luna', 'gpt-6-sol', 'grok-4.7']);
    expect(ranked.filter(item => item.score === null).every(item => item.reason)).toBe(true);
    expect(rankModels('explain')[0].evidence_level).toBe('BENCHMARK_DIRECT');
    expect(rankModels('extract')[0].evidence_level).toBe('BENCHMARK_INDIRECT');
  });

  it('recommends a cheap paced model for ordinary documents, the strongest reliable one for complex documents, and another vendor for the check', () => {
    const recommendation = recommendModels();
    expect(recommendation.extract).toMatchObject({ model: 'gemini-3.5-flash-lite', min_interval_ms: 15000 });
    expect(recommendation.extract_complex).toMatchObject({ model: 'gpt-6-sol', vendor: 'OpenAI' });
    expect(recommendation.verify.vendor).not.toBe(recommendation.extract.vendor);
    expect(recommendation.status).toBe('provisional');
    expect(recommendation.caution).toMatch(/not extraction from legal documents/);
  });
});

describe('opt-in model profile', () => {
  it('changes nothing unless selected, and never adds a key', () => {
    const env = { ...KEYS };
    expect(applyModelProfile(env)).toBe(env);
    const applied = applyModelProfile({ ...PROFILE });
    expect(Object.keys(applied).filter(name => name.endsWith('_API_KEY'))).toEqual([]);
    expect(applied.DAJC_RESEARCH_OPENAI_MODEL).toBeUndefined();
  });

  it('fills models, per-model prices, intervals and routes only for providers with a key', () => {
    const env = applyModelProfile({ ...PROFILE, ...KEYS });
    expect(env).toMatchObject({
      DAJC_RESEARCH_GEMINI_MODEL: 'gemini-3.5-flash-lite', DAJC_RESEARCH_GEMINI_MIN_INTERVAL_MS: '15000',
      DAJC_RESEARCH_OPENAI_MODEL: 'gpt-6-sol', DAJC_RESEARCH_OPENAI_MODEL_VERIFY: 'gpt-6-luna',
      DAJC_RESEARCH_ROUTE_EXTRACT_COMPLEX: expect.stringMatching(/^openai,/),
      // The reasoning setting the bake-off measured, so the ranking holds for what is called.
      DAJC_RESEARCH_OPENAI_REASONING_EFFORT: 'none',
    });
    expect(env.DAJC_RESEARCH_XAI_MODEL).toBeUndefined();
    expect(env.DAJC_RESEARCH_XAI_REASONING_EFFORT).toBeUndefined();
    expect(applyModelProfile({ ...PROFILE, ...KEYS, DAJC_RESEARCH_OPENAI_REASONING_EFFORT: 'low' }).DAJC_RESEARCH_OPENAI_REASONING_EFFORT).toBe('low');
    expect(env.DAJC_RESEARCH_ANTHROPIC_MODEL).toBeUndefined();
    const status = providerStatus(env);
    expect(status.filter(item => item.configured).map(item => item.id).sort()).toEqual(['gemini', 'openai', 'perplexity']);
  });

  it('lets every explicit setting win over the profile', () => {
    const env = applyModelProfile({ ...PROFILE, ...KEYS, DAJC_RESEARCH_OPENAI_MODEL: 'gpt-6-luna', DAJC_RESEARCH_ROUTE_EXTRACT: 'openai', DAJC_RESEARCH_GEMINI_MIN_INTERVAL_MS: '5000', DAJC_RESEARCH_PRICING_USD: JSON.stringify({ openai: { input: 0.1, output: 0.5 } }) });
    expect(env).toMatchObject({ DAJC_RESEARCH_OPENAI_MODEL: 'gpt-6-luna', DAJC_RESEARCH_ROUTE_EXTRACT: 'openai', DAJC_RESEARCH_GEMINI_MIN_INTERVAL_MS: '5000' });
    expect(JSON.parse(env.DAJC_RESEARCH_PRICING_USD).openai).toMatchObject({ input: 0.1, output: 0.5 });
  });

  it('drives the orchestrator: ordinary and complex documents at different models, the check at another vendor', async () => {
    const env = applyModelProfile({ ...PROFILE, ...KEYS, DAJC_DRIVING_BANS_RESEARCH_ENABLED: 'true', DAJC_RESEARCH_RUN_BUDGET_USD: '2', DAJC_RESEARCH_MONTHLY_BUDGET_USD: '5' });
    const ai = createMockAiFetch({ brain: { extract: () => extraction([]) } });
    let now = Date.parse('2026-11-02T08:00:00Z');
    const orchestrator = createOrchestrator({ providers: createProviders({ env, fetchFn: ai.fetchFn }), routes: routesFromEnv(env), limits: limitsFromEnv(env), clock: () => new Date(now), sleep: async (ms: number) => { now += ms; } });
    const request = { system: 'You are the legal data extraction step.', user: 'FIXTURE-KEY: none', schema: EXTRACTION_SCHEMA, schemaName: 'driving_ban_extraction', maxOutputTokens: 1000 };
    const ordinary = await orchestrator.run('extract', request);
    const complex = await orchestrator.run('extract', { ...request, document: { mediaType: 'application/pdf', base64: Buffer.from('%PDF-1.7').toString('base64') } }, { needsPdf: true });
    const check = await orchestrator.run('verify', request, { excludeVendors: [ordinary.vendor] });
    expect([ordinary.provider, ordinary.requested_model]).toEqual(['gemini', 'gemini-3.5-flash-lite']);
    expect([complex.provider, complex.requested_model]).toEqual(['openai', 'gpt-6-sol']);
    expect([check.provider, check.requested_model]).toEqual(['openai', 'gpt-6-luna']);
    // Criterion 6: a document in a language without live-tested extraction (or of unknown language) takes the complex route.
    expect(env.DAJC_RESEARCH_TESTED_LANGUAGES).toBe('cs,de');
    const german = await orchestrator.run('extract', request, { language: 'de' });
    const french = await orchestrator.run('extract', request, { language: 'fr' });
    const unknown = await orchestrator.run('extract', request, { language: null });
    expect([german.requested_model, german.task_class]).toEqual(['gemini-3.5-flash-lite', 'EXTRACT_STANDARD']);
    expect([french.requested_model, french.task_class, french.complex_reasons]).toEqual(['gpt-6-sol', 'EXTRACT_COMPLEX', ['UNTESTED_LANGUAGE']]);
    expect(unknown.complex_reasons).toEqual(['UNTESTED_LANGUAGE']);
    expect(orchestrator.calls().find((call: any) => call.language === 'fr')).toMatchObject({ task_class: 'EXTRACT_COMPLEX', complex_reasons: ['UNTESTED_LANGUAGE'], provider: 'openai' });
    expect(researchReadiness({ ...PROFILE, ...KEYS, DAJC_DRIVING_BANS_RESEARCH_ENABLED: 'true', DAJC_RESEARCH_RUN_BUDGET_USD: '2', DAJC_RESEARCH_MONTHLY_BUDGET_USD: '5' })).toMatchObject({ enabled: true, model_profile: { selected: 'bakeoff-2026-10-25' } });
  });
});
