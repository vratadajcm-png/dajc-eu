// Regressions from the W44 investigation (24 October 2026): DAJC's own
// archive dominated Search, the official N307 notice was never found, an
// evergreen blog and a third-hand relay passed, and the edition copy named
// countries without a published report.
import { describe, expect, it } from 'vitest';
import { isOwnPublication, officialDomainsFor, sourceTier } from '../source-policy.mjs';
import {
  buildSearchQueries, buildSearchRequest, DEFAULT_CLASSIFIER_MODEL, searchBundles, searchWithPerplexitySearch, SEARCH_GROUPS, verifySearchItem,
} from '../web-search.mjs';
import { isRecentRefresh } from '../store.mjs';
import { checkFreshness, checkSpecificDevelopment } from '../weekly-eligibility.mjs';
import { alignEditionSummary, mentionedCountries, operatorChecklistFromReports } from '../edition-summary.mjs';
import { withOriginalPages } from '../../claude-weekly-review.mjs';

const group = (id) => SEARCH_GROUPS.find((g) => g.id === id);
const now = new Date('2026-10-22T08:00:00Z');

describe('DAJC own publications', () => {
  it('are recognised on both domains and their subdomains', () => {
    expect(isOwnPublication('https://www.dajc.eu/news/eu-oversize/eu-oversize-weekly-2026-w42/')).toBe(true);
    expect(isOwnPublication('https://dajc.cz/')).toBe(true);
    expect(isOwnPublication('https://notdajc.eu/news')).toBe(false);
  });

  it('are never a source - rejected before any page fetch', async () => {
    let fetched = false;
    const result = await verifySearchItem(
      { country: 'Czechia', region: null, url: 'https://www.dajc.eu/news/eu-oversize/eu-oversize-weekly-2026-w41', title: 'Weekly' },
      { fetchPage: async () => { fetched = true; return { ok: true, text: '' }; }, now },
    );
    expect(result).toEqual({ ok: false, reason: 'DAJC own publication - never a source' });
    expect(fetched).toBe(false);
    expect(checkSpecificDevelopment({ sourceUrl: 'https://www.dajc.eu/news/eu-oversize/europe-hgv-driving-bans-september-october-2026/', title: 'European HGV Driving Bans: September & October 2026' }))
      .toEqual({ ok: false, reason: 'DAJC own publication - never a source' });
  });

  it('are dropped from Search leads before classification', async () => {
    const calls = [];
    const fetchFn = async (url) => {
      calls.push(url);
      return { ok: true, json: async () => ({ results: [{ url: 'https://www.dajc.eu/news/eu-oversize/eu-oversize-weekly-2026-w42/', title: 'EU Oversize Weekly', snippet: 'oversize' }] }) };
    };
    const result = await searchWithPerplexitySearch(group('cz'), buildSearchRequest(group('cz'), now), { searchKey: 'k', claudeKey: 'k', fetchFn });
    expect(result).toEqual([]);
    expect(calls).toEqual(['https://api.perplexity.ai/search']);
  });
});

describe('Perplexity Search requests', () => {
  it('send short local-language keyword queries, never the LLM prompt', () => {
    const queries = buildSearchQueries(group('cz'), 'oversize');
    expect(queries[0]).toBe('nadrozměrná přeprava');
    expect(queries.length).toBeLessThanOrEqual(5);
    for (const query of queries) {
      expect(query.length).toBeLessThan(120);
      expect(query).not.toMatch(/weekly|briefing|dajc/i);
    }
    expect(buildSearchQueries(group('east'), 'oversize').join(' ')).not.toMatch(/\(/);
  });

  it('restrict the official-first pass to public authorities of the group', () => {
    const request = buildSearchRequest(group('benelux'), now, 'oversize', 'official');
    expect(request.search_domain_filter).toContain('rijkswaterstaat.nl');
    expect(request.search_domain_filter).toContain('wegenenverkeer.be');
    expect(request.search_domain_filter.every((d) => !d.startsWith('-'))).toBe(true);
    expect(request.search_domain_filter.length).toBeLessThanOrEqual(20);
    expect(request).not.toHaveProperty('search_after_date_filter');
    expect(buildSearchRequest(group('cz'), now, 'oversize', 'official').country).toBe('CZ');
  });

  it('exclude DAJC and driving-ban aggregators from the open-web pass and ask for recent pages', () => {
    const request = buildSearchRequest(group('nordics'), now, 'operations', 'industry');
    expect(request.search_domain_filter).toEqual(expect.arrayContaining(['-dajc.eu', '-dajc.cz', '-trafficban.com']));
    expect(request.search_after_date_filter).toBe('09/22/2026');
    // A Russian-language relay of a Swedish story (24tv.ua, W44) is outside the group's languages.
    expect(request.search_language_filter).not.toContain('ru');
  });

  it('every group has official domains for its first pass', () => {
    for (const g of SEARCH_GROUPS) expect(officialDomainsFor(g.codes).length, g.id).toBeGreaterThan(0);
  });
});

describe('evergreen guides are not developments', () => {
  it.each([
    ['https://loadplan.eu/blog/winter-rules-trucks-europe', 'Winter Rules for Trucks in Europe 2026/27: Tyres, Chains and Axle Loads by Country'],
    ['https://nsroute.com/en/permits/hungary/', 'Oversize load permit in Hungary (2026): authority, thresholds, fees'],
    ['https://www.schwertransport.de/en/grenzuberschreitender-sondertransport/', 'Cross-border special transport: Permits and procedures 2026'],
    ['https://www.ev-sol.cz/en/country/italy/', 'Transport to Italy'],
    ['https://tollcalc.eu/en/knowledgebase/toll-slovenia.html', 'Truck Toll Slovenia: The DarsGo System'],
  ])('%s', (sourceUrl, title) => {
    expect(checkSpecificDevelopment({ sourceUrl, title }).reason).toMatch(/evergreen guide/);
  });

  it('keeps dated official notices whose title ends with a year', () => {
    expect(checkSpecificDevelopment({
      sourceUrl: 'https://www.rijkswaterstaat.nl/nieuws/archief/2026/09/n307-gewichtsbeperking-markerwaarddijk-vanaf-21-oktober-2026',
      title: 'N307: gewichtsbeperking Markerwaarddijk; vanaf 21 oktober 2026',
    })).toEqual({ ok: true });
    expect(sourceTier('https://www.rijkswaterstaat.nl/nieuws/archief/2026/09/n307')).toBe('official');
  });
});

describe('catch-up after a skipped edition', () => {
  // W44 (26 Oct - 1 Nov) prepared on 22 Oct; W43 was never published.
  const ctx = { now, weekStart: new Date('2026-10-26T00:00:00Z'), weekEnd: new Date('2026-11-01T00:00:00Z') };
  const n307 = { publishedAt: '2026-09-28', validFrom: '2026-10-21', validTo: null };

  it('is not eligible when the previous edition was published', () => {
    expect(checkFreshness(n307, ctx).ok).toBe(false);
  });

  it('reports a change that took effect in the skipped week and is still in force', () => {
    expect(checkFreshness(n307, { ...ctx, catchUpSince: new Date('2026-10-19T00:00:00Z') })).toMatchObject({ ok: true, basis: 'catch-up' });
  });

  it('never revives a change that already ended or started before the skipped week', () => {
    const catchUpSince = new Date('2026-10-19T00:00:00Z');
    expect(checkFreshness({ ...n307, validTo: '2026-10-24' }, { ...ctx, catchUpSince }).ok).toBe(false);
    expect(checkFreshness({ ...n307, validFrom: '2026-10-12' }, { ...ctx, catchUpSince }).ok).toBe(false);
  });
});

describe('edition copy matches the published reports', () => {
  const report = {
    country: 'Netherlands', title: 'N307 Markerwaarddijk: 15 t gross and 7.3 t axle limit', where: 'N307 Markerwaarddijk',
    recommendedAction: 'Check gross and axle weights before assigning the N307.', sourceUrl: 'https://www.rijkswaterstaat.nl/nieuws/archief/2026/09/n307',
  };

  it('finds tracked countries as whole words, by name or adjective', () => {
    expect(mentionedCountries('Updates for the Netherlands and Hungary')).toEqual(expect.arrayContaining(['Netherlands', 'Hungary']));
    expect(mentionedCountries('Hungarian decree')).toEqual(['Hungary']);
    expect(mentionedCountries('Czechoslovak history, Germanic roots')).toEqual([]);
  });

  it('replaces an intro that promises a report the edition dropped, named by adjective (W44 correction run)', () => {
    const article = {
      seoTitle: 'European Oversize & Special Transport Weekly: 26 Oct - 1 Nov 2026',
      metaDescription: 'Weekly DAJC briefing: the N307 Houtribdijk weight limit in the Netherlands and Czech toll plans.',
      intro: 'The Netherlands now has a weight limit on the N307. Further items cover a Czech draft toll increase.',
      developments: [report], europeRoundup: [],
    };
    const { fixed } = alignEditionSummary(article, { weekRangeLabel: '26 October - 1 November 2026' });
    expect(fixed).toEqual(['metaDescription', 'intro']);
    expect(`${article.metaDescription} ${article.intro}`).not.toMatch(/Czech/);
  });

  it('replaces a description naming a country without a report and rebuilds the checklist', () => {
    const article = {
      seoTitle: 'DAJC Weekly - Week of Oct 26, 2026',
      metaDescription: 'Updates on new route restrictions in the Netherlands and ongoing policy discussions in Hungary.',
      intro: 'Developments relevant to heavy transport.',
      developments: [report], europeRoundup: [],
      operatorChecklist: ['Verify winter equipment compliance for vehicles over 3.5 tonnes.'],
    };
    const { fixed } = alignEditionSummary(article, { weekRangeLabel: '26 October - 1 November 2026' });
    expect(fixed).toEqual(['metaDescription']);
    expect(article.metaDescription).not.toMatch(/Hungary/);
    expect(article.metaDescription).toContain('N307 Markerwaarddijk');
    expect(article.operatorChecklist).toEqual(['Netherlands: Check gross and axle weights before assigning the N307.']);
    expect(article.intro).toBe('Developments relevant to heavy transport.');
  });

  it('builds one checklist line per report with an action', () => {
    expect(operatorChecklistFromReports([report, { ...report, recommendedAction: '' }])).toHaveLength(1);
  });
});

describe('final Claude review evidence', () => {
  const relay = 'https://24tv.ua/auto/ru/amp/vdvoe_bolshe_dorog_dlya_35_metrovyh_avtopoezdov_n76844';

  it('shows the reviewer who actually published the page', async () => {
    const html = `<html><body><article><h1>Вдвое больше дорог для 35-метровых автопоездов</h1><p>${'Шведы довольны экспериментом. '.repeat(20)}</p></article></body></html>`;
    const [record] = await withOriginalPages([{ url: relay, excerptFromMonitor: 'excerpt' }], async () => ({ ok: true, text: html }));
    expect(record).toMatchObject({ publisherHost: '24tv.ua', sourceTier: 'industry', originalPageFetched: true, excerptFromMonitor: 'excerpt' });
    expect(record.originalPageText).toContain('Шведы довольны');
  });

  it('marks an unreachable page instead of failing the review', async () => {
    const [record] = await withOriginalPages([{ url: 'https://www.rijkswaterstaat.nl/nieuws/x' }], async () => { throw new Error('timeout'); });
    expect(record).toMatchObject({ sourceTier: 'official', originalPageFetched: false, originalPageText: null });
  });
});

describe('lowest-cost discovery', () => {
  it('classifies Search leads on the cheapest model at low effort', async () => {
    const calls = [];
    const fetchFn = async (url, options) => {
      calls.push({ url, payload: JSON.parse(options.body) });
      if (url.endsWith('/search')) return { ok: true, json: async () => ({ results: [{ url: 'https://www.rsd.cz/novinky/x', title: 'Omezení', snippet: 'nadrozměrná přeprava' }] }) };
      return { ok: true, json: async () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: '{"items":[]}' }] }) };
    };
    await searchWithPerplexitySearch(group('cz'), buildSearchRequest(group('cz'), now, ['oversize', 'heavy']), { searchKey: 'k', claudeKey: 'k', fetchFn });
    expect(DEFAULT_CLASSIFIER_MODEL).toBe('claude-haiku-5-5');
    expect(calls[1].payload.model).toBe('claude-haiku-5-5');
    expect(calls[1].payload.output_config.effort).toBe('low');
  });

  it('bundles both focuses into one Search request when every language fits', () => {
    expect(searchBundles(group('cz'), ['oversize', 'heavy'])).toEqual([['oversize', 'heavy']]);
    const queries = buildSearchQueries(group('cz'), ['oversize', 'heavy']);
    expect(queries).toContain('nadrozměrná přeprava');
    expect(queries).toContain('omezení nákladních vozidel most tonáž');
    expect(queries.length).toBeLessThanOrEqual(5);
  });

  it('keeps one request per focus where bundling would drop a language', () => {
    expect(searchBundles(group('nordics'), ['oversize', 'heavy'])).toEqual([['oversize'], ['heavy']]);
    expect(buildSearchQueries(group('nordics'), 'oversize')).toEqual(expect.arrayContaining(['særtransport', 'dispenstransport', 'erikoiskuljetus']));
  });

  it('reuses findings written less than the allowed age ago', () => {
    const written = new Date('2026-10-22T03:20:00Z');
    expect(isRecentRefresh(written, new Date('2026-10-22T09:20:00Z'), 18)).toBe(true);
    expect(isRecentRefresh(written, new Date('2026-10-23T03:20:00Z'), 18)).toBe(false);
    expect(isRecentRefresh(written, new Date('2026-10-22T09:20:00Z'), 0)).toBe(false);
    expect(isRecentRefresh(null, new Date('2026-10-22T09:20:00Z'), 18)).toBe(false);
  });
});

describe('Official notice with a year-less effective date (N307, W44)', () => {
  // Rijkswaterstaat's own wording: "Vanaf 21 oktober geldt ..." with no year.
  // Before the fix the page was dropped as "older than 7 days, nothing upcoming".
  const html = `<html><head><script type="application/ld+json">{"@type":"NewsArticle","datePublished":"2026-09-28T15:47:49Z"}</script></head><body><main>
    <h1>N307: gewichtsbeperking Markerwaarddijk; vanaf 21 oktober</h1>
    <p>Vanaf 21 oktober geldt op de Markerwaarddijk (N307, ook wel Houtribdijk) een gewichtsbeperking van 15 ton en een aslastbeperking van 7,3 ton.
    Hierdoor kan zwaar verkeer, met name vrachtwagens, niet langer gebruik maken van de bruggen over de Houtribsluizen bij Lelystad.
    Vrachtverkeer moet omrijden via Amsterdam of de Afsluitdijk. Personenauto's, hulpdiensten en bestelbussen kunnen de route blijven gebruiken.</p>
  </main></body></html>`;
  const url = 'https://www.rijkswaterstaat.nl/nieuws/archief/2026/09/n307-gewichtsbeperking-markerwaarddijk-vanaf-21-oktober-2026';

  it('is kept as recently in force, so a skipped edition can catch it up', async () => {
    const result = await verifySearchItem(
      { country: 'Netherlands', region: null, url, title: 'N307: gewichtsbeperking Markerwaarddijk; vanaf 21 oktober' },
      { fetchPage: async () => ({ ok: true, text: html, finalUrl: url }), now: new Date('2026-10-24T10:12:00Z') },
    );
    expect(result.ok).toBe(true);
    expect(result.finding.publishedAt).toBe('2026-09-28');
    expect(result.finding.validFrom).toBe('2026-10-21');
    expect(checkFreshness(result.finding, {
      now: new Date('2026-10-24T10:12:00Z'),
      catchUpSince: new Date('2026-10-19T00:00:00Z'),
      weekStart: new Date('2026-10-26T00:00:00Z'),
      weekEnd: new Date('2026-11-01T00:00:00Z'),
    })).toMatchObject({ ok: true, basis: 'catch-up' });
  });
});
