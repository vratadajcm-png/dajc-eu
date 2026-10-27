import { createHash } from 'node:crypto';
import { closeSync, existsSync, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, realpathSync, renameSync, writeFileSync, appendFileSync } from 'node:fs';
import { extname, isAbsolute, join, resolve, sep } from 'node:path';
import { parseSubmission, assertPlainData, stableStringify, validateProposal, prepareCandidate, assertTransition, OPEN_STATES, renderReviewReportHtml } from './review-workflow.mjs';
/**
 * Offline evidence store for manually supplied Driving Bans material. All input is
 * untrusted: paths are confined to the import root, sizes are bounded before
 * reading, nothing is executed or fetched, and stored evidence is content-addressed.
 * Layout: submissions/, evidence/, blobs/, proposals/, candidates/, audit-log.jsonl.
 */

export const IMPORT_LIMITS = Object.freeze({ submission_bytes: 1_000_000, text_bytes: 2_000_000, document_bytes: 25_000_000, total_bytes: 60_000_000 });
const KINDS = Object.freeze({ '.txt': 'TEXT_EXCERPT', '.md': 'TEXT_EXCERPT', '.pdf': 'PDF', '.html': 'HTML_SNAPSHOT', '.htm': 'HTML_SNAPSHOT', '.json': 'JSON_DATA', '.xml': 'XML_DATA' });
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

/** Resolve a relative path strictly inside root: no absolute paths, no "..", no symlinks, regular files only. */
export function confinedFile(root, relative) {
  if (typeof relative !== 'string' || !relative || isAbsolute(relative) || relative.includes('\0') || relative.includes('\\') || relative.split('/').some(part => part === '..' || part === '')) throw new Error(`Rejected document path ${JSON.stringify(relative)}`);
  const realRoot = realpathSync(root);
  const candidate = resolve(realRoot, relative);
  if (lstatSync(candidate).isSymbolicLink()) throw new Error(`Symbolic links are not imported: ${relative}`);
  const real = realpathSync(candidate);
  if (!real.startsWith(realRoot + sep)) throw new Error(`Document escapes the import root: ${relative}`);
  if (!lstatSync(real).isFile()) throw new Error(`Not a regular file: ${relative}`);
  return real;
}

/** Read at most limit bytes; the size is checked on the open descriptor before reading. */
export function readBounded(file, limit) {
  const fd = openSync(file, 'r');
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile()) throw new Error(`Not a regular file: ${file}`);
    const size = stat.size;
    if (size > limit) throw new Error(`File exceeds ${limit} bytes: ${file}`);
    const buffer = Buffer.alloc(size);
    let offset = 0;
    while (offset < size) { const read = readSync(fd, buffer, offset, size - offset, offset); if (!read) break; offset += read; }
    if (offset !== size) throw new Error(`Short read: ${file}`);
    return buffer;
  } finally { closeSync(fd); }
}

function checkContent(kind, bytes, path) {
  if (kind === 'PDF') {
    if (bytes.subarray(0, 5).toString('latin1') !== '%PDF-') throw new Error(`Not a PDF document: ${path}`);
    return;
  }
  if (bytes.length > IMPORT_LIMITS.text_bytes) throw new Error(`Text document exceeds ${IMPORT_LIMITS.text_bytes} bytes: ${path}`);
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { throw new Error(`Text document is not valid UTF-8: ${path}`); }
  if (text.includes('\0')) throw new Error(`Text document contains NUL bytes: ${path}`);
  if (kind === 'JSON_DATA') assertPlainData(JSON.parse(text));
}

/** Read and hash every document of a submission in memory; nothing is written. */
export function readDocuments(submission, root) {
  let total = 0;
  return submission.documents.map(doc => {
    const kind = KINDS[extname(doc.path).toLowerCase()];
    if (!kind) throw new Error(`Unsupported document type: ${doc.path}`);
    const file = confinedFile(root, doc.path);
    const bytes = readBounded(file, IMPORT_LIMITS.document_bytes);
    total += bytes.length;
    if (total > IMPORT_LIMITS.total_bytes) throw new Error('Submission documents exceed the total size limit');
    checkContent(kind, bytes, doc.path);
    return { meta: { path: doc.path, source_id: doc.source_id, title: doc.title, kind, bytes: bytes.length, sha256: sha256(bytes), retrieved_from: doc.retrieved_from, retrieved_at: doc.retrieved_at }, bytes };
  });
}

const dirs = store => ({ submissions: join(store, 'submissions'), evidence: join(store, 'evidence'), blobs: join(store, 'blobs'), proposals: join(store, 'proposals'), candidates: join(store, 'candidates') });
export function openStore(store) {
  for (const dir of Object.values(dirs(store))) mkdirSync(dir, { recursive: true });
  return store;
}
const writeAtomic = (file, content) => { const tmp = `${file}.tmp-${process.pid}`; writeFileSync(tmp, content); renameSync(tmp, file); };
const writeOnce = (file, content) => { if (!existsSync(file)) writeAtomic(file, content); };
const json = value => JSON.stringify(value, null, 1) + '\n';
const proposalFile = (store, id) => { if (!/^prop-[0-9a-f]{16}$/.test(id)) throw new Error(`Invalid proposal id ${id}`); return join(dirs(store).proposals, `${id}.json`); };
export const loadProposal = (store, id) => JSON.parse(readFileSync(proposalFile(store, id), 'utf8'));
export const listProposals = store => existsSync(dirs(store).proposals) ? readdirSync(dirs(store).proposals).filter(name => /^prop-[0-9a-f]{16}\.json$/.test(name)).sort().map(name => loadProposal(store, name.slice(0, -5))) : [];

/** Append-only audit log; each entry carries the hash of the previous one. */
export function appendAudit(store, event) {
  const file = join(store, 'audit-log.jsonl');
  const lines = existsSync(file) ? readFileSync(file, 'utf8').trim().split('\n').filter(Boolean) : [];
  const previous = lines.length ? JSON.parse(lines.at(-1)) : null;
  const entry = { seq: (previous?.seq ?? 0) + 1, ...event, prev_hash: previous?.hash ?? null };
  entry.hash = sha256(stableStringify(entry));
  appendFileSync(file, JSON.stringify(entry) + '\n');
  return entry;
}
export function verifyAuditLog(store) {
  const file = join(store, 'audit-log.jsonl');
  if (!existsSync(file)) return { ok: true, entries: 0 };
  let previous = null;
  const lines = readFileSync(file, 'utf8').trim().split('\n').filter(Boolean);
  for (const [index, line] of lines.entries()) {
    const { hash, ...entry } = JSON.parse(line);
    if (entry.seq !== index + 1 || entry.prev_hash !== (previous?.hash ?? null) || hash !== sha256(stableStringify(entry))) return { ok: false, entries: lines.length, broken_at: index + 1 };
    previous = { ...entry, hash };
  }
  for (const proposal of listProposals(store)) {
    const last = lines.map(line => JSON.parse(line)).filter(entry => entry.proposal_id === proposal.proposal_id).at(-1);
    if (!last || last.to !== proposal.state) return { ok: false, entries: lines.length, mismatch: proposal.proposal_id };
  }
  return { ok: true, entries: lines.length };
}

function transition(store, proposal, to, { at, actor, action, reason = null, identityVerified = false, details = null }) {
  assertTransition(proposal.state, to);
  const from = proposal.state;
  proposal.state = to;
  proposal.history.push({ at, from, to, actor, action, identity_verified: identityVerified, ...(reason ? { reason } : {}) });
  writeAtomic(proposalFile(store, proposal.proposal_id), json(proposal));
  appendAudit(store, { at, actor, identity_verified: identityVerified, action, proposal_id: proposal.proposal_id, from, to, ...(reason ? { reason } : {}), ...(details ? { details } : {}) });
  return proposal;
}

/**
 * Import one submission. The same evidence imported again is reported as DUPLICATE and writes nothing.
 * imported_at is the system clock; legal_verified_at stays what the submitter stated.
 */
export function importSubmission({ submissionFile, root, store, now = new Date(), actor = 'local-cli' }) {
  const raw = JSON.parse(readBounded(submissionFile, IMPORT_LIMITS.submission_bytes).toString('utf8'));
  const submission = parseSubmission(raw);
  const documents = readDocuments(submission, root);
  const fingerprint = sha256(stableStringify({ submission, documents: documents.map(doc => doc.meta.sha256) }));
  const submissionId = `sub-${fingerprint.slice(0, 16)}`, proposalId = `prop-${fingerprint.slice(0, 16)}`;
  openStore(store);
  const submissionPath = join(dirs(store).submissions, `${submissionId}.json`);
  if (existsSync(submissionPath)) return { status: 'DUPLICATE', submission_id: submissionId, proposal_id: proposalId };
  const at = now.toISOString();
  // Evidence already stored by an earlier submission is reused, never duplicated.
  const knownDocuments = documents.map(doc => doc.meta.sha256).filter(hash => existsSync(join(dirs(store).evidence, `${hash}.json`)));
  for (const doc of documents) {
    writeOnce(join(dirs(store).blobs, doc.meta.sha256), doc.bytes);
    writeOnce(join(dirs(store).evidence, `${doc.meta.sha256}.json`), json({ sha256: doc.meta.sha256, bytes: doc.meta.bytes, kind: doc.meta.kind, first_seen_at: at, first_submission_id: submissionId, original_path: doc.meta.path, source_id: doc.meta.source_id, retrieved_from: doc.meta.retrieved_from, retrieved_at: doc.meta.retrieved_at }));
  }
  writeAtomic(submissionPath, json({ submission_id: submissionId, fingerprint, imported_at: at, imported_by: actor, identity_verified: false, submission, documents: documents.map(doc => doc.meta) }));
  const proposal = { proposal_id: proposalId, submission_id: submissionId, state: 'IMPORTED', imported_at: at, submission, documents: documents.map(doc => doc.meta), known_documents: knownDocuments, findings: [], diff: [], history: [{ at, from: null, to: 'IMPORTED', actor, action: 'IMPORT', identity_verified: false }] };
  writeAtomic(proposalFile(store, proposalId), json(proposal));
  appendAudit(store, { at, actor, identity_verified: false, action: 'IMPORT', proposal_id: proposalId, from: null, to: 'IMPORTED', details: { submission_id: submissionId, documents: proposal.documents.map(doc => doc.sha256) } });
  return { status: 'IMPORTED', submission_id: submissionId, proposal_id: proposalId, known_documents: knownDocuments };
}

/** Deterministic validation; a clean proposal always goes on to human review. */
export function validateStoredProposal({ store, proposalId, rawCanonical, now = new Date(), actor = 'deterministic-validator', catalogSources = [] }) {
  const proposal = loadProposal(store, proposalId);
  if (!['IMPORTED', 'CONFLICT'].includes(proposal.state)) throw new Error(`Only IMPORTED or CONFLICT proposals are validated (state ${proposal.state})`);
  const others = listProposals(store).filter(item => item.proposal_id !== proposalId && OPEN_STATES.includes(item.state) && item.state !== 'INSUFFICIENT_EVIDENCE');
  const result = validateProposal({ submission: proposal.submission, documents: proposal.documents, rawCanonical, openProposals: others, catalogSources });
  proposal.findings = result.findings; proposal.diff = result.diff;
  const at = now.toISOString();
  if (result.state === proposal.state) {
    writeAtomic(proposalFile(store, proposalId), json(proposal));
    appendAudit(store, { at, actor, identity_verified: false, action: 'REVALIDATE_NO_CHANGE', proposal_id: proposalId, from: proposal.state, to: proposal.state, details: { findings: result.findings.map(f => f.code) } });
    return proposal;
  }
  transition(store, proposal, result.state, { at, actor, action: 'VALIDATE', details: { findings: result.findings.map(f => f.code) } });
  if (result.state === 'VALIDATED') transition(store, proposal, 'REVIEW_REQUIRED', { at, actor, action: 'QUEUE_FOR_HUMAN_REVIEW' });
  return proposal;
}

/** Record a human decision. The reviewer label is not proof of identity; GitHub approval is. */
export function decideProposal({ store, proposalId, action, reviewer, reason, now = new Date() }) {
  if (!['APPROVE', 'REJECT'].includes(action)) throw new Error(`Unknown decision ${action}`);
  if (!reviewer?.trim() || !reason?.trim()) throw new Error('A reviewer label and a reason are required');
  const proposal = loadProposal(store, proposalId);
  if (action === 'APPROVE' && proposal.state !== 'REVIEW_REQUIRED') throw new Error(`Only REVIEW_REQUIRED proposals can be approved (state ${proposal.state})`);
  return transition(store, proposal, action === 'APPROVE' ? 'APPROVED' : 'REJECTED', { at: now.toISOString(), actor: reviewer.trim(), action, reason: reason.trim(), identityVerified: false });
}

/**
 * Re-validate an approved proposal against the current dataset and write a candidate
 * dataset plus its diff into the store. canonical.json is never written here.
 */
export function prepareStoredProposal({ store, proposalId, rawCanonical, now = new Date(), actor = 'local-cli', allowSynthetic = false, catalogSources = [] }) {
  const proposal = loadProposal(store, proposalId);
  if (proposal.state !== 'APPROVED') throw new Error(`Only APPROVED proposals can be prepared (state ${proposal.state})`);
  const at = now.toISOString();
  // Concurrent proposals were excluded at validation; here only drift of the dataset since approval matters.
  const recheck = validateProposal({ submission: proposal.submission, documents: proposal.documents, rawCanonical, catalogSources });
  if (recheck.state !== 'VALIDATED') {
    proposal.findings = recheck.findings;
    return transition(store, proposal, 'CONFLICT', { at, actor, action: 'PREPARE', reason: 'The dataset changed since approval', details: { findings: recheck.findings.map(f => f.code) } });
  }
  const { candidate, diff, publication } = prepareCandidate({ proposal, documents: proposal.documents, rawCanonical, allowSynthetic });
  const dir = join(dirs(store).candidates, proposalId);
  mkdirSync(dir, { recursive: true });
  writeAtomic(join(dir, 'canonical.candidate.json'), JSON.stringify(candidate, null, 1) + '\n');
  writeAtomic(join(dir, 'diff.json'), json({ proposal_id: proposalId, publication, base_dataset_version: rawCanonical.dataset_version, candidate_dataset_version: candidate.dataset_version, changes: diff }));
  proposal.diff = diff;
  proposal.candidate = { path: `candidates/${proposalId}/canonical.candidate.json`, publication };
  return transition(store, proposal, 'READY_FOR_CANONICAL_UPDATE', { at, actor, action: 'PREPARE', details: { publication, changes: diff.length } });
}

export function writeReviewReport({ store, output, now = new Date() }) {
  const proposals = listProposals(store);
  mkdirSync(output, { recursive: true });
  const at = now.toISOString();
  writeAtomic(join(output, 'review-report.html'), renderReviewReportHtml(proposals, at));
  writeAtomic(join(output, 'review-report.json'), json({ generated_at: at, audit_log: verifyAuditLog(store), proposals: proposals.map(({ submission, ...rest }) => ({ ...rest, jurisdiction: submission.jurisdiction, summary: submission.summary, synthetic: submission.synthetic, legal_verified_at: submission.legal_verified_at, legal_effective: submission.legal_effective })) }));
  return { proposals: proposals.length };
}
