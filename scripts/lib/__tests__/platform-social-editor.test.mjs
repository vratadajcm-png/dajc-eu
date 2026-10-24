import { describe, it, expect } from 'vitest';
import { validateSocialCopy, createClaudeSocialCopy } from '../claude-social-copy.mjs';

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
    expect(calls[0]).toContain('X: create a concise standalone post');
    expect(calls[1]).toContain('LinkedIn: a distinct B2B professional summary');
    expect(calls[0]).not.toEqual(calls[1]);
  });
});
