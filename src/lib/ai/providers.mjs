/**
 * Provider-neutral AI adapters for DAJC research. Plain fetch, no SDKs, no new
 * dependencies - the same approach as scripts/lib/web-search.mjs (Weekly) and
 * src/lib/ask/providers.ts (Ask DAJC AI, PR #78). Server-side only.
 *
 * Keys, model names and prices come from the environment only, under the
 * DAJC_RESEARCH_* prefix: research has its own keys and spend limits, separate
 * from the Weekly pipeline and from Ask. Nothing has a default model or price:
 * a provider without key, model and price is not configured and is never called.
 * Errors never echo a response body (it can contain the request) or a key.
 *
 * Request formats follow each vendor's public HTTP API. They are exercised here
 * against recorded-shape fixtures only; a live call needs keys this repository
 * does not hold.
 */

export const PROVIDER_IDS = Object.freeze(['anthropic', 'openai', 'xai', 'gemini', 'mistral', 'perplexity']);

/** Static facts per provider. `region` is the vendor's legal seat, for data-routing decisions. */
export const PROVIDER_CATALOG = Object.freeze({
  anthropic: { vendor: 'Anthropic', region: 'US', capabilities: ['json', 'pdf'], keyEnv: 'DAJC_RESEARCH_ANTHROPIC_API_KEY', modelEnv: 'DAJC_RESEARCH_ANTHROPIC_MODEL' },
  openai: { vendor: 'OpenAI', region: 'US', capabilities: ['json', 'pdf'], keyEnv: 'DAJC_RESEARCH_OPENAI_API_KEY', modelEnv: 'DAJC_RESEARCH_OPENAI_MODEL' },
  xai: { vendor: 'xAI', region: 'US', capabilities: ['json'], keyEnv: 'DAJC_RESEARCH_XAI_API_KEY', modelEnv: 'DAJC_RESEARCH_XAI_MODEL' },
  gemini: { vendor: 'Google', region: 'US', capabilities: ['json', 'pdf'], keyEnv: 'DAJC_RESEARCH_GEMINI_API_KEY', modelEnv: 'DAJC_RESEARCH_GEMINI_MODEL' },
  mistral: { vendor: 'Mistral AI', region: 'EU', capabilities: ['json'], keyEnv: 'DAJC_RESEARCH_MISTRAL_API_KEY', modelEnv: 'DAJC_RESEARCH_MISTRAL_MODEL' },
  perplexity: { vendor: 'Perplexity AI', region: 'US', capabilities: ['search'], keyEnv: 'DAJC_RESEARCH_PERPLEXITY_API_KEY', modelEnv: null },
});

export const PRICING_ENV = 'DAJC_RESEARCH_PRICING_USD';

export class ProviderError extends Error {
  /** @param {string} provider @param {string} message @param {{ status?: number, retryable?: boolean }} [info] */
  constructor(provider, message, { status = null, retryable = false } = {}) {
    super(`${provider}: ${message}`);
    this.name = 'ProviderError';
    this.provider = provider;
    this.status = status;
    this.retryable = retryable;
  }
}

const finite = (value, max) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= max;

/**
 * DAJC_RESEARCH_PRICING_USD: {"anthropic":{"input":3,"output":15},"perplexity":{"request":0.005},...}
 * USD per 1M tokens (models) or per request (search). Invalid JSON or values = no prices.
 */
export function parsePricing(raw) {
  if (!raw) return {};
  let parsed;
  try { parsed = JSON.parse(raw); } catch { return {}; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  const out = {};
  for (const id of PROVIDER_IDS) {
    const price = parsed[id];
    if (!price || typeof price !== 'object') continue;
    if (id === 'perplexity') { if (finite(price.request, 10)) out[id] = { request: price.request }; }
    else if (finite(price.input, 1000) && finite(price.output, 1000)) out[id] = { input: price.input, output: price.output };
  }
  return out;
}

/** Configuration state per provider: names of missing settings only, never values. */
export function providerStatus(env = process.env) {
  const pricing = parsePricing(env[PRICING_ENV]);
  return PROVIDER_IDS.map(id => {
    const spec = PROVIDER_CATALOG[id];
    const missing = [];
    if (!env[spec.keyEnv]?.trim()) missing.push(spec.keyEnv);
    if (spec.modelEnv && !env[spec.modelEnv]?.trim()) missing.push(spec.modelEnv);
    if (!pricing[id]) missing.push(`${PRICING_ENV}.${id}`);
    return { id, vendor: spec.vendor, region: spec.region, capabilities: spec.capabilities, configured: missing.length === 0, missing };
  });
}

const RETRYABLE_STATUS = new Set([408, 409, 425, 429, 500, 502, 503, 504, 529]);

async function postJson(fetchFn, provider, url, headers, body, timeoutMs) {
  let res;
  try {
    res = await fetchFn(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    throw new ProviderError(provider, error?.name === 'TimeoutError' || error?.name === 'AbortError' ? 'timeout' : 'network error', { retryable: true });
  }
  if (!res.ok) throw new ProviderError(provider, `HTTP ${res.status}`, { status: res.status, retryable: RETRYABLE_STATUS.has(res.status) });
  try { return await res.json(); } catch { throw new ProviderError(provider, 'invalid JSON response', { retryable: true }); }
}

function parseModelJson(provider, text) {
  if (typeof text !== 'string' || !text.trim()) throw new ProviderError(provider, 'no structured output');
  try { return JSON.parse(text); } catch { throw new ProviderError(provider, 'structured output is not JSON'); }
}

const tokens = value => Number(value) || 0;

/**
 * One adapter per provider with a uniform interface:
 *   json({ system, user, schema, schemaName, maxOutputTokens, document? }) -> { json, usage, model }
 *   search({ queries, domains, maxResults }) -> { results, usage }
 * `document` is { mediaType: 'application/pdf', base64 } for native PDF reading.
 * @returns {Record<string, any>}
 */
export function createProvider(id, { env = process.env, fetchFn = fetch, timeoutMs = 90_000 } = {}) {
  const spec = PROVIDER_CATALOG[id];
  if (!spec) throw new Error(`Unknown AI provider ${id}`);
  const status = providerStatus(env).find(item => item.id === id);
  const key = env[spec.keyEnv]?.trim();
  const model = spec.modelEnv ? env[spec.modelEnv]?.trim() : null;
  const base = { id, vendor: spec.vendor, region: spec.region, capabilities: spec.capabilities, configured: status.configured, model, price: parsePricing(env[PRICING_ENV])[id] ?? null };
  const requireConfigured = () => { if (!status.configured) throw new ProviderError(id, `not configured (${status.missing.join(', ')})`); };
  const requirePdf = document => { if (document && !spec.capabilities.includes('pdf')) throw new ProviderError(id, 'cannot read PDF documents'); };

  if (id === 'perplexity') {
    return {
      ...base,
      async search({ queries, domains = [], maxResults = 10 }) {
        requireConfigured();
        const response = await postJson(fetchFn, id, 'https://api.perplexity.ai/search', { authorization: `Bearer ${key}` }, { query: queries, max_results: maxResults, ...(domains.length ? { search_domain_filter: domains.slice(0, 20) } : {}) }, timeoutMs);
        if (!Array.isArray(response?.results)) throw new ProviderError(id, 'no results array');
        // Multi-query requests may group results per query.
        const results = response.results.flat().filter(r => typeof r?.url === 'string').map(r => ({ url: r.url, title: String(r.title || '').slice(0, 250), snippet: String(r.snippet || '').slice(0, 500), date: typeof r.date === 'string' ? r.date : null }));
        return { results, usage: { requests: 1 } };
      },
    };
  }

  const call = {
    async anthropic({ system, user, schema, maxOutputTokens, document }) {
      const content = [...(document ? [{ type: 'document', source: { type: 'base64', media_type: document.mediaType, data: document.base64 } }] : []), { type: 'text', text: user }];
      const response = await postJson(fetchFn, id, 'https://api.anthropic.com/v1/messages', { 'x-api-key': key, 'anthropic-version': '2023-06-01' }, { model, max_tokens: maxOutputTokens, system, messages: [{ role: 'user', content }], output_config: { format: { type: 'json_schema', schema } } }, timeoutMs);
      // A refusal or a truncated answer is not a result.
      if (response?.stop_reason !== 'end_turn') throw new ProviderError(id, `stop_reason ${response?.stop_reason || 'unknown'}`);
      return { text: (response.content || []).find(block => block?.type === 'text')?.text, usage: { inputTokens: tokens(response.usage?.input_tokens), outputTokens: tokens(response.usage?.output_tokens) }, model: response.model || model };
    },
    async openai({ system, user, schema, schemaName, maxOutputTokens, document }) {
      const content = [{ type: 'input_text', text: user }, ...(document ? [{ type: 'input_file', filename: 'document.pdf', file_data: `data:${document.mediaType};base64,${document.base64}` }] : [])];
      const response = await postJson(fetchFn, id, 'https://api.openai.com/v1/responses', { authorization: `Bearer ${key}` }, { model, store: false, max_output_tokens: maxOutputTokens, input: [{ role: 'system', content: system }, { role: 'user', content }], text: { format: { type: 'json_schema', name: schemaName, schema, strict: true } } }, timeoutMs);
      if (response?.status !== 'completed') throw new ProviderError(id, `response ${response?.status || 'unknown'}`);
      const parts = (response.output || []).filter(item => item?.type === 'message').flatMap(item => item.content || []);
      if (parts.some(part => part?.type === 'refusal')) throw new ProviderError(id, 'refusal');
      return { text: parts.find(part => part?.type === 'output_text')?.text, usage: { inputTokens: tokens(response.usage?.input_tokens), outputTokens: tokens(response.usage?.output_tokens) }, model: response.model || model };
    },
    async xai(args) { return chatCompletions('https://api.x.ai/v1/chat/completions', args); },
    async mistral(args) { return chatCompletions('https://api.mistral.ai/v1/chat/completions', args); },
    async gemini({ system, user, schema, maxOutputTokens, document }) {
      const parts = [...(document ? [{ inline_data: { mime_type: document.mediaType, data: document.base64 } }] : []), { text: user }];
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
      const response = await postJson(fetchFn, id, url, { 'x-goog-api-key': key }, { systemInstruction: { parts: [{ text: system }] }, contents: [{ role: 'user', parts }], generationConfig: { responseMimeType: 'application/json', responseJsonSchema: schema, maxOutputTokens } }, timeoutMs);
      const candidate = response?.candidates?.[0];
      if (candidate?.finishReason !== 'STOP') throw new ProviderError(id, `finishReason ${candidate?.finishReason || 'unknown'}`);
      return { text: (candidate.content?.parts || []).map(part => part?.text || '').join(''), usage: { inputTokens: tokens(response.usageMetadata?.promptTokenCount), outputTokens: tokens(response.usageMetadata?.candidatesTokenCount) }, model: response.modelVersion || model };
    },
  };

  /** OpenAI-compatible chat completions (xAI, Mistral) with a strict JSON schema. */
  async function chatCompletions(url, { system, user, schema, schemaName, maxOutputTokens }) {
    const response = await postJson(fetchFn, id, url, { authorization: `Bearer ${key}` }, { model, max_tokens: maxOutputTokens, messages: [{ role: 'system', content: system }, { role: 'user', content: user }], response_format: { type: 'json_schema', json_schema: { name: schemaName, schema, strict: true } } }, timeoutMs);
    const choice = response?.choices?.[0];
    if (choice?.finish_reason !== 'stop') throw new ProviderError(id, `finish_reason ${choice?.finish_reason || 'unknown'}`);
    return { text: choice.message?.content, usage: { inputTokens: tokens(response.usage?.prompt_tokens), outputTokens: tokens(response.usage?.completion_tokens) }, model: response.model || model };
  }

  return {
    ...base,
    async json(request) {
      requireConfigured();
      requirePdf(request.document);
      const result = await call[id](request);
      return { json: parseModelJson(id, result.text), usage: result.usage, model: result.model };
    },
  };
}

/**
 * All six adapters; unconfigured ones exist but refuse every call.
 * @returns {Record<string, any>}
 */
export function createProviders(options = {}) {
  return Object.fromEntries(PROVIDER_IDS.map(id => [id, createProvider(id, options)]));
}
