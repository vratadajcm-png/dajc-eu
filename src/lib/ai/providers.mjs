/**
 * Provider-neutral AI adapters for DAJC research. Plain fetch, no SDKs, no new
 * dependencies - the same approach as scripts/lib/web-search.mjs (Weekly) and
 * src/lib/ask/providers.ts (Ask DAJC AI, PR #78). Server-side only.
 *
 * Keys, model names and prices come from the environment only, under the
 * DAJC_RESEARCH_* prefix (or from an explicitly selected model profile, see
 * research/config.mjs). Nothing has a default model or price: a provider without
 * key, model and price is not configured and is never called. Errors never echo a
 * response body or a key; only a category and the provider's machine code are kept.
 *
 * Error handling follows what the DAJC AI bake-off of 25 October 2026 actually met
 * (data/ai-benchmark/bakeoff-2026-10-25.json): a credit or tier refusal must stop the
 * provider instead of being resent, a token-rate 429 must be paced with the provider's
 * retry delay, and a 503 "high demand" must be retried with backoff.
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

/** Optional reasoning settings, validated; an invalid value leaves the provider unconfigured. */
const REASONING_OPTIONS = Object.freeze({
  anthropic: { env: 'DAJC_RESEARCH_ANTHROPIC_EFFORT', values: ['low', 'medium', 'high', 'xhigh', 'max'] },
  openai: { env: 'DAJC_RESEARCH_OPENAI_REASONING_EFFORT', values: ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'] },
  xai: { env: 'DAJC_RESEARCH_XAI_REASONING_EFFORT', values: ['low', 'medium', 'high'] },
});

/**
 * What an error means and what the orchestrator does with it. `block` stops the
 * provider for the rest of the run: the same request would only fail again.
 */
export const ERROR_CATEGORIES = Object.freeze({
  CREDIT_OR_BILLING: { retryable: false, block: true },
  AUTHENTICATION: { retryable: false, block: true },
  PERMISSION_OR_TIER: { retryable: false, block: true },
  MODEL_NOT_FOUND: { retryable: false, block: true },
  INVALID_REQUEST: { retryable: false, block: true },
  QUOTA_EXHAUSTED: { retryable: false, block: true },
  NOT_CONFIGURED: { retryable: false, block: true },
  REQUEST_TOO_LARGE: { retryable: false, block: false },
  UNSUPPORTED_INPUT: { retryable: false, block: false },
  RATE_LIMIT: { retryable: true, block: false },
  OVERLOADED: { retryable: true, block: false },
  SERVER_ERROR: { retryable: true, block: false },
  TIMEOUT: { retryable: true, block: false },
  NETWORK: { retryable: true, block: false },
  INVALID_RESPONSE: { retryable: false, block: false },
  INCOMPLETE_RESPONSE: { retryable: false, block: false },
  REFUSAL: { retryable: false, block: false },
});

export class ProviderError extends Error {
  /** @param {string} provider @param {string} category @param {{ status?: number|null, code?: string|null, retryAfterMs?: number|null, detail?: string }} [info] */
  constructor(provider, category, { status = null, code = null, retryAfterMs = null, detail = '' } = {}) {
    const spec = ERROR_CATEGORIES[category] ?? ERROR_CATEGORIES.INVALID_RESPONSE;
    super(`${provider}: ${category}${status ? ` (HTTP ${status}${code ? `, ${code}` : ''})` : code ? ` (${code})` : ''}${detail ? ` ${detail}` : ''}`);
    this.name = 'ProviderError';
    this.provider = provider;
    this.category = category;
    this.status = status;
    this.code = code;
    this.retryable = spec.retryable;
    this.blockProvider = spec.block;
    this.retryAfterMs = retryAfterMs;
  }
}

const finite = (value, max) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= max;
const tokenPrice = price => price && finite(price.input, 1000) && finite(price.output, 1000) ? { input: price.input, output: price.output } : null;

/**
 * DAJC_RESEARCH_PRICING_USD: USD per 1M tokens per provider, optionally per model,
 * and USD per search request:
 * {"openai":{"input":2,"output":10,"models":{"gpt-6-luna":{"input":0.1,"output":0.5}}},"perplexity":{"request":0.005}}
 * Invalid JSON or values = no prices.
 */
export function parsePricing(raw) {
  if (!raw) return {};
  let parsed;
  try { parsed = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { return {}; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  const out = {};
  for (const id of PROVIDER_IDS) {
    const price = parsed[id];
    if (!price || typeof price !== 'object') continue;
    if (id === 'perplexity') { if (finite(price.request, 10)) out[id] = { request: price.request }; continue; }
    const base = tokenPrice(price);
    const models = Object.fromEntries(Object.entries(price.models && typeof price.models === 'object' ? price.models : {}).map(([model, value]) => [model, tokenPrice(value)]).filter(([, value]) => value));
    if (base || Object.keys(models).length) out[id] = { ...(base ?? {}), ...(Object.keys(models).length ? { models } : {}) };
  }
  return out;
}

const TASK_SUFFIXES = ['EXTRACT', 'VERIFY'];
/** Model for a task: <P>_MODEL_<TASK>_COMPLEX for complex documents, then <P>_MODEL_<TASK>, then <P>_MODEL. */
export function modelFor(env, id, task = null, complex = false) {
  const base = PROVIDER_CATALOG[id].modelEnv;
  if (!base) return null;
  const suffix = task && TASK_SUFFIXES.includes(task.toUpperCase()) ? task.toUpperCase() : null;
  return (suffix && complex && env[`${base}_${suffix}_COMPLEX`]?.trim()) || (suffix && env[`${base}_${suffix}`]?.trim()) || env[base]?.trim() || null;
}
/** The provider-level price covers its default model only; any other model needs its own price, so a budget is never underestimated. */
export function priceFor(pricing, id, model, defaultModel = model) {
  const entry = pricing[id];
  if (!entry) return null;
  if (id === 'perplexity') return entry;
  return entry.models?.[model] ?? (model === defaultModel && entry.input !== undefined ? { input: entry.input, output: entry.output } : null);
}

/** Configuration state per provider: names of missing or invalid settings only, never values. */
export function providerStatus(env = process.env) {
  const pricing = parsePricing(env[PRICING_ENV]);
  return PROVIDER_IDS.map(id => {
    const spec = PROVIDER_CATALOG[id];
    const missing = [];
    if (!env[spec.keyEnv]?.trim()) missing.push(spec.keyEnv);
    const model = modelFor(env, id);
    if (spec.modelEnv && !model) missing.push(spec.modelEnv);
    if (!priceFor(pricing, id, model)) missing.push(`${PRICING_ENV}.${id}`);
    for (const suffix of TASK_SUFFIXES) for (const name of [`${spec.modelEnv}_${suffix}`, `${spec.modelEnv}_${suffix}_COMPLEX`]) {
      const value = spec.modelEnv && env[name]?.trim();
      if (value && !priceFor(pricing, id, value, model)) missing.push(`${PRICING_ENV}.${id}.models.${value}`);
    }
    const reasoning = REASONING_OPTIONS[id];
    if (reasoning && env[reasoning.env] && !reasoning.values.includes(env[reasoning.env])) missing.push(`${reasoning.env} (invalid value)`);
    return { id, vendor: spec.vendor, region: spec.region, capabilities: spec.capabilities, configured: missing.length === 0, missing };
  });
}

const safeCode = value => typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,60}$/.test(value) ? value : null;
/** The provider's machine-readable error code; never its message. */
function providerCode(id, body) {
  const error = body?.error;
  if (id === 'anthropic') return safeCode(error?.type);
  if (id === 'gemini') return safeCode(error?.status);
  if (id === 'mistral') return safeCode([body?.type, body?.code].filter(Boolean).join(':'));
  return safeCode(error?.code ?? error?.type ?? body?.code);
}
function retryAfterOf(headers, body) {
  const header = headers?.get?.('retry-after');
  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
    const date = Date.parse(header);
    if (Number.isFinite(date)) return Math.max(0, date - Date.now());
  }
  // Gemini: google.rpc.RetryInfo { retryDelay: "37s" } in error.details.
  for (const detail of Array.isArray(body?.error?.details) ? body.error.details : []) {
    const match = /^(\d+(?:\.\d+)?)s$/.exec(String(detail?.retryDelay ?? ''));
    if (match) return Math.round(Number(match[1]) * 1000);
  }
  return null;
}

/**
 * Category of an HTTP error. The message text is read only to tell credit, quota and
 * tier refusals apart (bake-off: Anthropic answers a low credit balance with HTTP 400,
 * OpenAI insufficient_quota with 429); it is never stored or rethrown.
 */
export function classifyHttpError(id, status, body, headers) {
  const text = JSON.stringify(body ?? '').toLowerCase();
  const code = providerCode(id, body);
  const retryAfterMs = retryAfterOf(headers, body);
  const make = category => new ProviderError(id, category, { status, code, retryAfterMs });
  // 429 first: Gemini's per-minute limit says "check your plan and billing details", yet pacing fixed it in the bake-off.
  if (status === 429) {
    if (/insufficient_quota/.test(text)) return make('CREDIT_OR_BILLING');
    return make(/perday|per day|daily/.test(text) && retryAfterMs === null ? 'QUOTA_EXHAUSTED' : 'RATE_LIMIT');
  }
  if (status === 408 || status === 504) return make('TIMEOUT');
  if (status === 503 || status === 529) return make('OVERLOADED');
  if (status >= 500) return make('SERVER_ERROR');
  if (status === 402 || /credit balance|billing|payment required|spend limit|prepay|out of credits/.test(text)) return make('CREDIT_OR_BILLING');
  if (status === 401) return make('AUTHENTICATION');
  if (status === 403) return make('PERMISSION_OR_TIER');
  if (status === 404) return make('MODEL_NOT_FOUND');
  if (status === 413) return make('REQUEST_TOO_LARGE');
  if (/model[^"]{0,40}(not found|does not exist|not supported|is not available|unknown)|invalid model|unknown model|model_not_found/.test(text)) return make('MODEL_NOT_FOUND');
  if (/failed_precondition|tier|subscription/.test(text)) return make('PERMISSION_OR_TIER');
  return make('INVALID_REQUEST');
}

async function postJson(fetchFn, id, url, headers, body, timeoutMs) {
  let res;
  try {
    res = await fetchFn(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    throw new ProviderError(id, error?.name === 'TimeoutError' || error?.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK');
  }
  if (!res.ok) {
    let parsed = null;
    try { parsed = JSON.parse((await res.text()).slice(0, 65_536)); } catch { /* not JSON */ }
    throw classifyHttpError(id, res.status, parsed, res.headers);
  }
  try { return await res.json(); } catch { throw new ProviderError(id, 'INVALID_RESPONSE', { detail: 'body is not JSON' }); }
}

function parseModelJson(id, text) {
  if (typeof text !== 'string' || !text.trim()) throw new ProviderError(id, 'INVALID_RESPONSE', { detail: 'no structured output' });
  try { return JSON.parse(text); } catch { throw new ProviderError(id, 'INVALID_RESPONSE', { detail: 'structured output is not JSON' }); }
}

const tokens = value => Number(value) || 0;
const GEMINI_REFUSALS = new Set(['SAFETY', 'RECITATION', 'PROHIBITED_CONTENT', 'BLOCKLIST', 'SPII', 'LANGUAGE']);

/**
 * One adapter per provider with a uniform interface:
 *   json({ system, user, schema, schemaName, maxOutputTokens, document?, task?, complex? }) -> { json, usage, model, requestedModel }
 *   search({ queries, domains, maxResults }) -> { results, usage }
 *   modelFor(task, complex), priceFor(task, complex)
 * `document` is { mediaType: 'application/pdf', base64 } for native PDF reading.
 * @returns {Record<string, any>}
 */
export function createProvider(id, { env = process.env, fetchFn = fetch, timeoutMs = 120_000 } = {}) {
  const spec = PROVIDER_CATALOG[id];
  if (!spec) throw new Error(`Unknown AI provider ${id}`);
  const status = providerStatus(env).find(item => item.id === id);
  const key = env[spec.keyEnv]?.trim();
  const pricing = parsePricing(env[PRICING_ENV]);
  const reasoning = REASONING_OPTIONS[id] && env[REASONING_OPTIONS[id].env] ? env[REASONING_OPTIONS[id].env] : null;
  const base = {
    id, vendor: spec.vendor, region: spec.region, capabilities: spec.capabilities, configured: status.configured, model: modelFor(env, id),
    price: priceFor(pricing, id, modelFor(env, id)),
    modelFor: (task, complex = false) => modelFor(env, id, task, complex),
    priceFor: (task, complex = false) => priceFor(pricing, id, modelFor(env, id, task, complex), modelFor(env, id)),
  };
  const requireConfigured = () => { if (!status.configured) throw new ProviderError(id, 'NOT_CONFIGURED', { detail: `(${status.missing.join(', ')})` }); };
  const requirePdf = document => { if (document && !spec.capabilities.includes('pdf')) throw new ProviderError(id, 'UNSUPPORTED_INPUT', { detail: 'cannot read PDF documents' }); };

  if (id === 'perplexity') {
    return {
      ...base,
      async search({ queries, domains = [], maxResults = 10 }) {
        requireConfigured();
        const response = await postJson(fetchFn, id, 'https://api.perplexity.ai/search', { authorization: `Bearer ${key}` }, { query: queries, max_results: maxResults, ...(domains.length ? { search_domain_filter: domains.slice(0, 20) } : {}) }, timeoutMs);
        if (!Array.isArray(response?.results)) throw new ProviderError(id, 'INVALID_RESPONSE', { detail: 'no results array' });
        // Multi-query requests may group results per query.
        const results = response.results.flat().filter(r => typeof r?.url === 'string').map(r => ({ url: r.url, title: String(r.title || '').slice(0, 250), snippet: String(r.snippet || '').slice(0, 500), date: typeof r.date === 'string' ? r.date : null }));
        return { results, usage: { requests: 1 } };
      },
    };
  }

  const call = {
    async anthropic({ model, system, user, schema, maxOutputTokens, document }) {
      const content = [...(document ? [{ type: 'document', source: { type: 'base64', media_type: document.mediaType, data: document.base64 } }] : []), { type: 'text', text: user }];
      const response = await postJson(fetchFn, id, 'https://api.anthropic.com/v1/messages', { 'x-api-key': key, 'anthropic-version': '2023-06-01' }, { model, max_tokens: maxOutputTokens, system, messages: [{ role: 'user', content }], output_config: { ...(reasoning ? { effort: reasoning } : {}), format: { type: 'json_schema', schema } } }, timeoutMs);
      // A refusal or a truncated answer is not a result.
      if (response?.stop_reason === 'max_tokens') throw new ProviderError(id, 'INCOMPLETE_RESPONSE', { code: 'max_tokens' });
      if (response?.stop_reason === 'refusal') throw new ProviderError(id, 'REFUSAL', { code: 'refusal' });
      if (response?.stop_reason !== 'end_turn') throw new ProviderError(id, 'INVALID_RESPONSE', { code: safeCode(response?.stop_reason) ?? 'stop_reason' });
      return { text: (response.content || []).find(block => block?.type === 'text')?.text, usage: { inputTokens: tokens(response.usage?.input_tokens), outputTokens: tokens(response.usage?.output_tokens) }, model: response.model || model };
    },
    async openai({ model, system, user, schema, schemaName, maxOutputTokens, document }) {
      const content = [{ type: 'input_text', text: user }, ...(document ? [{ type: 'input_file', filename: 'document.pdf', file_data: `data:${document.mediaType};base64,${document.base64}` }] : [])];
      const response = await postJson(fetchFn, id, 'https://api.openai.com/v1/responses', { authorization: `Bearer ${key}` }, { model, store: false, max_output_tokens: maxOutputTokens, ...(reasoning ? { reasoning: { effort: reasoning } } : {}), input: [{ role: 'system', content: system }, { role: 'user', content }], text: { format: { type: 'json_schema', name: schemaName, schema, strict: true } } }, timeoutMs);
      if (response?.status === 'incomplete') throw new ProviderError(id, 'INCOMPLETE_RESPONSE', { code: safeCode(response.incomplete_details?.reason) ?? 'incomplete' });
      if (response?.status !== 'completed') throw new ProviderError(id, 'INVALID_RESPONSE', { code: safeCode(response?.status) ?? 'status' });
      const parts = (response.output || []).filter(item => item?.type === 'message').flatMap(item => item.content || []);
      if (parts.some(part => part?.type === 'refusal')) throw new ProviderError(id, 'REFUSAL', { code: 'refusal' });
      return { text: parts.find(part => part?.type === 'output_text')?.text, usage: { inputTokens: tokens(response.usage?.input_tokens), outputTokens: tokens(response.usage?.output_tokens) }, model: response.model || model };
    },
    async xai(args) { return chatCompletions('https://api.x.ai/v1/chat/completions', args, reasoning ? { reasoning_effort: reasoning } : {}); },
    async mistral(args) { return chatCompletions('https://api.mistral.ai/v1/chat/completions', args, {}); },
    async gemini({ model, system, user, schema, maxOutputTokens, document }) {
      const parts = [...(document ? [{ inline_data: { mime_type: document.mediaType, data: document.base64 } }] : []), { text: user }];
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
      // No sampling override: the bake-off omitted temperature for Gemini 3.x for API compatibility.
      const response = await postJson(fetchFn, id, url, { 'x-goog-api-key': key }, { systemInstruction: { parts: [{ text: system }] }, contents: [{ role: 'user', parts }], generationConfig: { responseMimeType: 'application/json', responseJsonSchema: schema, maxOutputTokens } }, timeoutMs);
      if (response?.promptFeedback?.blockReason) throw new ProviderError(id, 'REFUSAL', { code: safeCode(response.promptFeedback.blockReason) });
      const candidate = response?.candidates?.[0];
      if (candidate?.finishReason === 'MAX_TOKENS') throw new ProviderError(id, 'INCOMPLETE_RESPONSE', { code: 'MAX_TOKENS' });
      if (GEMINI_REFUSALS.has(candidate?.finishReason)) throw new ProviderError(id, 'REFUSAL', { code: candidate.finishReason });
      if (candidate?.finishReason !== 'STOP') throw new ProviderError(id, 'INVALID_RESPONSE', { code: safeCode(candidate?.finishReason) ?? 'finishReason' });
      return { text: (candidate.content?.parts || []).filter(part => !part?.thought).map(part => part?.text || '').join(''), usage: { inputTokens: tokens(response.usageMetadata?.promptTokenCount), outputTokens: tokens(response.usageMetadata?.candidatesTokenCount) + tokens(response.usageMetadata?.thoughtsTokenCount) }, model: response.modelVersion || model };
    },
  };

  /** OpenAI-compatible chat completions (xAI, Mistral) with a strict JSON schema. */
  async function chatCompletions(url, { model, system, user, schema, schemaName, maxOutputTokens }, extra) {
    const response = await postJson(fetchFn, id, url, { authorization: `Bearer ${key}` }, { model, max_tokens: maxOutputTokens, ...extra, messages: [{ role: 'system', content: system }, { role: 'user', content: user }], response_format: { type: 'json_schema', json_schema: { name: schemaName, schema, strict: true } } }, timeoutMs);
    const choice = response?.choices?.[0];
    if (choice?.finish_reason === 'length') throw new ProviderError(id, 'INCOMPLETE_RESPONSE', { code: 'length' });
    if (choice?.finish_reason === 'content_filter') throw new ProviderError(id, 'REFUSAL', { code: 'content_filter' });
    if (choice?.finish_reason !== 'stop') throw new ProviderError(id, 'INVALID_RESPONSE', { code: safeCode(choice?.finish_reason) ?? 'finish_reason' });
    return { text: choice.message?.content, usage: { inputTokens: tokens(response.usage?.prompt_tokens), outputTokens: tokens(response.usage?.completion_tokens) }, model: response.model || model };
  }

  return {
    ...base,
    async json(request) {
      requireConfigured();
      requirePdf(request.document);
      const model = modelFor(env, id, request.task ?? null, Boolean(request.complex));
      if (!priceFor(pricing, id, model, modelFor(env, id))) throw new ProviderError(id, 'NOT_CONFIGURED', { detail: `(no price for the ${request.task ?? 'default'} model)` });
      const result = await call[id]({ ...request, model });
      return { json: parseModelJson(id, result.text), usage: result.usage, model: result.model, requestedModel: model };
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
