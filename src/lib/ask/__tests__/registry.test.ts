// Driving Bans 2.0: the free Ask, paid Intelligence and paid DAJC AI share one
// authoritative registry and one legal verification state. Official pages found
// on the web stay unverified leads and enter the registry only through review.

import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CostMeter } from '../cost';
import { runPipeline, type PipelineDeps } from '../pipeline';
import { askQuestion } from '../service';
import { MemoryAskStore } from '../store/memory';
import { lookupDrivingBans, NO_CONFIRMED_BAN_FINDING } from '../own-data';
import { DRIVING_BANS_INTELLIGENCE_RELEASED } from '../../intelligence/entitlements';
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

function deps(scenario: FakeScenario, extra: Partial<PipelineDeps> = {}) {
  const providers = fakeProviders(scenario);
  return { providers, deps: { config, providers, meter: new CostMeter(config), now: NOW, view: fixtureView(), findings: [], fetchPage: fakeFetchPage({}), ...extra } as PipelineDeps };
}
const ownDraft = (text: string, quote = (p: JsonCallParams) => ownRecordQuote(p)) => (params: JsonCallParams) => ({
  claims: [{ text, source_id: firstOwnSourceId(params), quote: quote(params) }], covers_question: true,
});
const sha = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex');

describe('one authoritative registry for confirmed driving-ban facts', () => {
  it('answers a fully verified country inside the published period as VERIFIED and shows its verification state', async () => {
    const { deps: d, providers } = deps({ draft: ownDraft('In Czechia the Sunday and public holiday driving ban applies on that day (zákaz jízdy).') });
    const { answer } = await runPipeline('Is there a truck driving ban in Czechia on 1 November 2026?', 'en', d);
    expect(answer.level).toBe('VERIFIED');
    expect(providers.calls.search).toHaveLength(0);
    expect(answer.statements.map((s) => s.basis)).toEqual(['dajc_verified']);
    expect(answer.sources[0].verification).toBe('DAJC_VERIFIED');
    expect(answer.verification).toEqual([{
      jurisdiction: 'CZ', outcome: 'BAN_FOUND', days: [{ date: SUNDAY, outcome: 'BAN_FOUND' }], coverageComplete: true,
      verificationState: 'PRIMARY_VERIFIED', lastVerified: '2026-09-26T15:25:00.000Z', period: { from: '2026-10-01', to: '2026-11-30' },
    }]);
  });

  it('states "no confirmed ban" only from the registry of a country verified in full', async () => {
    const { deps: d, providers } = deps({ classification: { dates: [TUESDAY] }, draft: ownDraft('The DAJC registry lists no verified driving ban for Czechia on that day (zákaz jízdy).', () => NO_CONFIRMED_BAN_FINDING) });
    const { answer } = await runPipeline('Is there a truck driving ban in Czechia on 3 November 2026?', 'en', d);
    expect(answer.level).toBe('VERIFIED');
    expect(providers.calls.search).toHaveLength(0);
    expect(answer.verification[0]).toMatchObject({ jurisdiction: 'CZ', outcome: 'NO_CONFIRMED_BAN', coverageComplete: true });
    const rows = answer.facts[0].rows;
    expect(rows.find((r) => r.label === 'Restriction')?.value).toBe('No verified legal driving ban in the DAJC registry');
    expect(rows.find((r) => r.label === 'Local time')?.value).toBe(`${TUESDAY} (Europe/Prague)`);
    expect(answer.sources[0]).toMatchObject({ url: 'https://www.dajc.eu/driving-bans', verification: 'DAJC_VERIFIED', checkedAt: '2026-09-26' });
  });

  it('answers a country without verified data as INSUFFICIENT_VERIFIED_DATA - never as "no ban"', async () => {
    const { deps: d } = deps({ classification: { jurisdictions: ['DE'], dates: [TUESDAY], language: 'cs' } });
    const { answer } = await runPipeline('Platí v Německu v úterý 3. listopadu 2026 zákaz jízdy pro kamiony?', 'cs', d);
    expect(answer.level).toBe('INSUFFICIENT_VERIFIED_DATA');
    expect(answer.ui.levelLabel).toBe('NEDOSTATEK OVĚŘENÝCH DAT');
    expect(answer.ui.levelHelp).toMatch(/Nedostatek informací neznamená, že zákaz neexistuje/);
    expect(answer.notices).toContain('Nedostatek ověřených dat pro: DE. Neznamená to, že zákaz neexistuje.');
    expect(answer.verification).toEqual([expect.objectContaining({ jurisdiction: 'DE', outcome: 'INSUFFICIENT_VERIFIED_DATA', coverageComplete: false, lastVerified: null })]);
    expect(answer.statements).toHaveLength(0);
  });

  it('keeps incompletely verified AT and missing DE below VERIFIED, with verified AT facts', async () => {
    const { deps: d } = deps({ classification: { jurisdictions: ['AT', 'DE'] }, draft: ownDraft('In Austria the weekend driving ban applies on that day (Fahrverbot).') });
    const { answer } = await runPipeline('Is there a truck driving ban in Austria and Germany on 1 November 2026?', 'en', d);
    expect(answer.level).toBe('PARTIAL');
    expect(Object.fromEntries(answer.verification.map((v) => [v.jurisdiction, [v.outcome, v.coverageComplete]]))).toEqual({ AT: ['BAN_FOUND', false], DE: ['INSUFFICIENT_VERIFIED_DATA', false] });
    expect(answer.notices.join(' ')).toMatch(/do not yet cover every restriction type/);
    expect(answer.notices.join(' ')).toMatch(/Insufficient verified data for: DE/);
  });

  it('lists a documented exception without deciding whether it applies', async () => {
    const { deps: d } = deps({ draft: ownDraft('In Czechia the Sunday and public holiday driving ban applies on that day (zákaz jízdy).') });
    const { answer } = await runPipeline('Does the Czech Sunday truck ban apply to perishable goods on 1 November 2026?', 'en', d);
    expect(answer.facts[0].rows.find((r) => r.label === 'Exceptions')?.value).toBe('Perishable goods.');
    expect(answer.notices).toContain('Exceptions are listed as published. DAJC does not assess whether they apply to a specific transport; the competent authority decides.');
    expect(JSON.stringify(answer)).not.toMatch(/exempt(ed)? from the ban for|exception applies/i);
  });
});

describe('official web findings stay leads for the review layer', () => {
  const scenario: FakeScenario = {
    classification: { dates: ['2026-12-06'], search_terms: ['zákaz jízdy prosinec'] },
    searchResults: [{ url: CZ_LEAD, title: 'MD ČR' }],
    draft: () => ({ claims: [{ text: 'The Czech ministry page states a truck driving ban on Sunday 6 December 2026 from 13 to 22 (zákaz jízdy).', source_id: 'S1', quote: CZ_QUOTE }], covers_question: true }),
  };
  const fetchPage = () => fakeFetchPage({ [CZ_LEAD]: { html: htmlPage('Omezení jízdy', CZ_TEXT) } });

  it('never makes a date outside the published period VERIFIED, even for a fully verified country', async () => {
    const { deps: d } = deps(scenario, { fetchPage: fetchPage() });
    const { answer, reviewUrls } = await runPipeline('Is there a truck driving ban in Czechia on 6 December 2026?', 'en', d);
    expect(answer.verification[0]).toMatchObject({ jurisdiction: 'CZ', outcome: 'INSUFFICIENT_VERIFIED_DATA', coverageComplete: true });
    expect(answer.level).toBe('INSUFFICIENT_VERIFIED_DATA');
    expect(answer.statements).toEqual([expect.objectContaining({ basis: 'unverified_official_lead' })]);
    expect(answer.sources[0]).toMatchObject({ url: CZ_LEAD, verification: 'UNVERIFIED_LEAD' });
    expect(answer.notices.join(' ')).toMatch(/not a completed legal review and have been passed to DAJC for review/);
    expect(reviewUrls).toEqual([{ url: CZ_LEAD, jurisdiction: 'CZ', topic: 'driving_ban' }]);
  });

  it('hands the queued finding to the Driving Bans review layer without touching the published registry', async () => {
    const store = new MemoryAskStore();
    const before = sha('data/driving-bans/canonical.json');
    const providers = fakeProviders(scenario);
    const outcome = await askQuestion('user-1', 'Is there a truck driving ban in Czechia on 6 December 2026?', 'en', { config, store, providers, now: () => NOW, pipeline: { view: fixtureView(), findings: [], fetchPage: fetchPage() } });
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
      expect(proposal.submission.operations).toEqual([expect.objectContaining({ op: 'ADD_SOURCE', source: expect.objectContaining({ url: CZ_LEAD, role: 'SECONDARY' }) })]);
    } finally { rmSync(evidenceStore, { recursive: true, force: true }); }
    // The published registry is unchanged: the lead decides nothing.
    expect(sha('data/driving-bans/canonical.json')).toBe(before);
    expect(lookupDrivingBans({ jurisdictions: ['CZ'], dates: ['2026-12-06'] }, { view: fixtureView(), now: NOW }).verification.CZ.outcome).toBe('INSUFFICIENT_VERIFIED_DATA');
  });

  it('keeps the trust rules of other topics: an official page can still verify a non-driving-ban answer', async () => {
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
  });
});

describe('free Ask versus paid DAJC AI', () => {
  it('answers without any paid entitlement while paid Intelligence stays unreleased', async () => {
    expect(DRIVING_BANS_INTELLIGENCE_RELEASED).toBe(false);
    const { deps: d } = deps({ draft: ownDraft('In Czechia the Sunday and public holiday driving ban applies on that day (zákaz jízdy).') });
    const { answer } = await runPipeline('Is there a truck driving ban in Czechia on 1 November 2026?', 'en', d);
    expect(answer.level).toBe('VERIFIED');
    expect(JSON.stringify(answer)).not.toMatch(/organizationId|entitlement/);
  });

  it('uses only the free entry point of the shared contract; paid authorisation is never reached from Ask', () => {
    const files = ['own-data.ts', 'pipeline.ts', 'service.ts', 'handlers.ts'].map((file) => readFileSync(`src/lib/ask/${file}`, 'utf8'));
    expect(files[0]).toMatch(/answerFreeAskQuery/);
    for (const code of files) expect(code).not.toMatch(/answerDrivingBansQuery|authorizeFeature|intelligence\/entitlements|handleEntitledRequest/);
  });
});
