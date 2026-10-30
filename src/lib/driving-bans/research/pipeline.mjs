import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { basename, isAbsolute, join, resolve, sep } from 'node:path';
import { dajcCoverageCount } from '../../../../config/europe-coverage.mjs';
import { appendAudit } from '../evidence-store.mjs';
import { stableStringify } from '../review-workflow.mjs';
import { researchTarget, discoverDocuments } from './discovery.mjs';
import { composeDocumentParts, documentText, scanForInstructions } from './documents.mjs';
import { checkExtractedRule, draftRuleOf, extractRules, EXTRACTION_PROMPT_VERSION } from './extraction.mjs';
import { crossCheck, dualExtraction } from './cross-check.mjs';
import { buildOperations, documentPath, draftSubmission, sourceConflicts } from './proposal.mjs';

/**
 * DAJC Driving Bans research run. AI searches, reads and checks official documents
 * and prepares drafts; it never publishes, approves or writes canonical.json.
 *
 * Internal research phases (before the existing review workflow of PR #82):
 *   DISCOVERED → DOCUMENT_RETRIEVED → AI_EXTRACTED → AI_CROSS_CHECKED →
 *   DETERMINISTICALLY_VALIDATED → REVIEW_REQUIRED
 * with separate branches INSUFFICIENT_EVIDENCE and CONFLICT. A person then reads the
 * primary text and promotes a REVIEW_REQUIRED draft into the existing automaton
 * (IMPORTED → VALIDATED → REVIEW_REQUIRED → APPROVED → READY_FOR_CANONICAL_UPDATE),
 * or rejects it. There is no second approval automaton.
 */

export const RESEARCH_PHASES = Object.freeze(['DISCOVERED', 'DOCUMENT_RETRIEVED', 'AI_EXTRACTED', 'AI_CROSS_CHECKED', 'DETERMINISTICALLY_VALIDATED', 'REVIEW_REQUIRED']);
export const DRAFT_STATES = Object.freeze(['REVIEW_REQUIRED', 'INSUFFICIENT_EVIDENCE', 'CONFLICT', 'PROMOTED', 'REJECTED']);
export const DOCUMENT_OUTCOMES = Object.freeze(['DRAFTED', 'DUPLICATE', 'NO_CHANGE', 'NOT_RELEVANT', 'UNCHANGED_SOURCE', 'SOURCE_UNAVAILABLE', 'REJECTED_BY_FETCH_POLICY', 'EXTRACTION_INVALID', 'NOT_ANALYZED_BUDGET', 'NOT_ANALYZED_NO_PROVIDER']);

const sha = value => createHash('sha256').update(typeof value === 'string' ? value : stableStringify(value)).digest('hex');

/** Research store with a write guard: inside its root only, and never a file named canonical.json. */
export function openResearchStore(root) {
  const real = resolve(root);
  if (existsSync(join(real, 'canonical.json'))) throw new Error('The research store must not be the canonical data directory');
  for (const dir of ['runs', 'drafts', 'documents', 'blobs', 'cache']) mkdirSync(join(real, dir), { recursive: true });
  const path = relative => {
    if (typeof relative !== 'string' || !relative || isAbsolute(relative) || relative.split(/[\\/]/).some(part => part === '..' || part === '')) throw new Error(`Rejected research store path ${JSON.stringify(relative)}`);
    const file = resolve(real, relative);
    if (!file.startsWith(real + sep)) throw new Error(`Research store path escapes the store: ${relative}`);
    if (basename(file) === 'canonical.json') throw new Error('Research never writes canonical.json');
    return file;
  };
  const write = (relative, content) => { const file = path(relative); const tmp = `${file}.tmp-${process.pid}`; writeFileSync(tmp, content); renameSync(tmp, file); return file; };
  return {
    root: real, path,
    write,
    writeJson: (relative, value) => write(relative, JSON.stringify(value, null, 1) + '\n'),
    writeOnce: (relative, content) => { if (!existsSync(path(relative))) write(relative, content); },
    exists: relative => existsSync(path(relative)),
    readJson: relative => JSON.parse(readFileSync(path(relative), 'utf8')),
    readBytes: relative => readFileSync(path(relative)),
    list: dir => existsSync(join(real, dir)) ? readdirSync(join(real, dir)).sort() : [],
    audit: event => appendAudit(real, event),
  };
}

export const loadDraft = (store, id) => { if (!/^rdraft-[0-9a-f]{16}$/.test(id)) throw new Error(`Invalid draft id ${id}`); return store.readJson(`drafts/${id}.json`); };
export const listDrafts = store => store.list('drafts').filter(name => /^rdraft-[0-9a-f]{16}\.json$/.test(name)).map(name => store.readJson(`drafts/${name}`));

const blocking = findings => findings.some(item => item.blocking_state === 'INSUFFICIENT_EVIDENCE') ? 'INSUFFICIENT_EVIDENCE' : findings.some(item => item.blocking_state === 'CONFLICT') ? 'CONFLICT' : null;
/** The existing validator decides the state; its individual findings are carried along for the reviewer. */
const dryRunFindings = dryRun => [
  ...dryRun.findings.map(item => ({ ...item, blocking_state: 'NOTE', from: 'review-workflow dry run' })),
  ...(dryRun.state === 'VALIDATED' ? [] : [{ code: `REVIEW_WORKFLOW_${dryRun.state}`, blocking_state: dryRun.state === 'CONFLICT' ? 'CONFLICT' : 'INSUFFICIENT_EVIDENCE', message: `The existing validator classifies this draft as ${dryRun.state}: ${dryRun.findings.map(f => f.code).join(', ')}` }]),
];

/**
 * Process one retrieved document up to a stored draft (or a terminal outcome).
 * Throws BudgetExceededError so the run can stop AI work instead of guessing.
 */
async function analyseDocument({ item, fetched, target, window, rawCanonical, catalogSources, orchestrator, store, runId, now, synthetic }) {
  const phases = ['DISCOVERED', 'DOCUMENT_RETRIEVED'];
  const { text, metadata } = documentText(fetched);
  const document = { url: item.url, final_url: fetched.final_url, sha256: fetched.sha256, byte_length: fetched.byte_length, kind: fetched.kind, content_type: fetched.content_type, retrieved_at: fetched.retrieved_at, last_modified: fetched.last_modified, etag: fetched.etag, parts: fetched.parts ?? null, title: metadata.title ?? item.title ?? fetched.title ?? null, language: metadata.language, eli: metadata.eli, published: metadata.published, modified: metadata.modified, version: metadata.eli?.version ?? metadata.modified ?? null, authority: item.authority, origin: item.origin, source_id: item.source_id, licence: item.licence ?? null, rights: item.rights ?? null, bytes: fetched.bytes };
  const injection = text ? scanForInstructions(text) : [];
  const findings = injection.length ? [{ code: 'UNTRUSTED_INSTRUCTIONS_IN_DOCUMENT', blocking_state: 'CONFLICT', message: 'The document contains instruction-like text addressed to an AI; it was treated as data only', excerpts: injection.slice(0, 3) }] : [];

  const cacheKey = `cache/${sha([fetched.sha256, target.jurisdiction, window, EXTRACTION_PROMPT_VERSION])}.json`;
  const checkRules = rules => rules.flatMap((rule, index) => checkExtractedRule(rule, { text, jurisdiction: target.jurisdiction, window }).map(item => ({ ...item, rule_index: index })));
  const blockingCount = list => list.filter(item => item.blocking_state !== 'NOTE').length;
  let first;
  if (store.exists(cacheKey)) first = { ...store.readJson(cacheKey), cached: true };
  else first = await extractRules({ orchestrator, jurisdiction: target.jurisdiction, window, document, text });
  if (!first.ok) return { outcome: 'EXTRACTION_INVALID', findings: [...findings, { code: 'EXTRACTION_OUTPUT_INVALID', blocking_state: 'INSUFFICIENT_EVIDENCE', message: first.issues.join('; ') }] };
  phases.push('AI_EXTRACTED');
  if (first.extraction.document_relevance === 'NOT_RELEVANT' || !first.extraction.rules.length) return { outcome: 'NOT_RELEVANT', findings, extraction_meta: { provider: first.provider, model: first.model, cached: Boolean(first.cached) } };

  let ruleFindings = checkRules(first.extraction.rules);
  // Live checks (29-30 Oct 2026): the cheap model misquoted and wrote 7.5 t as 7.5 kg where the
  // strongest model did not. A cheap extraction that fails the deterministic checks is read again
  // once on the stronger route; the extraction with fewer blocking findings is kept.
  const strongerRoute = !first.cached && !first.complex && blocking(ruleFindings) === 'INSUFFICIENT_EVIDENCE' ? orchestrator.next?.('extract', { escalate: true, needsPdf: text === null }) : null;
  // Compared with the model requested, not the one served (a provider may route an ID to a newer model).
  if (strongerRoute && (strongerRoute.provider !== first.provider || strongerRoute.model !== (first.requested_model ?? first.model))) {
    let stronger = null;
    try { stronger = await extractRules({ orchestrator, jurisdiction: target.jurisdiction, window, document, text, escalate: true }); }
    catch (error) { if (error.name === 'BudgetExceededError') throw error; }
    const usable = Boolean(stronger?.ok && stronger.extraction.rules.length);
    const strongerFindings = usable ? checkRules(stronger.extraction.rules) : null;
    const adopted = usable && blockingCount(strongerFindings) < blockingCount(ruleFindings);
    findings.push({ code: 'ESCALATED_EXTRACTION', blocking_state: 'NOTE', message: `${first.model} failed the deterministic checks (${[...new Set(ruleFindings.filter(f => f.blocking_state !== 'NOTE').map(f => f.code))].join(', ')}); ${usable ? `${stronger.model} read the document again and ${adopted ? 'its extraction is used' : 'did no better, so the first extraction is kept'}` : 'no stronger model could read it again'}`, first_model: first.model, stronger_model: stronger?.model ?? null });
    if (adopted) { first = { ...stronger, escalated_from: first.model }; ruleFindings = strongerFindings; }
  }
  if (!first.cached) store.writeJson(cacheKey, { ok: true, extraction: first.extraction, provider: first.provider, vendor: first.vendor, model: first.model, complex: Boolean(first.complex), escalated_from: first.escalated_from ?? null, prompt_version: EXTRACTION_PROMPT_VERSION });
  const extraction = first.extraction;
  if (extraction.instructions_found_in_document) findings.push({ code: 'PROMPT_INJECTION_SUSPECTED', blocking_state: 'CONFLICT', message: 'The extraction model reports instructions inside the document' });
  const drafts = extraction.rules.map(rule => draftRuleOf(rule, { jurisdiction: target.jurisdiction, window, sourceId: item.source_id ?? 'pending' }));
  drafts.forEach((draft, index) => { if (!draft) ruleFindings.push({ code: 'DRAFT_NOT_BUILDABLE', blocking_state: 'INSUFFICIENT_EVIDENCE', message: 'Missing criterion, timezone or validity: no registry rule can be drafted without inventing a value', rule_index: index }); });
  const usable = drafts.map((draft, index) => ({ draft, rule: extraction.rules[index] })).filter(entry => entry.draft);
  // Only a registry source keeps its canonical identity; a lead or search hit on the same URL is the same source.
  const known = target.known.find(source => source.url === item.url || source.url === fetched.final_url) ?? null;
  const { operations, findings: comparison, sourceId } = buildOperations({ drafts: usable.map(entry => entry.draft), extracted: usable.map(entry => entry.rule), document, target, rawCanonical, window, known });
  findings.push(...ruleFindings, ...comparison);
  const extractionMeta = { provider: first.provider, vendor: first.vendor, model: first.model, escalated_from: first.escalated_from ?? null, prompt_version: EXTRACTION_PROMPT_VERSION, cached: Boolean(first.cached) };
  if (!operations.length && !blocking(ruleFindings)) return { outcome: 'NO_CHANGE', findings, extraction_meta: extractionMeta, document };
  // The same document with the same operations was drafted before: nothing new, no further AI cost.
  const draftId = `rdraft-${sha({ jurisdiction: target.jurisdiction, document: fetched.sha256, operations }).slice(0, 16)}`;
  if (store.exists(`drafts/${draftId}.json`)) return { outcome: 'DUPLICATE', draft_id: draftId, findings, extraction_meta: extractionMeta };

  // Independent check by another vendor, and a second extraction when the change is risky.
  // An extraction the deterministic checks already reject is not sent for a paid check.
  let check = null, dual = null;
  if (blocking(ruleFindings) === 'INSUFFICIENT_EVIDENCE' || !operations.length) findings.push({ code: 'INDEPENDENT_CHECK_SKIPPED', blocking_state: 'NOTE', message: 'The extraction already fails the deterministic checks' });
  else {
    try {
      check = await crossCheck({ orchestrator, jurisdiction: target.jurisdiction, window, document, text, extraction, excludeVendors: [first.vendor] });
      findings.push(...check.findings);
      if (check.ok) phases.push('AI_CROSS_CHECKED');
      const risky = operations.some(op => op.op === 'ADD_RULE' || op.op === 'CANCEL_RULE' || (op.op === 'AMEND_RULE' && ['weight_threshold', 'schedule', 'roads'].some(key => key in op.changes)));
      if (risky) {
        dual = await dualExtraction({ orchestrator, jurisdiction: target.jurisdiction, window, document, text, first: extraction, excludeVendors: [first.vendor] });
        findings.push(...dual.findings);
      }
    } catch (error) {
      if (error.name === 'BudgetExceededError') throw error;
      findings.push({ code: 'NO_INDEPENDENT_CHECK', blocking_state: 'INSUFFICIENT_EVIDENCE', message: `No independent check was possible: ${error.message}` });
    }
  }

  const summary = `AI research draft for ${target.jurisdiction} from ${document.final_url}: ${operations.filter(op => op.op !== 'ADD_SOURCE').map(op => `${op.op} ${op.ban_id ?? op.rule?.ban_id}`).join(', ') || 'no rule operation'}. Not legally verified.`;
  let submission = null, dryRun = null;
  if (operations.length) {
    try {
      ({ submission, dryRun } = draftSubmission({ target, document, operations, sourceId, summary, rawCanonical, catalogSources, detectedAt: now.toISOString(), synthetic }));
      findings.push(...dryRunFindings(dryRun));
    } catch (error) {
      findings.push({ code: 'SUBMISSION_INVALID', blocking_state: 'INSUFFICIENT_EVIDENCE', message: String(error.message || error).slice(0, 500) });
    }
  }
  const failed = blocking(findings);
  if (!failed && dryRun?.state === 'VALIDATED') phases.push('DETERMINISTICALLY_VALIDATED', 'REVIEW_REQUIRED');
  const state = failed ?? (dryRun?.state === 'VALIDATED' ? 'REVIEW_REQUIRED' : 'INSUFFICIENT_EVIDENCE');
  const at = now.toISOString();
  const { bytes, ...documentMeta } = document;
  const draft = {
    draft_id: draftId, run_id: runId, state, phases, jurisdiction: target.jurisdiction, created_at: at, synthetic,
    document: { ...documentMeta, path: documentPath(document), source_id: sourceId },
    extraction: { ...extractionMeta, document_relevance: extraction.document_relevance, issuing_authority: extraction.issuing_authority, rules: extraction.rules, missing_or_unclear: extraction.missing_or_unclear, instructions_found_in_document: extraction.instructions_found_in_document },
    cross_check: check && { provider: check.provider, vendor: check.vendor, model: check.model, overall: check.overall ?? null, ok: check.ok },
    second_extraction: dual && { provider: dual.provider, vendor: dual.vendor, model: dual.model, agreed: !dual.findings.length },
    findings, submission, dry_run: dryRun,
    legal_verification: { status: 'NOT_PERFORMED', note: 'AI drafts and agreement between models are not legal verification. A person must read the primary text and promote or reject this draft.' },
    history: [{ at, from: null, to: state, actor: 'dajc-research-ai', identity_verified: false, action: 'DRAFT' }],
  };
  store.writeJson(`drafts/${draftId}.json`, draft);
  store.audit({ at, actor: 'dajc-research-ai', identity_verified: false, action: 'RESEARCH_DRAFT', draft_id: draftId, run_id: runId, from: null, to: state, details: { jurisdiction: target.jurisdiction, document: fetched.sha256, findings: findings.map(f => f.code) } });
  return { outcome: 'DRAFTED', draft_id: draftId, state, findings, extraction_meta: extractionMeta };
}

/** Every part of a multi-document act, or the first part that failed; each part is stored as retrieved. */
async function fetchParts(item, allowedHosts, fetchDocument, store) {
  const parts = [];
  for (const url of item.parts) {
    const part = await fetchDocument(url, allowedHosts);
    if (!part.ok) return { ...part, part_url: url };
    parts.push(part);
  }
  for (const part of parts) store.writeOnce(`blobs/${part.sha256}`, part.bytes);
  return composeDocumentParts(parts) ?? { ok: false, url: item.url, availability: 'REJECTED', code: 'PARTS_WITHOUT_TEXT' };
}

/**
 * One research run over the requested jurisdictions. fetchDocument(url, allowedHosts)
 * is safeFetch in production and a fixture transport in tests.
 */
export async function runResearch({ jurisdictions, mode = 'full', window, now = new Date(), rawCanonical, snapshot, catalogEntries = [], authorityDomains = {}, orchestrator, fetchDocument, store, leadUrls = [], maxDocuments = 6, useSearch = true, synthetic = false, runId = `run-${now.toISOString().replace(/[-:.]/g, '').slice(0, 15)}-${sha(jurisdictions).slice(0, 6)}` }) {
  const startedAt = now.toISOString();
  const report = {
    run_id: runId, mode, synthetic, started_at: startedAt, window, jurisdictions_requested: jurisdictions.length, jurisdictions_processed: 0,
    technical: { status: 'COMPLETED', errors: [] },
    source_retrieval: { discovered: 0, retrieved: 0, unchanged: 0, unavailable: [], rejected: [], discarded_non_official: 0 },
    ai_analysis: { status: 'OK', documents_analyzed: 0, cached: 0, not_analyzed: 0, blocked_reason: null },
    independent_check: { performed: 0, agreed: 0, disagreed: 0, skipped_failed_validation: 0, not_available: 0 },
    legal_verification: { status: 'NOT_PERFORMED_BY_AI', drafts_awaiting_human_review: 0, note: 'Research prepares drafts only. Legal verification and publication need a person and an approved pull request.' },
    registry_completeness: null,
    per_jurisdiction: [], drafts: [], calls: [],
  };
  let aiBlocked = null;
  const drafts = [];
  for (const code of jurisdictions) {
    const target = researchTarget(code, { rawCanonical, catalogEntries, authorityDomains });
    const row = { jurisdiction: code, documents: [], errors: [] };
    report.per_jurisdiction.push(row);
    let discovered;
    try { discovered = await discoverDocuments(target, { orchestrator: aiBlocked ? null : orchestrator, window, maxDocuments, leadUrls: mode === 'urgent' ? leadUrls : [], useSearch }); }
    catch (error) { aiBlocked = 'BUDGET_EXHAUSTED'; report.technical.errors.push({ jurisdiction: code, stage: 'discover', message: error.message }); discovered = await discoverDocuments(target, { orchestrator: null, window, maxDocuments, leadUrls: mode === 'urgent' ? leadUrls : [], useSearch: false }); }
    row.errors.push(...discovered.errors);
    report.source_retrieval.discovered += discovered.items.length;
    report.source_retrieval.discarded_non_official += discovered.discarded.length;
    for (const item of discovered.items) {
      const fetched = item.parts ? await fetchParts(item, target.allowedHosts, fetchDocument, store) : await fetchDocument(item.url, target.allowedHosts);
      const entry = { url: item.url, origin: item.origin };
      row.documents.push(entry);
      if (!fetched.ok) {
        entry.outcome = fetched.availability === 'REJECTED' ? 'REJECTED_BY_FETCH_POLICY' : 'SOURCE_UNAVAILABLE';
        entry.code = fetched.code;
        (entry.outcome === 'SOURCE_UNAVAILABLE' ? report.source_retrieval.unavailable : report.source_retrieval.rejected).push({ jurisdiction: code, url: item.url, ...(fetched.part_url ? { part_url: fetched.part_url } : {}), code: fetched.code, http_status: fetched.http_status ?? null, ...(item.origin === 'REGISTRY' ? { registry_source_id: item.source_id, note: 'Publication trust needs review; the ban is NOT cancelled.' } : {}) });
        continue;
      }
      report.source_retrieval.retrieved += 1;
      store.writeOnce(`blobs/${fetched.sha256}`, fetched.bytes);
      store.writeOnce(`documents/${fetched.sha256}.json`, JSON.stringify({ sha256: fetched.sha256, url: item.url, final_url: fetched.final_url, kind: fetched.kind, content_type: fetched.content_type, bytes: fetched.byte_length, ...(fetched.parts ? { parts: fetched.parts } : {}), first_retrieved_at: fetched.retrieved_at, last_modified: fetched.last_modified, etag: fetched.etag, jurisdiction: code, authority: item.authority ?? null, origin: item.origin, availability: 'REACHABLE', licence: item.licence ?? null, rights: item.rights ?? null }, null, 1) + '\n');
      if (item.content_sha256 && item.content_sha256 === fetched.sha256) { entry.outcome = 'UNCHANGED_SOURCE'; report.source_retrieval.unchanged += 1; continue; }
      if (aiBlocked) { entry.outcome = aiBlocked === 'BUDGET_EXHAUSTED' ? 'NOT_ANALYZED_BUDGET' : 'NOT_ANALYZED_NO_PROVIDER'; report.ai_analysis.not_analyzed += 1; continue; }
      try {
        const result = await analyseDocument({ item, fetched, target, window, rawCanonical, catalogSources: catalogEntries, orchestrator, store, runId, now, synthetic });
        Object.assign(entry, { outcome: result.outcome, draft_id: result.draft_id ?? null, state: result.state ?? null, findings: (result.findings || []).map(f => f.code) });
        report.ai_analysis.documents_analyzed += 1;
        if (result.extraction_meta?.cached) report.ai_analysis.cached += 1;
        if (result.outcome === 'DRAFTED') drafts.push(loadDraft(store, result.draft_id));
      } catch (error) {
        if (error.name === 'BudgetExceededError') { aiBlocked = 'BUDGET_EXHAUSTED'; entry.outcome = 'NOT_ANALYZED_BUDGET'; report.ai_analysis.not_analyzed += 1; report.technical.errors.push({ jurisdiction: code, stage: 'analyse', message: error.message }); continue; }
        if (error.name === 'NoProviderError') { aiBlocked = aiBlocked ?? 'NO_PROVIDER'; entry.outcome = 'NOT_ANALYZED_NO_PROVIDER'; report.ai_analysis.not_analyzed += 1; report.technical.errors.push({ jurisdiction: code, stage: 'analyse', message: error.message }); continue; }
        throw error;
      }
    }
    report.jurisdictions_processed += 1;
  }

  // Two documents of one run that change the same rule differently go to the CONFLICT branch together.
  for (const conflict of sourceConflicts(drafts)) for (const id of conflict.drafts) {
    const draft = loadDraft(store, id);
    if (draft.state === 'CONFLICT') continue;
    const at = now.toISOString();
    draft.findings.push({ code: 'SOURCE_CONFLICT', blocking_state: 'CONFLICT', message: `Documents of this run change ${conflict.ban_id} differently (${conflict.drafts.join(', ')})`, ban_id: conflict.ban_id });
    draft.history.push({ at, from: draft.state, to: 'CONFLICT', actor: 'dajc-research-ai', identity_verified: false, action: 'SOURCE_CONFLICT' });
    store.audit({ at, actor: 'dajc-research-ai', identity_verified: false, action: 'SOURCE_CONFLICT', draft_id: id, run_id: runId, from: draft.state, to: 'CONFLICT' });
    draft.state = 'CONFLICT';
    store.writeJson(`drafts/${id}.json`, draft);
  }

  const finalDrafts = drafts.map(draft => loadDraft(store, draft.draft_id));
  report.drafts = finalDrafts.map(draft => ({ draft_id: draft.draft_id, jurisdiction: draft.jurisdiction, state: draft.state, operations: (draft.submission?.operations ?? []).map(op => `${op.op} ${op.ban_id ?? op.rule?.ban_id ?? op.source?.source_id}`), findings: draft.findings.filter(f => f.blocking_state !== 'NOTE').map(f => f.code) }));
  report.legal_verification.drafts_awaiting_human_review = finalDrafts.filter(draft => draft.state === 'REVIEW_REQUIRED').length;
  for (const draft of finalDrafts) {
    if (!draft.cross_check) { report.independent_check[draft.findings.some(f => f.code === 'INDEPENDENT_CHECK_SKIPPED') ? 'skipped_failed_validation' : 'not_available'] += 1; continue; }
    report.independent_check.performed += 1;
    if (draft.cross_check.ok && draft.second_extraction?.agreed !== false) report.independent_check.agreed += 1; else report.independent_check.disagreed += 1;
  }
  report.ai_analysis.status = aiBlocked ?? 'OK';
  report.ai_analysis.blocked_reason = aiBlocked;
  if (aiBlocked) report.technical.status = 'COMPLETED_WITH_AI_STOPPED';
  report.calls = orchestrator?.calls() ?? [];
  report.cost_usd = orchestrator?.spentThisRun() ?? 0;
  const completeRows = snapshot.jurisdictions.filter(item => item.coverage_complete).map(item => item.jurisdiction);
  report.registry_completeness = { tracked: snapshot.jurisdictions.length, coverage_complete: completeRows.length, complete: completeRows, incomplete: snapshot.jurisdictions.filter(item => !item.coverage_complete).map(item => item.jurisdiction), window: snapshot.window, dataset_version: snapshot.dataset_version };
  report.statement = `${report.jurisdictions_processed} of ${report.jurisdictions_requested} requested jurisdictions processed (${dajcCoverageCount} tracked). Registry: ${completeRows.length} of ${snapshot.jurisdictions.length} jurisdictions verified in full for ${snapshot.window.from} to ${snapshot.window.to}. This run is not a legal verification of any jurisdiction.`;
  report.finished_at = new Date().toISOString();
  store.writeJson(`runs/${runId}.json`, report);
  store.audit({ at: report.finished_at, actor: 'dajc-research-ai', identity_verified: false, action: 'RESEARCH_RUN', run_id: runId, from: null, to: report.technical.status, details: { drafts: report.drafts.length, cost_usd: report.cost_usd } });
  return report;
}
