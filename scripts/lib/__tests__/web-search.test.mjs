import { describe, expect, it } from 'vitest';
import {
  buildSearchPrompt, cleanSourceName, cleanUrl, discoverWithWebSearch, parseSearchResponse, SEARCH_GROUPS, verifySearchItem,
} from '../web-search.mjs';
import { dajcEuropeCoverage } from '../../../config/europe-coverage.mjs';

const now = new Date('2026-10-08T05:00:00Z');

const ARTICLE_TEXT =
  'Ab 12. Oktober 2026 gilt auf der A8 zwischen Salzburg und Rosenheim eine Gewichtsbeschränkung: ' +
  'Lkw über 12 t dürfen die Brücke nur einspurig befahren. Ausnahmetransporte benötigen eine neue Genehmigung ' +
  'und eine Polizeibegleitung. Die Autobahn GmbH empfiehlt, Transporte frühzeitig neu zu planen.';

function page({ heading = 'Neue Gewichtsbeschränkung für Lkw auf der A8', date = '2026-10-06', text = ARTICLE_TEXT } = {}) {
  return `<html><head><meta property="article:published_time" content="${date}T09:00:00+02:00"></head>` +
    `<body><article><h1>${heading}</h1><p>${text}</p></article></body></html>`;
}

const item = (overrides = {}) => ({
  country: 'Germany',
  title: 'Neue Gewichtsbeschränkung für Lkw auf der A8',
  url: 'https://www.autobahn.de/aktuelles/a8-gewicht?utm_source=openai',
  sourceName: 'Autobahn GmbH',
  publishedAt: '2026-10-06',
  validFrom: '2026-10-12',
  validTo: null,
  summary: 'A weight restriction applies to trucks over 12 t on the A8 bridge from 12 October 2026.',
  type: 'bridge_restriction',
  oversize: true,
  ...overrides,
});

const okPage = (html) => async (url) => ({ ok: true, text: html, finalUrl: url });

describe('buildSearchPrompt', () => {
  it('asks for one week back, one month ahead, >12 t scope with oversize first', () => {
    const prompt = buildSearchPrompt(SEARCH_GROUPS[0], now, 'oversize');
    expect(prompt).toContain('between 2026-10-01 and 2026-10-08');
    expect(prompt).toContain('between 2026-10-08 and 2026-11-07');
    expect(prompt).toMatch(/vehicles over 12 tonnes/);
    expect(prompt).toMatch(/ONLY oversize/);
    expect(prompt).toMatch(/NEVER RETURN: general recurring truck driving bans/);
  });

  it('has a separate focus for other goods vehicles over 12 t', () => {
    expect(buildSearchPrompt(SEARCH_GROUPS[0], now, 'heavy')).toMatch(/goods vehicles over 12 t/);
  });
});

describe('SEARCH_GROUPS', () => {
  it('searches Central Europe first, country by country', () => {
    expect(SEARCH_GROUPS.slice(0, 6).map((g) => g.codes[0])).toEqual(['CZ', 'DE', 'AT', 'SK', 'PL', 'HU']);
  });

  it('covers every sovereign coverage code directly or through a parent search', () => {
    const codes = new Set(SEARCH_GROUPS.flatMap((g) => g.codes));
    const sovereign = dajcEuropeCoverage.map(([code]) => code).filter((code) => /^[A-Z]{2}$/.test(code));
    const parented = new Set(['GP', 'MQ', 'GF', 'RE', 'YT', 'MF', 'BL', 'PM', 'NC', 'PF', 'WF', 'TF', 'AW', 'CW', 'SX']);
    expect(sovereign.filter((code) => !codes.has(code) && !parented.has(code))).toEqual([]);
  });
});

describe('parseSearchResponse', () => {
  it('keeps well-formed http(s) items and ignores junk', () => {
    const text = JSON.stringify({ items: [item(), item({ url: 'javascript:alert(1)' }), item({ url: 'not a url' })] });
    expect(parseSearchResponse(text)).toHaveLength(1);
    expect(parseSearchResponse('not json')).toEqual([]);
    expect(parseSearchResponse('')).toEqual([]);
  });
});

describe('cleanUrl', () => {
  it('drops utm tracking and fragments', () => {
    expect(cleanUrl('https://a.example/x?id=3&utm_source=openai#top')).toBe('https://a.example/x?id=3');
  });
});

describe('cleanSourceName', () => {
  it('keeps a clean publisher name', () => {
    expect(cleanSourceName('Landesbetrieb Straßenwesen Brandenburg', 'https://www.ls.brandenburg.de/x')).toBe('Landesbetrieb Straßenwesen Brandenburg');
  });
  it('falls back to the host name for a mangled or empty name', () => {
    expect(cleanSourceName('Landesbetrieb Stra\u00007fenwesen Brandenburg', 'https://www.ls.brandenburg.de/x')).toBe('ls.brandenburg.de');
    expect(cleanSourceName('', 'https://www.ls.brandenburg.de/x')).toBe('ls.brandenburg.de');
  });
});

describe('verifySearchItem', () => {
  it('builds the finding from the page itself, not from the model', async () => {
    const result = await verifySearchItem(item({ summary: 'model prose' }), { fetchPage: okPage(page()), now });
    expect(result.ok).toBe(true);
    expect(result.finding).toMatchObject({
      country: 'Germany',
      title: 'Neue Gewichtsbeschränkung für Lkw auf der A8',
      sourceUrl: 'https://www.autobahn.de/aktuelles/a8-gewicht',
      publishedAt: '2026-10-06',
      discoveredVia: 'web-search',
    });
    expect(result.finding.summary).toContain('Ausnahmetransporte');
    expect(result.finding.summary).not.toContain('model prose');
  });

  it('drops a page that cannot be fetched', async () => {
    const result = await verifySearchItem(item(), { fetchPage: async () => ({ ok: false, error: 'HTTP 404' }), now });
    expect(result).toEqual({ ok: false, reason: 'page not reachable (HTTP 404)' });
  });

  it('drops a page whose own text has no freight/oversize context, whatever the model claimed', async () => {
    const html = page({ heading: 'Neuer Radweg eröffnet', text: 'Der neue Radweg entlang der Straße wurde heute eröffnet. '.repeat(4) });
    const result = await verifySearchItem(item(), { fetchPage: okPage(html), now });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/no freight-vehicle \(>12 t\) or oversize-transport context/);
  });

  it('never trusts a model date that the page does not show', async () => {
    const html = `<html><body><article><h1>Neue Gewichtsbeschränkung für Lkw auf der A8</h1><p>${ARTICLE_TEXT}</p></article></body></html>`;
    const result = await verifySearchItem(item({ publishedAt: '2026-10-07' }), { fetchPage: okPage(html), now });
    expect(result.ok).toBe(true);
    expect(result.finding.publishedAt).toBeNull();
  });

  it('accepts a model date only when the page text contains it', async () => {
    const html = `<html><body><article><h1>Neue Gewichtsbeschränkung für Lkw auf der A8</h1><p>Stand 6. Oktober 2026. ${ARTICLE_TEXT}</p></article></body></html>`;
    const result = await verifySearchItem(item({ publishedAt: '2026-10-06' }), { fetchPage: okPage(html), now });
    expect(result.finding.publishedAt).toBe('2026-10-06');
  });

  it('drops an old page that announces nothing upcoming', async () => {
    const html = page({ date: '2026-08-01', text: 'Lkw über 12 t: neue Regeln für Ausnahmetransporte und Polizeibegleitung auf der A8 wurden beschlossen. '.repeat(3) });
    const result = await verifySearchItem(item(), { fetchPage: okPage(html), now });
    expect(result).toEqual({ ok: false, reason: 'published 2026-08-01, older than 7 days, nothing upcoming' });
  });

  it('keeps an old page announcing a change within the next month', async () => {
    const result = await verifySearchItem(item(), { fetchPage: okPage(page({ date: '2026-08-01' })), now });
    expect(result.ok).toBe(true);
  });

  it('drops binary documents', async () => {
    const result = await verifySearchItem(item(), { fetchPage: okPage('%PDF-1.7\u0000\u0001\u0002 binary'), now });
    expect(result.ok).toBe(false);
  });
});

describe('discoverWithWebSearch', () => {
  it('runs both focuses per group, verifies hits and dedupes URLs across groups', async () => {
    const groups = SEARCH_GROUPS.slice(0, 2);
    const calls = [];
    const client = {
      responses: {
        create: async (request) => {
          calls.push(request);
          return { output_text: JSON.stringify({ items: [item()] }) };
        },
      },
    };
    const { findings, groups: report } = await discoverWithWebSearch({ client, now, groups, fetchPage: okPage(page()) });
    expect(calls).toHaveLength(4);
    expect(calls[0].tools[0].type).toBe('web_search_preview');
    expect(findings).toHaveLength(1);
    expect(findings[0].searchGroup).toBe(groups[0].id);
    expect(report.map((r) => r.status)).toEqual(['ok', 'ok']);
  });

  it('reports a failed search as unavailable instead of hiding it', async () => {
    const client = { responses: { create: async () => { throw new Error('rate limited'); } } };
    const { findings, groups } = await discoverWithWebSearch({ client, now, groups: SEARCH_GROUPS.slice(0, 1), fetchPage: okPage(page()) });
    expect(findings).toEqual([]);
    expect(groups[0]).toMatchObject({ status: 'unavailable', error: 'oversize: rate limited; heavy: rate limited' });
  });
});
