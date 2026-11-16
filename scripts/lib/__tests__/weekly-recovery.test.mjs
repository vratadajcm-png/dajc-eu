import { describe, expect, it } from 'vitest';
import { REJECTION_MARKER, selectRejectedSourceUrls, shouldReplaceBlockedEditionPr } from '../weekly-recovery.mjs';

const links = ['https://authority.example/valid', 'https://publisher.example/unsupported'];
describe('bounded independent editorial recovery', () => {
  it('removes only exact reviewer-rejected URLs when every source was checked', () => {
    expect(selectRejectedSourceUrls({ verdict: 'reject', blockingReasons: ['Unsupported claim'], sourceChecks: [
      { url: links[0], supported: true, reason: 'Confirmed' },
      { url: links[1], supported: false, reason: 'Not supported' },
    ] }, links)).toEqual([links[1]]);
  });
  it('refuses incomplete, duplicate, invented or approval-shaped rejection records', () => {
    for (const review of [
      { verdict: 'reject', blockingReasons: ['Issue'], sourceChecks: [{ url: links[1], supported: false }] },
      { verdict: 'reject', blockingReasons: ['Issue'], sourceChecks: [{ url: links[1], supported: false }, { url: links[1], supported: false }] },
      { verdict: 'reject', blockingReasons: ['Issue'], sourceChecks: [{ url: 'https://unknown.example/', supported: false }, { url: links[1], supported: false }] },
      { verdict: 'approve', blockingReasons: [], sourceChecks: [{ url: links[0], supported: true }, { url: links[1], supported: false }] },
    ]) expect(selectRejectedSourceUrls(review, links)).toEqual([]);
  });
  it('refreshes only old blocked publication PRs with a finite number of attempts', () => {
    const now = new Date('2026-11-13T16:00:00Z');
    const draft = { headRefName: 'automation/weekly-2026-w47', url: 'https://github.test/pull/1', body: REJECTION_MARKER, createdAt: '2026-11-12T11:00:00Z', updatedAt: '2026-11-12T11:00:00Z' };
    expect(shouldReplaceBlockedEditionPr(draft, [draft], now)).toBe(true);
    expect(shouldReplaceBlockedEditionPr(draft, [draft], new Date('2026-11-12T12:00:00Z'))).toBe(false);
    expect(shouldReplaceBlockedEditionPr({ ...draft, body: 'Claude approved, CI pending' }, [draft], now)).toBe(false);
    expect(shouldReplaceBlockedEditionPr({ ...draft, updatedAt: '2026-11-13T15:00:00Z' }, [draft], now)).toBe(false);
    expect(shouldReplaceBlockedEditionPr(draft, [draft, { headRefName: 'automation/weekly-2026-w47-retry-2' }, { headRefName: 'automation/weekly-2026-w47-retry-3' }], now)).toBe(false);
  });
});
