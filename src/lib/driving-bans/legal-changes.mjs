import { createHash } from 'node:crypto';
import { diffCanonical, includesWindow, publicationWindow } from './core.mjs';
import { checkRules, newFindings } from './rule-checks.mjs';
/**
 * Classifies the field-level audit of diffCanonical into the changes a reviewer and
 * a user care about. Deterministic: the same before/after pair always yields the same
 * change ids, and comparing a dataset with itself yields nothing. A changed web page,
 * HTTP metadata or source version is never reported as a change of law.
 */

export const CHANGE_TYPES = Object.freeze([
  'NEW_RULE', 'AMENDED_RULE', 'CANCELLED_RULE', 'SUPERSEDED_RULE', 'NEW_EXCEPTION', 'REMOVED_EXCEPTION',
  'SOURCE_UNAVAILABLE', 'SOURCE_CONFLICT', 'EXPIRED_EVIDENCE', 'REVIEW_REQUIRED', 'METADATA_ONLY', 'COVERAGE_STATUS',
]);
export const LEGAL_CHANGE_TYPES = Object.freeze(['NEW_RULE', 'AMENDED_RULE', 'CANCELLED_RULE', 'SUPERSEDED_RULE', 'NEW_EXCEPTION', 'REMOVED_EXCEPTION']);
const METADATA_FIELDS = new Set(['source_version']);
const SOURCE_METADATA_FIELDS = ['version', 'checked_at', 'content_sha256', 'retrieval_method', 'findings', 'url'];

const IMPACT = Object.freeze({
  NEW_RULE: 'New restriction: plan journeys around the stated dates, hours, roads and vehicle categories.',
  AMENDED_RULE: 'Restriction changed: re-check hours, scope and dates of planned journeys.',
  CANCELLED_RULE: 'Restriction cancelled by the stated legal act from the stated date; other restrictions still apply.',
  SUPERSEDED_RULE: 'Restriction replaced by a newer rule; follow the replacing rule.',
  NEW_EXCEPTION: 'A new exception may allow some journeys; check that the vehicle and load meet its exact conditions.',
  REMOVED_EXCEPTION: 'An exception no longer applies; journeys that relied on it are restricted again.',
  SOURCE_UNAVAILABLE: 'Official source could not be confirmed; publication trust is withdrawn, but the restriction is NOT cancelled.',
  SOURCE_CONFLICT: 'Official sources disagree; treat the stricter hours as binding until reviewed.',
  EXPIRED_EVIDENCE: 'Evidence no longer covers the published period; shown as not verified until re-reviewed.',
  REVIEW_REQUIRED: 'Needs human review before anything is published.',
  METADATA_ONLY: 'No change of law; source or page metadata only.',
  COVERAGE_STATUS: 'Verification status of the jurisdiction changed; no rule changed.',
});

const sha = value => createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16);
const asList = value => Array.isArray(value) ? value : [];

function change(type, base, { detectedAt, reasons = {} }) {
  const record = {
    type, legal_change: LEGAL_CHANGE_TYPES.includes(type),
    jurisdiction: base.jurisdiction ?? null, ban_id: base.ban_id ?? null, source_id: base.source_id ?? null, field: base.field ?? null,
    before: base.before ?? null, after: base.after ?? null,
    detected_at: detectedAt, sources: base.sources ?? [], legal_effective_from: base.legal_effective_from ?? null,
    user_impact: IMPACT[type], reason: base.reason ?? reasons[base.ban_id] ?? null,
    review_state: type === 'METADATA_ONLY' && !base.content_changed ? 'INFORMATIONAL' : type === 'COVERAGE_STATUS' ? 'INFORMATIONAL' : 'REVIEW_REQUIRED',
  };
  record.change_id = `chg-${sha([type, record.jurisdiction, record.ban_id, record.source_id, record.field, record.before, record.after])}`;
  return record;
}

const sourcesOf = rule => rule ? [...new Set([rule.source_id, ...(rule.evidence_ids || [])])] : [];

/** Classified changes between two hydrated datasets. Pass {detectedAt} explicitly for reproducible output. */
export function detectChanges(before, after, { detectedAt = new Date().toISOString(), reasons = {} } = {}) {
  const options = { detectedAt, reasons };
  const out = [];
  const beforeRules = new Map(before.rules.map(rule => [rule.ban_id, rule]));
  const afterRules = new Map(after.rules.map(rule => [rule.ban_id, rule]));
  const evidenceChanged = id => {
    const a = beforeRules.get(id), b = afterRules.get(id);
    return !a || !b || JSON.stringify(sourcesOf(a)) !== JSON.stringify(sourcesOf(b)) || a.source_version !== b.source_version;
  };

  for (const item of diffCanonical(before, after)) {
    const rule = afterRules.get(item.ban_id) || beforeRules.get(item.ban_id);
    const base = { jurisdiction: item.jurisdiction, ban_id: item.ban_id, field: item.field, before: item.before, after: item.after, sources: sourcesOf(rule) };
    if (item.kind === 'NEW_RULE') {
      out.push(change('NEW_RULE', { ...base, after: { valid_from: rule.valid_from, valid_to: rule.valid_to, schedule: rule.schedule }, legal_effective_from: rule.valid_from, reason: rule.notes ?? null }, options));
      for (const old of rule.supersedes) if (beforeRules.get(old)?.status === 'ACTIVE' && afterRules.get(old)?.status === 'ACTIVE') out.push(change('SUPERSEDED_RULE', { jurisdiction: rule.jurisdiction, ban_id: old, field: 'superseded_by', before: null, after: rule.ban_id, sources: sourcesOf(rule), legal_effective_from: rule.valid_from }, options));
    } else if (item.kind === 'REMOVED_RECORD_REQUIRES_REVIEW') {
      out.push(change('REVIEW_REQUIRED', { ...base, reason: 'A rule record disappeared. Removal is never a legal cancellation; restore it or cancel it with a primary source.' }, options));
    } else if (item.kind === 'COVERAGE_CHANGED') {
      out.push(change('COVERAGE_STATUS', base, options));
    } else if (item.field === 'status') {
      const type = item.after === 'CANCELLED' ? 'CANCELLED_RULE' : item.after === 'SUPERSEDED' ? 'SUPERSEDED_RULE' : 'AMENDED_RULE';
      out.push(change(type, { ...base, legal_effective_from: rule.cancellation?.effective_from ?? null, reason: rule.cancellation?.legal_basis ?? null }, options));
    } else if (item.field === 'exceptions') {
      const was = new Set(asList(item.before)), now = new Set(asList(item.after));
      for (const text of now) if (!was.has(text)) {
        out.push(change('NEW_EXCEPTION', { ...base, before: null, after: text }, options));
        if (!evidenceChanged(item.ban_id)) out.push(change('REVIEW_REQUIRED', { ...base, field: 'exceptions', before: null, after: text, reason: 'Exception added without new or changed evidence.' }, options));
      }
      for (const text of was) if (!now.has(text)) out.push(change('REMOVED_EXCEPTION', { ...base, before: text, after: null }, options));
    } else if (item.field === 'verification_state') {
      out.push(change(item.after === 'SOURCE_UNAVAILABLE' ? 'SOURCE_UNAVAILABLE' : 'REVIEW_REQUIRED', base, options));
    } else if (METADATA_FIELDS.has(item.field)) {
      out.push(change('METADATA_ONLY', base, options));
    } else {
      out.push(change('AMENDED_RULE', { ...base, legal_effective_from: rule.legal_effective_from ?? null }, options));
    }
  }

  const beforeSources = new Map(before.sources.map(source => [source.source_id, source]));
  for (const source of after.sources) {
    const old = beforeSources.get(source.source_id);
    if (!old) continue;
    if (source.availability === 'SOURCE_UNAVAILABLE' && old.availability !== 'SOURCE_UNAVAILABLE') out.push(change('SOURCE_UNAVAILABLE', { source_id: source.source_id, field: 'availability', before: old.availability ?? null, after: 'SOURCE_UNAVAILABLE', sources: [source.source_id], reason: 'Retrieval failed; this never cancels a ban.' }, options));
    for (const field of SOURCE_METADATA_FIELDS) if (JSON.stringify(old[field]) !== JSON.stringify(source[field])) out.push(change('METADATA_ONLY', { source_id: source.source_id, field, before: old[field] ?? null, after: source[field] ?? null, sources: [source.source_id], content_changed: field === 'content_sha256' }, options));
  }

  for (const item of newFindings(checkRules(before), checkRules(after))) {
    if (item.code === 'SOURCE_CONFLICT') out.push(change('SOURCE_CONFLICT', { jurisdiction: item.jurisdiction, ban_id: item.ban_ids?.join(',') ?? null, field: item.date ?? null, after: item.message, reason: item.message }, options));
    else if (item.severity !== 'INFO') out.push(change('REVIEW_REQUIRED', { jurisdiction: item.jurisdiction, ban_id: item.ban_id ?? item.ban_ids?.join(',') ?? null, field: item.code, after: item.message, reason: item.message }, options));
  }
  const seen = new Set();
  return out.filter(item => !seen.has(item.change_id) && seen.add(item.change_id));
}

/**
 * State-based evidence findings at a point in time (not a diff): verified rules whose
 * review stops before the active window ends, and a dataset span that no longer
 * contains the active window.
 */
export function assessEvidence(data, { now = new Date() } = {}) {
  const window = publicationWindow(now);
  const detectedAt = now.toISOString();
  const out = [];
  if (!includesWindow(data.window, window)) out.push(change('EXPIRED_EVIDENCE', { field: 'window', before: data.window, after: { from: window.from, to: window.to }, reason: 'The reviewed span does not contain the active publication window.' }, { detectedAt }));
  for (const rule of data.rules) {
    if (rule.status !== 'ACTIVE' || rule.verification_state !== 'PRIMARY_VERIFIED' || rule.valid_to < window.from || rule.valid_from > window.to) continue;
    if (rule.review_window.to < window.to && rule.valid_to > rule.review_window.to) out.push(change('EXPIRED_EVIDENCE', { jurisdiction: rule.jurisdiction, ban_id: rule.ban_id, field: 'review_window', before: rule.review_window, after: { from: window.from, to: window.to }, sources: sourcesOf(rule), reason: `Reviewed only to ${rule.review_window.to}.` }, { detectedAt }));
  }
  return out;
}
