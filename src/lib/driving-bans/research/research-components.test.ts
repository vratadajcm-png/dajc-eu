import { describe, expect, it } from 'vitest';
import { createProvider, createProviders, parsePricing, providerStatus, PROVIDER_IDS } from '../../ai/providers.mjs';
import { createLedger, createOrchestrator, DEFAULT_ROUTES, limitsFromEnv, routesFromEnv, BudgetExceededError, NoProviderError } from '../../ai/orchestrator.mjs';
import { checkUrl, hostAllowed, isPublicAddress, safeFetch } from './safe-fetch.mjs';
import { htmlToText, scanForInstructions, wrapUntrusted, documentText } from './documents.mjs';
import { checkExtractedRule, numbersIn, timeInQuote, draftRuleOf, EXTRACTION_SCHEMA } from './extraction.mjs';
import { researchReadiness } from './config.mjs';
import { createMockAiFetch, testEnv, supportAll } from '../../../../tests/fixtures/driving-bans-research/mock-ai.mjs';
import { DOCUMENTS, extractedRule, extraction } from '../../../../tests/fixtures/driving-bans-research/cz-scenarios.mjs';

const NOW = new Date('2026-11-02T08:00:00Z');
const WINDOW = { from: '2026-11-01', to: '2026-12-31' };
const request = { system: 'You are the legal data extraction step.', user: 'FIXTURE-KEY: none', schema: EXTRACTION_SCHEMA, schemaName: 'driving_ban_extraction', maxOutputTokens: 1000 };
const orchestratorFor = (env: Record<string, string>, ai: ReturnType<typeof createMockAiFetch>, extra: any = {}) => createOrchestrator({ providers: createProviders({ env, fetchFn: ai.fetchFn }), routes: routesFromEnv(env), limits: limitsFromEnv(env), clock: () => NOW, sleep: async () => {}, ...extra });
const emptyBrain = { extract: () => extraction([]) };

describe('provider adapters (recorded-shape fixtures; no live API call)', () => {
  it('reports configuration by setting names only and keeps every provider off without key, model and price', () => {
    const off = providerStatus({});
    expect(off.map(item => item.id)).toEqual(['anthropic', 'openai', 'xai', 'gemini', 'mistral', 'perplexity']);
    expect(off.every(item => !item.configured)).toBe(true);
    expect(off.find(item => item.id === 'mistral')).toMatchObject({ region: 'EU', missing: ['DAJC_RESEARCH_MISTRAL_API_KEY', 'DAJC_RESEARCH_MISTRAL_MODEL', 'DAJC_RESEARCH_PRICING_USD.mistral'] });
    const on = providerStatus(testEnv());
    expect(on.every(item => item.configured)).toBe(true);
    expect(JSON.stringify(on)).not.toMatch(/test-key|test-claude/);
    // No default model or price is ever assumed.
    expect(providerStatus(testEnv({ DAJC_RESEARCH_OPENAI_MODEL: '' })).find(item => item.id === 'openai')?.configured).toBe(false);
    expect(parsePricing('{"openai":{"input":-1,"output":2},"perplexity":{"request":0.01}}')).toEqual({ perplexity: { request: 0.01 } });
    expect(parsePricing('not json')).toEqual({});
  });

  it('sends each vendor its own documented request format', async () => {
    const ai = createMockAiFetch({ brain: emptyBrain });
    const providers = createProviders({ env: testEnv(), fetchFn: ai.fetchFn });
    for (const id of ['anthropic', 'openai', 'xai', 'gemini', 'mistral']) {
      const result = await providers[id].json(request);
      expect(result.json).toEqual(extraction([]));
    }
    await providers.perplexity.search({ queries: ['CZ truck ban'], domains: ['gov.cz'], maxResults: 5 });
    const byProvider = Object.fromEntries(ai.log.map(entry => [entry.provider, entry]));
    expect(byProvider.anthropic.url).toBe('https://api.anthropic.com/v1/messages');
    expect(byProvider.anthropic.headers['x-api-key']).toBe('test-key-anthropic');
    expect(byProvider.anthropic.body.output_config.format.type).toBe('json_schema');
    expect(byProvider.openai.url).toBe('https://api.openai.com/v1/responses');
    expect(byProvider.openai.body).toMatchObject({ store: false, text: { format: { type: 'json_schema', strict: true } } });
    expect(byProvider.xai.url).toBe('https://api.x.ai/v1/chat/completions');
    expect(byProvider.mistral.url).toBe('https://api.mistral.ai/v1/chat/completions');
    expect(byProvider.mistral.body.response_format.type).toBe('json_schema');
    expect(byProvider.gemini.url).toMatch(/^https:\/\/generativelanguage\.googleapis\.com\/v1beta\/models\/test-gemini:generateContent$/);
    expect(byProvider.gemini.headers['x-goog-api-key']).toBe('test-key-gemini');
    expect(byProvider.gemini.body.generationConfig).toMatchObject({ responseMimeType: 'application/json' });
    expect(byProvider.perplexity.body).toMatchObject({ query: ['CZ truck ban'], search_domain_filter: ['gov.cz'] });
  });

  it('passes PDFs natively only to providers that read them', async () => {
    const ai = createMockAiFetch({ brain: emptyBrain });
    const providers = createProviders({ env: testEnv(), fetchFn: ai.fetchFn });
    const document = { mediaType: 'application/pdf', base64: Buffer.from('%PDF-1.7 test').toString('base64') };
    await providers.anthropic.json({ ...request, document });
    await providers.openai.json({ ...request, document });
    await providers.gemini.json({ ...request, document });
    expect(ai.log.map(entry => entry.pdf)).toEqual([true, true, true]);
    await expect(providers.mistral.json({ ...request, document })).rejects.toThrow(/cannot read PDF/);
    await expect(providers.xai.json({ ...request, document })).rejects.toThrow(/cannot read PDF/);
  });

  it('never echoes a response body or key in errors and classifies retryable failures', async () => {
    const ai = createMockAiFetch({ brain: emptyBrain, failures: { openai: { status: 401, remaining: 1 }, anthropic: { status: 503, remaining: 1 } } });
    const providers = createProviders({ env: testEnv(), fetchFn: ai.fetchFn });
    const unauthorised = await providers.openai.json(request).catch(error => error);
    expect([unauthorised.message, unauthorised.retryable]).toEqual(['openai: HTTP 401', false]);
    const overloaded = await providers.anthropic.json(request).catch(error => error);
    expect([overloaded.message, overloaded.retryable]).toEqual(['anthropic: HTTP 503', true]);
    expect(`${unauthorised.message} ${overloaded.message}`).not.toMatch(/prompt|test-key/);
    const off = createProvider('xai', { env: {}, fetchFn: ai.fetchFn });
    const calls = ai.log.length;
    await expect(off.json(request)).rejects.toThrow(/not configured/);
    expect(ai.log.length).toBe(calls);
  });
});

describe('orchestrator', () => {
  it('routes by task, keeps the independent check at another vendor and refuses customer data', async () => {
    const ai = createMockAiFetch({ brain: emptyBrain });
    const orchestrator = orchestratorFor(testEnv(), ai);
    expect(routesFromEnv({})).toEqual(DEFAULT_ROUTES);
    expect((await orchestrator.run('extract', request)).provider).toBe('anthropic');
    expect((await orchestrator.run('verify', request, { excludeVendors: ['OpenAI'] })).provider).toBe('gemini');
    expect((await orchestrator.run('extract', request, { excludeVendors: ['Anthropic'] })).provider).toBe('openai');
    const before = ai.log.length;
    await expect(orchestrator.run('extract', request, { dataClass: 'customer' })).rejects.toBeInstanceOf(NoProviderError);
    expect(ai.log.length).toBe(before);
    const routed = orchestratorFor(testEnv({ DAJC_RESEARCH_ROUTE_EXTRACT: 'mistral,unknown,openai' }), ai);
    expect((await routed.run('extract', request)).provider).toBe('mistral');
    const cheap = orchestratorFor(testEnv({ DAJC_RESEARCH_PREFER_LOWER_COST: 'true' }), ai);
    expect((await cheap.run('extract', request)).provider).toBe('mistral');
  });

  it('16: retries with backoff, opens the circuit and fails over when a provider is down', async () => {
    const ai = createMockAiFetch({ brain: emptyBrain, failures: { anthropic: { status: 503, remaining: 99 } } });
    const sleeps: number[] = [];
    const orchestrator = orchestratorFor(testEnv(), ai, { sleep: async (ms: number) => { sleeps.push(ms); }, random: () => 0, breakerThreshold: 2 });
    const first = await orchestrator.run('extract', request);
    expect(first.provider).toBe('openai');
    expect(ai.log.filter(entry => entry.provider === 'anthropic').length).toBe(3);
    expect(sleeps).toEqual([1000, 2000]);
    await orchestrator.run('extract', request);
    expect(orchestrator.breakerState().anthropic.open).toBe(true);
    const anthropicCalls = ai.log.filter(entry => entry.provider === 'anthropic').length;
    await orchestrator.run('extract', request);
    expect(ai.log.filter(entry => entry.provider === 'anthropic').length).toBe(anthropicCalls);
    expect(orchestrator.calls().filter(call => call.provider === 'anthropic').every(call => call.outcome === 'FAILED')).toBe(true);
  });

  it('17: stops at the budget instead of guessing, and books cost per module and provider', async () => {
    const ai = createMockAiFetch({ brain: emptyBrain });
    const tight = orchestratorFor(testEnv({ DAJC_RESEARCH_RUN_BUDGET_USD: '0.0001' }), ai);
    await expect(tight.run('extract', request)).rejects.toBeInstanceOf(BudgetExceededError);
    expect(ai.log.length).toBe(0);
    const ledger = createLedger({ clock: () => NOW });
    const orchestrator = orchestratorFor(testEnv({ DAJC_RESEARCH_MAX_REQUESTS_PER_RUN: '2' }), ai, { ledger });
    const result = await orchestrator.run('extract', request);
    expect(result.cost_usd).toBeCloseTo((1200 * 3 + 600 * 15) / 1e6, 8);
    await orchestrator.run('discover', { queries: ['x'], domains: [], maxResults: 1 });
    await expect(orchestrator.run('extract', request)).rejects.toThrow(/Request limit/);
    expect(ledger.snapshot()['2026-11']['driving-bans-research'].by_provider).toMatchObject({ anthropic: { requests: 1, input_tokens: 1200, output_tokens: 600 }, perplexity: { usd: 0.005 } });
    const audit = JSON.stringify(orchestrator.calls());
    expect(audit).not.toMatch(/test-key|legal data extraction step/);
    expect(orchestrator.calls()[0]).toMatchObject({ module: 'driving-bans-research', provider: 'anthropic', model: 'test-claude', outcome: 'OK', input_tokens: 1200 });
  });

  it('keeps research off by default and explains why', () => {
    const off = researchReadiness({});
    expect(off.enabled).toBe(false);
    expect(off.blockers).toEqual(expect.arrayContaining(['DAJC_DRIVING_BANS_RESEARCH_ENABLED is not "true"', 'DAJC_RESEARCH_RUN_BUDGET_USD is not set', 'No configured provider for extraction']));
    expect(researchReadiness(testEnv()).enabled).toBe(true);
    const single = testEnv({ DAJC_RESEARCH_OPENAI_API_KEY: '', DAJC_RESEARCH_GEMINI_API_KEY: '', DAJC_RESEARCH_MISTRAL_API_KEY: '', DAJC_RESEARCH_XAI_API_KEY: '' });
    expect(researchReadiness(single).blockers.join(' ')).toMatch(/independent check needs a configured vendor other than Anthropic/);
    expect(JSON.stringify(researchReadiness(testEnv()))).not.toMatch(/test-key/);
    expect(PROVIDER_IDS).toHaveLength(6);
  });
});

describe('safe retrieval (SSRF, size, type)', () => {
  const allowed = ['gov.cz', 'zakonyprolidi.cz'];
  const page = (body: string, type = 'text/html; charset=utf-8', status = 200, headers: Record<string, string> = {}) => ({ status, headers: { 'content-type': type, ...headers }, body: Buffer.from(body) });

  it('accepts only https URLs on allowed official hosts', () => {
    expect(checkUrl('https://www.mdcr.gov.cz/a', allowed).hostname).toBe('www.mdcr.gov.cz');
    for (const [url, code] of [['http://www.mdcr.gov.cz/a', 'NOT_HTTPS'], ['https://user:pw@www.mdcr.gov.cz/', 'CREDENTIALS_IN_URL'], ['https://www.mdcr.gov.cz:8443/', 'PORT_NOT_ALLOWED'], ['https://10.0.0.1/', 'IP_LITERAL'], ['https://[::1]/', 'IP_LITERAL'], ['https://gov.cz.evil.example/', 'HOST_NOT_ALLOWED'], ['https://evilgov.cz/', 'HOST_NOT_ALLOWED'], ['file:///etc/passwd', 'NOT_HTTPS']]) {
      expect(() => checkUrl(url, allowed), url).toThrow(expect.objectContaining({ code }));
    }
    expect(hostAllowed('www.ris.bka.gv.at', ['gv.at'])).toBe(true);
  });

  it('rejects private, loopback, link-local and mixed DNS answers before connecting', async () => {
    for (const address of ['10.0.0.5', '127.0.0.1', '169.254.169.254', '192.168.0.10', '100.64.0.1', '::1', 'fd00::1', 'fe80::1', '::ffff:10.0.0.1', '64:ff9b::7f00:1']) expect(isPublicAddress(address), address).toBe(false);
    for (const address of ['93.184.216.34', '2a00:1450:4001:80b::200e', '::ffff:93.184.216.34']) expect(isPublicAddress(address), address).toBe(true);
    let connected = 0;
    const transport = async () => { connected += 1; return page('x'); };
    const mixed = await safeFetch('https://www.mdcr.gov.cz/a', { allowedHosts: allowed, resolve: async () => [{ address: '93.184.216.34', family: 4 }, { address: '10.0.0.5', family: 4 }], transport });
    expect([mixed.ok, mixed.availability, mixed.code, connected]).toEqual([false, 'REJECTED', 'PRIVATE_ADDRESS', 0]);
  });

  it('pins the connection to the validated address and re-checks every redirect', async () => {
    const seen: string[] = [];
    const resolve = async (host: string) => host === 'internal.gov.cz' ? [{ address: '10.1.1.1', family: 4 }] : [{ address: '93.184.216.34', family: 4 }];
    const routes: Record<string, any> = {
      'https://www.mdcr.gov.cz/a': page('', 'text/html', 302, { location: 'https://evil.example.net/steal' }),
      'https://www.mdcr.gov.cz/b': page('', 'text/html', 301, { location: 'https://internal.gov.cz/admin' }),
      'https://www.mdcr.gov.cz/c': page('', 'text/html', 302, { location: '/d' }),
      'https://www.mdcr.gov.cz/d': page('<p>ok</p>'),
    };
    const transport = async (url: URL, { address }: { address: string }) => { seen.push(`${url.href}@${address}`); return routes[url.href] ?? page('', 'text/html', 404); };
    expect(await safeFetch('https://www.mdcr.gov.cz/a', { allowedHosts: allowed, resolve, transport })).toMatchObject({ ok: false, availability: 'REJECTED', code: 'HOST_NOT_ALLOWED' });
    expect(await safeFetch('https://www.mdcr.gov.cz/b', { allowedHosts: allowed, resolve, transport })).toMatchObject({ ok: false, availability: 'REJECTED', code: 'PRIVATE_ADDRESS' });
    const ok = await safeFetch('https://www.mdcr.gov.cz/c', { allowedHosts: allowed, resolve, transport, clock: () => NOW });
    expect(ok).toMatchObject({ ok: true, final_url: 'https://www.mdcr.gov.cz/d', redirects: ['https://www.mdcr.gov.cz/d'], kind: 'HTML_SNAPSHOT', retrieved_at: NOW.toISOString() });
    expect(ok.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(seen.every(entry => entry.endsWith('@93.184.216.34'))).toBe(true);
  });

  it('checks content type, PDF signature and availability; unavailable is never "cancelled"', async () => {
    const fetchWith = (response: any) => safeFetch('https://www.mdcr.gov.cz/x', { allowedHosts: allowed, resolve: async () => [{ address: '93.184.216.34', family: 4 }], transport: async () => response });
    expect(await fetchWith(page('MZ', 'application/x-msdownload'))).toMatchObject({ availability: 'REJECTED', code: 'CONTENT_TYPE_NOT_ALLOWED' });
    expect(await fetchWith(page('<html>', 'application/pdf'))).toMatchObject({ availability: 'REJECTED', code: 'NOT_A_PDF' });
    expect(await fetchWith(page('%PDF-1.7 ...', 'application/pdf'))).toMatchObject({ ok: true, kind: 'PDF' });
    expect(await fetchWith(page('a\u0000b', 'text/plain'))).toMatchObject({ availability: 'REJECTED', code: 'BINARY_TEXT' });
    expect(await fetchWith(page('Service down', 'text/html', 503))).toMatchObject({ ok: false, availability: 'SOURCE_UNAVAILABLE', http_status: 503 });
    const network = await safeFetch('https://www.mdcr.gov.cz/x', { allowedHosts: allowed, resolve: async () => [{ address: '93.184.216.34', family: 4 }], transport: async () => { throw new Error('ECONNRESET'); } });
    expect(network).toMatchObject({ ok: false, availability: 'SOURCE_UNAVAILABLE', code: 'NETWORK_ERROR' });
  });
});

describe('documents and untrusted text', () => {
  it('extracts page text without scripts and keeps folded legal sections', () => {
    const text = htmlToText('<p>A&nbsp;§&nbsp;43</p><script>steal()</script><div hidden><p>(2) Folded provision</p></div><!-- c -->');
    expect(text).toContain('A § 43');
    expect(text).toContain('(2) Folded provision');
    expect(text).not.toMatch(/steal|c -->/);
    const fetched: any = { kind: 'HTML_SNAPSHOT', bytes: Buffer.from(DOCUMENTS.measure), charset: 'utf-8', last_modified: null, content_language: null };
    expect(documentText(fetched).metadata).toMatchObject({ language: 'cs', modified: '2026-10-30' });
  });

  it('21: flags instruction-like text and neutralises forged markers', () => {
    const text = htmlToText(DOCUMENTS.injection);
    expect(scanForInstructions(text).length).toBeGreaterThanOrEqual(2);
    const wrapped = wrapUntrusted('DOCUMENT', text, 'abc123');
    expect(wrapped.match(/<<<END UNTRUSTED DOCUMENT abc123>>>/g)).toHaveLength(1);
    expect(wrapped).not.toMatch(/<<<END UNTRUSTED DOCUMENT 0000/);
    expect(wrapped).toContain('UNTRUSTED-MARKER-REMOVED');
  });
});

describe('deterministic checks of an extraction', () => {
  const text = htmlToText(DOCUMENTS.measure);
  const codes = (rule: any, doc: string | null = text) => checkExtractedRule(rule, { text: doc, jurisdiction: 'CZ', window: WINDOW }).map(item => item.code);

  it('3: accepts a weight criterion only when its value is in the verified quote', () => {
    expect(codes(extractedRule())).toEqual([]);
    expect(numbersIn('převyšující 12 000 kg')).toContain(12000);
    expect(numbersIn('über 7,5 t')).toContain(7.5);
    expect(codes(extractedRule({ weight_conditions: [{ operator: '>', value: 7500, unit: 'kg', applies_to: 'MAM of lorry' }] }))).toContain('VALUE_NOT_IN_QUOTE');
    expect(codes(extractedRule({ weight_conditions: [{ operator: '>', value: null, unit: null, applies_to: 'MAM of lorry' }] }))).toContain('WEIGHT_INCOMPLETE');
  });

  it('requires verbatim quotes for every decisive field and times that appear in them', () => {
    const rule = extractedRule();
    expect(codes({ ...rule, evidence: rule.evidence.filter((item: any) => item.field !== 'legal_basis') })).toContain('MISSING_EVIDENCE');
    expect(codes({ ...rule, evidence: rule.evidence.map((item: any) => item.field === 'roads' ? { ...item, quote: 'Na dálnici D2 v úseku Brno – Břeclav' } : item) })).toContain('QUOTE_NOT_IN_DOCUMENT');
    expect(codes({ ...rule, schedule: { ...rule.schedule, end_time: '15:00' } })).toContain('TIME_NOT_IN_QUOTE');
    expect(timeInQuote('24:00', 'bis Mitternacht')).toBe(true);
    expect(timeInQuote('22:00', 'from 10 p.m.')).toBe(true);
    expect(codes(rule, null)).toContain('QUOTES_NOT_MACHINE_VERIFIABLE');
    expect(codes({ ...rule, valid_from: null, valid_to: null, open_ended: false })).toContain('VALIDITY_MISSING');
    expect(checkExtractedRule({ ...rule, timezone: null, roads: [] }, { text, jurisdiction: 'RU', window: WINDOW }).map(item => item.code)).toEqual(expect.arrayContaining(['TIMEZONE_AMBIGUOUS', 'CORRIDOR_SCOPE_MISSING']));
  });

  it('drafts an UNVERIFIED canonical rule and never fills a missing value', () => {
    const draft = draftRuleOf(extractedRule(), { jurisdiction: 'CZ', window: WINDOW, sourceId: 'cz-test' });
    expect(draft).toMatchObject({ verification_state: 'UNVERIFIED', status: 'ACTIVE', timezone: 'Europe/Prague', weight_threshold: { operator: '>', value: 12000, unit: 'kg' }, schedule: { kind: 'dates', dates: [{ date: '2026-11-14', occurrence_id: '2026-11-14' }] } });
    expect(draft.verified_at).toBeUndefined();
    expect(draftRuleOf(extractedRule({ weight_conditions: [{ operator: '>', value: null, unit: 'kg', applies_to: 'x' }] }), { jurisdiction: 'CZ', window: WINDOW, sourceId: 's' })).toBeNull();
    expect(draftRuleOf(extractedRule({ timezone: null }), { jurisdiction: 'ES', window: WINDOW, sourceId: 's' })).toBeNull();
    expect(supportAll([{ rule_index: 0 }]).overall).toBe('CONSISTENT');
  });
});
