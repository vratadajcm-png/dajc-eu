import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { officialAuthorityDomains } from '../../../../config/official-authority-domains.mjs';
import { dajcEuropeCoverage } from '../../../../config/europe-coverage.mjs';
import { restrictionClassOf } from '../core.mjs';
import { decideProposal, importSubmission, loadProposal, prepareStoredProposal, validateStoredProposal } from '../evidence-store.mjs';
import { stableStringify, validateProposal } from '../review-workflow.mjs';
import { normalizeForQuote } from './documents.mjs';
import { listDrafts, loadDraft } from './pipeline.mjs';
import { quoteOnPage, readPdfPages } from './pdf-text.mjs';

/**
 * Automatic approval of AI research drafts taken from official PDF documents
 * (owner decision, 3 November 2026). Code, not a model, decides. A draft is approved
 * only when every check below holds; otherwise it stays REVIEW_REQUIRED for a person:
 *  - the switch DAJC_DRIVING_BANS_AUTO_APPROVAL_ENABLED is the exact string "true" and
 *    no earlier automatic approval is past its human-review deadline;
 *  - the document is a PDF with a text layer, from an official host of the jurisdiction,
 *    and the registry source it backs is PRIMARY;
 *  - the independent check (another vendor) is CONSISTENT and a second extraction by
 *    another vendor agrees field by field; no finding asks for human judgement;
 *  - every quote is found by code on the page the model names;
 *  - the draft only adds rules, each restating the pattern of a rule a person verified
 *    (same days or dates kind, hours, timezone, weight, roads, regions, direction,
 *    restriction types, number of exceptions and the same act): new dates of a known ban;
 *  - the legal effect the document states covers the rules, and the existing validator
 *    accepts the submission against the current registry.
 * Approval goes through the existing automaton (IMPORTED → … → READY_FOR_CANONICAL_UPDATE)
 * under the gate's own actor. Rules are PRIMARY_VERIFIED with verification_method
 * AUTOMATED, labelled in every output, and a person must review them within
 * HUMAN_REVIEW_DAYS. Coverage, review spans and NO_BAN are never touched: an automatic
 * rule never makes a jurisdiction or month "verified in full".
 */

export const AUTO_APPROVAL_FLAG = 'DAJC_DRIVING_BANS_AUTO_APPROVAL_ENABLED';
export const AUTO_APPROVAL_GATE_VERSION = 'dba-1';
export const AUTO_APPROVAL_ACTOR = `dajc-auto-approval-gate:${AUTO_APPROVAL_GATE_VERSION}`;
export const HUMAN_REVIEW_DAYS = 7;
const DAY = 86_400_000;
// Notes of the research pipeline that need no human judgement; any other note sends the draft to a person.
const HARMLESS_NOTES = new Set(['ESCALATED_EXTRACTION', 'SECOND_EXTRACTION_RETRIED']);

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const hostOf = url => { try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ''); } catch { return null; } };
const onHost = (host, domains) => Boolean(host) && domains.some(domain => host === domain || host.endsWith(`.${domain}`));
const effective = (rule, raw) => ({ ...(raw.rule_profiles?.[rule.profile] || {}), ...rule });

/** Rules approved by the gate and not yet reviewed by a person, and those past their deadline. */
export function autoApprovalStatus(rawCanonical, now = new Date()) {
  const pending = rawCanonical.rules.map(rule => effective(rule, rawCanonical)).filter(rule => rule.verification_method === 'AUTOMATED' && rule.status === 'ACTIVE');
  const row = rule => ({ ban_id: rule.ban_id, jurisdiction: rule.jurisdiction, approved_at: rule.auto_approval?.approved_at ?? null, human_review_due: rule.auto_approval?.human_review_due ?? null, source_url: rule.source_url });
  return {
    awaiting_human_review: pending.map(row),
    overdue: pending.filter(rule => Date.parse(rule.auto_approval?.human_review_due ?? 0) < now.getTime()).map(row),
  };
}

const norm = value => normalizeForQuote(value ?? '');
const weightSignature = weight => {
  if (!weight) return null;
  if (Array.isArray(weight.any_of)) return { any_of: weight.any_of.map(weightSignature).sort((a, b) => stableStringify(a).localeCompare(stableStringify(b))) };
  if (Array.isArray(weight.all_of)) return { all_of: weight.all_of.map(weightSignature).sort((a, b) => stableStringify(a).localeCompare(stableStringify(b))) };
  return { operator: weight.operator, value: weight.value ?? null, unit: weight.unit ?? null };
};
const textSet = values => [...new Set((values || []).map(norm).filter(Boolean))].sort();
const direction = value => { const text = norm(value); return !text || /\bboth\b|obou/.test(text) ? 'both' : text; };
/** Act numbers (361/2000) and paragraphs (§43) named by a legal basis. */
export function legalBasisKey(text) {
  const value = String(text ?? '');
  return { acts: [...new Set(value.match(/\d+\/\d{2,4}/g) || [])].sort(), paragraphs: [...new Set((value.match(/§\s*\d+[a-z]?/gi) || []).map(item => item.replace(/\s+/g, '').toLowerCase()))].sort() };
}

/** What makes two rules the same kind of ban; dates, validity, title and source may differ. */
export function rulePattern(rule) {
  const schedule = rule.schedule || {};
  return {
    jurisdiction: rule.jurisdiction, restriction_class: restrictionClassOf(rule), restriction_types: [...(rule.restriction_types || [])].sort(), timezone: rule.timezone,
    schedule: { kind: schedule.kind, weekdays: schedule.kind === 'weekly' ? [...(schedule.weekdays || [])].sort() : [], start_time: schedule.start_time, end_time: schedule.end_time, end_day_offset: schedule.end_day_offset ?? 0 },
    weight: weightSignature(rule.weight_threshold), roads: textSet(rule.roads), regions: textSet(rule.regions), direction: direction(rule.direction), exceptions: (rule.exceptions || []).length,
    acts: legalBasisKey(rule.legal_basis).acts,
  };
}

/** The human-verified rule whose pattern the drafted rule restates, or null. */
export function matchVerifiedPattern(rule, rawCanonical) {
  const wanted = stableStringify(rulePattern(rule));
  const paragraphs = legalBasisKey(rule.legal_basis);
  if (!paragraphs.acts.length) return null;
  const superseded = new Set(rawCanonical.rules.flatMap(raw => effective(raw, rawCanonical).status === 'ACTIVE' ? (raw.supersedes || []) : []));
  for (const raw of rawCanonical.rules) {
    const known = effective(raw, rawCanonical);
    if (known.status !== 'ACTIVE' || known.verification_state !== 'PRIMARY_VERIFIED' || (known.verification_method ?? 'HUMAN') !== 'HUMAN' || superseded.has(known.ban_id)) continue;
    if (stableStringify(rulePattern(known)) !== wanted) continue;
    if (legalBasisKey(known.legal_basis).paragraphs.every(item => paragraphs.paragraphs.includes(item))) return known;
  }
  return null;
}

const check = (id, ok, detail) => ({ id, ok: Boolean(ok), detail });

/** Every check of the gate for one draft. eligible is true only when all of them pass. */
export async function autoApprovalDecision({ researchStore, draft, rawCanonical, catalogSources = [], now = new Date(), env = process.env, authorityDomains = officialAuthorityDomains }) {
  const checks = [];
  checks.push(check('switch_on', env[AUTO_APPROVAL_FLAG] === 'true', `${AUTO_APPROVAL_FLAG} must be "true"`));
  const status = autoApprovalStatus(rawCanonical, now);
  checks.push(check('no_overdue_review', !status.overdue.length, status.overdue.length ? `Human review overdue: ${status.overdue.map(item => item.ban_id).join(', ')}` : 'No automatic approval is past its review deadline'));
  checks.push(check('draft_ready', draft.state === 'REVIEW_REQUIRED' && !draft.synthetic && draft.submission, `Draft state ${draft.state}${draft.synthetic ? ', synthetic' : ''}`));

  const document = draft.document || {};
  let pages = null;
  if (document.kind === 'PDF' && document.text_layer === 'PDF_TEXT' && researchStore.exists(`blobs/${document.sha256}`)) {
    const bytes = researchStore.readBytes(`blobs/${document.sha256}`);
    if (sha256(bytes) === document.sha256) pages = await readPdfPages(bytes);
  }
  checks.push(check('pdf_text_layer', pages, pages ? `PDF with text on ${pages.length} page(s), SHA-256 ${document.sha256}` : 'Only a stored PDF with a text layer qualifies (a scan or another format goes to a person)'));

  const operations = draft.submission?.operations ?? [];
  const sourceOp = operations.find(op => op.op === 'ADD_SOURCE' && op.source.source_id === document.source_id);
  const registrySource = rawCanonical.sources.find(source => source.source_id === document.source_id);
  const primary = sourceOp ? sourceOp.source.role === 'PRIMARY' && sourceOp.source.url === document.final_url : registrySource?.role === 'PRIMARY';
  const domains = [...(authorityDomains[draft.jurisdiction] || []), ...rawCanonical.sources.filter(source => source.role === 'PRIMARY' && rawCanonical.rules.some(rule => effective(rule, rawCanonical).jurisdiction === draft.jurisdiction && effective(rule, rawCanonical).source_id === source.source_id)).map(source => hostOf(source.url)).filter(Boolean)];
  checks.push(check('official_primary_source', primary && onHost(hostOf(document.final_url), domains), `${document.final_url} (${primary ? 'PRIMARY' : 'not a PRIMARY source'}) on an official host of ${draft.jurisdiction}`));

  const extractor = draft.extraction?.vendor;
  checks.push(check('independent_check', draft.cross_check?.ok && draft.cross_check.overall === 'CONSISTENT' && draft.cross_check.vendor && draft.cross_check.vendor !== extractor, `Check by ${draft.cross_check?.vendor ?? 'none'} (${draft.cross_check?.overall ?? 'not run'}), extraction by ${extractor}`));
  checks.push(check('second_extraction_agrees', draft.second_extraction?.agreed === true && draft.second_extraction.vendor && draft.second_extraction.vendor !== extractor, `Second extraction by ${draft.second_extraction?.vendor ?? 'none'}: ${draft.second_extraction?.agreed ? 'agrees field by field' : 'missing or different'}`));

  const blocking = (draft.findings || []).filter(item => item.blocking_state !== 'NOTE' || !HARMLESS_NOTES.has(item.code));
  checks.push(check('no_open_findings', !blocking.length, blocking.length ? `Findings for a person: ${[...new Set(blocking.map(item => item.code))].join(', ')}` : 'No finding needs human judgement'));

  const evidence = (draft.extraction?.rules || []).flatMap((rule, index) => (rule.evidence || []).map(item => ({ ...item, rule_index: index })));
  const misplaced = pages ? evidence.filter(item => !quoteOnPage(pages, item.page, item.quote)) : evidence;
  checks.push(check('quotes_on_stated_pages', evidence.length && !misplaced.length, misplaced.length ? `${misplaced.length} quote(s) without a page or not found on it: ${misplaced.slice(0, 3).map(item => `${item.field}@${item.page ?? '?'}`).join(', ')}` : `${evidence.length} quotes found on their pages`));

  const rules = operations.filter(op => op.op === 'ADD_RULE').map(op => op.rule);
  const others = operations.filter(op => op.op !== 'ADD_RULE' && op !== sourceOp);
  checks.push(check('only_new_rules', rules.length && !others.length, others.length ? `Not automatic: ${[...new Set(others.map(op => op.op))].join(', ')}` : `${rules.length} new rule(s)`));
  const matches = rules.map(rule => ({ ban_id: rule.ban_id, pattern_of: matchVerifiedPattern(rule, rawCanonical)?.ban_id ?? null }));
  checks.push(check('known_verified_pattern', rules.length && matches.every(item => item.pattern_of), matches.map(item => `${item.ban_id} → ${item.pattern_of ?? 'no human-verified rule with the same pattern'}`).join('; ')));

  const effect = draft.legal_effect?.stated_by_document;
  const inEffect = rule => effect?.from && rule.valid_from >= effect.from && (effect.to === null || rule.valid_to <= effect.to);
  checks.push(check('legal_effect_stated', effect?.from && rules.every(inEffect), effect?.from ? `Legal effect ${effect.from} to ${effect.to ?? 'open'} stated by the document` : 'The document states no common legal effect'));

  let validation = null;
  if (draft.submission && rules.length) {
    const submission = approvedSubmission(draft, { at: now.toISOString(), matches });
    validation = validateProposal({ submission, documents: [{ path: document.path, source_id: document.source_id, sha256: document.sha256, kind: document.kind, bytes: document.byte_length }], rawCanonical, openProposals: [], identities: dajcEuropeCoverage, catalogSources, detectedAt: now.toISOString() });
  }
  const changeTypes = [...new Set((validation?.changes || []).filter(change => change.type !== 'COVERAGE_STATUS').map(change => change.type))];
  checks.push(check('validator_accepts', validation?.state === 'VALIDATED' && changeTypes.every(type => ['NEW_RULE', 'METADATA_ONLY'].includes(type)), validation ? `Validator: ${validation.state}; changes ${changeTypes.join(', ') || 'none'}${validation.findings.length ? `; findings ${validation.findings.map(f => f.code).join(', ')}` : ''}` : 'Not validated'));

  return { draft_id: draft.draft_id, jurisdiction: draft.jurisdiction, gate_version: AUTO_APPROVAL_GATE_VERSION, decided_at: now.toISOString(), eligible: checks.every(item => item.ok), checks, matches };
}

/** The draft's submission as the gate approves it: rules PRIMARY_VERIFIED, AUTOMATED and awaiting human review. */
function approvedSubmission(draft, { at, matches }) {
  const due = new Date(Date.parse(at) + HUMAN_REVIEW_DAYS * DAY).toISOString();
  const operations = draft.submission.operations.map(op => {
    if (op.op !== 'ADD_RULE') return op;
    const record = {
      gate_version: AUTO_APPROVAL_GATE_VERSION, approved_at: at, human_review_due: due, draft_id: draft.draft_id, document_sha256: draft.document.sha256,
      extraction: { vendor: draft.extraction.vendor, model: draft.extraction.model }, independent_check: { vendor: draft.cross_check.vendor, model: draft.cross_check.model },
      second_extraction: { vendor: draft.second_extraction.vendor, model: draft.second_extraction.model },
      pattern_of: matches.find(item => item.ban_id === op.rule.ban_id)?.pattern_of ?? null, human_reviewed_at: null, human_reviewer: null,
    };
    return { ...op, rule: { ...op.rule, verification_state: 'PRIMARY_VERIFIED', verified_at: at, review_window: { from: op.rule.valid_from, to: op.rule.valid_to }, verification_method: 'AUTOMATED', auto_approval: record, notes: `${op.rule.notes ?? ''} Verified automatically from an official PDF by gate ${AUTO_APPROVAL_GATE_VERSION} at ${at}; human review due ${due}.`.trim() } };
  });
  return { ...draft.submission, submitted_by: `${AUTO_APPROVAL_ACTOR} (automatic approval of AI research draft ${draft.draft_id}; not a person)`, legal_verified_at: at, legal_effective: draft.legal_effect.stated_by_document, operations, summary: `${draft.submission.summary} Approved automatically by gate ${AUTO_APPROVAL_GATE_VERSION}; human review due ${due}.`.slice(0, 4000) };
}

/** Import a submission with its stored document through a throwaway root, as promote does. */
function importWithDocument({ submission, documentPath, bytes, evidenceStore, now, actor }) {
  const root = mkdtempSync(join(tmpdir(), 'dajc-auto-approval-'));
  try {
    const file = join(root, documentPath);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, bytes);
    writeFileSync(join(root, 'submission.json'), JSON.stringify(submission, null, 1) + '\n');
    return importSubmission({ submissionFile: join(root, 'submission.json'), root, store: resolve(evidenceStore), now, actor });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/**
 * Decide one draft and, when eligible, approve it through the existing automaton up to a
 * candidate dataset. canonical.json is never written: publication is a separate pull request.
 */
export async function autoApproveDraft({ researchStore, draftId, evidenceStore, rawCanonical, catalogSources = [], now = new Date(), env = process.env, authorityDomains = officialAuthorityDomains }) {
  if (resolve(evidenceStore) === researchStore.root) throw new Error('The evidence store and the research store must be separate directories');
  const draft = loadDraft(researchStore, draftId);
  const decision = await autoApprovalDecision({ researchStore, draft, rawCanonical, catalogSources, now, env, authorityDomains });
  const at = now.toISOString();
  draft.auto_approval_decision = decision;
  if (!decision.eligible) {
    researchStore.writeJson(`drafts/${draftId}.json`, draft);
    researchStore.audit({ at, actor: AUTO_APPROVAL_ACTOR, identity_verified: false, action: 'AUTO_APPROVAL_DECLINED', draft_id: draftId, from: draft.state, to: draft.state, details: { failed: decision.checks.filter(item => !item.ok).map(item => item.id) } });
    return { draft_id: draftId, approved: false, decision };
  }
  const submission = approvedSubmission(draft, { at, matches: decision.matches });
  const imported = importWithDocument({ submission, documentPath: draft.document.path, bytes: researchStore.readBytes(`blobs/${draft.document.sha256}`), evidenceStore, now, actor: AUTO_APPROVAL_ACTOR });
  const store = resolve(evidenceStore);
  const reason = `Automatic approval by gate ${AUTO_APPROVAL_GATE_VERSION}: ${decision.checks.map(item => item.id).join(', ')} passed`;
  let proposal = imported.status === 'DUPLICATE' ? loadProposal(store, imported.proposal_id) : validateStoredProposal({ store, proposalId: imported.proposal_id, rawCanonical, now, catalogSources, actor: AUTO_APPROVAL_ACTOR });
  if (proposal.state === 'REVIEW_REQUIRED') proposal = decideProposal({ store, proposalId: imported.proposal_id, action: 'APPROVE', reviewer: AUTO_APPROVAL_ACTOR, reason, now });
  if (proposal.state === 'APPROVED') proposal = prepareStoredProposal({ store, proposalId: imported.proposal_id, rawCanonical, now, actor: AUTO_APPROVAL_ACTOR, catalogSources });
  const approved = proposal.state === 'READY_FOR_CANONICAL_UPDATE';
  draft.history.push({ at, from: draft.state, to: approved ? 'PROMOTED' : draft.state, actor: AUTO_APPROVAL_ACTOR, identity_verified: false, action: approved ? 'AUTO_APPROVE' : 'AUTO_APPROVAL_STOPPED', reason, proposal_id: imported.proposal_id });
  if (approved) {
    draft.state = 'PROMOTED';
    draft.promotion = { at, reviewer: AUTO_APPROVAL_ACTOR, automatic: true, legal_verified_at: at, legal_effective_stated_by_ai: draft.legal_effect.stated_by_document, proposal_id: imported.proposal_id, proposal_state: proposal.state };
  }
  researchStore.writeJson(`drafts/${draftId}.json`, draft);
  researchStore.audit({ at, actor: AUTO_APPROVAL_ACTOR, identity_verified: false, action: approved ? 'AUTO_APPROVE' : 'AUTO_APPROVAL_STOPPED', draft_id: draftId, from: 'REVIEW_REQUIRED', to: draft.state, details: { proposal_id: imported.proposal_id, proposal_state: proposal.state } });
  return { draft_id: draftId, approved, decision, proposal_id: imported.proposal_id, proposal_state: proposal.state, candidate_path: approved ? join(store, proposal.candidate.path) : null, rules: submission.operations.filter(op => op.op === 'ADD_RULE').map(op => ({ ban_id: op.rule.ban_id, human_review_due: op.rule.auto_approval.human_review_due, pattern_of: op.rule.auto_approval.pattern_of })) };
}

/**
 * Decide every REVIEW_REQUIRED draft in turn. Each approval builds on the candidate of the
 * previous one, so the last candidate holds all of them; it is returned, never applied here.
 */
export async function autoApproveAll({ researchStore, evidenceStore, rawCanonical, catalogSources = [], now = new Date(), env = process.env, authorityDomains = officialAuthorityDomains }) {
  let current = rawCanonical, candidatePath = null;
  const results = [];
  for (const draft of listDrafts(researchStore).filter(item => item.state === 'REVIEW_REQUIRED')) {
    const result = await autoApproveDraft({ researchStore, draftId: draft.draft_id, evidenceStore, rawCanonical: current, catalogSources, now, env, authorityDomains });
    results.push(result);
    if (result.approved) { candidatePath = result.candidate_path; current = JSON.parse(readFileSync(candidatePath, 'utf8')); }
  }
  return { gate_version: AUTO_APPROVAL_GATE_VERSION, decided_at: now.toISOString(), approved: results.filter(item => item.approved).length, results, candidate_path: candidatePath };
}

/**
 * A person reviews an automatically approved rule against the same PDF (same SHA-256) and
 * confirms it. This prepares an AMEND_RULE submission in the existing workflow; approval,
 * the candidate and the publication pull request stay with the existing commands.
 */
export function confirmAutoApprovedRule({ banId, documentFile, evidenceStore, reviewer, reason, rawCanonical, catalogSources = [], now = new Date() }) {
  if (!reviewer?.trim() || !reason?.trim()) throw new Error('A reviewer label and a reason are required');
  const raw = rawCanonical.rules.find(rule => rule.ban_id === banId);
  const rule = raw && effective(raw, rawCanonical);
  if (!rule || rule.verification_method !== 'AUTOMATED') throw new Error(`${banId} is not an automatically approved rule awaiting review`);
  const bytes = readFileSync(documentFile);
  if (sha256(bytes) !== rule.auto_approval.document_sha256) throw new Error('The document is not the one the gate approved (SHA-256 differs); review the same PDF');
  const at = now.toISOString();
  const path = `documents/${rule.auto_approval.document_sha256.slice(0, 16)}.pdf`;
  const submission = {
    submission_version: 1, synthetic: false, submitted_by: `${reviewer.trim()} (human review of automatic approval)`, jurisdiction: rule.jurisdiction, region: null,
    summary: `Human review of ${banId}, approved automatically on ${rule.auto_approval.approved_at}: ${reason.trim()}`.slice(0, 4000),
    documents: [{ path, source_id: rule.source_id, title: `Official PDF reviewed for ${banId}`.slice(0, 300), retrieved_from: rule.source_url, retrieved_at: rule.auto_approval.approved_at }],
    links: [], legal_effective: null, legal_verified_at: at,
    operations: [{ op: 'AMEND_RULE', ban_id: banId, expected_sequence: rule.sequence, reason: `Human review of automatic approval: ${reason.trim()}`.slice(0, 2000), changes: { verification_method: 'HUMAN', verified_at: at, auto_approval: { ...rule.auto_approval, human_reviewed_at: at, human_reviewer: reviewer.trim() } } }],
    supersedes_submission: null,
  };
  const imported = importWithDocument({ submission, documentPath: path, bytes, evidenceStore, now, actor: reviewer.trim() });
  const proposal = imported.status === 'DUPLICATE' ? null : validateStoredProposal({ store: resolve(evidenceStore), proposalId: imported.proposal_id, rawCanonical, now, catalogSources });
  return { ban_id: banId, proposal_id: imported.proposal_id, import_status: imported.status, proposal_state: proposal?.state ?? null, findings: proposal?.findings?.map(item => item.code) ?? [] };
}
