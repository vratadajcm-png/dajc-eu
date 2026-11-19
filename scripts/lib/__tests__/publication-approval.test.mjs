import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { publicationApprovalValid, protectedMergeState } from '../publication-approval.mjs';
const raw = '---\nsources:\n  - name: "Authority"\n    url: "https://authority.example/notice"\n---\nEvidence-bound article';
const article = { articlePath: 'src/content/news/eu-oversize/eu-oversize-weekly-2026-w47.md', targetWeek: '2026-W47', raw };
const record = () => ({ schemaVersion: 1, state: 'EDITORIAL_APPROVED', ...article, raw: undefined,
  sha256: createHash('sha256').update(raw).digest('hex'), researchProvider: 'perplexity-search', claudeModel: 'claude-sonnet-5-5',
  approvedAt: '2026-11-16T17:00:00Z', attemptId: '12345-1', sourceCount: 1,
  review: { verdict: 'approve', blockingReasons: [], sourceChecks: [{ url: 'https://authority.example/notice', supported: true, reason: 'Original source supports every claim' }] } });

describe('durable exact-byte editorial approval', () => {
  it('accepts a complete independent approval of exact edition bytes', () => expect(publicationApprovalValid(record(), article)).toBe(true));
  it('blocks changed article bytes and a receipt for another week', () => {
    expect(publicationApprovalValid(record(), { ...article, raw: raw + ' changed claim' })).toBe(false);
    expect(publicationApprovalValid({ ...record(), targetWeek: '2026-W48' }, article)).toBe(false);
  });
  it('blocks rejected, absent, partial and unsupported source reviews', () => {
    for (const review of [null, { ...record().review, verdict: 'reject' }, { ...record().review, blockingReasons: ['stale'] }, { ...record().review, sourceChecks: [] },
      { ...record().review, sourceChecks: [{ url: 'https://authority.example/notice', supported: false, reason: 'Unsupported claim' }] }]) {
      expect(publicationApprovalValid({ ...record(), review }, article)).toBe(false);
    }
    expect(publicationApprovalValid({ ...record(), state: 'EDITORIAL_REJECTED' }, article)).toBe(false);
  });
});
const head = 'a'.repeat(40);
const pr = () => ({ headRefOid: head, baseRefName: 'main', state: 'OPEN', isDraft: false,
  body: '<!-- DAJC_WEEKLY_STATE:EDITORIAL_APPROVED -->', statusCheckRollup: [{ conclusion: 'SUCCESS' }], mergeStateStatus: 'CLEAN' });
const checks = () => ['application-validate', 'news-validate'].map(name => ({ name, bucket: 'pass' }));
describe('protected exact-head merge', () => {
  it('merges only the exact approved head after both required checks', () => expect(protectedMergeState(pr(), checks(), head).status).toBe('ready'));
  it('blocks a stale head, draft, rejected PR, or unprotected main', () => {
    for (const p of [{ ...pr(), headRefOid: 'b'.repeat(40) }, { ...pr(), isDraft: true }, { ...pr(), body: 'REJECTED_BY_CLAUDE' }]) expect(protectedMergeState(p, checks(), head).status).toBe('blocked');
    expect(protectedMergeState(pr(), [], head).status).toBe('blocked');
    expect(protectedMergeState(pr(), [{ name: 'irrelevant', bucket: 'pass' }], head).status).toBe('blocked');
  });
  it('waits for pending CI and stops on CI or Vercel failure', () => {
    expect(protectedMergeState(pr(), [{ ...checks()[0], bucket: 'pending' }, checks()[1]], head).status).toBe('pending');
    expect(protectedMergeState(pr(), [{ ...checks()[0], bucket: 'fail' }, checks()[1]], head).status).toBe('blocked');
    expect(protectedMergeState({ ...pr(), statusCheckRollup: [{ name: 'Vercel', conclusion: 'FAILURE' }] }, checks(), head).status).toBe('blocked');
  });
});
