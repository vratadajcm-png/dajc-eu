// HTTP clients for the three providers (§47.2 AI routing): OpenAI answers
// (classification and draft), Anthropic independently checks, Perplexity
// searches official domains. Plain fetch, no SDKs - the same approach as
// the article pipeline (scripts/lib/web-search.mjs) and no new npm
// dependencies. Keys and model names come from AskConfig (environment
// only); nothing here is ever bundled into client code.
//
// OpenAI is called with `store: false`: questions are not kept by the
// provider for later retrieval. The search engine never receives the
// user's question - only short keyword queries built by the classifier.

export type FetchFn = typeof fetch;

export class ProviderError extends Error {
  constructor(readonly provider: 'openai' | 'anthropic' | 'perplexity', message: string) {
    super(`${provider}: ${message}`);
    this.name = 'ProviderError';
  }
}

export interface ModelResult<T> {
  json: T;
  usage: { inputTokens: number; outputTokens: number };
}

export interface JsonCallParams {
  model: string;
  system: string;
  user: string;
  schemaName: string;
  schema: Record<string, unknown>;
  maxOutputTokens: number;
  signal?: AbortSignal;
}

export interface Providers {
  openaiJson<T>(params: JsonCallParams): Promise<ModelResult<T>>;
  anthropicJson<T>(params: JsonCallParams): Promise<ModelResult<T>>;
  search(params: { queries: string[]; domains: string[]; maxResults: number; signal?: AbortSignal }): Promise<Array<{ url: string; title: string }>>;
}

async function postJson(fetchFn: FetchFn, provider: ProviderError['provider'], url: string, headers: Record<string, string>, body: unknown, signal?: AbortSignal) {
  let res: Response;
  try {
    res = await fetchFn(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal });
  } catch (error) {
    throw new ProviderError(provider, (error as Error)?.name === 'AbortError' ? 'timeout' : 'network error');
  }
  // Never echo the response body: it can contain the request.
  if (!res.ok) throw new ProviderError(provider, `HTTP ${res.status}`);
  try {
    return await res.json();
  } catch {
    throw new ProviderError(provider, 'invalid JSON response');
  }
}

function parseJson<T>(provider: ProviderError['provider'], text: unknown): T {
  if (typeof text !== 'string' || !text) throw new ProviderError(provider, 'no structured output');
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ProviderError(provider, 'structured output is not JSON');
  }
}

export function createProviders({ openaiKey, anthropicKey, perplexityKey, fetchFn = fetch }: { openaiKey: string; anthropicKey: string; perplexityKey: string; fetchFn?: FetchFn }): Providers {
  return {
    async openaiJson<T>({ model, system, user, schemaName, schema, maxOutputTokens, signal }: JsonCallParams): Promise<ModelResult<T>> {
      const response = await postJson(fetchFn, 'openai', 'https://api.openai.com/v1/responses', { authorization: `Bearer ${openaiKey}` }, {
        model,
        store: false,
        max_output_tokens: maxOutputTokens,
        input: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        text: { format: { type: 'json_schema', name: schemaName, schema, strict: true } },
      }, signal);
      if (response?.status !== 'completed') throw new ProviderError('openai', `response ${response?.status || 'unknown'}`);
      const content = (response.output || []).filter((item: { type?: string }) => item?.type === 'message').flatMap((item: { content?: unknown[] }) => item.content || []);
      if (content.some((part: { type?: string }) => part?.type === 'refusal')) throw new ProviderError('openai', 'refusal');
      const text = content.find((part: { type?: string }) => part?.type === 'output_text') as { text?: string } | undefined;
      return {
        json: parseJson<T>('openai', text?.text),
        usage: { inputTokens: Number(response.usage?.input_tokens) || 0, outputTokens: Number(response.usage?.output_tokens) || 0 },
      };
    },

    async anthropicJson<T>({ model, system, user, schema, maxOutputTokens, signal }: JsonCallParams): Promise<ModelResult<T>> {
      const response = await postJson(fetchFn, 'anthropic', 'https://api.anthropic.com/v1/messages', { 'x-api-key': anthropicKey, 'anthropic-version': '2023-06-01' }, {
        model,
        max_tokens: maxOutputTokens,
        system,
        messages: [{ role: 'user', content: user }],
        output_config: { effort: 'medium', format: { type: 'json_schema', schema } },
      }, signal);
      // A refusal or a truncated answer is not a check that passed.
      if (response?.stop_reason !== 'end_turn') throw new ProviderError('anthropic', `stop_reason ${response?.stop_reason || 'unknown'}`);
      const text = (response.content || []).find((block: { type?: string }) => block?.type === 'text') as { text?: string } | undefined;
      return {
        json: parseJson<T>('anthropic', text?.text),
        usage: { inputTokens: Number(response.usage?.input_tokens) || 0, outputTokens: Number(response.usage?.output_tokens) || 0 },
      };
    },

    async search({ queries, domains, maxResults, signal }) {
      const response = await postJson(fetchFn, 'perplexity', 'https://api.perplexity.ai/search', { authorization: `Bearer ${perplexityKey}` }, {
        query: queries,
        max_results: maxResults,
        search_domain_filter: domains,
      }, signal);
      if (!Array.isArray(response?.results)) throw new ProviderError('perplexity', 'no results array');
      // Multi-query requests may group results per query.
      return (response.results.flat() as Array<{ url?: unknown; title?: unknown }>)
        .filter((r) => typeof r?.url === 'string')
        .map((r) => ({ url: r.url as string, title: String(r.title || '').slice(0, 250) }));
    },
  };
}
