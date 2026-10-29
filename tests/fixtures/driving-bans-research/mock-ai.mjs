// SYNTHETIC TEST FIXTURE. A scripted stand-in for the AI provider HTTP APIs and for
// official web servers, so the research pipeline can be exercised end to end
// without network, keys or cost. Nothing here is a live API test.
import { safeFetch } from '../../../src/lib/driving-bans/research/safe-fetch.mjs';

const HOSTS = { 'api.anthropic.com': 'anthropic', 'api.openai.com': 'openai', 'api.x.ai': 'xai', 'generativelanguage.googleapis.com': 'gemini', 'api.mistral.ai': 'mistral', 'api.perplexity.ai': 'perplexity' };

/** Fake keys and models for all six providers; prices make budget accounting testable. */
export function testEnv(overrides = {}) {
  return {
    DAJC_DRIVING_BANS_RESEARCH_ENABLED: 'true',
    DAJC_RESEARCH_RUN_BUDGET_USD: '5', DAJC_RESEARCH_MONTHLY_BUDGET_USD: '50',
    DAJC_RESEARCH_ANTHROPIC_API_KEY: 'test-key-anthropic', DAJC_RESEARCH_ANTHROPIC_MODEL: 'test-claude',
    DAJC_RESEARCH_OPENAI_API_KEY: 'test-key-openai', DAJC_RESEARCH_OPENAI_MODEL: 'test-gpt',
    DAJC_RESEARCH_XAI_API_KEY: 'test-key-xai', DAJC_RESEARCH_XAI_MODEL: 'test-grok',
    DAJC_RESEARCH_GEMINI_API_KEY: 'test-key-gemini', DAJC_RESEARCH_GEMINI_MODEL: 'test-gemini',
    DAJC_RESEARCH_MISTRAL_API_KEY: 'test-key-mistral', DAJC_RESEARCH_MISTRAL_MODEL: 'test-mistral',
    DAJC_RESEARCH_PERPLEXITY_API_KEY: 'test-key-perplexity',
    DAJC_RESEARCH_PRICING_USD: JSON.stringify({ anthropic: { input: 3, output: 15 }, openai: { input: 2, output: 8 }, xai: { input: 3, output: 15 }, gemini: { input: 1, output: 5 }, mistral: { input: 1, output: 3 }, perplexity: { request: 0.005 } }),
    ...overrides,
  };
}

const between = (text, label) => { const match = new RegExp(`<<<UNTRUSTED ${label} ([0-9a-f]+)>>>\\n([\\s\\S]*?)\\n<<<END UNTRUSTED ${label} \\1>>>`).exec(text || ''); return match ? match[2] : null; };

function unpack(provider, body) {
  if (provider === 'anthropic') return { system: body.system, user: body.messages[0].content.find(part => part.type === 'text').text, pdf: body.messages[0].content.some(part => part.type === 'document') };
  if (provider === 'openai') return { system: body.input[0].content, user: body.input[1].content.find(part => part.type === 'input_text').text, pdf: body.input[1].content.some(part => part.type === 'input_file') };
  if (provider === 'gemini') return { system: body.systemInstruction.parts[0].text, user: body.contents[0].parts.find(part => 'text' in part).text, pdf: body.contents[0].parts.some(part => 'inline_data' in part) };
  return { system: body.messages[0].content, user: body.messages[1].content, pdf: false };
}

function wrap(provider, model, text) {
  if (provider === 'anthropic') return { model, stop_reason: 'end_turn', content: [{ type: 'text', text }], usage: { input_tokens: 1200, output_tokens: 600 } };
  if (provider === 'openai') return { model, status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text }] }], usage: { input_tokens: 1200, output_tokens: 600 } };
  if (provider === 'gemini') return { modelVersion: model, candidates: [{ finishReason: 'STOP', content: { parts: [{ text }] } }], usageMetadata: { promptTokenCount: 1200, candidatesTokenCount: 600 } };
  return { model, choices: [{ finish_reason: 'stop', message: { content: text } }], usage: { prompt_tokens: 1200, completion_tokens: 600 } };
}

/** Every decisive field of every extracted rule SUPPORTED. */
export function supportAll(extraction) {
  return { rules: extraction.map(rule => ({ rule_index: rule.rule_index, verdicts: ['vehicle_scope', 'weight', 'start_time', 'end_time', 'legal_basis'].map(field => ({ field, verdict: 'SUPPORTED', quote: null, note: null })), missing_conditions: [] })), omitted_rules: [], overall: 'CONSISTENT', instructions_found_in_document: false };
}

/**
 * brain.extract({ provider, key, document, user }) and brain.verify({ provider, key, extraction }) return the
 * model JSON; brain.search({ queries, domains }) returns search results. key is the FIXTURE-KEY of the document.
 * failures: { anthropic: { status: 503, remaining: 3, body?, headers?, throws? } } makes a provider fail that many
 * times, with the given error body and headers (recorded bake-off shapes), or throw a fetch error (e.g. TimeoutError).
 * transform(provider, response) may alter a successful vendor response (e.g. a truncated answer).
 */
export function createMockAiFetch({ brain, failures = {}, transform = (provider, response) => response }) {
  const log = [];
  const fetchFn = async (url, init) => {
    const provider = HOSTS[new URL(url).hostname];
    if (!provider) throw new Error(`Unexpected outbound request to ${url}`);
    const body = JSON.parse(init.body);
    const failure = failures[provider];
    if (failure && failure.remaining > 0) {
      failure.remaining -= 1;
      log.push({ provider, url, headers: init.headers, body, failed: failure.status ?? failure.throws ?? 503 });
      if (failure.throws) throw Object.assign(new Error('fetch failed'), { name: failure.throws });
      return new Response(JSON.stringify(failure.body ?? { error: 'upstream said: your prompt was ... and key test-key' }), { status: failure.status ?? 503, headers: failure.headers ?? {} });
    }
    if (provider === 'perplexity') {
      log.push({ provider, url, headers: init.headers, body, task: 'search' });
      return Response.json({ results: brain.search?.({ queries: body.query, domains: body.search_domain_filter ?? [] }) ?? [] });
    }
    const { system, user, pdf } = unpack(provider, body);
    const task = /independent check/.test(system) ? 'verify' : 'extract';
    const document = between(user, 'DOCUMENT');
    const key = /FIXTURE-KEY: ([a-z0-9-]+)/.exec(document ?? user)?.[1] ?? null;
    log.push({ provider, url, headers: init.headers, body, task, key, pdf, user });
    const output = task === 'verify'
      ? (brain.verify?.({ provider, key, extraction: JSON.parse(between(user, 'EXTRACTION')), user }) ?? supportAll(JSON.parse(between(user, 'EXTRACTION'))))
      : brain.extract({ provider, key, document, user, pdf });
    const model = body.model ?? new URL(url).pathname.split('/models/')[1]?.split(':')[0] ?? `${provider}-test`;
    return Response.json(transform(provider, wrap(provider, model, JSON.stringify(output))));
  };
  return { fetchFn, log };
}

/**
 * Official web servers as fixtures. pages: { url: { body, type, status, headers } };
 * dns: { host: [{ address, family }] }. Requests go through the real safeFetch checks.
 */
export function fixtureWeb(pages, { dns = {}, clock = () => new Date('2026-11-02T08:00:00Z') } = {}) {
  const requests = [];
  const resolve = async host => dns[host] ?? [{ address: '93.184.216.34', family: 4 }];
  const transport = async (url, { address }) => {
    requests.push({ url: url.href, address });
    const page = pages[url.href];
    if (!page) return { status: 404, headers: {}, body: Buffer.from('') };
    return { status: page.status ?? 200, headers: { 'content-type': page.type ?? 'text/html; charset=utf-8', ...(page.headers || {}) }, body: Buffer.isBuffer(page.body) ? page.body : Buffer.from(page.body ?? '', 'utf8') };
  };
  return { fetchDocument: (url, allowedHosts) => safeFetch(url, { allowedHosts, resolve, transport, clock }), requests, resolve, transport };
}
