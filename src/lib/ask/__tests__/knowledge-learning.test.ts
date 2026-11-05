import { describe, expect, it } from 'vitest';
import {
  approveKnowledge, proposeKnowledge, retrieveApprovedKnowledge,
  type ProposalInput,
} from '../learning/knowledge';

const NOW = new Date('2026-11-05T08:00:00.000Z');
const sample: ProposalInput = {
  id: 'qa_review_00001',
  origin: 'OPT_IN_QA_REVIEW',
  topic: 'oversize_permit',
  jurisdiction: 'GB',
  scope: 'GLOBAL',
  organisationId: null,
  summary: 'An official guidance page describes the application procedure for abnormal loads.',
  officialSourceUrl: 'https://www.gov.uk/guidance/abnormal-loads',
  sourceQuote: 'Operators must follow the applicable official abnormal load notification procedure.',
  sourceCheckedAt: '2026-11-05T07:00:00.000Z',
  expiresAt: '2026-11-20T00:00:00.000Z',
  subjectOptedIn: true,
  humanSanitised: true,
};
const reviewed = (p: ProposalInput = sample) => approveKnowledge(proposeKnowledge(p, NOW), {
  reviewerId: 'reviewer-with-authority',
  verifiedOfficialQuote: true,
  approvedLegalScope: true,
  now: NOW,
});

describe('DAJC AI learning review gate (not a live service)', () => {
  it('never automatically approves a Q&A result', () => {
    const candidate = proposeKnowledge(sample, NOW);
    expect(candidate.status).toBe('PENDING');
    expect(candidate.reviewedBy).toBeNull();
    expect(retrieveApprovedKnowledge([candidate], { topic: 'oversize_permit', jurisdiction: 'GB', organisationId: null, now: NOW })).toEqual([]);
  });

  it('requires explicit opt-in for any question-based proposal', () => {
    expect(() => proposeKnowledge({ ...sample, subjectOptedIn: false }, NOW)).toThrow('CONSENT_REQUIRED');
    expect(() => proposeKnowledge({ ...sample, humanSanitised: false }, NOW)).toThrow('HUMAN_SANITISATION_REQUIRED');
  });

  it('rejects obvious private data and non-official websites', () => {
    expect(() => proposeKnowledge({ ...sample, summary: 'Please contact private.person@example.com about their permit application.' }, NOW)).toThrow('PERSONAL_DATA_DETECTED');
    expect(() => proposeKnowledge({ ...sample, officialSourceUrl: 'https://some-blog.example.com/road-permits' }, NOW)).toThrow('OFFICIAL_SOURCE_REQUIRED');
  });

  it('requires an actual explicit human review and checked official quote', () => {
    const candidate = proposeKnowledge(sample, NOW);
    expect(() => approveKnowledge(candidate, { reviewerId: 'reviewer', verifiedOfficialQuote: false, approvedLegalScope: true, now: NOW })).toThrow('HUMAN_REVIEW_REQUIRED');
    expect(approveKnowledge(candidate, { reviewerId: 'reviewer', verifiedOfficialQuote: true, approvedLegalScope: true, now: NOW }).status).toBe('APPROVED');
  });

  it('enforces tenant isolation at retrieval time', () => {
    const privateKnowledge = reviewed({ ...sample, id: 'qa_review_private1', scope: 'ORGANISATION', organisationId: 'carrier-A' });
    const query = { topic: 'oversize_permit' as const, jurisdiction: 'GB', organisationId: 'carrier-B', now: NOW };
    expect(retrieveApprovedKnowledge([privateKnowledge], query)).toEqual([]);
    expect(retrieveApprovedKnowledge([privateKnowledge], { ...query, organisationId: null })).toEqual([]);
    expect(retrieveApprovedKnowledge([privateKnowledge], { ...query, organisationId: 'carrier-A' })).toHaveLength(1);
    expect(() => proposeKnowledge({ ...sample, scope: 'ORGANISATION', organisationId: null }, NOW)).toThrow('ORGANISATION_REQUIRED');
  });

  it('never supplies driving bans from a second knowledge base', () => {
    expect(() => proposeKnowledge({ ...sample, topic: 'driving_ban' }, NOW)).toThrow('DRIVING_BANS_REGISTRY_ONLY');
    expect(retrieveApprovedKnowledge([reviewed()], { topic: 'driving_ban', jurisdiction: 'GB', organisationId: null, now: NOW })).toEqual([]);
  });

  it('expires stale knowledge even when previously approved', () => {
    const record = reviewed();
    expect(retrieveApprovedKnowledge([record], { topic: 'oversize_permit', jurisdiction: 'GB', organisationId: null, now: NOW })).toHaveLength(1);
    expect(retrieveApprovedKnowledge([record], { topic: 'oversize_permit', jurisdiction: 'GB', organisationId: null, now: new Date('2026-11-21T00:00:00.000Z') })).toEqual([]);
    expect(retrieveApprovedKnowledge([record], { topic: 'oversize_permit', jurisdiction: 'FR', organisationId: null, now: NOW })).toEqual([]);
    expect(() => proposeKnowledge({ ...sample, expiresAt: '2027-08-01T00:00:00.000Z' }, NOW)).toThrow('INVALID_FRESHNESS');
  });

  it('returns citations and dates, not private reviewer or tenant identity', () => {
    const record = reviewed();
    const found = retrieveApprovedKnowledge([record], { topic: 'oversize_permit', jurisdiction: 'GB', organisationId: null, now: NOW });
    expect(found[0]).toMatchObject({ officialSourceUrl: sample.officialSourceUrl, sourceQuote: sample.sourceQuote });
    expect(JSON.stringify(found)).not.toContain('reviewer-with-authority');
    expect(JSON.stringify(found)).not.toContain('organisationId');
  });
});
