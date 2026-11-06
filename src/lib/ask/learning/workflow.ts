// Controlled learning workflow on top of the offline policy (knowledge.ts):
//
//   question -> feedback -> proposal -> source check -> independent
//   verification -> approval -> publication (retrievable by the pipeline)
//
// - Only users the owner granted KNOWLEDGE_REVIEWER (dajc_ask.reviewers,
//   written with an administrative connection only) may act.
// - Four eyes: the source check and the verification are made by two
//   different reviewers, neither of them the proposer, and the proposer
//   never approves (also enforced by a database constraint).
// - Driving bans are excluded: the published registry is their authority.
// - Customer feedback becomes a proposal only if the user gave the
//   SHARED_LEARNING consent AND the legal policy is approved
//   (DAJC_AI_SHARED_LEARNING_POLICY_APPROVED, false). Reviewers always
//   rewrite the content; no raw customer text is ever published.
// - Published knowledge expires (max 90 days) and must be re-reviewed.

import { z } from 'zod';
import { DAJC_AI_SHARED_LEARNING_POLICY_APPROVED } from '../account/service';
import type { Topic } from '../own-data';
import type { KnowledgeRow, KnowledgeStatusRow, PaidStore } from '../store/paid-types';
import { approveKnowledge, proposeKnowledge, retrieveApprovedKnowledge, type LearningProposal } from './knowledge';

export interface LearningDeps {
  paid: PaidStore;
  now?: () => Date;
}

export type LearningOutcome =
  | { status: 'ok'; entry: KnowledgeRow }
  | { status: 'forbidden' | 'not_found' | 'conflict' | 'four_eyes' | 'policy_not_approved' | 'no_consent' }
  | { status: 'invalid'; reason: string };

const nowOf = (deps: LearningDeps) => deps.now?.() ?? new Date();
const actor = (userId: string) => `reviewer:${userId}`;

function toProposal(row: KnowledgeRow): LearningProposal {
  return {
    id: row.id, origin: row.origin, topic: row.topic as Topic, jurisdiction: row.jurisdiction, scope: row.scope, organisationId: row.organisationId,
    summary: row.summary, officialSourceUrl: row.officialSourceUrl, sourceQuote: row.sourceQuote,
    sourceCheckedAt: row.sourceCheckedAt.toISOString(), expiresAt: row.expiresAt.toISOString(),
    status: row.status === 'APPROVED' ? 'APPROVED' : row.status === 'REJECTED' ? 'REJECTED' : row.status === 'REVOKED' ? 'REVOKED' : 'PENDING',
    reviewedBy: row.approvedBy, reviewedAt: row.reviewedAt?.toISOString() ?? null,
  };
}

async function isReviewer(userId: string, deps: LearningDeps) {
  return deps.paid.isReviewer(userId, 'KNOWLEDGE_REVIEWER');
}

export interface ProposalFields {
  id: string;
  topic: Topic;
  jurisdiction: string | null;
  summary: string;
  officialSourceUrl: string;
  sourceQuote: string;
  sourceCheckedAt: string;
  expiresAt: string;
  feedbackId?: string;
}

const proposalFieldsSchema = z.object({
  id: z.string(), topic: z.string(), jurisdiction: z.string().nullable(), summary: z.string(), officialSourceUrl: z.string(),
  sourceQuote: z.string(), sourceCheckedAt: z.string(), expiresAt: z.string(), feedbackId: z.string().uuid().optional(),
}).strict();

/** A reviewer proposes knowledge, from an official source or (policy permitting) from consented feedback. */
export async function propose(reviewerId: string, rawFields: unknown, deps: LearningDeps): Promise<LearningOutcome> {
  if (!(await isReviewer(reviewerId, deps))) return { status: 'forbidden' };
  const parsed = proposalFieldsSchema.safeParse(rawFields);
  if (!parsed.success) return { status: 'invalid', reason: 'INVALID_FIELDS' };
  const fields = parsed.data as ProposalFields;
  const now = nowOf(deps);
  let origin: LearningProposal['origin'] = 'OFFICIAL_SOURCE_REVIEW';
  let optedIn = false;
  if (fields.feedbackId) {
    if (!DAJC_AI_SHARED_LEARNING_POLICY_APPROVED) return { status: 'policy_not_approved' };
    const feedback = (await deps.paid.listFeedback('TRIAGED', 500)).find((f) => f.id === fields.feedbackId);
    if (!feedback) return { status: 'not_found' };
    if (!feedback.sharedLearningConsent) return { status: 'no_consent' };
    origin = 'OPT_IN_QA_REVIEW';
    optedIn = true;
  }
  let proposal: LearningProposal;
  try {
    proposal = proposeKnowledge({ ...fields, origin, scope: 'GLOBAL', organisationId: null, subjectOptedIn: optedIn, humanSanitised: true }, now);
  } catch (error) {
    return { status: 'invalid', reason: (error as Error).message };
  }
  const row: KnowledgeRow = {
    ...proposal, sourceCheckedAt: new Date(proposal.sourceCheckedAt), expiresAt: new Date(proposal.expiresAt), status: 'PENDING',
    proposedBy: actor(reviewerId), sourceCheckedBy: null, verifiedBy: null, approvedBy: null, reviewedAt: null, version: 1,
  };
  if ((await deps.paid.insertKnowledge(row, now)) === 'exists') return { status: 'conflict' };
  if (fields.feedbackId) await deps.paid.setFeedbackStatus(fields.feedbackId, 'PROPOSED');
  await deps.paid.appendAudit({ actor: actor(reviewerId), action: 'KNOWLEDGE_PROPOSED', subject: `knowledge:${row.id}`, details: { origin, topic: row.topic, jurisdiction: row.jurisdiction } }, now);
  return { status: 'ok', entry: row };
}

async function transition(reviewerId: string, id: string, from: KnowledgeStatusRow, patch: (row: KnowledgeRow, now: Date) => Partial<KnowledgeRow> | LearningOutcome, action: string, deps: LearningDeps): Promise<LearningOutcome> {
  if (!(await isReviewer(reviewerId, deps))) return { status: 'forbidden' };
  const now = nowOf(deps);
  const row = await deps.paid.getKnowledge(id);
  if (!row) return { status: 'not_found' };
  if (row.status !== from) return { status: 'conflict' };
  const change = patch(row, now);
  if ('status' in change && typeof change.status === 'string' && !['PENDING', 'SOURCE_CHECKED', 'VERIFIED', 'APPROVED', 'REJECTED', 'REVOKED'].includes(change.status)) return change as LearningOutcome;
  try {
    if (!(await deps.paid.updateKnowledge(id, { status: row.status, version: row.version }, change as Partial<KnowledgeRow>, now))) return { status: 'conflict' };
  } catch (error) {
    if ((error as Error).message === 'FOUR_EYES') return { status: 'four_eyes' };
    throw error;
  }
  await deps.paid.appendAudit({ actor: actor(reviewerId), action, subject: `knowledge:${id}`, details: { from, to: (change as Partial<KnowledgeRow>).status } }, now);
  return { status: 'ok', entry: (await deps.paid.getKnowledge(id))! };
}

/** Reviewer A confirms the quote at the official source. */
export function confirmSource(reviewerId: string, id: string, deps: LearningDeps) {
  return transition(reviewerId, id, 'PENDING', (row) => (row.proposedBy === actor(reviewerId) ? { status: 'four_eyes' } as LearningOutcome : { status: 'SOURCE_CHECKED', sourceCheckedBy: actor(reviewerId) }), 'KNOWLEDGE_SOURCE_CHECKED', deps);
}

/** Reviewer B independently verifies the statement against the source. */
export function verifyIndependently(reviewerId: string, id: string, deps: LearningDeps) {
  return transition(reviewerId, id, 'SOURCE_CHECKED', (row) => (row.proposedBy === actor(reviewerId) || row.sourceCheckedBy === actor(reviewerId)
    ? { status: 'four_eyes' } as LearningOutcome
    : { status: 'VERIFIED', verifiedBy: actor(reviewerId) }), 'KNOWLEDGE_VERIFIED', deps);
}

/** Approval publishes the entry; the policy kernel re-checks freshness and scope. */
export function approve(reviewerId: string, id: string, review: { approvedLegalScope: boolean }, deps: LearningDeps) {
  return transition(reviewerId, id, 'VERIFIED', (row, now) => {
    if (row.proposedBy === actor(reviewerId)) return { status: 'four_eyes' } as LearningOutcome;
    try {
      approveKnowledge(toProposal(row), { reviewerId: actor(reviewerId), verifiedOfficialQuote: true, approvedLegalScope: review.approvedLegalScope, now });
    } catch (error) {
      return { status: 'invalid', reason: (error as Error).message } as LearningOutcome;
    }
    return { status: 'APPROVED', approvedBy: actor(reviewerId), reviewedAt: now };
  }, 'KNOWLEDGE_APPROVED', deps);
}

export async function reject(reviewerId: string, id: string, deps: LearningDeps) {
  const row = await deps.paid.getKnowledge(id);
  if (!row || !['PENDING', 'SOURCE_CHECKED', 'VERIFIED'].includes(row.status)) return { status: row ? 'conflict' : 'not_found' } as LearningOutcome;
  return transition(reviewerId, id, row.status, () => ({ status: 'REJECTED' }), 'KNOWLEDGE_REJECTED', deps);
}

/** Withdraws published knowledge immediately (e.g. the rule changed). */
export function revoke(reviewerId: string, id: string, deps: LearningDeps) {
  return transition(reviewerId, id, 'APPROVED', () => ({ status: 'REVOKED' }), 'KNOWLEDGE_REVOKED', deps);
}

/** Published, fresh, cited knowledge for the pipeline (never for driving bans). */
export async function publishedKnowledge(query: { topic: Topic; jurisdictions: string[] }, deps: LearningDeps) {
  if (query.topic === 'driving_ban') return [];
  const now = nowOf(deps);
  const entries = (await deps.paid.listKnowledge({ status: 'APPROVED', topic: query.topic })).map(toProposal);
  const seen = new Set<string>();
  const result: ReturnType<typeof retrieveApprovedKnowledge> = [];
  for (const jurisdiction of query.jurisdictions.length ? query.jurisdictions : [null]) {
    for (const entry of retrieveApprovedKnowledge(entries, { topic: query.topic, jurisdiction, organisationId: null, now })) {
      if (!seen.has(entry.id)) {
        seen.add(entry.id);
        result.push(entry);
      }
    }
  }
  return result;
}
