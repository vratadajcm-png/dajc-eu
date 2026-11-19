import { describe, expect, it } from 'vitest';
import { identicalRejectedPreparation } from '../../check-weekly-preparation.mjs';
import { findingsFingerprint, REJECTION_MARKER, shouldReplaceBlockedEditionPr } from '../weekly-recovery.mjs';

const fingerprint = findingsFingerprint([{ sourceUrl: 'https://authority.example/notice', title: 'Permit rule', summary: 'Actual source facts' }]);
const draft = { number: 130, url: 'https://github.test/pull/130', headRefName: 'automation/weekly-2026-w47',
  body: REJECTION_MARKER + `\n<!-- DAJC_WEEKLY_SOURCES:${fingerprint} -->`, createdAt: '2026-11-12T09:00:00Z' };

describe('source-aware deduplication before paid generation', () => {
  it('blocks the exact rejected snapshot even after the PR was closed', () => {
    expect(identicalRejectedPreparation([{ ...draft, state: 'CLOSED' }], '2026-W47', fingerprint)).toEqual({ ...draft, state: 'CLOSED' });
  });
  it('permits actual changed source facts and distinguishes other target weeks/previews', () => {
    const changed = findingsFingerprint([{ sourceUrl: 'https://authority.example/notice', title: 'Permit rule', summary: 'Authority published a corrected rule' }]);
    expect(identicalRejectedPreparation([draft], '2026-W47', changed)).toBeNull();
    expect(identicalRejectedPreparation([draft], '2026-W48', fingerprint)).toBeNull();
    expect(identicalRejectedPreparation([{ ...draft, headRefName: 'automation/weekly-2026-w47-preview' }], '2026-W47', fingerprint)).toBeNull();
  });
  it('recognizes bounded retry identity including workflow reruns and the BLOCKED state', () => {
    const retry = { ...draft, headRefName: draft.headRefName + '-retry-12345-2', body: `<!-- DAJC_WEEKLY_STATE:BLOCKED -->\n<!-- DAJC_WEEKLY_SOURCES: ${fingerprint} -->` };
    expect(identicalRejectedPreparation([retry], '2026-W47', fingerprint)).toBe(retry);
    expect(shouldReplaceBlockedEditionPr(retry, [draft, retry], new Date('2026-11-16'))).toBe(true);
  });
  it('does not mistake an approved editorial preparation for a veto', () => {
    expect(identicalRejectedPreparation([{ ...draft, body: `<!-- DAJC_WEEKLY_STATE:EDITORIAL_APPROVED -->\n<!-- DAJC_WEEKLY_SOURCES:${fingerprint} -->` }], '2026-W47', fingerprint)).toBeNull();
  });
});
