import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import rawCanonical from '../../../../data/driving-bans/canonical.json';
import { getDrivingBansSnapshot } from '../../../../config/driving-ban-calendars/runtime.mjs';
import { officialAuthorityDomains } from '../../../../config/official-authority-domains.mjs';
import { dajcEuropeCoverage } from '../../../../config/europe-coverage.mjs';
import { createProviders } from '../../ai/providers.mjs';
import { createLedger, createOrchestrator, limitsFromEnv, routesFromEnv } from '../../ai/orchestrator.mjs';
import { hydrateCanonical, snapshot as snapshotOf, toIcs, validateCanonical } from '../core.mjs';
import { decideProposal, loadProposal, prepareStoredProposal, verifyAuditLog } from '../evidence-store.mjs';
import { verificationMethodText } from '../public-labels.mjs';
import { runResearch, openResearchStore, loadDraft } from './pipeline.mjs';
import { readPdfPages, quoteOnPage } from './pdf-text.mjs';
import { autoApprovalDecision, autoApprovalStatus, autoApproveAll, autoApproveDraft, confirmAutoApprovedRule, matchVerifiedPattern, AUTO_APPROVAL_FLAG, HUMAN_REVIEW_DAYS } from './auto-approve.mjs';
import { createMockAiFetch, fixtureWeb, testEnv } from '../../../../tests/fixtures/driving-bans-research/mock-ai.mjs';
import { extraction } from '../../../../tests/fixtures/driving-bans-research/cz-scenarios.mjs';
import { PDF_DOCUMENTS, PDF_URLS, holidayExtraction, holidayRule } from '../../../../tests/fixtures/driving-bans-research/pdf-scenarios.mjs';

const NOW = new Date('2026-12-10T08:00:00Z');
const WINDOW = { from: '2027-01-01', to: '2027-01-31' };
const ON = { [AUTO_APPROVAL_FLAG]: 'true' };
const CANONICAL_PATH = 'data/driving-bans/canonical.json';
const canonicalBytes = readFileSync(CANONICAL_PATH, 'utf8');
const temp: string[] = [];
const tempDir = (prefix: string) => { const dir = mkdtempSync(join(tmpdir(), prefix)); temp.push(dir); return dir; };
afterAll(() => { for (const dir of temp) rmSync(dir, { recursive: true, force: true }); });
const pdf = (body: Buffer) => ({ body, type: 'application/pdf' });

async function researched(brainMap: Record<string, any>, urls: string[], verify?: (ctx: any) => any) {
  const store = openResearchStore(tempDir('dajc-auto-research-'));
  const env = testEnv();
  const ai = createMockAiFetch({ brain: { extract: ({ key }: any) => brainMap[key] ?? extraction([], { document_relevance: 'NOT_RELEVANT' }), ...(verify ? { verify } : {}) } });
  const pages = { [PDF_URLS.holiday]: pdf(PDF_DOCUMENTS.holiday), [PDF_URLS.scanned]: pdf(PDF_DOCUMENTS.scanned), [PDF_URLS.newPattern]: pdf(PDF_DOCUMENTS.newPattern) };
  const web = fixtureWeb(pages, { clock: () => NOW });
  const orchestrator = createOrchestrator({ providers: createProviders({ env, fetchFn: ai.fetchFn }), routes: routesFromEnv(env), limits: limitsFromEnv(env), ledger: createLedger({ clock: () => NOW }), clock: () => NOW, sleep: async () => {} });
  const report = await runResearch({ jurisdictions: ['CZ'], window: WINDOW, now: NOW, rawCanonical: structuredClone(rawCanonical), snapshot: getDrivingBansSnapshot(NOW), catalogEntries: [], authorityDomains: officialAuthorityDomains, orchestrator, fetchDocument: web.fetchDocument, store, useSearch: false, mode: 'urgent', leadUrls: urls });
  const drafts = report.per_jurisdiction.flatMap((row: any) => row.documents).filter((doc: any) => doc.draft_id).map((doc: any) => loadDraft(store, doc.draft_id));
  return { store, ai, report, drafts };
}

describe('local text of official PDFs', () => {
  it('reads each page and finds quotes on the page they are on; a scan or a broken file has no text', async () => {
    const pages = await readPdfPages(PDF_DOCUMENTS.holiday);
    expect(pages).toHaveLength(2);
    expect(pages![0]).toContain('o dnech zákazu jízdy podle zákona č. 361/2000 Sb., § 43 odst. 1 písm. a)');
    expect(quoteOnPage(pages!, 2, 'od 13:00 do 22:00 hodin')).toBe(true);
    expect(quoteOnPage(pages!, 1, 'od 13:00 do 22:00 hodin')).toBe(false);
    expect(quoteOnPage(pages!, 3, 'od 13:00 do 22:00 hodin')).toBe(false);
    expect(await readPdfPages(PDF_DOCUMENTS.scanned)).toBeNull();
    expect(await readPdfPages(Buffer.from('%PDF-1.4 not really a pdf'))).toBeNull();
  });

  it('lets the research pipeline check PDF quotes by code: a text PDF reaches REVIEW_REQUIRED, a scan does not', async () => {
    const { drafts, ai } = await researched({ 'cz-pdf-holiday': holidayExtraction() }, [PDF_URLS.holiday, PDF_URLS.scanned]);
    const [draft] = drafts;
    expect(draft).toMatchObject({ state: 'REVIEW_REQUIRED', document: { kind: 'PDF', text_layer: 'PDF_TEXT', page_count: 2 } });
    expect(draft.findings.map((f: any) => f.code)).not.toContain('QUOTES_NOT_MACHINE_VERIFIABLE');
    expect(draft.second_extraction).toMatchObject({ agreed: true });
    // The models read the page-marked text, not the binary PDF.
    expect(ai.log.filter((call: any) => call.key === 'cz-pdf-holiday').every((call: any) => call.pdf === false && call.user.includes('[[DAJC PAGE 2]]'))).toBe(true);
    expect(drafts).toHaveLength(1);
  });
});

describe('automatic approval of official PDF drafts (owner decision 3 Nov 2026)', () => {
  const holiday = () => researched({ 'cz-pdf-holiday': holidayExtraction() }, [PDF_URLS.holiday]);
  const raw = () => structuredClone(rawCanonical) as any;

  it('stays off without the switch: the draft waits for a person and nothing is imported', async () => {
    const { store, drafts } = await holiday();
    const evidence = tempDir('dajc-auto-evidence-');
    const result = await autoApproveDraft({ researchStore: store, draftId: drafts[0].draft_id, evidenceStore: evidence, rawCanonical: raw(), now: NOW, env: {} });
    expect(result.approved).toBe(false);
    expect(result.decision.checks.filter((c: any) => !c.ok).map((c: any) => c.id)).toEqual(['switch_on']);
    expect(loadDraft(store, drafts[0].draft_id).state).toBe('REVIEW_REQUIRED');
    expect(verifyAuditLog(evidence)).toEqual({ ok: true, entries: 0 });
  });

  it('approves new dates of a human-verified ban through the existing automaton, labelled and without touching coverage', async () => {
    const { store, drafts } = await holiday();
    const evidence = tempDir('dajc-auto-evidence-');
    const result = await autoApproveDraft({ researchStore: store, draftId: drafts[0].draft_id, evidenceStore: evidence, rawCanonical: raw(), now: NOW, env: ON });
    expect(result.decision.checks.every((c: any) => c.ok)).toBe(true);
    expect(result).toMatchObject({ approved: true, proposal_state: 'READY_FOR_CANONICAL_UPDATE' });
    expect(result.rules[0]).toMatchObject({ human_review_due: new Date(NOW.getTime() + HUMAN_REVIEW_DAYS * 86_400_000).toISOString() });
    expect(['cz-holidays-2026-autumn', 'cz-holidays-2026-christmas']).toContain(result.rules[0].pattern_of);
    const proposal = loadProposal(evidence, result.proposal_id);
    expect(proposal.history.map((h: any) => [h.to, h.actor])).toEqual(expect.arrayContaining([['APPROVED', 'dajc-auto-approval-gate:dba-1'], ['READY_FOR_CANONICAL_UPDATE', 'dajc-auto-approval-gate:dba-1']]));
    expect(verifyAuditLog(evidence).ok).toBe(true);
    expect(loadDraft(store, drafts[0].draft_id)).toMatchObject({ state: 'PROMOTED', promotion: { automatic: true } });

    const candidate = JSON.parse(readFileSync(result.candidate_path, 'utf8'));
    const rule = candidate.rules.find((r: any) => r.ban_id === result.rules[0].ban_id);
    expect(rule).toMatchObject({ verification_state: 'PRIMARY_VERIFIED', verification_method: 'AUTOMATED', review_window: { from: '2027-01-01', to: '2027-01-01' }, auto_approval: { gate_version: 'dba-1', human_reviewed_at: null, document_sha256: drafts[0].document.sha256 } });
    // Coverage, the reviewed span and NO_BAN stay exactly as a person left them.
    expect(candidate.jurisdictions).toEqual((rawCanonical as any).jurisdictions);
    expect(candidate.window).toEqual((rawCanonical as any).window);
    expect(readFileSync(CANONICAL_PATH, 'utf8')).toBe(canonicalBytes);

    // Published as a verified rule with its label; January stays unverified for the jurisdiction.
    const view = snapshotOf(hydrateCanonical(candidate, dajcEuropeCoverage), dajcEuropeCoverage, NOW);
    const event = view.events.find((e: any) => e.ban_id === rule.ban_id);
    expect(event).toMatchObject({ date: '2027-01-01', verification_method: 'AUTOMATED' });
    expect(view.jurisdictions.find((j: any) => j.jurisdiction === 'CZ').monthly_coverage.find((m: any) => m.from.startsWith('2027-01'))).toMatchObject({ coverage_complete: false, verification_state: 'UNVERIFIED' });
    expect(verificationMethodText(event, true, NOW)).toBe('Ověřeno automaticky z úředního PDF dokumentu; kontrola člověkem do 2026-12-17.');
    expect(verificationMethodText({ verification_method: 'HUMAN' }, true, NOW)).toBeNull();
    const ics = toIcs(view, { countries: ['CZ'], upcoming: false });
    expect(ics).toContain('X-DAJC-VERIFICATION-METHOD:AUTOMATED');
    expect(ics.split('X-DAJC-VERIFICATION-METHOD').length - 1).toBe(1);
  });

  it('leaves anything outside the safe pattern to a person', async () => {
    // Different hours than any human-verified rule: a new kind of ban.
    const newPattern = holidayRule({ schedule: { kind: 'dates', weekdays: [], dates: ['2027-01-01'], start_time: '06:00', end_time: '22:00', end_day_offset: 0 }, evidence: holidayRule().evidence.map((e: any) => ['start_time', 'end_time'].includes(e.field) ? { ...e, quote: 'od 06:00 do 22:00 hodin' } : e) });
    // A quote attributed to the wrong page.
    const wrongPage = holidayRule({ evidence: holidayRule().evidence.map((e: any) => e.field === 'start_time' ? { ...e, page: 1 } : e) });
    const { store, drafts } = await researched({ 'cz-pdf-new-pattern': holidayExtraction(newPattern) }, [PDF_URLS.newPattern]);
    const first = await autoApprovalDecision({ researchStore: store, draft: drafts[0], rawCanonical: raw(), now: NOW, env: ON });
    expect(first.checks.filter((c: any) => !c.ok).map((c: any) => c.id)).toEqual(['known_verified_pattern']);
    const second = await researched({ 'cz-pdf-holiday': holidayExtraction(wrongPage) }, [PDF_URLS.holiday]);
    const decision = await autoApprovalDecision({ researchStore: second.store, draft: second.drafts[0], rawCanonical: raw(), now: NOW, env: ON });
    expect(decision.checks.filter((c: any) => !c.ok).map((c: any) => c.id)).toEqual(['quotes_on_stated_pages']);
  });

  it('never approves a disagreement, an amendment, a scan, a synthetic draft or a non-PDF document', async () => {
    const { store, drafts } = await holiday();
    const base = drafts[0];
    const decide = (draft: any) => autoApprovalDecision({ researchStore: store, draft, rawCanonical: raw(), now: NOW, env: ON }).then((d: any) => d.checks.filter((c: any) => !c.ok).map((c: any) => c.id));
    expect(await decide({ ...base, second_extraction: { ...base.second_extraction, agreed: false } })).toEqual(['second_extraction_agrees']);
    expect(await decide({ ...base, cross_check: { ...base.cross_check, overall: 'UNCLEAR' } })).toEqual(['independent_check']);
    expect(await decide({ ...base, findings: [{ code: 'CHECK_FOUND_NO_HOURS', blocking_state: 'NOTE' }] })).toEqual(['no_open_findings']);
    const amend = { op: 'AMEND_RULE', ban_id: 'cz-sunday', expected_sequence: 0, reason: 'x', changes: { valid_to: '2027-12-31' } };
    expect(await decide({ ...base, submission: { ...base.submission, operations: [...base.submission.operations, amend] } })).toEqual(expect.arrayContaining(['only_new_rules']));
    expect(await decide({ ...base, synthetic: true })).toEqual(['draft_ready']);
    // Without the PDF text layer no quote can be found on its page either.
    expect(await decide({ ...base, document: { ...base.document, kind: 'HTML_SNAPSHOT', text_layer: null } })).toEqual(['pdf_text_layer', 'quotes_on_stated_pages']);
    expect(await decide({ ...base, document: { ...base.document, text_layer: 'NONE' } })).toEqual(['pdf_text_layer', 'quotes_on_stated_pages']);
    expect(await decide({ ...base, document: { ...base.document, final_url: 'https://truck-blog.example.com/svatky-2027.pdf' } })).toEqual(['official_primary_source']);
    expect(await decide({ ...base, legal_effect: { ...base.legal_effect, stated_by_document: null } })).toEqual(['legal_effect_stated']);
  });

  it('stops new approvals while an earlier one is past its review deadline, and the audit reports it', async () => {
    const { store, drafts } = await holiday();
    const first = await autoApproveDraft({ researchStore: store, draftId: drafts[0].draft_id, evidenceStore: tempDir('dajc-auto-evidence-'), rawCanonical: raw(), now: NOW, env: ON });
    const candidate = JSON.parse(readFileSync(first.candidate_path, 'utf8'));
    const later = new Date(NOW.getTime() + (HUMAN_REVIEW_DAYS + 1) * 86_400_000);
    expect(autoApprovalStatus(candidate, NOW)).toMatchObject({ awaiting_human_review: [expect.objectContaining({ ban_id: first.rules[0].ban_id })], overdue: [] });
    expect(autoApprovalStatus(candidate, later).overdue.map((r: any) => r.ban_id)).toEqual([first.rules[0].ban_id]);
    const next = await researched({ 'cz-pdf-holiday': holidayExtraction() }, [PDF_URLS.holiday]);
    const decision = await autoApprovalDecision({ researchStore: next.store, draft: next.drafts[0], rawCanonical: candidate, now: later, env: ON });
    expect(decision.checks.find((c: any) => c.id === 'no_overdue_review')).toMatchObject({ ok: false });
    const event = snapshotOf(hydrateCanonical(candidate, dajcEuropeCoverage), dajcEuropeCoverage, NOW).events.find((e: any) => e.ban_id === first.rules[0].ban_id);
    expect(verificationMethodText(event, false, later)).toBe('Verified automatically from an official PDF document; human review is overdue.');
  });

  it('lets a person confirm the rule against the same PDF through the existing workflow', async () => {
    const { store, drafts } = await holiday();
    const evidence = tempDir('dajc-auto-evidence-');
    const first = await autoApproveDraft({ researchStore: store, draftId: drafts[0].draft_id, evidenceStore: evidence, rawCanonical: raw(), now: NOW, env: ON });
    const candidate = JSON.parse(readFileSync(first.candidate_path, 'utf8'));
    const pdfFile = join(tempDir('dajc-auto-pdf-'), 'notice.pdf');
    writeFileSync(pdfFile, PDF_DOCUMENTS.holiday);
    const wrongFile = join(tempDir('dajc-auto-pdf-'), 'other.pdf');
    writeFileSync(wrongFile, PDF_DOCUMENTS.newPattern);
    const later = new Date(NOW.getTime() + 2 * 86_400_000);
    const args = { banId: first.rules[0].ban_id, evidenceStore: evidence, reviewer: 'Reviewer (test)', reason: 'Read the notice', rawCanonical: candidate, now: later };
    expect(() => confirmAutoApprovedRule({ ...args, documentFile: wrongFile })).toThrow(/SHA-256 differs/);
    const confirmed = confirmAutoApprovedRule({ ...args, documentFile: pdfFile });
    expect(confirmed.proposal_state).toBe('REVIEW_REQUIRED');
    decideProposal({ store: evidence, proposalId: confirmed.proposal_id, action: 'APPROVE', reviewer: 'Reviewer (test)', reason: 'ok', now: later });
    const ready = prepareStoredProposal({ store: evidence, proposalId: confirmed.proposal_id, rawCanonical: candidate, now: later });
    const reviewed = JSON.parse(readFileSync(join(evidence, ready.candidate.path), 'utf8'));
    const rule = reviewed.rules.find((r: any) => r.ban_id === first.rules[0].ban_id);
    expect(rule).toMatchObject({ verification_method: 'HUMAN', auto_approval: { human_reviewer: 'Reviewer (test)', human_reviewed_at: later.toISOString(), gate_version: 'dba-1' } });
    expect(() => validateCanonical(hydrateCanonical(reviewed, dajcEuropeCoverage), dajcEuropeCoverage)).not.toThrow();
    expect(autoApprovalStatus(reviewed, later).awaiting_human_review).toEqual([]);
    expect(() => confirmAutoApprovedRule({ ...args, rawCanonical: reviewed, documentFile: pdfFile })).toThrow(/not an automatically approved rule/);
  });

  it('builds one candidate for several approvals and refuses an inconsistent approval record', async () => {
    const { store } = await researched({ 'cz-pdf-holiday': holidayExtraction(), 'cz-pdf-new-pattern': holidayExtraction(holidayRule({ title: 'Jiný', schedule: { kind: 'dates', weekdays: [], dates: ['2027-01-01'], start_time: '06:00', end_time: '22:00', end_day_offset: 0 }, evidence: holidayRule().evidence.map((e: any) => ['start_time', 'end_time'].includes(e.field) ? { ...e, quote: 'od 06:00 do 22:00 hodin' } : e) })) }, [PDF_URLS.holiday, PDF_URLS.newPattern]);
    const all = await autoApproveAll({ researchStore: store, evidenceStore: tempDir('dajc-auto-evidence-'), rawCanonical: raw(), now: NOW, env: ON });
    expect(all.approved).toBe(1);
    expect(all.results.filter((r: any) => !r.approved).map((r: any) => r.decision.checks.filter((c: any) => !c.ok).map((c: any) => c.id))).toEqual([['known_verified_pattern']]);
    const candidate = JSON.parse(readFileSync(all.candidate_path, 'utf8'));
    expect(candidate.rules.filter((r: any) => r.verification_method === 'AUTOMATED')).toHaveLength(1);
    const broken = structuredClone(candidate);
    broken.rules.find((r: any) => r.verification_method === 'AUTOMATED').auto_approval.human_reviewed_at = '2026-12-11T00:00:00.000Z';
    expect(() => validateCanonical(hydrateCanonical(broken, dajcEuropeCoverage), dajcEuropeCoverage)).toThrow(/pending human review/);
    const unknown = structuredClone(candidate);
    unknown.rules[0].verification_method = 'MODEL';
    expect(() => validateCanonical(hydrateCanonical(unknown, dajcEuropeCoverage), dajcEuropeCoverage)).toThrow(/Invalid verification method/);
    expect(matchVerifiedPattern(candidate.rules.find((r: any) => r.verification_method === 'AUTOMATED'), candidate)?.verification_method ?? 'HUMAN').toBe('HUMAN');
  });
});
