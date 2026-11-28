import { describe, expect, it } from 'vitest';
import { createProviders, ProviderError } from '../providers';

function fakeFetch(response: unknown, status = 200) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(response), { status, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const KEYS = { openaiKey: 'ok-test', anthropicKey: 'ak-test', perplexityKey: 'pk-test' };
const PARAMS = { model: 'model-from-env', system: 'sys', user: 'usr', schemaName: 'x', schema: { type: 'object' }, maxOutputTokens: 100 };

describe('provider clients', () => {
  it('OpenAI: structured output, store=false, model from configuration', async () => {
    const { fn, calls } = fakeFetch({
      status: 'completed',
      output: [{ type: 'reasoning' }, { type: 'message', content: [{ type: 'output_text', text: '{"a":1}' }] }],
      usage: { input_tokens: 12, output_tokens: 3 },
    });
    const result = await createProviders({ ...KEYS, fetchFn: fn }).openaiJson<{ a: number }>(PARAMS);
    expect(result).toEqual({ json: { a: 1 }, usage: { inputTokens: 12, outputTokens: 3 } });
    expect(calls[0].url).toBe('https://api.openai.com/v1/responses');
    const body = JSON.parse(String(calls[0].init.body));
    expect(body).toMatchObject({ model: 'model-from-env', store: false, text: { format: { type: 'json_schema', strict: true } } });
    expect((calls[0].init.headers as Record<string, string>).authorization).toBe('Bearer ok-test');
  });

  it('OpenAI: refusals and incomplete responses are errors', async () => {
    const refusal = fakeFetch({ status: 'completed', output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'no' }] }] });
    await expect(createProviders({ ...KEYS, fetchFn: refusal.fn }).openaiJson(PARAMS)).rejects.toThrow(ProviderError);
    const incomplete = fakeFetch({ status: 'incomplete', output: [] });
    await expect(createProviders({ ...KEYS, fetchFn: incomplete.fn }).openaiJson(PARAMS)).rejects.toThrow(/incomplete/);
  });

  it('Anthropic: structured output and only a finished turn counts', async () => {
    const ok = fakeFetch({ stop_reason: 'end_turn', content: [{ type: 'text', text: '{"results":[]}' }], usage: { input_tokens: 5, output_tokens: 2 } });
    const result = await createProviders({ ...KEYS, fetchFn: ok.fn }).anthropicJson(PARAMS);
    expect(result.json).toEqual({ results: [] });
    const body = JSON.parse(String(ok.calls[0].init.body));
    expect(ok.calls[0].url).toBe('https://api.anthropic.com/v1/messages');
    expect(body).toMatchObject({ model: 'model-from-env', output_config: { format: { type: 'json_schema' } } });
    expect(body).not.toHaveProperty('temperature');
    for (const reason of ['refusal', 'max_tokens']) {
      const bad = fakeFetch({ stop_reason: reason, content: [{ type: 'text', text: '{}' }] });
      await expect(createProviders({ ...KEYS, fetchFn: bad.fn }).anthropicJson(PARAMS)).rejects.toThrow(ProviderError);
    }
  });

  it('Perplexity: restricted to the given domains', async () => {
    const { fn, calls } = fakeFetch({ results: [[{ url: 'https://www.gov.pl/a', title: 'A' }], [{ url: 'https://www.gov.pl/b' }]] });
    const results = await createProviders({ ...KEYS, fetchFn: fn }).search({ queries: ['zakaz ruchu'], domains: ['gov.pl'], maxResults: 5 });
    expect(results.map((r) => r.url)).toEqual(['https://www.gov.pl/a', 'https://www.gov.pl/b']);
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ query: ['zakaz ruchu'], max_results: 5, search_domain_filter: ['gov.pl'] });
  });

  it('never echoes a provider error body (it can contain the question)', async () => {
    const { fn } = fakeFetch({ error: 'the user question was: secret' }, 500);
    await expect(createProviders({ ...KEYS, fetchFn: fn }).openaiJson(PARAMS)).rejects.toThrow(/^openai: HTTP 500$/);
  });
});
