import { describe, expect, it } from 'vitest';
import { buildNewsRss, compareNewsEntries, formatNewsDate, isNewsEntryPublic, newsCategoryLabel } from '../news';

describe('isNewsEntryPublic', () => {
  const friday = new Date('2026-09-25T10:00:00.000Z'); // 12:00 CEST

  it('hides a prepared article until its Friday 12:00 slot', () => {
    const data = { status: 'published' as const, publishedAt: friday };
    expect(isNewsEntryPublic(data, new Date('2026-09-24T15:00:00Z'))).toBe(false);
    expect(isNewsEntryPublic(data, new Date('2026-09-25T09:59:59Z'))).toBe(false);
    expect(isNewsEntryPublic(data, friday)).toBe(true);
    expect(isNewsEntryPublic(data, new Date('2026-09-25T10:01:00Z'))).toBe(true);
  });

  it('keeps date-only legacy articles public', () => {
    const data = { status: 'published' as const, publishedAt: new Date('2026-09-18') };
    expect(isNewsEntryPublic(data, new Date('2026-09-18T10:00:00Z'))).toBe(true);
  });

  it('never shows drafts', () => {
    const data = { status: 'draft' as const, publishedAt: new Date('2026-01-01') };
    expect(isNewsEntryPublic(data, friday)).toBe(false);
  });
});

describe('formatNewsDate', () => {
  it('shows the Prague calendar date, not the UTC one', () => {
    // 22 October 00:00 CEST is 21 October 22:00 UTC.
    expect(formatNewsDate(new Date('2026-10-21T22:00:00.000Z'))).toBe('22 October 2026');
    expect(formatNewsDate(new Date('2026-10-23T10:00:00.000Z'), 'short')).toBe('23 Oct 2026');
  });
});

describe('newsCategoryLabel', () => {
  it('labels only Weekly editions as EU Oversize Weekly', () => {
    expect(newsCategoryLabel('eu-oversize', 'eu-oversize-weekly-2026-w44')).toBe('EU Oversize Weekly');
    expect(newsCategoryLabel('eu-oversize', 'eu-oversize-special-2026-09-02')).toBe('EU Oversize Special Edition');
    expect(newsCategoryLabel('eu-oversize', 'europe-hgv-driving-bans-september-october-2026')).toBe('Driving Bans Reference');
    expect(newsCategoryLabel('platform', 'why-dajc-exists')).toBe('DAJC Platform Updates');
  });
});

describe('compareNewsEntries', () => {
  it('orders newest first and breaks a tie by the later week', () => {
    const entry = (slug: string, iso: string) => ({ data: { slug, publishedAt: new Date(iso) } });
    const sorted = [
      entry('eu-oversize-weekly-2026-w34', '2026-08-29T10:00:00Z'),
      entry('eu-oversize-weekly-2026-w36', '2026-08-29T10:00:00Z'),
      entry('eu-oversize-weekly-2026-w39', '2026-09-18T10:00:00Z'),
    ].sort(compareNewsEntries);
    expect(sorted.map((e) => e.data.slug)).toEqual(['eu-oversize-weekly-2026-w39', 'eu-oversize-weekly-2026-w36', 'eu-oversize-weekly-2026-w34']);
  });
});

describe('buildNewsRss', () => {
  it('lists entries newest first with escaped text and canonical links', () => {
    const rss = buildNewsRss([
      { collection: 'platform', data: { slug: 'why-dajc-exists', title: 'Why DAJC exists', description: 'A & B', publishedAt: new Date('2026-08-18T00:00:00Z') } },
      { collection: 'eu-oversize', data: { slug: 'eu-oversize-weekly-2026-w44', title: 'N307 <15 t>', description: 'Limit', publishedAt: new Date('2026-10-23T10:00:00Z') } },
    ], 'https://www.dajc.eu');
    expect(rss.indexOf('eu-oversize-weekly-2026-w44')).toBeLessThan(rss.indexOf('why-dajc-exists'));
    expect(rss).toContain('<title>N307 &lt;15 t&gt;</title>');
    expect(rss).toContain('<description>A &amp; B</description>');
    expect(rss).toContain('<link>https://www.dajc.eu/news/eu-oversize/eu-oversize-weekly-2026-w44/</link>');
    expect(rss).toContain('<category>EU Oversize Weekly</category>');
  });
});
