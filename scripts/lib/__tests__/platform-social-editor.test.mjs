import { describe, it, expect } from 'vitest';
import { validateSocialCopy, createClaudeSocialCopy, xWeightedLength } from '../claude-social-copy.mjs';

const url = 'https://www.dajc.eu/news/eu-oversize/eu-oversize-weekly-2026-w44';
const article = { url, title: 'EU Oversize Weekly', description: 'European freight news', sections: ['Permit changes'] };

describe('channel-specific approved social editions', () => {
  it('requires the unchanged canonical article URL in each edition', () => {
    expect(validateSocialCopy('x', article, '🚛 Verified freight update ' + url)).toContain(url);
    expect(validateSocialCopy('linkedin', article, 'European freight update for dispatchers. Check the operational details: ' + url)).toContain(url);
    expect(() => validateSocialCopy('x', article, 'No link')).toThrow();
    expect(() => validateSocialCopy('linkedin', article, 'Read ' + url + ' again ' + url)).toThrow();
  });
  it('enforces separate channel-specific length constraints', () => {
    expect(() => validateSocialCopy('x', article, 'X'.repeat(270) + url)).toThrow();
    expect(() => validateSocialCopy('linkedin', article, 'Too short ' + url.slice(0, 10))).toThrow();
  });
  it('sends the correct independent editorial instructions to Claude', async () => {
    const calls = [];
    const fetchFn = async (_endpoint, options) => {
      const req = JSON.parse(options.body);
      calls.push(req.messages[0].content);
      const channel = calls.length === 1 ? 'x' : 'linkedin';
      const text = channel === 'x' ? '🚛 Verified weekly freight update ' + url : 'European transport operators face new operational updates. Read the source-grounded DAJC briefing: ' + url;
      return { ok: true, json: async () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ text }) }] }) };
    };
    await createClaudeSocialCopy('x', article, { apiKey: 'test', fetchFn });
    await createClaudeSocialCopy('linkedin', article, { apiKey: 'test', fetchFn });
    expect(calls[0]).toContain('X: write a punchy, specific headline/hook');
    expect(calls[1]).toContain('LinkedIn: write a distinctive professional B2B teaser');
    expect(calls[0]).not.toEqual(calls[1]);
  });
});

describe('X length as X counts it (first live X run, 24 October 2026)', () => {
  const longUrl = 'https://www.dajc.eu/news/platform/media-partnerships-transport-intelligence-2026';
  const platform = { url: longUrl, title: 'DAJC media partnerships', description: 'Three collaboration concepts', sections: [] };
  const reply = (text) => ({ ok: true, json: async () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ text }) }] }) });

  it('counts the article link as 23 characters and emoji as 2', () => {
    expect(xWeightedLength('Read ' + longUrl, longUrl)).toBe(5 + 23);
    expect(xWeightedLength('🚛 ' + longUrl, longUrl)).toBe(2 + 1 + 23);
  });

  it('accepts a post that fits on X even though the long URL makes it over 260 code points', () => {
    const text = 'A'.repeat(200) + ' ' + longUrl;
    expect(Array.from(text).length).toBeGreaterThan(260);
    expect(validateSocialCopy('x', platform, text)).toBe(text);
  });

  it('gives Claude the measured length once and keeps the shorter post', async () => {
    const bodies = [];
    const fetchFn = async (_endpoint, options) => {
      bodies.push(JSON.parse(options.body));
      return bodies.length === 1 ? reply('B'.repeat(250) + ' ' + longUrl) : reply('Short teaser ' + longUrl);
    };
    expect(await createClaudeSocialCopy('x', platform, { apiKey: 'test', fetchFn })).toBe('Short teaser ' + longUrl);
    expect(bodies).toHaveLength(2);
    expect(bodies[1].messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
    expect(bodies[1].messages[2].content).toMatch(/X characters too long/);
  });

  it('does not retry other failures and fails after one shortening attempt', async () => {
    let calls = 0;
    const noLink = async () => { calls += 1; return reply('No link at all'); };
    await expect(createClaudeSocialCopy('x', platform, { apiKey: 'test', fetchFn: noLink })).rejects.toThrow(/canonical article URL/);
    expect(calls).toBe(1);
    calls = 0;
    const tooLong = async () => { calls += 1; return reply('C'.repeat(300) + ' ' + longUrl); };
    await expect(createClaudeSocialCopy('x', platform, { apiKey: 'test', fetchFn: tooLong })).rejects.toThrow(/too long/);
    expect(calls).toBe(2);
  });
});
