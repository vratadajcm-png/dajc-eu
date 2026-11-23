import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { validateResumablePr, validateResumedEdition } from '../../resume-reviewed-weekly.mjs';
const targetWeek = '2026-W47';
const repository = 'example/dajc';
const prUrl = 'https://github.com/example/dajc/pull/123';
const expectedHead = 'a'.repeat(40);
const articlePath = 'src/content/news/eu-oversize/eu-oversize-weekly-2026-w47.md';
const auditPath = 'data/oversize/2026-W47/publication/456-2.json';
const source = 'https://authority.example/notice47';
const raw = `---\nsources:\n  - name: "Authority"\n    url: "${source}"\n---\nArticle content.\n`;
const pr = { url: prUrl, state: 'OPEN', baseRefName: 'main', baseRefOid: 'b'.repeat(40), headRefName: 'automation/weekly-2026-w47-retry-456-2', headRefOid: expectedHead, isDraft: false, isCrossRepository: false,
  body: '<!-- DAJC_WEEKLY_STATE:EDITORIAL_APPROVED -->\n<!-- DAJC_WEEKLY_ATTEMPT:456-2 -->' };
const audit = { schemaVersion: 1, attemptId: '456-2', state: 'EDITORIAL_APPROVED', targetWeek, articlePath, sha256: createHash('sha256').update(raw).digest('hex'),
  researchProvider: 'perplexity-search', claudeModel: 'claude-test', approvedAt: '2026-11-16T12:00:00Z', sourceCount: 1,
  review: { verdict: 'approve', blockingReasons: [], sourceChecks: [{ url: source, supported: true, reason: 'Confirmed by authority' }] } };
const input = { pr, repository, prUrl, expectedHead, targetWeek, raw, audit, changedPaths: [articlePath, auditPath, 'data/oversize/2026-W46/findings.json'] };

describe('resuming independently approved release without generation', () => {
  it('recovers exact approved pending attempt with same pinned PR head', () => {
    expect(validateResumedEdition(input)).toEqual({ articlePath, auditPath, attemptId: '456-2' });
    expect(validateResumablePr({ ...pr, headRefName: 'automation/weekly-2026-w47' }, input)).toBe('456-2');
    expect(validateResumablePr({ ...pr, headRefName: 'automation/weekly-2026-w47-retry-456' }, input)).toBe('456-2');
  });
  it('blocks changed heads, forks, closed PRs, drafts and wrong branches', () => {
    for (const change of [{ headRefOid: 'c'.repeat(40) }, { baseRefName: 'other' }, { state: 'MERGED' }, { isDraft: true }, { isCrossRepository: true }, { headRefName: 'automation/weekly-2026-w48' }]) {
      expect(() => validateResumedEdition({ ...input, pr: { ...pr, ...change } })).toThrow(/RESUME/);
    }
    expect(() => validateResumedEdition({ ...input, prUrl: 'https://github.com/other/repo/pull/123' })).toThrow(/RESUME/);
  });
  it('requires unique approval and attempt markers', () => {
    for (const body of ['', pr.body + '\n<!-- DAJC_WEEKLY_ATTEMPT:456-3 -->', pr.body + '\n<!-- DAJC_WEEKLY_STATE:EDITORIAL_REJECTED -->', pr.body.replace('EDITORIAL_APPROVED', 'EDITORIAL_REJECTED')]) {
      expect(() => validateResumedEdition({ ...input, pr: { ...pr, body } })).toThrow(/RESUME/);
    }
  });
  it('rejects stale receipts or a changed article without calling paid APIs', () => {
    for (const change of [{ raw: raw + 'Tampered' }, { audit: { ...audit, attemptId: '456-1' } }, { audit: { ...audit, review: { ...audit.review, verdict: 'reject' } } }]) {
      expect(() => validateResumedEdition({ ...input, ...change })).toThrow(/RESUME/);
    }
  });
  it('rejects source-code changes, other articles and extra audit files', () => {
    for (const extra of ['scripts/generate-weekly-article.mjs', '.github/workflows/news-ci.yml', 'src/content/news/eu-oversize/eu-oversize-weekly-2026-w48.md', 'data/oversize/2026-W47/publication/456-3.json']) {
      expect(() => validateResumedEdition({ ...input, changedPaths: [...input.changedPaths, extra] })).toThrow(/unexpected paths/);
    }
    expect(() => validateResumedEdition({ ...input, changedPaths: [articlePath] })).toThrow(/unexpected paths/);
  });
});
