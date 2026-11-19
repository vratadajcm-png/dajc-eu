/**
 * DAJC Driving Bans research CLI. AI searches and checks official documents and
 * writes drafts into a research store; it never writes canonical.json, never
 * approves and never publishes. A person promotes a draft into the existing
 * review workflow (npm run driving-bans:evidence).
 */
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { dajcCoverageCodes, isTrackedJurisdiction } from '../config/europe-coverage.mjs';
import { officialAuthorityDomains } from '../config/official-authority-domains.mjs';
import { drivingBanSourceCatalog } from '../config/driving-ban-sources/index.mjs';
import { getDrivingBansSnapshot, canonicalDrivingBans } from '../config/driving-ban-calendars/runtime.mjs';
import { assertSweepRequest, publicationWindow } from '../src/lib/driving-bans/core.mjs';
import { verifyAuditLog } from '../src/lib/driving-bans/evidence-store.mjs';
import { createProviders } from '../src/lib/ai/providers.mjs';
import { createLedger, createOrchestrator, limitsFromEnv, routesFromEnv } from '../src/lib/ai/orchestrator.mjs';
import { researchReadiness, createResearchOrchestrator } from '../src/lib/driving-bans/research/config.mjs';
import { runResearch, openResearchStore, listDrafts, loadDraft } from '../src/lib/driving-bans/research/pipeline.mjs';
import { promoteDraft, rejectDraft } from '../src/lib/driving-bans/research/promote.mjs';
import { autoApproveAll, autoApproveDraft, confirmAutoApprovedRule, AUTO_APPROVAL_GATE_VERSION } from '../src/lib/driving-bans/research/auto-approve.mjs';
import { safeFetch } from '../src/lib/driving-bans/research/safe-fetch.mjs';

const CANONICAL = resolve('data/driving-bans/canonical.json');
const { values, positionals } = parseArgs({ allowPositionals: true, options: {
  store: { type: 'string', default: 'data/driving-bans/staging/research' }, 'evidence-store': { type: 'string', default: 'data/driving-bans/staging' },
  jurisdictions: { type: 'string', default: 'all' }, mode: { type: 'string', default: 'full' }, url: { type: 'string', multiple: true, default: [] },
  'max-documents': { type: 'string', default: '6' }, 'no-search': { type: 'boolean', default: false }, 'initial-repair': { type: 'boolean', default: false },
  clock: { type: 'string' }, reviewer: { type: 'string' }, reason: { type: 'string' }, 'legal-verified-at': { type: 'string' }, 'review-from': { type: 'string' }, 'review-to': { type: 'string' }, 'legal-effective-from': { type: 'string' }, 'legal-effective-to': { type: 'string' }, 'exceptions-complete': { type: 'boolean' },
  'candidate-out': { type: 'string' }, 'report-md': { type: 'string' }, document: { type: 'string' },
} });
const [command, target] = positionals;
const now = values.clock ? new Date(values.clock) : new Date();
const print = value => console.log(JSON.stringify(value, null, 2));
const rawCanonical = () => JSON.parse(readFileSync(CANONICAL, 'utf8'));
const store = () => { const dir = resolve(values.store); if (dir === dirname(CANONICAL)) throw new Error('The research store must be its own directory'); return openResearchStore(dir); };
const brief = draft => ({ draft_id: draft.draft_id, state: draft.state, jurisdiction: draft.jurisdiction, url: draft.document.final_url, operations: (draft.submission?.operations ?? []).map(op => `${op.op} ${op.ban_id ?? op.rule?.ban_id ?? op.source?.source_id}`), blocking: draft.findings.filter(f => f.blocking_state !== 'NOTE').map(f => f.code) });

async function run() {
  const readiness = researchReadiness(process.env);
  if (!readiness.enabled) { print({ status: 'DISABLED', blockers: readiness.blockers }); return; }
  const codes = values.jurisdictions === 'all' ? Object.keys(dajcCoverageCodes) : values.jurisdictions.split(',').map(code => code.trim().toUpperCase());
  if (!codes.length || !codes.every(isTrackedJurisdiction)) throw new Error('Only tracked jurisdictions of config/europe-coverage.mjs can be researched');
  if (values.mode === 'full') assertSweepRequest({ mode: 'full', initialRepair: values['initial-repair'] }, canonicalDrivingBans, now);
  else if (values.mode !== 'urgent' || codes.length !== 1 || !values.url.length) throw new Error('Urgent research needs --mode urgent, exactly one --jurisdictions code and at least one --url lead');
  const research = store();
  const window = publicationWindow(now);
  const orchestrator = createResearchOrchestrator({ env: process.env, ledgerFile: join(research.root, 'ledger.json'), clock: () => new Date() });
  const report = await runResearch({
    jurisdictions: codes, mode: values.mode, window: { from: window.from, to: window.to }, now, rawCanonical: rawCanonical(), snapshot: getDrivingBansSnapshot(now),
    catalogEntries: drivingBanSourceCatalog.entries, authorityDomains: officialAuthorityDomains, orchestrator, store: research,
    fetchDocument: (url, allowedHosts) => safeFetch(url, { allowedHosts }), leadUrls: values.url, maxDocuments: Number(values['max-documents']), useSearch: !values['no-search'],
  });
  print({ run_id: report.run_id, statement: report.statement, technical: report.technical.status, ai: report.ai_analysis.status, cost_usd: report.cost_usd, drafts: report.drafts, report: join(research.root, 'runs', `${report.run_id}.json`) });
}

/** Synthetic end-to-end walkthrough with scripted providers and fixture web pages. Not a live test. */
async function demo() {
  const { createMockAiFetch, fixtureWeb, testEnv } = await import('../tests/fixtures/driving-bans-research/mock-ai.mjs');
  const { DOCUMENTS, URLS, extraction, extractedRule } = await import('../tests/fixtures/driving-bans-research/cz-scenarios.mjs');
  const canonicalBefore = readFileSync(CANONICAL, 'utf8');
  const clock = new Date('2026-11-02T08:00:00Z');
  const research = openResearchStore(values.store === 'data/driving-bans/staging/research' ? mkdtempSync(join(tmpdir(), 'dajc-research-demo-')) : resolve(values.store));
  const env = testEnv();
  const ai = createMockAiFetch({ brain: { extract: ({ key }) => key === 'cz-new-rule' ? extraction([extractedRule()]) : extraction([], { document_relevance: 'NOT_RELEVANT' }) } });
  const web = fixtureWeb({ [URLS.measure]: { body: DOCUMENTS.measure } }, { clock: () => clock });
  const orchestrator = createOrchestrator({ providers: createProviders({ env, fetchFn: ai.fetchFn }), routes: routesFromEnv(env), limits: limitsFromEnv(env), ledger: createLedger({ clock: () => clock }), clock: () => clock, sleep: async () => {} });
  const report = await runResearch({ jurisdictions: ['CZ'], mode: 'urgent', window: { from: '2026-11-01', to: '2026-12-31' }, now: clock, rawCanonical: rawCanonical(), snapshot: getDrivingBansSnapshot(clock), catalogEntries: [], authorityDomains: officialAuthorityDomains, orchestrator, fetchDocument: web.fetchDocument, store: research, leadUrls: [URLS.measure], maxDocuments: 1, useSearch: false, synthetic: true });
  const evidenceStore = join(research.root, 'evidence-demo');
  const draft = report.drafts[0];
  const promoted = draft?.state === 'REVIEW_REQUIRED' ? promoteDraft({ researchStore: research, draftId: draft.draft_id, evidenceStore, reviewer: 'DAJC demo reviewer', reason: 'Synthetic walkthrough', legalVerifiedAt: '2026-11-02T07:30:00Z', reviewWindow: { from: '2026-11-01', to: '2026-12-31' }, confirmations: { legalEffective: { from: '2026-11-14', to: '2026-11-14' }, exceptionsComplete: true }, rawCanonical: rawCanonical(), now: clock }) : null;
  print({ synthetic: true, note: 'Scripted providers and fixture pages: no network, no keys, no live API test.', statement: report.statement, drafts: report.drafts, independent_check: report.independent_check, calls: report.calls.map(call => `${call.task}:${call.provider}:${call.outcome}`), promoted, canonical_unchanged: readFileSync(CANONICAL, 'utf8') === canonicalBefore, store: research.root });
  if (readFileSync(CANONICAL, 'utf8') !== canonicalBefore) process.exitCode = 1;
}

/**
 * Automatic approval of PDF drafts. The final candidate is copied to --candidate-out (never to
 * canonical.json: publication is a separate, visible step of a pull request) and a Markdown
 * report for that pull request goes to --report-md.
 */
async function autoApprove() {
  if (values['candidate-out'] && resolve(values['candidate-out']) === CANONICAL) throw new Error('Write the candidate elsewhere; the publication step copies it into canonical.json');
  const args = { researchStore: store(), evidenceStore: resolve(values['evidence-store']), rawCanonical: rawCanonical(), catalogSources: drivingBanSourceCatalog.entries, now, env: process.env };
  const result = target ? await autoApproveDraft({ ...args, draftId: target }) : await autoApproveAll(args);
  const results = target ? [result] : result.results;
  const candidate = result.candidate_path;
  if (values['candidate-out'] && candidate) {
    mkdirSync(dirname(resolve(values['candidate-out'])), { recursive: true });
    copyFileSync(candidate, resolve(values['candidate-out']));
  }
  if (values['report-md']) {
    const approved = results.filter(item => item.approved);
    const lines = [`## Driving Bans: automatic approval from official PDF documents (gate ${AUTO_APPROVAL_GATE_VERSION})`, '', `${approved.length} of ${results.length} draft(s) approved automatically on ${now.toISOString()}. Rules are labelled "verified automatically" and need a human review within 7 days (\`npm run driving-bans:research -- confirm-auto\`). They never change coverage, reviewed periods or NO_BAN.`, ''];
    for (const item of results) {
      const draft = loadDraft(store(), item.draft_id);
      lines.push(`### ${item.approved ? 'Approved' : 'Left for a person'}: ${item.draft_id} (${draft.jurisdiction})`, `- Document: ${draft.document.final_url}`, `- SHA-256: \`${draft.document.sha256}\`, ${draft.document.page_count ?? '?'} page(s)`);
      if (item.approved) for (const rule of item.rules) lines.push(`- Rule \`${rule.ban_id}\`, pattern of \`${rule.pattern_of}\`, human review due ${rule.human_review_due}`);
      for (const check of item.decision.checks) lines.push(`- ${check.ok ? '✅' : '❌'} ${check.id}: ${check.detail}`);
      lines.push('');
    }
    mkdirSync(dirname(resolve(values['report-md'])), { recursive: true });
    writeFileSync(resolve(values['report-md']), lines.join('\n') + '\n');
  }
  print(target ? result : { ...result, results: results.map(item => ({ draft_id: item.draft_id, approved: item.approved, proposal_id: item.proposal_id ?? null, failed: item.decision.checks.filter(check => !check.ok).map(check => check.id), rules: item.rules ?? [] })) });
}

switch (command) {
  case 'status': print(researchReadiness(process.env)); break;
  case 'run': await run(); break;
  case 'list': print(listDrafts(store()).map(brief)); break;
  case 'show': print(loadDraft(store(), target)); break;
  case 'reject': print(brief(rejectDraft({ researchStore: store(), draftId: target, reviewer: values.reviewer, reason: values.reason, now }))); break;
  case 'promote': print(promoteDraft({ researchStore: store(), draftId: target, evidenceStore: resolve(values['evidence-store']), reviewer: values.reviewer, reason: values.reason, legalVerifiedAt: values['legal-verified-at'], reviewWindow: { from: values['review-from'], to: values['review-to'] }, confirmations: { legalEffective: { from: values['legal-effective-from'], to: values['legal-effective-to'] ?? null }, exceptionsComplete: values['exceptions-complete'] === true }, rawCanonical: rawCanonical(), catalogSources: drivingBanSourceCatalog.entries, now })); break;
  case 'verify-log': { const result = verifyAuditLog(store().root); print(result); if (!result.ok) process.exitCode = 1; break; }
  case 'demo': await demo(); break;
  case 'auto-approve': await autoApprove(); break;
  case 'confirm-auto': print(confirmAutoApprovedRule({ banId: target, documentFile: resolve(values.document), evidenceStore: resolve(values['evidence-store']), reviewer: values.reviewer, reason: values.reason, rawCanonical: rawCanonical(), catalogSources: drivingBanSourceCatalog.entries, now })); break;
  default:
    console.error('Usage: driving-bans-research.mjs <status | run [--jurisdictions all|AT,DE] [--mode full|urgent --url URL] [--no-search] [--max-documents N] | list | show ID | reject ID --reviewer L --reason R | promote ID --reviewer L --reason R --legal-verified-at ISO --review-from DATE --review-to DATE --legal-effective-from DATE [--legal-effective-to DATE] --exceptions-complete [--evidence-store DIR] | verify-log | demo | auto-approve [ID] [--candidate-out FILE] [--report-md FILE] [--evidence-store DIR] | confirm-auto BAN_ID --document PDF --reviewer L --reason R [--evidence-store DIR]> [--store DIR]');
    process.exitCode = 2;
}
