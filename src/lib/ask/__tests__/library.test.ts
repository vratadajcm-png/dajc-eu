// DAJC legal library inside the existing Ask pipeline: citations with article
// and PDF page, level limits, and regression tests against outdated rules,
// wrong mass bands, incomplete citations and wrong exceptions. Library texts
// below are real excerpts of Regulation (EC) No 561/2006, Article 7, from the
// EUR-Lex consolidated PDFs of 31.12.2024 (imported in the development library).

import { describe, expect, it } from 'vitest';
import { CostMeter } from '../cost';
import { libraryLanguages, readLibraryConfig, type LibraryHit, type LibraryLookup } from '../library';
import { runPipeline, type PipelineDeps } from '../pipeline';
import type { JsonCallParams } from '../providers';
import { fakeFetchPage, fakeProviders, fixtureView, NOW, testConfig, type FakeScenario } from './helpers';

const ARTICLE_7: Record<string, { text: string; quote: string; statement: string; label: string; anchor: string; sha: string }> = {
  cs: {
    text: 'Po čtyřech a půl hodinách řízení musí mít řidič nepřerušenou přestávku\nnejméně 45 minut, pokud mu nezačíná doba odpočinku.',
    quote: 'Po čtyřech a půl hodinách řízení musí mít řidič nepřerušenou přestávku nejméně 45 minut',
    statement: 'Po čtyřech a půl hodinách řízení musí mít řidič nepřerušenou přestávku nejméně 45 minut.',
    label: 'Nařízení (ES) č. 561/2006, konsolidované znění k 31. 12. 2024', anchor: 'Článek 7', sha: '48552c3b3a88f3f42f756fc638c7466fcebe72b2d96aaa5753c3ffc2b1c7c15c',
  },
  en: {
    text: 'After a driving period of four and a half hours a driver shall take\nan uninterrupted break of not less than 45 minutes, unless he takes a rest period.',
    quote: 'After a driving period of four and a half hours a driver shall take an uninterrupted break of not less than 45 minutes',
    statement: 'After a driving period of four and a half hours, a driver shall take an uninterrupted break of not less than 45 minutes.',
    label: 'Regulation (EC) No 561/2006, consolidated text of 31.12.2024', anchor: 'Article 7', sha: '3c36e849d222cf7e7367ae9b246c7506dc801b1ee1cc697fa3db2acbe80f569b',
  },
  de: {
    text: 'Nach einer Lenkdauer von viereinhalb Stunden hat ein Fahrer eine\nununterbrochene Fahrtunterbrechung von wenigstens 45 Minuten einzulegen, sofern er keine Ruhezeit einlegt.',
    quote: 'Nach einer Lenkdauer von viereinhalb Stunden hat ein Fahrer eine ununterbrochene Fahrtunterbrechung von wenigstens 45 Minuten',
    statement: 'Nach einer Lenkdauer von viereinhalb Stunden ist eine ununterbrochene Fahrtunterbrechung von wenigstens 45 Minuten einzulegen.',
    label: 'Verordnung (EG) Nr. 561/2006, konsolidierte Fassung vom 31.12.2024', anchor: 'Artikel 7', sha: 'ef8cf4e96c8d5776a47bd5492b2fa0559177dc31cc8ab82285a62a4414fb4f4e',
  },
  pl: {
    text: 'Po okresie prowadzenia pojazdu trwającym cztery i pół godziny kierowcy przysługuje ciągła\nprzerwa trwająca co najmniej czterdzieści pięć minut, chyba że kierowca rozpoczyna okres odpoczynku.',
    quote: 'Po okresie prowadzenia pojazdu trwającym cztery i pół godziny kierowcy przysługuje ciągła przerwa trwająca co najmniej czterdzieści pięć minut',
    statement: 'Po okresie prowadzenia pojazdu trwającym cztery i pół godziny kierowcy przysługuje ciągła przerwa trwająca co najmniej czterdzieści pięć minut.',
    label: 'Rozporządzenie (WE) nr 561/2006, tekst skonsolidowany z 31.12.2024', anchor: 'Artykuł 7', sha: '29a0d5df99137e0d584c194b904e1b396cc1a1765eab960ff99804aaa4a46ae9',
  },
  sk: {
    text: 'Po štyroch a pol hodinách jazdy má vodič neprerušovanú prestávku trvajúcu najmenej\nštyridsaťpäť minút, ak nezačína čerpať dobu odpočinku.',
    quote: 'Po štyroch a pol hodinách jazdy má vodič neprerušovanú prestávku trvajúcu najmenej štyridsaťpäť minút',
    statement: 'Po štyroch a pol hodinách jazdy má vodič neprerušovanú prestávku trvajúcu najmenej štyridsaťpäť minút.',
    label: 'Nariadenie (ES) č. 561/2006, konsolidované znenie k 31. 12. 2024', anchor: 'Článok 7', sha: 'fc42123241ff3663795d63ad3d5d08e91d05a28e51a8485d67f0cb14c3fcc172',
  },
};

const QUESTIONS: Record<string, { question: string; country: string }> = {
  cs: { question: 'Jak dlouhou přestávku musím udělat po 4,5 hodinách řízení v Česku?', country: 'CZ' },
  en: { question: 'How long is the break after 4.5 hours of driving in Ireland?', country: 'IE' },
  de: { question: 'Wie lange muss die Pause nach 4,5 Stunden Lenkzeit in Deutschland sein?', country: 'DE' },
  pl: { question: 'Jak długa przerwa po 4,5 godzinach jazdy w Polsce?', country: 'PL' },
  sk: { question: 'Aká dlhá prestávka po 4,5 hodinách jazdy na Slovensku?', country: 'SK' },
};

function hit(lang: string, over: Partial<LibraryHit> = {}): LibraryHit {
  const a = ARTICLE_7[lang];
  const page = { cs: 's.', sk: 's.', de: 'S.', pl: 'str.' }[lang] || 'p.';
  return {
    id: '1', jurisdiction: 'EU', title: 'Regulation (EC) No 561/2006', officialNumber: 'Regulation (EC) No 561/2006', legalCategory: 'EU_REGULATION',
    anchorType: 'ARTICLE', anchorLabel: a.anchor, pageFrom: 7, pageTo: 7, text: a.text, language: lang,
    url: `https://eur-lex.europa.eu/legal-content/${lang.toUpperCase()}/TXT/PDF/?uri=CELEX:02006R0561-20241231#page=7`, sha256: a.sha, versionLabel: a.label,
    authenticity: 'CONSOLIDATED_DOCUMENTATION', effectiveFrom: '2024-12-31', effectiveTo: null, validity: 'IN_FORCE', validityCheckedOn: '2026-11-08',
    provenance: 'HUMAN_VERIFIED', lastVerifiedAt: '2026-11-08T10:00:00.000Z', applicability: 'EU_DIRECT', massCheck: 'NO_THRESHOLD',
    citation: `${a.label} · ${a.anchor} · ${page} 7`, ...over,
  };
}

function libraryOf(hits: LibraryHit[]): LibraryLookup & { calls: number } {
  const wrapped = Object.assign(async (_query: Parameters<LibraryLookup>[0]) => {
    wrapped.calls++;
    return hits;
  }, { calls: 0 });
  return wrapped;
}

function citeLibrary(statement: string, quote: string, sourceId = 'L1') {
  return (params: JsonCallParams) => ({
    claims: params.user.includes(`id="${sourceId}"`) ? [{ text: statement, source_id: sourceId, quote }] : [],
    covers_question: true,
  });
}

function run(lang: string, hits: LibraryHit[], scenario: FakeScenario = {}) {
  const config = testConfig();
  const a = ARTICLE_7[lang];
  const q = QUESTIONS[lang];
  const providers = fakeProviders({
    classification: { language: lang, jurisdictions: [q.country], topic: 'other', dates: ['2026-11-08'], search_terms: ['break driving time'] },
    draft: citeLibrary(a.statement, a.quote),
    ...scenario,
  });
  const library = libraryOf(hits);
  const deps = { config, providers, meter: new CostMeter(config), now: NOW, view: fixtureView(), findings: [], fetchPage: fakeFetchPage({}), library } as PipelineDeps;
  return { promise: runPipeline(q.question, lang === 'cs' ? 'cs' : 'en', deps), providers, library };
}

describe('DAJC AI answers from the legal library in five languages', () => {
  it.each(Object.keys(ARTICLE_7))('%s: verified answer with document, article and PDF page, no paid web search', async (lang) => {
    const { promise, providers } = run(lang, [hit(lang)]);
    const { answer } = await promise;
    expect(answer.level).toBe('VERIFIED');
    expect(answer.statements).toEqual([{ text: ARTICLE_7[lang].statement, sourceId: 'L1', basis: 'official_web' }]);
    expect(answer.sources[0].title).toBe(hit(lang).citation);
    expect(answer.sources[0].title).toContain(ARTICLE_7[lang].anchor);
    expect(answer.sources[0].url).toMatch(/#page=7$/);
    expect(answer.sources[0].checkedAt).toBe('2026-11-08');
    // The country is answered by the library, so the paid web search is not used.
    expect(providers.calls.search).toHaveLength(0);
    expect(answer.notices.join(' ')).toMatch(/not a legal interpretation|není právním výkladem/);
    expect(answer.notices.join(' ')).toMatch(/consolidated text is a documentation tool|Konsolidované znění je dokumentační nástroj/);
  });

  it('searches the question language, the official languages and English', () => {
    expect(libraryLanguages('cs', ['DE'])).toEqual(['cs', 'de', 'en']);
    expect(libraryLanguages('pl', ['PL'])).toEqual(['pl', 'en']);
  });
});

describe('the library never raises an answer it cannot support', () => {
  it('keeps a machine-checked (not independently verified) version at PARTIAL and says so', async () => {
    const { answer } = await run('en', [hit('en', { provenance: 'AUTO_CHECKED' })]).promise;
    expect(answer.level).toBe('PARTIAL');
    expect(answer.notices.join(' ')).toMatch(/not yet the independent verification/);
  });

  it('answers VERIFIED from an AI-verified version and says that the verification was automated', async () => {
    const { answer } = await run('en', [hit('en', { provenance: 'AI_VERIFIED', aiVerifiedAt: '2026-11-09T10:00:00.000Z', aiVerificationModels: 'openai/gpt-6-sol + anthropic/claude-sonnet-5-5' })]).promise;
    expect(answer.level).toBe('VERIFIED');
    expect(answer.notices.join(' ')).toMatch(/verified automatically: two independent AI models/);
    expect(answer.notices.join(' ')).toMatch(/not a human, official or legally binding confirmation/);
    const cs = await run('cs', [hit('cs', { provenance: 'AI_VERIFIED' })]).promise;
    expect(cs.answer.notices.join(' ')).toMatch(/Nejde o lidské, úřední ani právně závazné potvrzení/);
  });

  it('never presents a person-verified version as AI-verified', async () => {
    const { answer } = await run('en', [hit('en')]).promise;
    expect(answer.notices.join(' ')).not.toMatch(/two independent AI models/);
  });

  it('reads AI- and person-verified versions in production, machine-checked ones only in internal tests', () => {
    expect(readLibraryConfig({ DAJC_KB_ENABLED: 'true', VERCEL_ENV: 'production', DAJC_KB_ALLOW_AUTO_CHECKED: 'true' } as any)).toEqual({ allowedProvenance: ['AI_VERIFIED', 'HUMAN_VERIFIED'] });
    expect(readLibraryConfig({ DAJC_KB_ENABLED: 'true', VERCEL_ENV: 'preview', DAJC_KB_ALLOW_AUTO_CHECKED: 'true' } as any)).toEqual({ allowedProvenance: ['AI_VERIFIED', 'HUMAN_VERIFIED', 'AUTO_CHECKED'] });
    expect(readLibraryConfig({ DAJC_KB_ENABLED: 'false' } as any)).toBeNull();
  });

  it('keeps a provision with an unreviewed mass band at PARTIAL (no transfer between 3.5 t and 7.5 t rules)', async () => {
    const { answer } = await run('en', [hit('en', { massCheck: 'UNREVIEWED' })]).promise;
    expect(answer.level).toBe('PARTIAL');
    expect(answer.notices.join(' ')).toMatch(/mass band was not confirmed/);
  });

  it('never cites a provision of another mass band', async () => {
    const { answer } = await run('en', [hit('en', { massCheck: 'MISMATCH' })]).promise;
    expect(answer.sources.some((s) => s.url.includes('eur-lex'))).toBe(false);
    expect(answer.level).not.toBe('VERIFIED');
  });

  it('never cites an outdated or not-yet-valid version', async () => {
    for (const over of [{ effectiveTo: '2025-01-01' }, { effectiveFrom: '2027-01-01' }, { validity: 'REPEALED' }, { validity: 'SUPERSEDED' }]) {
      const { answer } = await run('en', [hit('en', over as Partial<LibraryHit>)]).promise;
      expect(answer.sources.some((s) => s.url.includes('eur-lex')), JSON.stringify(over)).toBe(false);
    }
  });

  it('never cites a passage without a complete citation', async () => {
    for (const over of [{ anchorType: 'PREAMBLE', anchorLabel: 'Preamble' }, { url: 'https://eur-lex.europa.eu/x.pdf' }, { sha256: 'abc' }, { versionLabel: '' }]) {
      const { answer } = await run('en', [hit('en', over as Partial<LibraryHit>)]).promise;
      expect(answer.sources.some((s) => s.url.includes('eur-lex')), JSON.stringify(over)).toBe(false);
    }
  });

  it('flags a directive (national transposition) and still searches official websites for the country', async () => {
    const { promise, providers } = run('en', [hit('en', { legalCategory: 'EU_DIRECTIVE', applicability: 'TRANSPOSITION_CHECK_REQUIRED' })]);
    const { answer } = await promise;
    expect(answer.level).toBe('PARTIAL');
    expect(answer.notices.join(' ')).toMatch(/national transposition/);
    expect(providers.calls.search).toHaveLength(1);
  });

  it('drops a statement that decides an exception for the reader, even with an official source', async () => {
    const { answer } = await run('en', [hit('en')], {
      draft: citeLibrary('The exemption applies here because the break was taken.', ARTICLE_7.en.quote),
    }).promise;
    expect(answer.statements).toHaveLength(0);
    expect(answer.level).not.toBe('VERIFIED');
  });

  it('drops a statement whose numbers are not in the quoted provision', async () => {
    const { answer } = await run('en', [hit('en')], {
      draft: citeLibrary('After a driving period of four and a half hours, a driver shall take a break of not less than 30 minutes.', ARTICLE_7.en.quote),
    }).promise;
    expect(answer.statements).toHaveLength(0);
  });

  it('is not consulted for driving bans: the Driving Bans registry stays their only authority', async () => {
    const config = testConfig();
    const library = libraryOf([hit('en')]);
    const providers = fakeProviders({ draft: () => ({ claims: [], covers_question: false }) });
    await runPipeline('Is there a truck driving ban in Czechia on Sunday?', 'en', {
      config, providers, meter: new CostMeter(config), now: NOW, view: fixtureView(), findings: [], fetchPage: fakeFetchPage({}), library,
    } as PipelineDeps);
    expect(library.calls).toBe(0);
  });

  it('a failing library lookup never breaks the answer', async () => {
    const config = testConfig();
    const providers = fakeProviders({ classification: { jurisdictions: ['IE'], topic: 'other', search_terms: ['break'] } });
    const library = (async () => { throw new Error('db down'); }) as LibraryLookup;
    const { answer } = await runPipeline('How long is the break after 4.5 hours of driving in Ireland?', 'en', {
      config, providers, meter: new CostMeter(config), now: NOW, view: fixtureView(), findings: [], fetchPage: fakeFetchPage({}), library,
    } as PipelineDeps);
    expect(answer.level).toBe('UNKNOWN');
    expect(providers.calls.search).toHaveLength(1);
  });
});
