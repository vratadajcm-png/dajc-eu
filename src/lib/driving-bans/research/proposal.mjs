import { createHash } from 'node:crypto';
import { dajcEuropeCoverage } from '../../../../config/europe-coverage.mjs';
import { restrictionClassOf } from '../core.mjs';
import { parseSubmission, stableStringify, validateProposal } from '../review-workflow.mjs';
import { normalizeForQuote } from './documents.mjs';

/**
 * Deterministic comparison of drafted rules with the registry, and the draft
 * submission in the existing evidence format (docs/DRIVING_BANS_EVIDENCE_IMPORT.md).
 * The existing validator (review-workflow.mjs) runs as a dry run; the draft itself
 * never carries legal_verified_at, so it can only enter the review workflow
 * through a person (research/promote.mjs).
 */

const sha = value => createHash('sha256').update(typeof value === 'string' ? value : stableStringify(value)).digest('hex');
const finding = (code, blocking, message, extra = {}) => ({ code, blocking_state: blocking, message, ...extra });
const set = values => new Set((values || []).map(normalizeForQuote));
const sameSet = (a, b) => { const x = set(a), y = set(b); return x.size === y.size && [...x].every(value => y.has(value)); };
const sequenceOf = (rule, raw) => rule.sequence ?? raw.rule_profiles?.[rule.profile]?.sequence ?? 0;
const effective = (rule, raw) => ({ ...(raw.rule_profiles?.[rule.profile] || {}), ...rule });

const datesIn = (schedule, window) => (schedule.dates || []).map(item => item.date).filter(date => date >= window.from && date <= window.to).sort();
function overlaps(a, b, window) {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'daily') return true;
  if (a.kind === 'weekly') return a.weekdays.some(day => b.weekdays.includes(day));
  const mine = new Set(datesIn(a, window));
  return datesIn(b, window).some(date => mine.has(date)) || (!mine.size && !datesIn(b, window).length);
}

/** Active registry rule of the same jurisdiction, class and recurrence that the draft most plausibly restates. */
export function matchRegistryRule(draft, rawCanonical, window) {
  const superseded = new Set(rawCanonical.rules.flatMap(rule => effective(rule, rawCanonical).status === 'ACTIVE' ? (rule.supersedes || []) : []));
  let best = null;
  for (const raw of rawCanonical.rules) {
    const rule = effective(raw, rawCanonical);
    if (rule.jurisdiction !== draft.jurisdiction || rule.status !== 'ACTIVE' || superseded.has(rule.ban_id) || restrictionClassOf(rule) !== draft.restriction_class) continue;
    if (!overlaps(draft.schedule, rule.schedule, window)) continue;
    const mine = roadIds(draft.roads), theirs = roadIds(rule.roads);
    const roadsMatch = (!mine.length && !theirs.length) || mine.some(id => theirs.includes(id));
    const score = 3 + (rule.schedule.start_time === draft.schedule.start_time ? 2 : 0) + (rule.schedule.end_time === draft.schedule.end_time ? 1 : 0) + (roadsMatch ? 2 : 0) + (sameSet(rule.regions, draft.regions) ? 1 : 0);
    if (score >= 6 && (!best || score > best.score)) best = { rule, raw, score };
  }
  return best;
}

/** Legally decisive differences only; wording of titles, directions and notes is not a change of law. */
export function decisiveDifferences(draft, existing, window) {
  const changes = {}, notes = [];
  const a = draft.schedule, b = existing.schedule;
  const timesDiffer = a.start_time !== b.start_time || a.end_time !== b.end_time || a.end_day_offset !== b.end_day_offset;
  if (a.kind === 'weekly' && (timesDiffer || stableStringify([...a.weekdays].sort()) !== stableStringify([...b.weekdays].sort()))) changes.schedule = { ...b, start_time: a.start_time, end_time: a.end_time, end_day_offset: a.end_day_offset, weekdays: [...a.weekdays].sort() };
  if (a.kind === 'daily' && timesDiffer) changes.schedule = { ...b, start_time: a.start_time, end_time: a.end_time, end_day_offset: a.end_day_offset };
  if (a.kind === 'dates') {
    const drafted = datesIn(a, window), known = datesIn(b, window);
    if (timesDiffer || stableStringify(drafted) !== stableStringify(known)) {
      // Dates outside the reviewed period stay as they are; only the reviewed period is restated.
      const outside = (b.dates || []).filter(item => item.date < window.from || item.date > window.to);
      changes.schedule = { ...b, start_time: a.start_time, end_time: a.end_time, end_day_offset: a.end_day_offset, dates: [...outside, ...drafted.map(date => ({ date, occurrence_id: date }))].sort((x, y) => x.date.localeCompare(y.date)) };
      notes.push(finding('DATES_RESTATED_FOR_REVIEWED_PERIOD', 'NOTE', 'Only dates inside the reviewed period are replaced'));
    }
  }
  // Structure decides (combinator, operators, values, units); the wording of applies_to is for the reviewer.
  if (stableStringify(weightStructure(draft.weight_threshold)) !== stableStringify(weightStructure(existing.weight_threshold))) changes.weight_threshold = draft.weight_threshold;
  else if (stableStringify(draft.weight_threshold) !== stableStringify(existing.weight_threshold)) notes.push(finding('WEIGHT_WORDING_DIFFERS', 'NOTE', 'Same thresholds, different description of the measure; check MAM versus actual mass', { ban_id: existing.ban_id }));
  // Road numbers are compared; road classes and region names depend on language and go to the reviewer.
  const draftIds = roadIds(draft.roads), knownIds = roadIds(existing.roads);
  if ((draftIds.length || knownIds.length) && stableStringify(draftIds) !== stableStringify(knownIds)) changes.roads = draft.roads;
  else if (!sameSet(draft.roads, existing.roads)) notes.push(finding('ROAD_SCOPE_WORDING_DIFFERS', 'NOTE', `Road scope worded differently: ${draft.roads.join('; ')} / ${existing.roads.join('; ')}`, { ban_id: existing.ban_id }));
  if (!sameSet(draft.regions, existing.regions)) notes.push(finding('REGIONS_DIFFER', 'NOTE', `Regions: ${draft.regions.join('; ') || 'none'} / ${existing.regions.join('; ') || 'none'}`, { ban_id: existing.ban_id }));
  if (draft.exceptions.length !== existing.exceptions.length) notes.push(finding('EXCEPTIONS_DIFFER', 'NOTE', `The document lists ${draft.exceptions.length} exceptions, the registry ${existing.exceptions.length}; compare their wording before deciding`, { ban_id: existing.ban_id }));
  if (draft.valid_to > existing.valid_to) changes.valid_to = draft.valid_to;
  return { changes, notes };
}

const weightStructure = weight => weight?.any_of || weight?.all_of
  ? { [weight.any_of ? 'any_of' : 'all_of']: (weight.any_of || weight.all_of).map(weightStructure).map(stableStringify).sort() }
  : { operator: weight?.operator, value: weight?.value ?? null, unit: weight?.unit ?? null };
export const roadIds = roads => [...new Set((roads || []).flatMap(road => String(road).toUpperCase().match(/\b[A-Z]{1,3}[- ]?\d{1,4}[A-Z]?\b/g) || []).map(id => id.replace(/[- ]/g, '')))].sort();

const hostOf = url => new URL(url).hostname.replace(/^www\./, '');

/**
 * Operations for one document: ADD_SOURCE for a new official source, then
 * ADD_RULE / AMEND_RULE / CANCEL_RULE. Unmatched registry rules are never cancelled.
 */
export function buildOperations({ drafts, extracted, document, target, rawCanonical, window, known }) {
  const operations = [], findings = [];
  // A URL the registry already holds keeps its identity and role: a SECONDARY page never becomes PRIMARY here.
  const sameUrl = url => { try { const a = new URL(url); a.hash = ''; return a.href; } catch { return url; } };
  const registered = rawCanonical.sources.find(source => [document.url, document.final_url].filter(Boolean).map(sameUrl).includes(sameUrl(source.url)));
  const sourceId = registered?.source_id ?? (known?.origin === 'REGISTRY' ? known.source_id : `${target.jurisdiction.toLowerCase()}-ai-src-${sha(document.final_url).slice(0, 10)}`);
  const sourceExists = rawCanonical.sources.some(source => source.source_id === sourceId);
  if (registered && registered.role !== 'PRIMARY') findings.push(finding('SOURCE_NOT_PRIMARY', 'INSUFFICIENT_EVIDENCE', `The registry records ${registered.source_id} as ${registered.role}; it cannot back a verified rule`, { source_id: registered.source_id }));
  const usedRules = new Set();
  for (const [index, draft] of drafts.entries()) {
    const rule = { ...draft, source_id: sourceId, evidence_ids: [sourceId] };
    const relation = extracted[index].relation;
    const match = matchRegistryRule(rule, rawCanonical, window);
    if (relation.type === 'REPEALS') {
      if (!match) { findings.push(finding('CANCELLATION_TARGET_NOT_FOUND', 'INSUFFICIENT_EVIDENCE', 'The document repeals a rule that cannot be matched to the registry', { rule_index: index })); continue; }
      const effectiveFrom = extracted[index].valid_from;
      if (!effectiveFrom) { findings.push(finding('CANCELLATION_DATE_MISSING', 'INSUFFICIENT_EVIDENCE', `${match.rule.ban_id}: the repeal states no effective date`, { ban_id: match.rule.ban_id })); continue; }
      usedRules.add(match.rule.ban_id);
      // A repeal of some days only excludes those days; the rest of the rule stays in force.
      const repealed = rule.schedule.kind === 'dates' ? datesIn(rule.schedule, window) : [];
      const ruleDates = match.rule.schedule.kind === 'dates' ? (match.rule.schedule.dates || []).map(item => item.date) : null;
      if (repealed.length && (!ruleDates || ruleDates.some(date => !repealed.includes(date)))) {
        const excluded = [...new Set([...(match.rule.schedule.excluded_dates || []), ...repealed])].sort();
        operations.push({ op: 'AMEND_RULE', ban_id: match.rule.ban_id, expected_sequence: sequenceOf(match.raw, rawCanonical), changes: { schedule: { ...match.rule.schedule, excluded_dates: excluded }, evidence_ids: [...new Set([...(match.rule.evidence_ids || []), sourceId])] }, reason: `Official document ${document.final_url} repeals ${repealed.join(', ')} with effect from ${effectiveFrom}.` });
        findings.push(finding('PARTIAL_REPEAL', 'NOTE', `${match.rule.ban_id}: only ${repealed.join(', ')} are repealed; the other days stay in force`, { ban_id: match.rule.ban_id }));
        continue;
      }
      operations.push({ op: 'CANCEL_RULE', ban_id: match.rule.ban_id, expected_sequence: sequenceOf(match.raw, rawCanonical), legal_basis: rule.legal_basis.slice(0, 500), evidence_ids: [sourceId], effective_from: effectiveFrom });
      continue;
    }
    if (!match) { operations.push({ op: 'ADD_RULE', rule }); continue; }
    usedRules.add(match.rule.ban_id);
    const { changes, notes } = decisiveDifferences(rule, match.rule, window);
    findings.push(...notes);
    if (Object.keys(changes).length) operations.push({ op: 'AMEND_RULE', ban_id: match.rule.ban_id, expected_sequence: sequenceOf(match.raw, rawCanonical), changes: { ...changes, ...(match.rule.source_id === sourceId ? {} : { evidence_ids: [...new Set([...(match.rule.evidence_ids || []), sourceId])] }) }, reason: `Official document ${document.final_url} (SHA-256 ${document.sha256.slice(0, 16)}) states different ${Object.keys(changes).join(', ')}.` });
    else findings.push(finding('NO_LEGAL_CHANGE', 'NOTE', `${match.rule.ban_id}: the document restates the registry rule`, { ban_id: match.rule.ban_id }));
  }
  if (known?.origin === 'REGISTRY') {
    for (const raw of rawCanonical.rules) {
      const rule = effective(raw, rawCanonical);
      if (rule.jurisdiction === target.jurisdiction && rule.status === 'ACTIVE' && rule.source_id === sourceId && !usedRules.has(rule.ban_id)) findings.push(finding('REGISTRY_RULE_NOT_IN_EXTRACTION', 'NOTE', `${rule.ban_id} cites this source but was not found in the extraction; this is not a cancellation`, { ban_id: rule.ban_id }));
    }
  }
  if (operations.length && !sourceExists) {
    operations.unshift({ op: 'ADD_SOURCE', source: { source_id: sourceId, url: document.final_url, authority: (document.authority || hostOf(document.final_url)).slice(0, 300), role: 'PRIMARY', version: (document.version || `retrieved ${document.retrieved_at} sha256:${document.sha256.slice(0, 16)}`).slice(0, 500), findings: `Official document retrieved by DAJC research (${document.kind}${document.parts ? `: ${document.parts.length} official parts of one act, ${document.parts.map(part => `${part.final_url} sha256:${part.sha256.slice(0, 16)}`).join('; ')}` : ''}). AI-extracted draft, not legally verified.`.slice(0, 2000) } });
  }
  return { operations, findings, sourceId };
}

const EXT = { PDF: 'pdf', HTML_SNAPSHOT: 'html', JSON_DATA: 'json', XML_DATA: 'xml', TEXT_EXCERPT: 'txt' };
export const documentPath = document => `documents/${document.sha256}.${EXT[document.kind]}`;

/**
 * Draft submission plus the existing validator as a dry run. The dry run uses the
 * retrieval time in place of legal_verified_at only to reach the canonical checks;
 * the stored draft keeps legal_verified_at null.
 */
export function draftSubmission({ target, document, operations, sourceId, summary, rawCanonical, catalogSources = [], detectedAt, synthetic = false, legalEffective = null }) {
  const submission = parseSubmission({
    submission_version: 1, synthetic, submitted_by: 'dajc-research-ai (draft; not a legal verification)', jurisdiction: target.jurisdiction, region: null,
    summary: summary.slice(0, 4000), documents: [{ path: documentPath(document), source_id: sourceId, title: (document.title || document.final_url).slice(0, 300), retrieved_from: document.final_url, retrieved_at: document.retrieved_at }],
    // The legal effect as the document states it (AI-extracted); promotion needs a person to confirm it.
    links: [], legal_effective: legalEffective, legal_verified_at: null, operations, supersedes_submission: null,
  });
  const dryRun = validateProposal({ submission: { ...submission, legal_verified_at: document.retrieved_at }, documents: [{ path: documentPath(document), source_id: sourceId, sha256: document.sha256, kind: document.kind, bytes: document.byte_length }], rawCanonical, openProposals: [], identities: dajcEuropeCoverage, catalogSources, detectedAt });
  return { submission, dryRun: { state: dryRun.state, findings: dryRun.findings, changes: dryRun.changes.filter(change => change.type !== 'COVERAGE_STATUS').map(({ change_id, type, legal_change, jurisdiction, ban_id, field, user_impact }) => ({ change_id, type, legal_change, jurisdiction, ban_id, field, user_impact })), placeholder_legal_verified_at: true } };
}

/** Same rule amended differently by two documents of one run: both go to the CONFLICT branch. */
export function sourceConflicts(drafts) {
  const byRule = new Map();
  for (const draft of drafts) for (const op of draft.submission?.operations ?? []) if (op.op === 'AMEND_RULE' || op.op === 'CANCEL_RULE') {
    const list = byRule.get(op.ban_id) ?? [];
    list.push({ draft, signature: stableStringify(op.op === 'AMEND_RULE' ? op.changes : { cancel: op.effective_from }) });
    byRule.set(op.ban_id, list);
  }
  const conflicts = [];
  for (const [banId, list] of byRule) if (new Set(list.map(item => item.signature)).size > 1) conflicts.push({ ban_id: banId, drafts: list.map(item => item.draft.draft_id) });
  return conflicts;
}
