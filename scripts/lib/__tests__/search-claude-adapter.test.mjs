import { describe, it, expect } from 'vitest';
import { searchWithPerplexitySearch, SEARCH_GROUPS } from '../web-search.mjs';
import { generateArticleWithClaude } from '../openai-client.mjs';

describe('Search → Claude fail-closed source flow', () => {
  it('never allows a Claude classifier to introduce URLs not returned by Search', async () => {
    const calls = [];
    const fetchFn = async (url, options) => {
      calls.push({ url, payload: JSON.parse(options.body) });
      if (url.endsWith('/search')) return { ok: true, json: async () => ({
        results: [{ url: 'https://example.org/official', title: 'Oversize permit news', snippet: 'Permit notice' }]
      }) };
      return { ok: true, json: async () => ({
        stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ items: [
          { country: 'Czechia', region: null, title: 'News', url: 'https://malicious.example/unlisted',
            sourceName: 'Fake', publishedAt: null, validFrom: null, validTo: null,
            summary: 'Unverified', type: 'permit_change', oversize: true }
        ] }) }]
      }) };
    };
    const result = await searchWithPerplexitySearch(SEARCH_GROUPS[0], 'oversize transport', {
      searchKey: 'test', claudeKey: 'test', fetchFn
    });
    expect(result).toEqual([]);
    expect(calls.map(x => x.url)).toEqual(['https://api.perplexity.ai/search', 'https://api.anthropic.com/v1/messages']);
    expect(calls[0].payload.max_results).toBeLessThanOrEqual(12);
  });

  it('refuses provider failure and missing credentials', async () => {
    await expect(searchWithPerplexitySearch(SEARCH_GROUPS[0], 'news', {
      searchKey: '', claudeKey: 'test',
    })).rejects.toThrow();
    await expect(searchWithPerplexitySearch(SEARCH_GROUPS[0], 'news', {
      searchKey: 'test', claudeKey: 'test',
      fetchFn: async () => ({ ok: false, status: 403 }),
    })).rejects.toThrow('HTTP 403');
  });

  it('Claude writer uses only provided verified candidates and structured schema', async () => {
    let request;
    const fetchFn = async (_url, options) => {
      request = JSON.parse(options.body);
      return { ok: true, json: async () => ({
        stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({
          seoTitle: 'Test', metaDescription: 'Test', intro: 'Test',
          developments: [], europeRoundup: [], operatorChecklist: []
        }) }]
      }) };
    };
    const output = await generateArticleWithClaude({
      candidates: [], targetWeekStart: '2026-10-26', targetWeekEnd: '2026-11-01',
      weekRangeLabel: 'W44', apiKey: 'test', fetchFn
    });
    expect(output.developments).toEqual([]);
    expect(request.output_config.format.type).toBe('json_schema');
    expect(request.messages[0].content).toContain('Verified candidates');
  });
});
