import { z } from 'zod';
import { dajcEuropeCoverage, isTrackedJurisdiction } from '../../../config/europe-coverage.mjs';
import { hydrateCanonical, validateCanonical, diffCanonical, isDate } from './core.mjs';
import { checkRules, newFindings } from './rule-checks.mjs';
import { detectChanges } from './legal-changes.mjs';
/**
 * Review & approval workflow for manually imported Driving Bans evidence. Pure
 * functions: no file system, no network. A proposal never touches canonical.json;
 * the furthest it gets is READY_FOR_CANONICAL_UPDATE with a candidate dataset
 * that a person reviews and merges through GitHub.
 */

export const REVIEW_STATES = Object.freeze(['IMPORTED', 'VALIDATED', 'REVIEW_REQUIRED', 'APPROVED', 'READY_FOR_CANONICAL_UPDATE', 'REJECTED', 'CONFLICT', 'INSUFFICIENT_EVIDENCE']);
export const OPEN_STATES = Object.freeze(['IMPORTED', 'VALIDATED', 'REVIEW_REQUIRED', 'APPROVED', 'CONFLICT', 'INSUFFICIENT_EVIDENCE']);
const TRANSITIONS = Object.freeze({
  IMPORTED: ['VALIDATED', 'INSUFFICIENT_EVIDENCE', 'CONFLICT'],
  VALIDATED: ['REVIEW_REQUIRED'],
  REVIEW_REQUIRED: ['APPROVED', 'REJECTED'],
  APPROVED: ['READY_FOR_CANONICAL_UPDATE', 'CONFLICT'],
  // Evidence of a submission is immutable: an incomplete one can only be rejected and replaced.
  INSUFFICIENT_EVIDENCE: ['REJECTED'],
  // A conflict is re-checked against the current dataset or rejected by a person.
  CONFLICT: ['VALIDATED', 'INSUFFICIENT_EVIDENCE', 'REJECTED'],
  READY_FOR_CANONICAL_UPDATE: [],
  REJECTED: [],
});
export const HUMAN_ACTIONS = Object.freeze(['APPROVE', 'REJECT']);

export function assertTransition(from, to) {
  if (!TRANSITIONS[from]?.includes(to)) throw new Error(`Transition ${from} -> ${to} is not allowed`);
}

const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
/** Untrusted JSON must not carry prototype-pollution keys at any depth. */
export function assertPlainData(value, path = '$') {
  if (Array.isArray(value)) value.forEach((item, index) => assertPlainData(item, `${path}[${index}]`));
  else if (value && typeof value === 'object') {
    if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) throw new Error(`Unexpected object type at ${path}`);
    for (const key of Object.keys(value)) {
      if (FORBIDDEN_KEYS.has(key)) throw new Error(`Forbidden key ${key} at ${path}`);
      assertPlainData(value[key], `${path}.${key}`);
    }
  }
  return value;
}

const httpsUrl = z.string().max(2048).url().refine(value => { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password; }, 'https URL without credentials required');
const date = z.string().refine(isDate, 'YYYY-MM-DD date required');
const instant = z.string().datetime();
const id = z.string().regex(/^[a-z0-9][a-z0-9_-]{1,119}$/);
// Evidence may cite any Source Registry identity, including prefixed ones such as provider:...
const sourceRef = z.string().regex(/^[a-z0-9][a-z0-9:_.-]{1,159}$/);
// Coverage, review and NO_BAN state are never proposed through this channel.
const FORBIDDEN_RULE_KEYS = ['ban_state', 'coverage_complete', 'no_ban_evidence', 'jurisdiction_reviews', 'scope_checks'];
const ruleObject = z.record(z.unknown()).refine(rule => !FORBIDDEN_RULE_KEYS.some(key => key in rule), 'Coverage/NO_BAN fields cannot be proposed');
const changes = z.record(z.unknown()).refine(value => !['ban_id', 'jurisdiction', 'sequence', ...FORBIDDEN_RULE_KEYS].some(key => key in value), 'Identity, sequence and coverage fields cannot be amended');

export const operationSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('ADD_SOURCE'), source: z.object({ source_id: id, url: httpsUrl, authority: z.string().min(1).max(300), role: z.enum(['PRIMARY', 'SECONDARY']), version: z.string().min(1).max(500), findings: z.string().min(1).max(4000) }).strict() }).strict(),
  z.object({ op: z.literal('ADD_RULE'), rule: ruleObject }).strict(),
  z.object({ op: z.literal('AMEND_RULE'), ban_id: id, expected_sequence: z.number().int().min(0), changes, reason: z.string().min(1).max(2000) }).strict(),
  z.object({ op: z.literal('CANCEL_RULE'), ban_id: id, expected_sequence: z.number().int().min(0), legal_basis: z.string().min(1).max(500), evidence_ids: z.array(id).min(1), effective_from: date }).strict(),
  z.object({ op: z.literal('SUPERSEDE_RULE'), ban_id: id, expected_sequence: z.number().int().min(0), rule: ruleObject, reason: z.string().min(1).max(2000) }).strict(),
]);

export const submissionSchema = z.object({
  submission_version: z.literal(1),
  synthetic: z.boolean().default(false),
  submitted_by: z.string().min(1).max(120),
  jurisdiction: z.string().regex(/^[A-Z]{2}$/).refine(isTrackedJurisdiction, 'Untracked jurisdiction'),
  region: z.string().min(1).max(200).nullable().default(null),
  summary: z.string().min(1).max(4000),
  documents: z.array(z.object({ path: z.string().min(1).max(300), source_id: sourceRef, title: z.string().min(1).max(300), retrieved_from: httpsUrl.nullable().default(null), retrieved_at: instant.nullable().default(null) }).strict()).max(20).default([]),
  links: z.array(z.object({ url: httpsUrl, source_id: sourceRef, title: z.string().min(1).max(300) }).strict()).max(50).default([]),
  legal_effective: z.object({ from: date, to: date.nullable() }).strict().nullable().default(null),
  legal_verified_at: instant.nullable().default(null),
  operations: z.array(operationSchema).min(1).max(200),
  supersedes_submission: z.string().regex(/^sub-[0-9a-f]{16}$/).nullable().default(null),
}).strict().refine(value => !value.legal_effective?.to || value.legal_effective.from <= value.legal_effective.to, 'legal_effective.from must not be after legal_effective.to');

export function parseSubmission(raw) {
  return submissionSchema.parse(assertPlainData(raw));
}

/** Stable JSON: sorted keys, so the same evidence always yields the same fingerprint. */
export function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

const ruleTargets = op => op.op === 'ADD_RULE' ? [op.rule.ban_id] : op.op === 'SUPERSEDE_RULE' ? [op.ban_id, op.rule.ban_id] : op.ban_id ? [op.ban_id] : [];
export const proposalTargets = proposal => [...new Set(proposal.operations.flatMap(ruleTargets).filter(Boolean))];

/** Apply operations to a copy of the raw canonical dataset. Never mutates its input. */
export function applyOperations(rawCanonical, submission, documentHashes = {}) {
  const data = structuredClone(rawCanonical);
  const rules = new Map(data.rules.map(rule => [rule.ban_id, rule]));
  const profileOf = rule => data.rule_profiles?.[rule.profile] || {};
  const sequenceOf = rule => rule.sequence ?? profileOf(rule).sequence ?? 0;
  for (const op of submission.operations) {
    if (op.op === 'ADD_SOURCE') {
      if (data.sources.some(source => source.source_id === op.source.source_id)) throw new Error(`Source ${op.source.source_id} already exists`);
      data.sources.push({ ...op.source, ...(documentHashes[op.source.source_id] ? { content_sha256: documentHashes[op.source.source_id] } : {}), checked_at: submission.legal_verified_at, retrieval_method: 'manual-evidence-import' });
    } else if (op.op === 'ADD_RULE') {
      if (rules.has(op.rule.ban_id)) throw new Error(`Rule ${op.rule.ban_id} already exists`);
      const rule = { sequence: 0, ...op.rule };
      data.rules.push(rule); rules.set(rule.ban_id, rule);
    } else {
      const rule = rules.get(op.ban_id);
      if (!rule) throw new Error(`Unknown rule ${op.ban_id}`);
      if (sequenceOf(rule) !== op.expected_sequence) throw new Error(`STALE_SEQUENCE ${op.ban_id}: expected ${op.expected_sequence}, found ${sequenceOf(rule)}`);
      const next = sequenceOf(rule) + 1;
      if (op.op === 'AMEND_RULE') Object.assign(rule, op.changes, { sequence: next });
      if (op.op === 'CANCEL_RULE') Object.assign(rule, { status: 'CANCELLED', sequence: next, cancellation: { legal_basis: op.legal_basis, evidence_ids: op.evidence_ids, effective_from: op.effective_from } });
      if (op.op === 'SUPERSEDE_RULE') {
        if (rules.has(op.rule.ban_id)) throw new Error(`Rule ${op.rule.ban_id} already exists`);
        Object.assign(rule, { status: 'SUPERSEDED', sequence: next });
        const replacement = { sequence: 0, ...op.rule, supersedes: [...new Set([...(op.rule.supersedes || []), op.ban_id])] };
        data.rules.push(replacement); rules.set(replacement.ban_id, replacement);
      }
    }
  }
  return data;
}

const finding = (code, message, extra = {}) => ({ code, message, ...extra });

/**
 * Deterministic validation of an imported submission against the current dataset.
 * Returns the next state and findings; it never decides legal truth.
 */
export function validateProposal({ submission, documents, rawCanonical, openProposals = [], identities = dajcEuropeCoverage, catalogSources = [], detectedAt = null }) {
  const insufficient = [], conflicts = [], notes = [];
  const sources = new Map(rawCanonical.sources.map(source => [source.source_id, source]));
  const added = new Map(submission.operations.filter(op => op.op === 'ADD_SOURCE').map(op => [op.source.source_id, op.source]));
  const sourceOf = sourceId => sources.get(sourceId) || added.get(sourceId);
  // Documents and links may cite any Source Registry identity; rules still need a canonical (or added) source.
  const catalog = new Map(catalogSources.map(entry => [entry.source_id, entry]));
  const evidenceSourceOf = sourceId => sourceOf(sourceId) || catalog.get(sourceId);
  const documentSources = new Set(documents.map(doc => doc.source_id));
  const linkSources = new Set(submission.links.map(link => link.source_id));

  for (const doc of documents) if (!evidenceSourceOf(doc.source_id)) insufficient.push(finding('UNKNOWN_SOURCE', `Document ${doc.path} cites unknown source ${doc.source_id}`));
  for (const link of submission.links) if (!evidenceSourceOf(link.source_id)) insufficient.push(finding('UNKNOWN_SOURCE', `Link ${link.url} cites unknown source ${link.source_id}`));
  const primaryEvidence = [...documentSources].filter(sourceId => evidenceSourceOf(sourceId)?.role === 'PRIMARY');
  if (!primaryEvidence.length) insufficient.push(finding('NO_PRIMARY_DOCUMENT', 'At least one imported document from a PRIMARY source is required; links alone are not immutable evidence.'));
  if (!submission.legal_verified_at) insufficient.push(finding('NO_LEGAL_VERIFICATION_DATE', 'legal_verified_at is required; the import time is not a legal verification date.'));
  for (const op of submission.operations.filter(item => item.op === 'ADD_SOURCE')) {
    if (!documentSources.has(op.source.source_id) && !linkSources.has(op.source.source_id)) insufficient.push(finding('SOURCE_WITHOUT_EVIDENCE', `New source ${op.source.source_id} has neither a document nor a link`));
  }

  for (const op of submission.operations) {
    // Judge the effective rule, i.e. its profile defaults plus the proposed fields, as hydrateCanonical does.
    const rule = op.rule && { ...(rawCanonical.rule_profiles?.[op.rule.profile] || {}), ...op.rule };
    if (rule) {
      if (rule.jurisdiction !== submission.jurisdiction) insufficient.push(finding('JURISDICTION_MISMATCH', `${rule.ban_id} is outside the submission jurisdiction ${submission.jurisdiction}`));
      if (!identities.some(([code]) => code === rule.jurisdiction)) insufficient.push(finding('UNTRACKED_JURISDICTION', `${rule.ban_id} uses an untracked jurisdiction`));
      for (const sourceId of [rule.source_id, ...(rule.evidence_ids || [])]) if (!sourceOf(sourceId)) insufficient.push(finding('UNKNOWN_SOURCE', `${rule.ban_id} cites unknown source ${sourceId}`));
      if (rule.verification_state === 'PRIMARY_VERIFIED' && !(rule.evidence_ids || []).some(sourceId => sourceOf(sourceId)?.role === 'PRIMARY' && documentSources.has(sourceId))) insufficient.push(finding('PRIMARY_CLAIM_WITHOUT_DOCUMENT', `${rule.ban_id} claims PRIMARY_VERIFIED without an imported PRIMARY document`));
    }
    if (op.op === 'CANCEL_RULE' && !op.evidence_ids.some(sourceId => sourceOf(sourceId)?.role === 'PRIMARY' && documentSources.has(sourceId))) insufficient.push(finding('CANCELLATION_WITHOUT_PRIMARY_DOCUMENT', `${op.ban_id}: a lost or unavailable source never cancels a ban; a PRIMARY document stating the cancellation is required`));
  }

  const mine = new Set(proposalTargets(submission));
  for (const other of openProposals) {
    const shared = proposalTargets(other.submission).filter(target => mine.has(target));
    if (shared.length) conflicts.push(finding('CONCURRENT_PROPOSAL', `Rules ${shared.join(', ')} are also changed by open proposal ${other.proposal_id}`, { proposal_id: other.proposal_id }));
  }

  let diff = [], changes = [];
  if (!insufficient.length) {
    let before, after;
    try {
      const candidate = applyOperations(rawCanonical, submission, Object.fromEntries(documents.map(doc => [doc.source_id, doc.sha256])));
      before = hydrateCanonical(rawCanonical, identities); after = hydrateCanonical(candidate, identities);
      validateCanonical(after, identities);
      diff = diffCanonical(before, after);
    } catch (error) {
      const message = String(error.message || error);
      if (message.startsWith('STALE_SEQUENCE')) conflicts.push(finding('STALE_SEQUENCE', message));
      else insufficient.push(finding('CANONICAL_VALIDATION_FAILED', message));
    }
    if (after) {
      for (const rule of after.rules.filter(item => submission.operations.some(op => op.op === 'ADD_RULE' && op.rule.ban_id === item.ban_id))) {
        const twin = before.rules.find(existing => existing.status === 'ACTIVE' && existing.jurisdiction === rule.jurisdiction && JSON.stringify(existing.schedule) === JSON.stringify(rule.schedule) && existing.valid_from <= rule.valid_to && rule.valid_from <= existing.valid_to && JSON.stringify(existing.roads) === JSON.stringify(rule.roads) && existing.direction === rule.direction);
        if (twin) conflicts.push(finding('DUPLICATE_OF_ACTIVE_RULE', `${rule.ban_id} repeats active rule ${twin.ban_id}`, { ban_id: twin.ban_id }));
      }
      try {
        changes = detectChanges(before, after, { detectedAt });
        // Semantic checks: only problems the proposal introduces count against it.
        for (const item of newFindings(checkRules(before), checkRules(after))) {
          const entry = finding(item.code, item.message, { ban_id: item.ban_id ?? item.ban_ids ?? null });
          if (item.blocking_state === 'CONFLICT') conflicts.push(entry);
          else if (item.blocking_state === 'INSUFFICIENT_EVIDENCE') insufficient.push(entry);
          else notes.push(entry);
        }
      } catch (error) {
        // Calendar expansion refuses identical events and impossible local times; both need a person.
        const message = String(error.message || error);
        if (/Duplicate (semantic event|event UID)/.test(message)) conflicts.push(finding('DUPLICATE_SEMANTIC_EVENT', message));
        else insufficient.push(finding('CALENDAR_EXPANSION_FAILED', message));
      }
    }
  }
  if (submission.synthetic) notes.push(finding('SYNTHETIC', 'Synthetic demonstration data; never publish.'));
  const state = insufficient.length ? 'INSUFFICIENT_EVIDENCE' : conflicts.length ? 'CONFLICT' : 'VALIDATED';
  return { state, findings: [...insufficient, ...conflicts, ...notes], diff, changes };
}

/** The candidate dataset a person reviews in a pull request. Never written over canonical.json by this module. */
export function prepareCandidate({ proposal, documents, rawCanonical, identities = dajcEuropeCoverage, allowSynthetic = false }) {
  if (proposal.state !== 'APPROVED') throw new Error('Only an APPROVED proposal can be prepared');
  if (proposal.submission.synthetic && !allowSynthetic) throw new Error('Synthetic proposals are demonstration data and cannot become a candidate');
  const candidate = applyOperations(rawCanonical, proposal.submission, Object.fromEntries(documents.map(doc => [doc.source_id, doc.sha256])));
  candidate.dataset_version = `${rawCanonical.dataset_version}+candidate.${proposal.proposal_id}`;
  const before = hydrateCanonical(rawCanonical, identities), after = hydrateCanonical(candidate, identities);
  validateCanonical(after, identities);
  return { candidate, diff: diffCanonical(before, after), publication: proposal.submission.synthetic ? 'SYNTHETIC_DEMO_NOT_FOR_PUBLICATION' : 'REQUIRES_GITHUB_PULL_REQUEST_APPROVAL' };
}

const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
/** Offline review report. All submitted text is escaped and the page loads nothing. */
export function renderReviewReportHtml(proposals, generatedAt) {
  const rows = proposals.map(p => `<section><h2>${escapeHtml(p.proposal_id)} · ${escapeHtml(p.state)}</h2>
<p>${escapeHtml(p.submission.jurisdiction)} · ${escapeHtml(p.submission.summary)}</p>
<p>Imported ${escapeHtml(p.imported_at)} · legal verification claimed ${escapeHtml(p.submission.legal_verified_at ?? 'none')}${p.submission.synthetic ? ' · <strong>SYNTHETIC</strong>' : ''}</p>
<h3>Evidence</h3><ul>${p.documents.map(d => `<li>${escapeHtml(d.title)} (${escapeHtml(d.kind)}, ${d.bytes} B) sha256 <code>${escapeHtml(d.sha256)}</code></li>`).join('')}${p.submission.links.map(l => `<li>Link: ${escapeHtml(l.title)} – ${escapeHtml(l.url)}</li>`).join('')}</ul>
<h3>Findings</h3><ul>${(p.findings || []).map(f => `<li><code>${escapeHtml(f.code)}</code> ${escapeHtml(f.message)}</li>`).join('') || '<li>none</li>'}</ul>
<h3>Changes</h3><ul>${(p.changes || []).filter(c => c.type !== 'COVERAGE_STATUS').map(c => `<li><code>${escapeHtml(c.type)}</code> ${escapeHtml(c.ban_id || c.source_id || c.jurisdiction)} ${escapeHtml(c.field || '')}${c.legal_change ? '' : ' (no change of law)'} – ${escapeHtml(c.user_impact)}</li>`).join('') || '<li>none</li>'}</ul>
<h3>History</h3><ol>${p.history.map(h => `<li>${escapeHtml(h.at)} ${escapeHtml(h.from ?? '–')} → ${escapeHtml(h.to)} (${escapeHtml(h.actor)}${h.identity_verified === false ? ', identity not verified' : ''})${h.reason ? ': ' + escapeHtml(h.reason) : ''}</li>`).join('')}</ol></section>`).join('\n');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><meta name="robots" content="noindex"><title>DAJC Driving Bans review report</title>
<style>body{font:14px/1.5 system-ui,sans-serif;max-width:960px;margin:2rem auto;padding:0 1rem}section{border-top:1px solid #ccc;padding:1rem 0}code{word-break:break-all}</style></head>
<body><h1>DAJC Driving Bans – offline review report</h1><p>Generated ${escapeHtml(generatedAt)}. Internal report. Approval here is not proof of reviewer identity and publishes nothing; publication requires an approved GitHub pull request.</p>
${rows || '<p>No proposals.</p>'}</body></html>\n`;
}
