/**
 * DAJC AI Learning — phase A, OFFLINE policy kernel.
 *
 * This module intentionally does NOT read conversations, write to Postgres,
 * call providers, or alter the Driving Bans registry. It can evaluate a
 * human-curated, source-backed knowledge proposal but never self-promotes
 * an answer into a shared fact. Calling code must independently enforce
 * reviewer RBAC, consent collection, retention and persistence controls.
 */
import { isAllowedSourceUrl } from '../official-sources';
import type { Topic } from '../own-data';

export type KnowledgeScope = 'GLOBAL' | 'ORGANISATION';
export type ProposalOrigin = 'OPT_IN_QA_REVIEW' | 'OFFICIAL_SOURCE_REVIEW';
export type KnowledgeStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'REVOKED';

export interface LearningProposal {
  id: string;
  origin: ProposalOrigin;
  topic: Exclude<Topic, 'driving_ban'>;
  jurisdiction: string | null;
  scope: KnowledgeScope;
  organisationId: string | null;
  /** A newly written, human-sanitised summary — NEVER raw user text. */
  summary: string;
  officialSourceUrl: string;
  /** Verified against the official source by a reviewer, not the model. */
  sourceQuote: string;
  sourceCheckedAt: string;
  expiresAt: string;
  status: KnowledgeStatus;
  reviewedBy: string | null;
  reviewedAt: string | null;
}

export type ProposalInput = Omit<LearningProposal,
  'status' | 'reviewedBy' | 'reviewedAt'> & {
  /** Explicit, documented opt-in required to repurpose any Q&A observation. */
  subjectOptedIn: boolean;
  /** Humans must rewrite/sanitise content before creating a proposal. */
  humanSanitised: boolean;
};

function parsedDate(value: string): number | null {
  const ms = Date.parse(value);
  return Number.isFinite(ms) && new Date(ms).toISOString() === value ? ms : null;
}

function hasObviousPersonalData(value: string): boolean {
  return /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,}/u.test(value)
    || /\+\d[\d\s()/-]{7,}\d/.test(value)
    || /\b[A-HJ-NPR-Z0-9]{17}\b/i.test(value); // VIN, not complete PII detection
}

/**
 * The policy is deliberately narrower than what a language model can do.
 * Callers MUST validate all fields and check reviewer permissions server-side.
 * For driving bans, the single verified registry is authoritative; this
 * parallel knowledge store may never grant a legal/route determination.
 */
export function proposeKnowledge(input: ProposalInput, now: Date): LearningProposal {
  if (input.topic === 'driving_ban') throw new Error('DRIVING_BANS_REGISTRY_ONLY');
  if (!/^[a-zA-Z0-9_-]{8,128}$/.test(input.id)) throw new Error('INVALID_ID');
  if (!['OPT_IN_QA_REVIEW', 'OFFICIAL_SOURCE_REVIEW'].includes(input.origin)) throw new Error('INVALID_ORIGIN');
  if (input.origin === 'OPT_IN_QA_REVIEW' && !input.subjectOptedIn) throw new Error('CONSENT_REQUIRED');
  if (!input.humanSanitised) throw new Error('HUMAN_SANITISATION_REQUIRED');
  if (input.scope !== 'GLOBAL' && input.scope !== 'ORGANISATION') throw new Error('INVALID_SCOPE');
  if (input.scope === 'ORGANISATION' && !input.organisationId?.trim()) throw new Error('ORGANISATION_REQUIRED');
  if (input.scope === 'GLOBAL' && input.organisationId !== null) throw new Error('GLOBAL_MUST_NOT_HAVE_ORGANISATION');
  if (input.jurisdiction !== null && !/^[A-Z]{2}$/.test(input.jurisdiction)) throw new Error('INVALID_JURISDICTION');
  if (input.summary.length < 20 || input.summary.length > 1000 || input.sourceQuote.length < 20 || input.sourceQuote.length > 2000) {
    throw new Error('INVALID_TEXT_LENGTH');
  }
  if (hasObviousPersonalData(input.summary) || hasObviousPersonalData(input.sourceQuote)) throw new Error('PERSONAL_DATA_DETECTED');
  if (!isAllowedSourceUrl(input.officialSourceUrl)) throw new Error('OFFICIAL_SOURCE_REQUIRED');
  const checked = parsedDate(input.sourceCheckedAt);
  const expires = parsedDate(input.expiresAt);
  if (checked === null || expires === null || checked > now.getTime() || expires <= now.getTime() || expires > now.getTime() + 90 * 86_400_000) {
    throw new Error('INVALID_FRESHNESS');
  }
  return {
    id: input.id, origin: input.origin, topic: input.topic, jurisdiction: input.jurisdiction,
    scope: input.scope, organisationId: input.organisationId, summary: input.summary.trim(),
    officialSourceUrl: input.officialSourceUrl, sourceQuote: input.sourceQuote.trim(),
    sourceCheckedAt: input.sourceCheckedAt, expiresAt: input.expiresAt,
    status: 'PENDING', reviewedBy: null, reviewedAt: null,
  };
}

/**
 * NOT an authorization boundary: only an independently authenticated,
 * explicitly permitted review service may invoke this transition.
 */
export function approveKnowledge(
  proposal: LearningProposal,
  review: { reviewerId: string; verifiedOfficialQuote: boolean; approvedLegalScope: boolean; now: Date },
): LearningProposal {
  if (proposal.status !== 'PENDING') throw new Error('NOT_PENDING');
  if (!review.reviewerId?.trim() || !review.verifiedOfficialQuote || !review.approvedLegalScope) throw new Error('HUMAN_REVIEW_REQUIRED');
  if (!isKnowledgeFresh(proposal, review.now)) throw new Error('STALE_EVIDENCE');
  return { ...proposal, status: 'APPROVED', reviewedBy: review.reviewerId, reviewedAt: review.now.toISOString() };
}

export function isKnowledgeFresh(proposal: LearningProposal, now: Date): boolean {
  const checked = parsedDate(proposal.sourceCheckedAt);
  const expires = parsedDate(proposal.expiresAt);
  const ageMs = checked === null ? Infinity : now.getTime() - checked;
  return checked !== null && expires !== null && ageMs >= 0 &&
    ageMs <= 30 * 86_400_000 && now.getTime() < expires;
}

export interface KnowledgeQuery {
  topic: Topic;
  jurisdiction: string | null;
  organisationId: string | null;
  now: Date;
}

/** Deny by default: approved, recent, matched, tenant-scoped, and cited. */
export function retrieveApprovedKnowledge(entries: LearningProposal[], query: KnowledgeQuery): Array<Pick<LearningProposal,
  'id' | 'summary' | 'officialSourceUrl' | 'sourceQuote' | 'sourceCheckedAt' | 'expiresAt'>> {
  // Never bypass the Driving Bans query service or its independent verification.
  if (query.topic === 'driving_ban') return [];
  return entries.filter((entry) =>
    entry.status === 'APPROVED' &&
    entry.topic === query.topic &&
    (entry.jurisdiction === null || entry.jurisdiction === query.jurisdiction) &&
    (entry.scope === 'GLOBAL' || (query.organisationId !== null && entry.organisationId === query.organisationId)) &&
    Boolean(entry.reviewedBy && entry.reviewedAt) &&
    isAllowedSourceUrl(entry.officialSourceUrl) &&
    isKnowledgeFresh(entry, query.now)
  ).map(({ id, summary, officialSourceUrl, sourceQuote, sourceCheckedAt, expiresAt }) => ({
    id, summary, officialSourceUrl, sourceQuote, sourceCheckedAt, expiresAt,
  }));
}
