import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { isDate } from '../core.mjs';
import { importSubmission, validateStoredProposal } from '../evidence-store.mjs';
import { loadDraft } from './pipeline.mjs';

/**
 * The human step between AI research and the existing review workflow (PR #82).
 * A person who has read the primary text states when they verified it and which
 * period they reviewed; only then do drafted rules become PRIMARY_VERIFIED claims,
 * and the submission enters the existing automaton at IMPORTED. Approval and the
 * candidate dataset stay with the existing commands; publication needs an
 * approved GitHub pull request.
 * The person also confirms what AI cannot: the legal effect (commencement and expiry)
 * read in the primary text, apart from the published window of the rules, and that the
 * exceptions are complete. A draft whose rule validity lies outside the reviewed period
 * mixes the two and is refused; it has to be corrected or researched again.
 */

const instant = value => typeof value === 'string' && /T.*Z$/.test(value) && Number.isFinite(Date.parse(value));

export function promoteDraft({ researchStore, draftId, evidenceStore, reviewer, reason, legalVerifiedAt, reviewWindow, confirmations = null, rawCanonical, catalogSources = [], now = new Date() }) {
  if (!reviewer?.trim() || !reason?.trim()) throw new Error('A reviewer label and a reason are required');
  if (!instant(legalVerifiedAt) || Date.parse(legalVerifiedAt) > now.getTime()) throw new Error('legal_verified_at must be an ISO instant (UTC, ending in Z) not in the future: the time the person verified the primary text');
  if (!isDate(reviewWindow?.from) || !isDate(reviewWindow?.to) || reviewWindow.from > reviewWindow.to) throw new Error('A reviewed period from <= to (YYYY-MM-DD) is required');
  const draft = loadDraft(researchStore, draftId);
  if (draft.state !== 'REVIEW_REQUIRED') throw new Error(`Only REVIEW_REQUIRED drafts can be promoted (state ${draft.state}); a draft with INSUFFICIENT_EVIDENCE or CONFLICT needs a new research run or a manual submission`);
  if (!draft.submission) throw new Error('The draft carries no submission');
  if (resolve(evidenceStore) === researchStore.root) throw new Error('The evidence store and the research store must be separate directories');
  const legal = confirmations?.legalEffective;
  if (!isDate(legal?.from) || !(legal.to === null || (isDate(legal.to) && legal.from <= legal.to))) throw new Error('Confirm the legal effect read in the primary text: confirmations.legalEffective { from: YYYY-MM-DD, to: YYYY-MM-DD or null }, apart from the published window');
  if (confirmations.exceptionsComplete !== true) throw new Error('Confirm that every exception and its conditions are complete as the primary text states them (confirmations.exceptionsComplete)');
  const outside = draft.submission.operations.flatMap(op => {
    const rule = op.op === 'ADD_RULE' || op.op === 'SUPERSEDE_RULE' ? op.rule : op.op === 'AMEND_RULE' ? op.changes : null;
    return rule ? [['valid_from', rule.valid_from], ['valid_to', rule.valid_to]].filter(([, value]) => value && (value < reviewWindow.from || value > reviewWindow.to)).map(([field, value]) => `${op.ban_id ?? op.rule.ban_id} ${field} ${value}`) : [];
  });
  if (outside.length) throw new Error(`Rule validity outside the reviewed period ${reviewWindow.from} to ${reviewWindow.to} (${outside.join('; ')}): the draft mixes the legal effect with the published window. Correct it or research the document again; the legal effect goes to confirmations.legalEffective`);

  const primary = draft.document.source_id;
  const verifyRule = rule => rule.source_id === primary || (rule.evidence_ids || []).includes(primary)
    ? { ...rule, verification_state: 'PRIMARY_VERIFIED', verified_at: legalVerifiedAt, review_window: { from: reviewWindow.from, to: reviewWindow.to }, notes: `${rule.notes ?? ''} Primary text verified by ${reviewer.trim()} at ${legalVerifiedAt}.`.trim() }
    : rule;
  const operations = draft.submission.operations.map(op => {
    if (op.op === 'ADD_RULE' || op.op === 'SUPERSEDE_RULE') return { ...op, rule: verifyRule(op.rule) };
    if (op.op === 'AMEND_RULE') return { ...op, changes: { ...op.changes, verified_at: legalVerifiedAt, review_window: { from: reviewWindow.from, to: reviewWindow.to } } };
    return op;
  });
  const submission = { ...draft.submission, submitted_by: `${reviewer.trim()} (human legal verification of AI research draft ${draftId})`, legal_verified_at: legalVerifiedAt, legal_effective: { from: legal.from, to: legal.to }, operations, summary: `${draft.submission.summary} Promoted by ${reviewer.trim()}: ${reason.trim()}`.slice(0, 4000) };

  // A throwaway import root outside the repository holds exactly the submission and its
  // content-addressed document; the import copies the document into the evidence store.
  const root = mkdtempSync(join(tmpdir(), `dajc-research-import-${draftId}-`));
  let imported;
  try {
    const docFile = join(root, draft.document.path);
    mkdirSync(dirname(docFile), { recursive: true });
    writeFileSync(docFile, researchStore.readBytes(`blobs/${draft.document.sha256}`));
    const submissionFile = join(root, 'submission.json');
    writeFileSync(submissionFile, JSON.stringify(submission, null, 1) + '\n');
    imported = importSubmission({ submissionFile, root, store: resolve(evidenceStore), now, actor: reviewer.trim() });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
  const proposal = imported.status === 'DUPLICATE' ? null : validateStoredProposal({ store: resolve(evidenceStore), proposalId: imported.proposal_id, rawCanonical, now, catalogSources });
  const at = now.toISOString();
  draft.history.push({ at, from: draft.state, to: 'PROMOTED', actor: reviewer.trim(), identity_verified: false, action: 'PROMOTE', reason: reason.trim(), proposal_id: imported.proposal_id });
  draft.state = 'PROMOTED';
  draft.promotion = { at, reviewer: reviewer.trim(), legal_verified_at: legalVerifiedAt, review_window: reviewWindow, legal_effective_confirmed: { from: legal.from, to: legal.to }, legal_effective_stated_by_ai: draft.submission.legal_effective ?? null, exceptions_complete_confirmed: true, proposal_id: imported.proposal_id, proposal_state: proposal?.state ?? 'DUPLICATE' };
  if (draft.legal_effect) draft.legal_effect.confirmed = true;
  researchStore.writeJson(`drafts/${draftId}.json`, draft);
  researchStore.audit({ at, actor: reviewer.trim(), identity_verified: false, action: 'PROMOTE', draft_id: draftId, from: 'REVIEW_REQUIRED', to: 'PROMOTED', reason: reason.trim(), details: { proposal_id: imported.proposal_id } });
  return { draft_id: draftId, proposal_id: imported.proposal_id, import_status: imported.status, proposal_state: proposal?.state ?? null, findings: proposal?.findings?.map(f => f.code) ?? [] };
}

/** A person rejects a draft; it stays in the store with its history. */
export function rejectDraft({ researchStore, draftId, reviewer, reason, now = new Date() }) {
  if (!reviewer?.trim() || !reason?.trim()) throw new Error('A reviewer label and a reason are required');
  const draft = loadDraft(researchStore, draftId);
  if (!['REVIEW_REQUIRED', 'INSUFFICIENT_EVIDENCE', 'CONFLICT'].includes(draft.state)) throw new Error(`Draft ${draftId} is ${draft.state}`);
  const at = now.toISOString();
  draft.history.push({ at, from: draft.state, to: 'REJECTED', actor: reviewer.trim(), identity_verified: false, action: 'REJECT', reason: reason.trim() });
  researchStore.audit({ at, actor: reviewer.trim(), identity_verified: false, action: 'REJECT', draft_id: draftId, from: draft.state, to: 'REJECTED', reason: reason.trim() });
  draft.state = 'REJECTED';
  researchStore.writeJson(`drafts/${draftId}.json`, draft);
  return draft;
}
