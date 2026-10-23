import { describe, it, expect } from 'vitest';
import { parseCandidateArticle, reviewApproved } from '../../claude-weekly-review.mjs';
import { createClaudeSocialCopy, validateSocialCopy } from '../claude-social-copy.mjs';
import { checkSonarKeyPreflight } from '../preflight.mjs';
import { buildSearchPrompt, SEARCH_GROUPS, searchGroup } from '../web-search.mjs';

const articleUrl = 'https://www.dajc.eu/news/eu-oversize/eu-oversize-weekly-2026-w44';
const now = new Date('2026-10-22T11:00:00Z');
const source = 'https://example.com/authority/oversize-notice';
const markdown = [
 '---', 'title: "Weekly"', 'description: "European truck news"',
 'slug: "eu-oversize-weekly-2026-w44"', 'category: "eu-oversize"',
 'publishedAt: 2026-10-23T10:00:00.000Z', 'language: "en"', 'author: "DAJC"',
 'status: "published"', 'sources:',
 '  - name: "Road authority"', '    url: "' + source + '"', '---',
 '## Intro', 'Freight update',
 '## Lead reports', '### Height rule (Germany)', 'Operators should check height limits.',
 '*Source: [Road authority](' + source + ')*',
 '## Operator checklist', '- Review permits',
 '## Sources', '- [Road authority](' + source + ')',
].join('\n');

describe('Sonar / Claude / Buffer chain - nonpublishing gates', () => {
 it('requires a Sonar key for the scheduled writer, but not dry-run mock', () => {
   expect(checkSonarKeyPreflight({ mock: false, apiKey: '' }).ok).toBe(false);
   expect(checkSonarKeyPreflight({ mock: true, apiKey: '' }).ok).toBe(true);
   expect(checkSonarKeyPreflight({ mock: false, apiKey: 'dummy' }).ok).toBe(true);
 });
 it('uses Sonar chat completions for researched discovery while preserving canonical sources', async () => {
   const calls = [];
   const client = { chat: { completions: { create: async payload => {
     calls.push(payload);
     return { choices: [{ message: { content: JSON.stringify({ items: [] }) } }] };
   } } } };
   const result = await searchGroup(client, SEARCH_GROUPS[0], { now, focuses: ['oversize'] });
   expect(result).toMatchObject({ status: 'ok', items: [] });
   expect(calls[0].model).toBe('sonar-pro');
   expect(calls[0].response_format.type).toBe('json_schema');
   expect(calls[0].messages[1].content).toContain('OFFICIAL PRIMARY');
 });
 it('refuses wrong week or release date and requires all source reviews', () => {
   const candidate = parseCandidateArticle('src/content/news/eu-oversize/eu-oversize-weekly-2026-w44.md', markdown, now);
   expect(candidate.week).toBe('2026-W44');
   const approved = { verdict: 'approve', blockingReasons: [], sourceChecks: [{ url: source, supported: true, reason: 'supported by primary source' }] };
   expect(reviewApproved(approved, [source])).toBe(true);
   expect(reviewApproved({ ...approved, verdict: 'reject' }, [source])).toBe(false);
   expect(() => parseCandidateArticle('src/content/news/eu-oversize/eu-oversize-weekly-2026-w45.md', markdown, now)).toThrow();
 });
 it('rejects invented or missing X/LinkedIn links and enforces X size', () => {
   const article = { url: articleUrl };
   expect(validateSocialCopy('x', article, '🚛 News ' + articleUrl)).toContain(articleUrl);
   expect(() => validateSocialCopy('x', article, 'No link')).toThrow();
   expect(() => validateSocialCopy('x', article, 'x'.repeat(300) + ' ' + articleUrl)).toThrow();
 });
 it('renders and validates one Claude social post with an injected transport adapter', async () => {
   const article = { url: articleUrl, title: 'Oversize Weekly', description: 'New freight rules', sections: ['Permits'] };
   const fetchFn = async () => ({
     ok: true,
     json: async () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ text: '🚛 New freight updates ' + article.url }) }] }),
   });
   expect(await createClaudeSocialCopy('x', article, { apiKey: 'dummy', fetchFn })).toContain(articleUrl);
 });
});
