import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { importSubmission, validateStoredProposal, decideProposal, prepareStoredProposal, writeReviewReport, verifyAuditLog, loadProposal, readBounded, listProposals } from './evidence-store.mjs';
import { parseSubmission, renderReviewReportHtml, REVIEW_STATES } from './review-workflow.mjs';

const canonicalPath = resolve('data/driving-bans/canonical.json');
const raw = () => JSON.parse(readFileSync(canonicalPath, 'utf8'));
const temps: string[] = [];
const temp = (prefix: string) => { const dir = mkdtempSync(join(tmpdir(), prefix)); temps.push(dir); return dir; };
afterEach(() => { while (temps.length) rmSync(temps.pop()!, { recursive: true, force: true }); });
const clock = (minute: number) => new Date(Date.UTC(2026, 9, 27, 12, minute));
const demo = JSON.parse(readFileSync('tests/fixtures/driving-bans-evidence/demo/submission.json', 'utf8'));
const DOC = 'SYNTHETIC test order: amendment of the Sunday hours.\n';

/** Writes a submission plus its documents into a fresh import root. */
function setup(submission: any, files: Record<string, string | Buffer> = { 'documents/order.txt': DOC }) {
  const root = temp('dajc-import-root-');
  for (const [path, content] of Object.entries(files)) { mkdirSync(join(root, path, '..'), { recursive: true }); writeFileSync(join(root, path), content); }
  writeFileSync(join(root, 'submission.json'), JSON.stringify(submission));
  return { root, file: join(root, 'submission.json') };
}
const synthetic = (operations: any[], extra: any = {}) => ({
  submission_version: 1, synthetic: true, submitted_by: 'test', jurisdiction: 'CZ', summary: 'SYNTHETIC test',
  documents: [{ path: 'documents/order.txt', source_id: 'cz-361', title: 'Order', retrieved_from: null, retrieved_at: null }],
  legal_verified_at: '2026-10-27T10:00:00Z', operations, ...extra,
});
const amendSunday = (expected = 0, reason = 'test') => ({ op: 'AMEND_RULE', ban_id: 'cz-sunday', expected_sequence: expected, changes: { notes: `SYNTHETIC ${reason}` }, reason });
function run(submission: any, store = temp('dajc-store-'), files?: Record<string, string | Buffer>) {
  const { root, file } = setup(submission, files);
  const imported = importSubmission({ submissionFile: file, root, store, now: clock(0) });
  return { store, root, file, imported, validated: validateStoredProposal({ store, proposalId: imported.proposal_id, rawCanonical: raw(), now: clock(1) }) };
}

describe('manual evidence import', () => {
  it('runs the full offline flow on the demo fixture without touching canonical.json', () => {
    const before = readFileSync(canonicalPath, 'utf8');
    const store = temp('dajc-store-');
    const fixture = resolve('tests/fixtures/driving-bans-evidence/demo');
    const imported = importSubmission({ submissionFile: join(fixture, 'submission.json'), root: fixture, store, now: clock(0) });
    expect(imported.status).toBe('IMPORTED');
    const proposal = validateStoredProposal({ store, proposalId: imported.proposal_id, rawCanonical: raw(), now: clock(1) });
    expect(proposal.state).toBe('REVIEW_REQUIRED');
    expect(proposal.diff.map((c: any) => c.kind)).toEqual(['NEW_RULE']);
    expect(proposal.imported_at).toBe(clock(0).toISOString());
    expect(proposal.submission.legal_verified_at).toBe('2026-10-27T10:30:00Z');
    decideProposal({ store, proposalId: imported.proposal_id, action: 'APPROVE', reviewer: 'Reviewer', reason: 'ok', now: clock(2) });
    expect(() => prepareStoredProposal({ store, proposalId: imported.proposal_id, rawCanonical: raw(), now: clock(3) })).toThrow(/Synthetic/);
    const ready = prepareStoredProposal({ store, proposalId: imported.proposal_id, rawCanonical: raw(), now: clock(4), allowSynthetic: true });
    expect(ready.state).toBe('READY_FOR_CANONICAL_UPDATE');
    const candidate = JSON.parse(readFileSync(join(store, ready.candidate.path), 'utf8'));
    expect(candidate.rules.some((r: any) => r.ban_id === 'cz-demo-synthetic-2027-01-02')).toBe(true);
    expect(candidate.sources.find((s: any) => s.source_id === 'demo-synthetic-cz-order').content_sha256).toBe(proposal.documents[0].sha256);
    expect(JSON.parse(readFileSync(join(store, `candidates/${imported.proposal_id}/diff.json`), 'utf8')).publication).toBe('SYNTHETIC_DEMO_NOT_FOR_PUBLICATION');
    expect(readFileSync(canonicalPath, 'utf8')).toBe(before);
    expect(verifyAuditLog(store)).toEqual({ ok: true, entries: 5 }); // the refused synthetic prepare changes nothing
    expect(loadProposal(store, imported.proposal_id).history.every((h: any) => h.identity_verified === false)).toBe(true);
  });

  it('treats a repeated import as a duplicate that changes nothing, and reuses known documents', () => {
    const { store, root, file, imported } = run(synthetic([amendSunday()]));
    const snapshot = () => JSON.stringify(readdirSync(store, { recursive: true }).sort()) + readFileSync(join(store, 'audit-log.jsonl'), 'utf8');
    const before = snapshot();
    expect(importSubmission({ submissionFile: file, root, store, now: clock(9) }).status).toBe('DUPLICATE');
    expect(snapshot()).toBe(before);
    const second = setup(synthetic([{ ...amendSunday(), reason: 'another' }]));
    const again = importSubmission({ submissionFile: second.file, root: second.root, store, now: clock(10) });
    expect(again.known_documents).toEqual([loadProposal(store, imported.proposal_id).documents[0].sha256]);
    expect(readdirSync(join(store, 'blobs'))).toHaveLength(1);
  });

  it('rejects unsafe paths, types and contents before anything is stored', () => {
    const outside = temp('dajc-outside-');
    writeFileSync(join(outside, 'secret.txt'), 'outside');
    const attempt = (path: string, files: Record<string, string | Buffer> = {}, link = false) => {
      const sub = synthetic([amendSunday()]); sub.documents[0].path = path;
      const { root, file } = setup(sub, files);
      if (link) symlinkSync(join(outside, 'secret.txt'), join(root, 'link.txt'));
      const store = temp('dajc-store-');
      expect(() => importSubmission({ submissionFile: file, root, store, now: clock(0) })).toThrow();
      expect(existsSync(join(store, 'submissions')) && readdirSync(join(store, 'submissions')).length).toBeFalsy();
    };
    attempt('../secret.txt');
    attempt('/etc/passwd');
    attempt('documents/../../secret.txt');
    attempt('link.txt', {}, true);
    attempt('documents/run.js', { 'documents/run.js': 'process.exit(1)' });
    attempt('documents/bad.txt', { 'documents/bad.txt': Buffer.from([0xff, 0xfe, 0x00]) });
    attempt('documents/fake.pdf', { 'documents/fake.pdf': 'not a pdf' });
    attempt('documents/data.json', { 'documents/data.json': '{"__proto__":{"polluted":true}}' });
    const big = join(temp('dajc-big-'), 'big.txt'); writeFileSync(big, 'x'.repeat(2048));
    expect(() => readBounded(big, 1024)).toThrow(/exceeds/);
  });

  it('rejects malformed or overreaching submissions at parse time', () => {
    const base = synthetic([amendSunday()]);
    expect(() => parseSubmission({ ...base, jurisdiction: 'JE' })).toThrow();
    expect(() => parseSubmission({ ...base, links: [{ url: 'http://example.test/', source_id: 'cz-361', title: 'x' }] })).toThrow();
    expect(() => parseSubmission({ ...base, links: [{ url: 'https://user:pw@example.test/', source_id: 'cz-361', title: 'x' }] })).toThrow();
    expect(() => parseSubmission({ ...base, operations: [{ op: 'ADD_RULE', rule: { ban_id: 'x-y', ban_state: 'NO_BAN' } }] })).toThrow(/NO_BAN/);
    expect(() => parseSubmission({ ...base, operations: [{ ...amendSunday(), changes: { sequence: 9 } }] })).toThrow();
    expect(() => parseSubmission({ ...base, extra_field: 1 })).toThrow();
    expect(() => parseSubmission(JSON.parse('{"__proto__":{"x":1},"submission_version":1}'))).toThrow(/Forbidden key/);
    expect(() => parseSubmission({ ...base, legal_effective: { from: '2026-12-02', to: '2026-12-01' } })).toThrow();
  });

  it('sends incomplete evidence to INSUFFICIENT_EVIDENCE, which a person can only reject', () => {
    const noDocument = run(synthetic([amendSunday()], { documents: [], links: [{ url: 'https://www.zakonyprolidi.cz/cs/2000-361', source_id: 'cz-361', title: 'Link only' }] }));
    expect(noDocument.validated.state).toBe('INSUFFICIENT_EVIDENCE');
    expect(noDocument.validated.findings.map((f: any) => f.code)).toContain('NO_PRIMARY_DOCUMENT');
    expect(() => decideProposal({ store: noDocument.store, proposalId: noDocument.imported.proposal_id, action: 'APPROVE', reviewer: 'R', reason: 'r' })).toThrow(/REVIEW_REQUIRED/);
    expect(decideProposal({ store: noDocument.store, proposalId: noDocument.imported.proposal_id, action: 'REJECT', reviewer: 'R', reason: 'needs the order text', now: clock(3) }).state).toBe('REJECTED');
    expect(() => decideProposal({ store: noDocument.store, proposalId: noDocument.imported.proposal_id, action: 'REJECT', reviewer: 'R', reason: 'again' })).toThrow(/not allowed/);
    const noDate = run(synthetic([amendSunday()], { legal_verified_at: null }));
    expect(noDate.validated.findings.map((f: any) => f.code)).toContain('NO_LEGAL_VERIFICATION_DATE');
    const cancel = run(synthetic([{ op: 'CANCEL_RULE', ban_id: 'cz-sunday', expected_sequence: 0, legal_basis: 'x', evidence_ids: ['cz-245'], effective_from: '2026-12-01' }]));
    expect(cancel.validated.findings.map((f: any) => f.code)).toContain('CANCELLATION_WITHOUT_PRIMARY_DOCUMENT');
  });

  it('detects concurrent proposals, stale sequences, duplicates of active rules and drift after approval', () => {
    const first = run(synthetic([amendSunday()]));
    const second = run(synthetic([amendSunday(0, 'competing')]), first.store);
    expect(second.validated.state).toBe('CONFLICT');
    expect(second.validated.findings.map((f: any) => f.code)).toContain('CONCURRENT_PROPOSAL');
    expect(run(synthetic([amendSunday(5)])).validated.findings.map((f: any) => f.code)).toContain('STALE_SEQUENCE');
    const canonical = raw();
    const sunday = { ...canonical.rule_profiles['cz-standing'], ...canonical.rules.find((r: any) => r.ban_id === 'cz-sunday') };
    delete sunday.profile;
    const twin = run(synthetic([{ op: 'ADD_RULE', rule: { ...sunday, ban_id: 'cz-sunday-copy' } }]));
    expect(twin.validated.findings.map((f: any) => f.code)).toContain('DUPLICATE_OF_ACTIVE_RULE');
    decideProposal({ store: first.store, proposalId: first.imported.proposal_id, action: 'APPROVE', reviewer: 'R', reason: 'ok', now: clock(5) });
    const drifted = raw(); drifted.rules.find((r: any) => r.ban_id === 'cz-sunday').sequence = 1;
    const result = prepareStoredProposal({ store: first.store, proposalId: first.imported.proposal_id, rawCanonical: drifted, now: clock(6), allowSynthetic: true });
    expect(result.state).toBe('CONFLICT');
    expect(verifyAuditLog(first.store).ok).toBe(true);
  });

  it('accepts Source Registry identities for documents but not as the source of a rule', () => {
    const catalogSources = [{ source_id: 'oversize:cz-czechtoll', role: 'PRIMARY' }];
    const sub = synthetic([amendSunday()]); sub.documents[0].source_id = 'oversize:cz-czechtoll';
    const { root, file } = setup(sub);
    const store = temp('dajc-store-');
    const imported = importSubmission({ submissionFile: file, root, store, now: clock(0) });
    expect(validateStoredProposal({ store, proposalId: imported.proposal_id, rawCanonical: raw(), now: clock(1), catalogSources }).state).toBe('REVIEW_REQUIRED');
    const rule = { op: 'ADD_RULE', rule: { ban_id: 'cz-catalog-only', profile: 'cz-standing', source_id: 'oversize:cz-czechtoll', evidence_ids: ['oversize:cz-czechtoll'], title: 'x', valid_from: '2027-01-02', valid_to: '2027-01-02', schedule: { kind: 'dates', start_time: '13:00', end_time: '22:00', end_day_offset: 0, dates: [{ date: '2027-01-02', occurrence_id: '2027-01-02' }] } } };
    const second = setup({ ...sub, operations: [rule] });
    const otherStore = temp('dajc-store-');
    const other = importSubmission({ submissionFile: second.file, root: second.root, store: otherStore, now: clock(2) });
    const checked = validateStoredProposal({ store: otherStore, proposalId: other.proposal_id, rawCanonical: raw(), now: clock(3), catalogSources });
    expect(checked.state).toBe('INSUFFICIENT_EVIDENCE');
    expect(checked.findings.map((f: any) => f.code)).toContain('UNKNOWN_SOURCE');
  });

  it('detects a tampered audit log or a proposal state that does not match it', () => {
    const { store } = run(synthetic([amendSunday()]));
    const file = join(store, 'audit-log.jsonl');
    const original = readFileSync(file, 'utf8');
    writeFileSync(file, original.replace('"VALIDATE"', '"VALIDATED_BY_HAND"'));
    expect(verifyAuditLog(store).ok).toBe(false);
    writeFileSync(file, original);
    const proposal = listProposals(store)[0];
    writeFileSync(join(store, 'proposals', `${proposal.proposal_id}.json`), JSON.stringify({ ...proposal, state: 'APPROVED' }));
    expect(verifyAuditLog(store).ok).toBe(false);
  });

  it('renders an offline report with escaped content and a locked-down page', () => {
    const { store } = run(synthetic([amendSunday()], { summary: '<script>alert(1)</script>' }));
    const out = temp('dajc-report-');
    writeReviewReport({ store, output: out, now: clock(9) });
    const html = readFileSync(join(out, 'review-report.html'), 'utf8');
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain("default-src 'none'");
    expect(JSON.parse(readFileSync(join(out, 'review-report.json'), 'utf8')).audit_log.ok).toBe(true);
    expect(renderReviewReportHtml([], 'now')).toContain('No proposals');
    expect(REVIEW_STATES).toEqual(['IMPORTED', 'VALIDATED', 'REVIEW_REQUIRED', 'APPROVED', 'READY_FOR_CANONICAL_UPDATE', 'REJECTED', 'CONFLICT', 'INSUFFICIENT_EVIDENCE']);
  });

  it('CLI works end to end on a separate store and refuses the canonical directory', () => {
    const store = temp('dajc-cli-store-');
    const cli = (...args: string[]) => JSON.parse(execFileSync(process.execPath, ['scripts/driving-bans-evidence.mjs', ...args, '--store', store, '--clock', '2026-10-27T12:00:00Z'], { encoding: 'utf8' }));
    const imported = cli('import', 'tests/fixtures/driving-bans-evidence/demo/submission.json');
    expect(cli('validate', imported.proposal_id).state).toBe('REVIEW_REQUIRED');
    expect(cli('approve', imported.proposal_id, '--reviewer', 'R', '--reason', 'ok').state).toBe('APPROVED');
    expect(cli('prepare', imported.proposal_id, '--allow-synthetic').state).toBe('READY_FOR_CANONICAL_UPDATE');
    expect(cli('verify-log').ok).toBe(true);
    expect(() => execFileSync(process.execPath, ['scripts/driving-bans-evidence.mjs', 'list', '--store', 'data/driving-bans'], { stdio: 'pipe' })).toThrow();
    for (const file of ['evidence-store.mjs', 'review-workflow.mjs']) expect(readFileSync(new URL(`./${file}`, import.meta.url), 'utf8')).not.toMatch(/\bfetch\(|node:https?|child_process/);
  });
});

describe('demo script', () => {
  it('completes and leaves canonical.json unchanged', () => {
    const store = temp('dajc-demo-');
    const output = execFileSync(process.execPath, ['scripts/driving-bans-evidence-demo.mjs', '--store', store], { encoding: 'utf8' });
    expect(output).toContain('READY_FOR_CANONICAL_UPDATE');
    expect(output).toContain('"unchanged":true');
  });
});
