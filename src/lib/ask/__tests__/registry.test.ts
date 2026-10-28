// Driving Bans 2.0: the free Ask, paid Intelligence and paid DAJC AI share one
// authoritative registry and one legal verification state. Official pages found
// on the web stay unverified leads and enter the registry only through review.
// The numbered blocks are the required alignment scenarios (PR #78 revision).

import { describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CostMeter } from '../cost';
import { t } from '../i18n';
import { runPipeline, type PipelineDeps } from '../pipeline';
import { askQuestion, getUsage } from '../service';
import { MemoryAskStore } from '../store/memory';
import { lookupDrivingBans, NO_CONFIRMED_BAN_FINDING } from '../own-data';
import { readPublishedDrivingBans } from '../../intelligence/driving-bans-adapter';
import { answerDrivingBansQuery, answerFreeAskQuery } from '../../intelligence/driving-bans-ai-contract';
import { DRIVING_BANS_INTELLIGENCE_RELEASED, handleEntitledRequest, requireSameTenant, tenantRecords } from '../../intelligence/entitlements';
import type { IntelligenceSourceRights } from '../../intelligence/persistence-contract';
import { drivingBanSourceCatalog } from '../../../../config/driving-ban-sources/index.mjs';
import { importWebLeads } from '../../driving-bans/web-leads.mjs';
import { listProposals } from '../../driving-bans/evidence-store.mjs';
import type { JsonCallParams } from '../providers';
import {
  fixtureView, NOW, SUNDAY, fakeFetchPage, fakeProviders, firstOwnSourceId, htmlPage, ownRecordQuote, testConfig, type FakeScenario,
} from './helpers';

const config = testConfig();
const TUESDAY = '2026-11-03';
const CZ_LEAD = 'https://www.mdcr.gov.cz/omezeni-jizdy-prosinec-2026';
const CZ_TEXT = 'Zákaz jízdy nákladních vozidel nad 7,5 t platí v neděli 6. prosince 2026 od 13 do 22 hodin na dálnicích a silnicích I. třídy. Zákaz se nevztahuje na vozidla uvedená v § 43 odst. 3 zákona o silničním provozu. Další informace poskytne Ministerstvo dopravy a Policie České republiky.';
const CZ_QUOTE = 'Zákaz jízdy nákladních vozidel nad 7,5 t platí v neděli 6. prosince 2026 od 13 do 22 hodin';
const CZ_SUNDAY = 'In Czechia the Sunday and public holiday driving ban applies on that day (zákaz jízdy).';

function deps(scenario: FakeScenario, extra: Partial<PipelineDeps> = {}) {
  const providers = fakeProviders(scenario);
  return { providers, deps: { config, providers, meter: new CostMeter(config), now: NOW, view: fixtureView(), findings: [], fetchPage: fakeFetchPage({}), ...extra } as PipelineDeps };
}
const quotedDraft = (texts: string[], quote: (params: JsonCallParams) => string) => (params: JsonCallParams) => ({
  claims: texts.map((text) => ({ text, source_id: firstOwnSourceId(params), quote: quote(params) })), covers_question: true,
});
const ownDraft = (...texts: string[]) => quotedDraft(texts, ownRecordQuote);
const sha = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex');

// Paid path, simulated as released with its flag on: the code is the same, only the release switch differs.
const ON = { released: true, env: { DAJC_AI_DRIVING_BANS_ENABLED: 'true' } };
const subjectA = { organizationId: 'org-a', userId: 'user-a' };
const entitlementA = { organizationId: 'org-a', features: ['ai-assistant' as const], validUntil: '2027-12-31T00:00:00.000Z' };
const tenantRights = (organizationId: string): IntelligenceSourceRights => ({
  sourceId: `customer-feed-${organizationId}`, policyVersion: 'test', storageScope: 'tenant-private', storage: 'allowed', history: 'allowed',
  derivedIntelligence: 'allowed', redistribution: 'denied', attributionRequired: false, evidenceReference: 'test contract', purpose: 'test', organizationId,
});
const sundaySearch = { jurisdictions: ['CZ'], from: '2026-10-31T23:00:00.000Z', to: '2026-11-01T23:00:00.000Z' };

describe('1. incompletely verified AT and DE: INSUFFICIENT_VERIFIED_DATA', () => {
  it('answers AT and DE as "Nedostatek ověřených dat", still showing the verified AT ban as verified', async () => {
    const { deps: d } = deps({ classification: { jurisdictions: ['AT', 'DE'], language: 'cs' }, draft: ownDraft('V Rakousku platí v uvedený den víkendový zákaz jízdy (Fahrverbot).') });
    const { answer } = await runPipeline('Platí v Rakousku a v Německu 1. listopadu 2026 zákaz jízdy pro kamiony?', 'cs', d);
    expect(answer.level).toBe('INSUFFICIENT_VERIFIED_DATA');
    expect(answer.ui.levelLabel).toBe('NEDOSTATEK OVĚŘENÝCH DAT');
    expect(answer.ui.levelHelp).toMatch(/Nedostatek informací neznamená, že zákaz neexistuje/);
    expect(Object.fromEntries(answer.verification.map((v) => [v.jurisdiction, [v.outcome, v.coverageComplete]]))).toEqual({ AT: ['BAN_FOUND', false], DE: ['INSUFFICIENT_VERIFIED_DATA', false] });
    // The verified AT fact is still shown and marked as verified by DAJC; it never lifts the answer.
    expect(answer.statements.map((s) => s.basis)).toEqual(['dajc_verified']);
    expect(answer.notices).toContain('Ověřená data DAJC pro tuto zemi zatím nepokrývají všechny druhy omezení.');
    expect(answer.notices).toContain('Nedostatek ověřených dat pro: DE. Neznamená to, že zákaz neexistuje.');
    expect(answer.ui.coverageIncompleteLabel).toBe('ověření země neúplné');
    expect(answer.ui.nextStep).toBe(t('cs', 'nextStep.CHECK_AUTHORITY'));
  });

  it('answers AT alone on a day without a verified event as INSUFFICIENT_VERIFIED_DATA, not as "no ban"', async () => {
    const { deps: d } = deps({ classification: { jurisdictions: ['AT'], dates: [TUESDAY] } });
    const { answer } = await runPipeline('Is there a truck driving ban in Austria on 3 November 2026?', 'en', d);
    expect(answer.level).toBe('INSUFFICIENT_VERIFIED_DATA');
    expect(answer.verification).toEqual([expect.objectContaining({ jurisdiction: 'AT', outcome: 'INSUFFICIENT_VERIFIED_DATA', coverageComplete: false })]);
    expect(answer.statements).toHaveLength(0);
    expect(JSON.stringify(answer)).not.toContain(NO_CONFIRMED_BAN_FINDING);
  });
});

describe('2. fully verified jurisdiction in the right period: verified answer with sources and verification date', () => {
  it('answers CZ on a Sunday of the published period as VERIFIED from the registry', async () => {
    const { deps: d, providers } = deps({ draft: ownDraft(CZ_SUNDAY) });
    const { answer } = await runPipeline('Is there a truck driving ban in Czechia on 1 November 2026?', 'en', d);
    expect(answer.level).toBe('VERIFIED');
    expect(providers.calls.search).toHaveLength(0);
    expect(answer.statements.map((s) => s.basis)).toEqual(['dajc_verified']);
    expect(answer.sources).toEqual([expect.objectContaining({ kind: 'own', url: 'https://www.mdcr.gov.cz/zakon-361', verification: 'DAJC_VERIFIED', checkedAt: '2026-09-26' })]);
    const rows = Object.fromEntries(answer.facts[0].rows.map((r) => [r.label, r.value]));
    expect(rows).toMatchObject({ Verified: '2026-09-26', 'Legal basis': 'Act 361/2000 Sb. §43' });
    expect(answer.verification).toEqual([{
      jurisdiction: 'CZ', outcome: 'BAN_FOUND', days: [{ date: SUNDAY, outcome: 'BAN_FOUND' }], coverageComplete: true,
      verificationState: 'PRIMARY_VERIFIED', lastVerified: '2026-09-26T15:25:00.000Z', period: { from: '2026-10-01', to: '2026-11-30' },
      // Listed exceptions: the shared contract asks for a check with the official source.
      authorityCheckRequired: true,
    }]);
    expect(answer.ui.nextStep).toBe(t('en', 'nextStep.CONFIRM_SOURCE'));
  });
});

describe('3. a date outside the verified period: INSUFFICIENT_VERIFIED_DATA, never "no ban"', () => {
  it('keeps a fully verified country undecided after its published period', async () => {
    const { deps: d } = deps({ classification: { dates: ['2026-12-08'] } });
    const { answer } = await runPipeline('Is there a truck driving ban in Czechia on 8 December 2026?', 'en', d);
    expect(answer.level).toBe('INSUFFICIENT_VERIFIED_DATA');
    expect(answer.verification[0]).toMatchObject({ jurisdiction: 'CZ', outcome: 'INSUFFICIENT_VERIFIED_DATA', coverageComplete: true, period: { from: '2026-10-01', to: '2026-11-30' } });
    expect(answer.ui.outcomeLabels[answer.verification[0].outcome]).toBe('insufficient verified data');
    expect(answer.notices).toContain('Insufficient verified data for: CZ. This does not mean that there is no ban.');
    expect(JSON.stringify(answer)).not.toContain(NO_CONFIRMED_BAN_FINDING);
  });

  it('stays INSUFFICIENT_VERIFIED_DATA even when an official page answers the date', async () => {
    const { deps: d } = deps({
      classification: { dates: ['2026-12-06'] },
      searchResults: [{ url: CZ_LEAD, title: 'MD ČR' }],
      draft: () => ({ claims: [{ text: 'The Czech ministry page states a truck driving ban on Sunday 6 December 2026 from 13 to 22 (zákaz jízdy).', source_id: 'S1', quote: CZ_QUOTE }], covers_question: true }),
    }, { fetchPage: fakeFetchPage({ [CZ_LEAD]: { html: htmlPage('Omezení jízdy', CZ_TEXT) } }) });
    const { answer } = await runPipeline('Is there a truck driving ban in Czechia on 6 December 2026?', 'en', d);
    expect(answer.verification[0]).toMatchObject({ jurisdiction: 'CZ', outcome: 'INSUFFICIENT_VERIFIED_DATA', coverageComplete: true });
    expect(answer.level).toBe('INSUFFICIENT_VERIFIED_DATA');
  });
});

describe('4. official web finding outside the registry: review layer, never VERIFIED, registry unchanged', () => {
  const scenario: FakeScenario = {
    classification: { dates: ['2026-12-06'], search_terms: ['zákaz jízdy prosinec'] },
    searchResults: [{ url: CZ_LEAD, title: 'MD ČR' }],
    draft: () => ({ claims: [{ text: 'The Czech ministry page states a truck driving ban on Sunday 6 December 2026 from 13 to 22 (zákaz jízdy).', source_id: 'S1', quote: CZ_QUOTE }], covers_question: true }),
  };
  const fetchPage = () => fakeFetchPage({ [CZ_LEAD]: { html: htmlPage('Omezení jízdy', CZ_TEXT) } });

  it('shows the finding only as an unverified lead, marked so for the model, and queues it for review', async () => {
    const { deps: d, providers } = deps(scenario, { fetchPage: fetchPage() });
    const { answer, reviewUrls } = await runPipeline('Is there a truck driving ban in Czechia on 6 December 2026?', 'en', d);
    // Both checks passed and the draft claims to cover the question, yet a web finding cannot verify a ban.
    expect(answer.level).toBe('INSUFFICIENT_VERIFIED_DATA');
    expect(answer.statements).toEqual([expect.objectContaining({ basis: 'unverified_official_lead' })]);
    expect(answer.sources[0]).toMatchObject({ url: CZ_LEAD, verification: 'UNVERIFIED_LEAD' });
    expect(answer.notices.join(' ')).toMatch(/not a completed legal review and have been passed to DAJC for review/);
    expect(answer.ui.aiNotice).toMatch(/not been verified by DAJC/);
    expect(providers.calls.openai.find((c) => c.schemaName === 'dajc_answer')!.user).toMatch(/id="S1" kind="official-web-unverified"/);
    expect(reviewUrls).toEqual([{ url: CZ_LEAD, jurisdiction: 'CZ', topic: 'driving_ban' }]);
  });

  it('hands the queued finding to the Driving Bans review layer without touching the published registry', async () => {
    const store = new MemoryAskStore();
    const canonicalBefore = sha('data/driving-bans/canonical.json');
    const publishedBefore = JSON.stringify(readPublishedDrivingBans(NOW));
    const outcome = await askQuestion('user-1', 'Is there a truck driving ban in Czechia on 6 December 2026?', 'en', { config, store, providers: fakeProviders(scenario), now: () => NOW, pipeline: { view: fixtureView(), findings: [], fetchPage: fetchPage() } });
    expect(outcome).toMatchObject({ status: 'answered', answer: { level: 'INSUFFICIENT_VERIFIED_DATA' } });
    const rows = [...store.reviewQueue.values()].map((row) => ({ url: row.url, jurisdiction: row.jurisdiction, topic: row.topic, first_seen: row.day }));
    expect(rows).toEqual([{ url: CZ_LEAD, jurisdiction: 'CZ', topic: 'driving_ban', first_seen: '2026-10-25' }]);
    expect(JSON.stringify(rows)).not.toMatch(/user-1|question|organization/i);

    const evidenceStore = mkdtempSync(join(tmpdir(), 'dajc-ask-leads-'));
    try {
      const [result] = importWebLeads({ leads: rows, store: evidenceStore, rawCanonical: JSON.parse(readFileSync('data/driving-bans/canonical.json', 'utf8')), catalogSources: drivingBanSourceCatalog.entries, now: NOW });
      expect(result).toMatchObject({ url: CZ_LEAD, status: 'INSUFFICIENT_EVIDENCE' });
      expect(result.findings).toEqual(expect.arrayContaining(['NO_PRIMARY_DOCUMENT', 'NO_LEGAL_VERIFICATION_DATE']));
      const [proposal] = listProposals(evidenceStore);
      expect(proposal.state).toBe('INSUFFICIENT_EVIDENCE');
      expect(proposal.submission.operations).toEqual([expect.objectContaining({ op: 'ADD_SOURCE', source: expect.objectContaining({ url: CZ_LEAD, role: 'SECONDARY' }) })]);
    } finally { rmSync(evidenceStore, { recursive: true, force: true }); }
    // The published registry is unchanged: the lead decides nothing.
    expect(sha('data/driving-bans/canonical.json')).toBe(canonicalBefore);
    expect(JSON.stringify(readPublishedDrivingBans(NOW))).toBe(publishedBefore);
    expect(lookupDrivingBans({ jurisdictions: ['CZ'], dates: ['2026-12-06'] }, { view: fixtureView(), now: NOW }).verification.CZ.outcome).toBe('INSUFFICIENT_VERIFIED_DATA');
  });
});

describe('5. a documented exception: listed, never decided by the AI', () => {
  it('lists the exception and drops any statement that decides it for a transport', async () => {
    const { deps: d, providers } = deps({ draft: ownDraft(CZ_SUNDAY, 'The perishable goods exception applies to this transport, so it may drive (výjimka).') });
    const { answer } = await runPipeline('Does the Czech Sunday truck ban apply to my perishable goods on 1 November 2026?', 'en', d);
    expect(answer.facts[0].rows.find((r) => r.label === 'Exceptions')?.value).toBe('Perishable goods.');
    expect(answer.notices).toContain('Exceptions are listed as published. DAJC does not assess whether they apply to a specific transport; the competent authority decides.');
    expect(answer.statements.map((s) => s.text)).toEqual([CZ_SUNDAY]);
    expect(answer.level).toBe('PARTIAL');
    expect(JSON.stringify(answer)).not.toMatch(/applies to this transport|may drive/i);
    // The model and the independent check are told the same rule.
    expect(providers.calls.openai.find((c) => c.schemaName === 'dajc_answer')!.system).toMatch(/Never decide whether an exception applies to a transport/);
    expect(providers.calls.anthropic[0].system).toMatch(/decides whether an exception applies to a specific transport/);
  });
});

describe('6. free versus paid access', () => {
  it('answers in the free Ask without any paid entitlement while paid Intelligence stays unreleased', async () => {
    expect(DRIVING_BANS_INTELLIGENCE_RELEASED).toBe(false);
    const { deps: d } = deps({ draft: ownDraft(CZ_SUNDAY) });
    const { answer } = await runPipeline('Is there a truck driving ban in Czechia on 1 November 2026?', 'en', d);
    expect(answer.level).toBe('VERIFIED');
    expect(JSON.stringify(answer)).not.toMatch(/organizationId|entitlement/);
  });

  it('keeps vehicle and route paid: the free entry point refuses them', () => {
    const view = fixtureView();
    expect(answerFreeAskQuery({ tool: 'evaluate_vehicle', input: { jurisdiction: 'CZ', at: '2026-11-01T13:00:00.000Z', vehicle: { configuration: 'SOLO', motorVehicleMassKg: 18000 } }, view }).status).toBe('NOT_ENTITLED');
    expect(answerFreeAskQuery({ tool: 'check_route', input: { route: { segments: [{ jurisdiction: 'CZ', roads: ['D1'], enterAt: '2026-11-01T12:00:00.000Z', exitAt: '2026-11-01T14:00:00.000Z' }] } }, view }).status).toBe('NOT_ENTITLED');
  });

  it('refuses a paid feature without an entitlement on the server, before any handler runs', async () => {
    const handler = vi.fn(async () => ({ ok: true }));
    // A client cannot name its organisation: the request carries org-a, the subject decides.
    const request = new Request('https://www.dajc.eu/api/intelligence/ai?organizationId=org-a', { method: 'POST', body: JSON.stringify({ organizationId: 'org-a' }) });
    const call = (extra: Record<string, unknown>) => handleEntitledRequest({ feature: 'ai-assistant', request, resolveSubject: async () => subjectA, resolveEntitlement: async () => null, handler, now: NOW, ...extra });
    expect((await call({})).status).toBe(404);
    expect((await call(ON)).status).toBe(403);
    expect(handler).not.toHaveBeenCalled();
    expect(answerDrivingBansQuery({ tool: 'search_bans', input: sundaySearch, subject: subjectA, entitlement: null, now: NOW, view: fixtureView(), ...ON }).status).toBe('NOT_ENTITLED');
  });

  it('uses only the free entry point of the shared contract; paid authorisation is never reached from Ask', () => {
    const files = ['own-data.ts', 'pipeline.ts', 'service.ts', 'handlers.ts'].map((file) => readFileSync(`src/lib/ask/${file}`, 'utf8'));
    expect(files[0]).toMatch(/answerFreeAskQuery/);
    expect(files[0]).toMatch(/intelligence\/driving-bans-adapter/);
    for (const code of files) expect(code).not.toMatch(/answerDrivingBansQuery|authorizeFeature|intelligence\/entitlements|handleEntitledRequest|driving-ban-calendars/);
  });
});

describe('7. tenant isolation', () => {
  it('keeps one Ask user\'s questions, findings and results away from another', async () => {
    const store = new MemoryAskStore();
    const service = { config, store, providers: fakeProviders({ draft: ownDraft(CZ_SUNDAY) }), now: () => NOW, pipeline: { view: fixtureView(), findings: [] } };
    const a = await askQuestion('user-a', 'Is there a truck driving ban in Czechia on 1 November 2026?', 'en', service);
    expect(a).toMatchObject({ status: 'answered', used: 1 });
    expect(await getUsage('user-b', service)).toMatchObject({ used: 0 });
    const b = await askQuestion('user-b', 'Is there a truck driving ban in Czechia on 1 November 2026?', 'en', service);
    expect(b).toMatchObject({ status: 'answered', used: 1 });
    // Nothing stored holds a question or an answer, and shared rows carry no user or organisation.
    const stored = JSON.stringify({ metrics: store.metrics, queue: [...store.reviewQueue.values()] });
    expect(stored).not.toMatch(/user-a|user-b|organization|Czechia|driving ban/i);
    expect(JSON.stringify(a)).not.toMatch(/user-b/);
    expect(JSON.stringify(b)).not.toMatch(/user-a/);
  });

  it('never serves tenant-bound source data in the free Ask, and only to the owning tenant on the paid path', () => {
    const view = fixtureView();
    expect(answerFreeAskQuery({ tool: 'search_bans', input: sundaySearch, view, rights: tenantRights('org-b') }).status).toBe('RIGHTS_DENIED');
    const paid = (extra: Record<string, unknown>) => answerDrivingBansQuery({ tool: 'search_bans', input: sundaySearch, subject: subjectA, entitlement: entitlementA, now: NOW, view, ...ON, ...extra });
    expect(paid({ entitlement: { ...entitlementA, organizationId: 'org-b' } }).status).toBe('TENANT_MISMATCH');
    expect(paid({ rights: tenantRights('org-b') }).status).toBe('RIGHTS_DENIED');
    expect(paid({ rights: tenantRights('org-a') }).status).toBe('OK');
    const results = [{ organizationId: 'org-a', finding: 'a' }, { organizationId: 'org-b', finding: 'b' }];
    expect(tenantRecords(results, 'org-a')).toEqual([results[0]]);
    expect(() => requireSameTenant(results[1], 'org-a')).toThrow(/Cross-tenant/);
  });
});

describe('8. "no confirmed ban" versus UNKNOWN: two different states and texts', () => {
  it('states "no confirmed ban in the verified period" only for a country verified in full', async () => {
    const { deps: d } = deps({ classification: { dates: [TUESDAY] }, draft: quotedDraft(['The DAJC registry lists no verified driving ban for Czechia on that day (zákaz jízdy).'], () => NO_CONFIRMED_BAN_FINDING) });
    const { answer } = await runPipeline('Is there a truck driving ban in Czechia on 3 November 2026?', 'en', d);
    expect(answer.level).toBe('VERIFIED');
    expect(answer.verification[0]).toMatchObject({ jurisdiction: 'CZ', outcome: 'NO_CONFIRMED_BAN', coverageComplete: true });
    expect(answer.ui.outcomeLabels.NO_CONFIRMED_BAN).toBe('no confirmed ban in the verified period (country verified in full)');
    const rows = Object.fromEntries(answer.facts[0].rows.map((r) => [r.label, r.value]));
    expect(rows).toMatchObject({ Restriction: 'No verified legal driving ban in the DAJC registry', 'Local time': `${TUESDAY} (Europe/Prague)` });
    expect(answer.sources[0]).toMatchObject({ url: 'https://www.dajc.eu/driving-bans', verification: 'DAJC_VERIFIED', checkedAt: '2026-09-26' });
  });

  it('answers a country whose ban state is UNKNOWN with insufficient verified data, in different words', async () => {
    const { deps: d } = deps({ classification: { jurisdictions: ['PL'], dates: [TUESDAY], language: 'cs' } });
    const { answer } = await runPipeline('Platí v Polsku v úterý 3. listopadu 2026 zákaz jízdy pro kamiony?', 'cs', d);
    expect(answer.level).toBe('INSUFFICIENT_VERIFIED_DATA');
    expect(answer.verification[0]).toMatchObject({ jurisdiction: 'PL', outcome: 'INSUFFICIENT_VERIFIED_DATA', coverageComplete: false, lastVerified: null });
    expect(answer.statements).toHaveLength(0);
    for (const lang of ['en', 'cs'] as const) {
      const none = t(lang, 'outcome.NO_CONFIRMED_BAN');
      const unknown = t(lang, 'outcome.INSUFFICIENT_VERIFIED_DATA');
      expect(none).not.toBe(unknown);
      expect(t(lang, 'level.INSUFFICIENT_VERIFIED_DATA')).not.toBe(t(lang, 'level.VERIFIED'));
    }
    expect(t('cs', 'outcome.NO_CONFIRMED_BAN')).toBe('žádný potvrzený zákaz v ověřeném období (země ověřena v plném rozsahu)');
    expect(t('cs', 'outcome.INSUFFICIENT_VERIFIED_DATA')).toBe('nedostatek ověřených dat');
    expect(answer.ui.levelHelp).toMatch(/neznamená, že zákaz neexistuje/);
  });
});

describe('other topics keep their own trust rules', () => {
  it('lets an official page verify a non-driving-ban answer', async () => {
    const url = 'https://www.rsd.cz/nadrozmerna-preprava';
    const text = 'Povolení k nadrozměrné přepravě vydává Ředitelství silnic a dálnic pro přepravy po dálnicích a silnicích I. třídy. Žádost se podává elektronicky a posuzuje se podle trasy, rozměrů a hmotnosti vozidla. Pro silnice nižších tříd rozhoduje příslušný krajský úřad.';
    const { deps: d } = deps({
      classification: { topic: 'oversize_permit', dates: [] },
      searchResults: [{ url, title: 'ŘSD' }],
      draft: () => ({ claims: [{ text: 'Permits for oversize transport on motorways are issued by the Road and Motorway Directorate (ŘSD).', source_id: 'S1', quote: 'Povolení k nadrozměrné přepravě vydává Ředitelství silnic a dálnic' }], covers_question: true }),
    }, { fetchPage: fakeFetchPage({ [url]: { html: htmlPage('Nadrozměrná přeprava', text) } }) });
    const { answer } = await runPipeline('Who issues oversize transport permits in Czechia?', 'en', d);
    expect(answer.level).toBe('VERIFIED');
    expect(answer.statements.map((s) => s.basis)).toEqual(['official_web']);
    expect(answer.verification).toEqual([]);
    expect(answer.ui.nextStep).toBeNull();
  });
});
