import { describe, expect, it } from 'vitest';
import { trustedReceiptMatches } from '../trusted-weekly-approval.mjs';
const receipt = { articlePath: 'src/content/news/eu-oversize/eu-oversize-weekly-2026-w47.md', sha256: 'abc', targetWeek: '2026-W47', approvedAt: '2026-11-16T17:00:00Z', review: { verdict: 'approve', sourceChecks: [{ url: 'https://example.test', supported: true }] } };
const record = { ...receipt, attemptId: '123-1', state: 'EDITORIAL_APPROVED' };
const run = { id: 123, run_attempt: 1, path: '.github/workflows/publish-weekly-oversize.yml', head_branch: 'main', event: 'workflow_dispatch' };
describe('trusted main-run approval artifact', () => {
  it('accepts only the matching independent review from the main publishing workflow', () => expect(trustedReceiptMatches(record, receipt, run)).toBe(true));
  it('blocks a fabricated receipt, changed claim hash or changed verdict', () => {
    expect(trustedReceiptMatches({ ...record, sha256: 'changed' }, receipt, run)).toBe(false);
    expect(trustedReceiptMatches({ ...record, review: { verdict: 'reject' } }, receipt, run)).toBe(false);
  });
  it('blocks PR workflows, another workflow, another run and another attempt', () => {
    for (const changed of [{ event: 'pull_request' }, { head_branch: 'untrusted' }, { path: '.github/workflows/news-ci.yml' }, { id: 456 }, { run_attempt: 2 }]) expect(trustedReceiptMatches(record, receipt, { ...run, ...changed })).toBe(false);
  });
});
