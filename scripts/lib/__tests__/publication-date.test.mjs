import { describe, expect, it } from 'vitest';
import { extractPublicationDate, findDates, toIsoDay } from '../publication-date.mjs';

const now = new Date('2026-10-02T12:00:00Z');

describe('findDates', () => {
  it.each([
    ['Bern, 19.08.2026 — Der Bundesrat', '2026-08-19'],
    ['PRESS RELEASE 31. 08. 2026 Charged Motorways', '2026-08-31'],
    ['Veröffentlicht am 6. Mai 2026', '2026-05-06'],
    ['Publié le 1er octobre 2026', '2026-10-01'],
    ['Publicado el 30 de septiembre de 2026', '2026-09-30'],
    ['publié le 1 octobre 2026', '2026-10-01'],
    ['Published: 21 September 2026', '2026-09-21'],
    ['September 21, 2026', '2026-09-21'],
    ['Objavljeno 17. rujna 2026.', '2026-09-17'],
    ['Zveřejněno 1. října 2026', '2026-10-01'],
    ['2026. szeptember 17.', '2026-09-17'],
    ['2026 m. rugsėjo 17 d.', '2026-09-17'],
    ['06/23/2026 06/23/2026', '2026-06-23'],
    ['2026-09-29T14:47:11Z', '2026-09-29'],
  ])('reads %s', (text, expected) => {
    expect(findDates(text)[0]?.iso ?? null).toBe(expected);
  });

  it('resolves "listopada" as October for Croatian sources and November elsewhere', () => {
    expect(findDates('5. listopada 2026.', { country: 'Croatia' })[0].iso).toBe('2026-10-05');
    expect(findDates('5 listopada 2026', { country: 'Poland' })[0].iso).toBe('2026-11-05');
  });

  it('rejects impossible calendar dates', () => {
    expect(findDates('31.02.2026')).toEqual([]);
  });
});

describe('toIsoDay', () => {
  it('normalises feed and metadata timestamps', () => {
    expect(toIsoDay('2026-10-01T11:33:53+02:00')).toBe('2026-10-01');
    expect(toIsoDay('Thu, 01 Oct 2026 09:33:53 GMT')).toBe('2026-10-01');
    expect(toIsoDay('')).toBeNull();
  });
});

describe('extractPublicationDate', () => {
  it('prefers schema.org datePublished on the page (e.g. Presseportal)', () => {
    const html = '<script type="application/ld+json">{"datePublished":"2026-10-01T11:33:53","dateModified":"2026-10-02T08:00:00"}</script>';
    expect(extractPublicationDate({ html, now })).toEqual({ date: '2026-10-01', source: 'jsonld' });
  });

  it('prefers first-publication metadata over a feed <updated> date (GOV.UK)', () => {
    const html = '<meta name="govuk:first-published-at" content="2013-08-19T00:00:00+01:00"><meta name="govuk:updated-at" content="2026-09-29T10:00:00+01:00">';
    expect(extractPublicationDate({ html, feedDate: '2026-09-29T10:00:00+01:00', now })).toEqual({ date: '2013-08-19', source: 'meta' });
  });

  it('uses the feed date when the page has no publication metadata', () => {
    expect(extractPublicationDate({ feedDate: 'Tue, 29 Sep 2026 07:00:00 GMT', now })).toEqual({ date: '2026-09-29', source: 'feed' });
  });

  it('reads a labelled publication date (ASTRA "Veröffentlicht am")', () => {
    const text = 'Medienmitteilung Veröffentlicht am 6. Mai 2026 Vereinfachte Bewilligung von Ausnahmetransporten Bern, 06.05.2026 — Ab dem 1. Juli 2026 ...';
    expect(extractPublicationDate({ text, now })).toEqual({ date: '2026-05-06', source: 'label' });
  });

  it('reads a leading date line (Estonian Transport Administration)', () => {
    const text = 'Uudised Tartu ja Elva vahel valmis uus tunnel 28.09.2026 | 14:56 1 pilt';
    expect(extractPublicationDate({ text, now })).toEqual({ date: '2026-09-28', source: 'leading-text' });
  });

  it('reads a date embedded in the URL (SSC press-release PDFs)', () => {
    const url = 'https://www.ssc.sk/files/documents/tlacove_spravy/ts_17.09.2026_1_65_most_zlate_moravce.pdf';
    expect(extractPublicationDate({ url, now })).toEqual({ date: '2026-09-17', source: 'url' });
  });

  it('never takes a future effective date as the publication date', () => {
    const text = 'A13 - tunnel de St Cloud: fermeture du tube nord à partir du 16 novembre 2026';
    expect(extractPublicationDate({ text, now })).toBeNull();
  });

  it('returns null without evidence instead of assuming today', () => {
    expect(extractPublicationDate({ text: 'Izvanredni prijevoz - osnovne informacije', url: 'https://hrvatske-ceste.hr/hr/stranice/izvanredni-prijevoz/2', now })).toBeNull();
  });
});
