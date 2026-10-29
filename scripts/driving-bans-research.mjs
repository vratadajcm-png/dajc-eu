/**
 * DAJC Driving Bans research CLI. AI searches and checks official documents and
 * writes drafts into a research store; it never writes canonical.json, never
 * approves and never publishes. A person promotes a draft into the existing
 * review workflow (npm run driving-bans:evidence).
 */
import { mkdtempSync, readFileSync } from 'node:fs';
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
import { safeFetch } from '../src/lib/driving-bans/research/safe-fetch.mjs';

const CANONICAL = resolve('data/driving-bans/canonical.json');
const { values, positionals } = parseArgs({ allowPositionals: true, options: {
  store: { type: 'string', default: 'data/driving-bans/staging/research' }, 'evidence-store': { type: 'string', default: 'data/driving-bans/staging' },
  jurisdictions: { type: 'string', default: 'all' }, mode: { type: 'string', default: 'full' }, url: { type: 'string', multiple: true, default: [] },
  'max-documents': { type: 'string', default: '6' }, 'no-search': { type: 'boolean', default: false }, 'initial-repair': { type: 'boolean', default: false },
  clock: { type: 'string' }, reviewer: { type: 'string' }, reason: { type: 'string' }, 'legal-verified-at': { type: 'string' }, 'review-from': { type: 'string' }, 'review-to': { type: 'string' },
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
  const promoted = draft?.state === 'REVIEW_REQUIRED' ? promoteDraft({ researchStore: research, draftId: draft.draft_id, evidenceStore, reviewer: 'DAJC demo reviewer', reason: 'Synthetic walkthrough', legalVerifiedAt: '2026-11-02T07:30:00Z', reviewWindow: { from: '2026-11-01', to: '2026-12-31' }, rawCanonical: rawCanonical(), now: clock }) : null;
  print({ synthetic: true, note: 'Scripted providers and fixture pages: no network, no keys, no live API test.', statement: report.statement, drafts: report.drafts, independent_check: report.independent_check, calls: report.calls.map(call => `${call.task}:${call.provider}:${call.outcome}`), promoted, canonical_unchanged: readFileSync(CANONICAL, 'utf8') === canonicalBefore, store: research.root });
  if (readFileSync(CANONICAL, 'utf8') !== canonicalBefore) process.exitCode = 1;
}

switch (command) {
  case 'status': print(researchReadiness(process.env)); break;
  case 'run': await run(); break;
  case 'list': print(listDrafts(store()).map(brief)); break;
  case 'show': print(loadDraft(store(), target)); break;
  case 'reject': print(brief(rejectDraft({ researchStore: store(), draftId: target, reviewer: values.reviewer, reason: values.reason, now }))); break;
  case 'promote': print(promoteDraft({ researchStore: store(), draftId: target, evidenceStore: resolve(values['evidence-store']), reviewer: values.reviewer, reason: values.reason, legalVerifiedAt: values['legal-verified-at'], reviewWindow: { from: values['review-from'], to: values['review-to'] }, rawCanonical: rawCanonical(), catalogSources: drivingBanSourceCatalog.entries, now })); break;
  case 'verify-log': { const result = verifyAuditLog(store().root); print(result); if (!result.ok) process.exitCode = 1; break; }
  case 'demo': await demo(); break;
  default:
    console.error('Usage: driving-bans-research.mjs <status | run [--jurisdictions all|AT,DE] [--mode full|urgent --url URL] [--no-search] [--max-documents N] | list | show ID | reject ID --reviewer L --reason R | promote ID --reviewer L --reason R --legal-verified-at ISO --review-from DATE --review-to DATE [--evidence-store DIR] | verify-log | demo> [--store DIR]');
    process.exitCode = 2;
}
