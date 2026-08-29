import { describe, expect, it } from 'vitest';
import { runQualityGate } from '../quality-gate.mjs';

const weekStart = new Date('2026-08-24T00:00:00Z');
const weekEnd = new Date('2026-08-30T00:00:00Z');

function makeDevelopment(i, overrides = {}) {
  return {
    country: 'Country',
    title: `Verified report ${i}`,
    whatChanged: 'Something changed.',
    where: 'Somewhere',
    validFrom: '2026-08-29',
    validTo: '2026-08-30',
    impact: 'Some impact.',
    recommendedAction: 'A concrete, practical action for the operator.',
    isDrivingBan: i === 0, // ensure at least one driving ban by default
    isInfrastructure: false,
    sourceUrl: `https://example.test/report-${i}`,
    sourceName: `Source ${i}`,
    ...overrides,
  };
}

function makeFrontmatter(developments) {
  return {
    title: 'Test title long enough',
    description: 'Test description long enough',
    slug: 'eu-oversize-weekly-2026-w35',
    category: 'eu-oversize',
    publishedAt: '2026-08-21',
    language: 'en',
    author: 'DAJC',
    status: 'published',
    sources: developments.map((d) => ({ name: d.sourceName, url: d.sourceUrl })),
  };
}

const LONG_BODY = 'x'.repeat(500);
describe('runQualityGate - report count', () => {
  it('blocks a generated edition with an empty Rest-of-Europe roundup', () => {
    const developments = Array.from({ length: 10 }, (_, i) => makeDevelopment(i));
    const result = runQualityGate({ frontmatter: makeFrontmatter(developments), body: LONG_BODY, developments, europeRoundup: [], weekStart, weekEnd });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => /roundup has only 0 report/.test(e))).toBe(true);
  });

  it('blocks a one-country Rest-of-Europe roundup', () => {
    const developments = Array.from({ length: 10 }, (_, i) => makeDevelopment(i));
    const europeRoundup = Array.from({ length: 3 }, (_, i) =>
      makeDevelopment(30 + i, { country: 'Slovenia' })
    );
    const all = [...developments, ...europeRoundup];
    const result = runQualityGate({
      frontmatter: makeFrontmatter(all),
      body: LONG_BODY,
      developments,
      europeRoundup,
      weekStart,
      weekEnd,
    });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => /covers only 1 country/.test(e))).toBe(true);
  });

  it('accepts a Rest-of-Europe roundup with ten reports across six countries', () => {
    const developments = Array.from({ length: 10 }, (_, i) => makeDevelopment(i));
    const countries = ['Spain', 'Romania', 'Denmark', 'Portugal', 'Croatia', 'Switzerland'];
    const europeRoundup = Array.from({ length: 10 }, (_, i) =>
      makeDevelopment(30 + i, { country: countries[i % countries.length] })
    );
    const all = [...developments, ...europeRoundup];
    const result = runQualityGate({
      frontmatter: makeFrontmatter(all),
      body: LONG_BODY,
      developments,
      europeRoundup,
      weekStart,
      weekEnd,
    });
    expect(result.ok).toBe(true);
  });

  it('blocks publication with fewer than 10 reports', () => {
    const developments = Array.from({ length: 9 }, (_, i) => makeDevelopment(i));
    const result = runQualityGate({ frontmatter: makeFrontmatter(developments), body: LONG_BODY, developments, weekStart, weekEnd });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => /only 9 lead report/.test(e))).toBe(true);
  });

  it('allows four strong leads once the target week reaches the post-summer policy date', () => {
    const developments = Array.from({ length: 4 }, (_, i) =>
      makeDevelopment(i, { validFrom: '2026-09-05', validTo: '2026-09-06' })
    );
    const countries = ['Spain', 'Romania', 'Denmark', 'Portugal', 'Croatia', 'Switzerland'];
    const europeRoundup = Array.from({ length: 10 }, (_, i) =>
      makeDevelopment(40 + i, {
        country: countries[i % countries.length],
        validFrom: '2026-09-05',
        validTo: '2026-09-06',
      })
    );
    const all = [...developments, ...europeRoundup];
    const gate = runQualityGate({
      frontmatter: makeFrontmatter(all),
      body: LONG_BODY,
      developments,
      europeRoundup,
      weekStart: new Date('2026-08-31T00:00:00Z'),
      weekEnd: new Date('2026-09-06T00:00:00Z'),
    });
    expect(gate.ok).toBe(true);
  });

  it('blocks publication with more than 12 reports', () => {
    const developments = Array.from({ length: 13 }, (_, i) => makeDevelopment(i));
    const gate = runQualityGate({ frontmatter: makeFrontmatter(developments), body: LONG_BODY, developments, weekStart, weekEnd });
    expect(gate.ok).toBe(false);
    expect(gate.errors.some((e) => /13 reports/.test(e))).toBe(true);
  });

  it('passes with exactly 10 reports (the required W35 count)', () => {
    const developments = Array.from({ length: 10 }, (_, i) => makeDevelopment(i));
    const gate = runQualityGate({ frontmatter: makeFrontmatter(developments), body: LONG_BODY, developments, weekStart, weekEnd });
    expect(gate.ok).toBe(true);
  });

  it('passes at the boundaries: 10 and 12', () => {
    for (const count of [10, 12]) {
      const developments = Array.from({ length: count }, (_, i) => makeDevelopment(i));
      const gate = runQualityGate({ frontmatter: makeFrontmatter(developments), body: LONG_BODY, developments, weekStart, weekEnd });
      expect(gate.ok).toBe(true);
    }
  });
});

describe('runQualityGate - duplicates', () => {
  it('rejects a report duplicated between lead coverage and the Europe roundup', () => {
    const developments = Array.from({ length: 10 }, (_, i) => makeDevelopment(i));
    const europeRoundup = [{ ...makeDevelopment(20), sourceUrl: developments[0].sourceUrl }];
    const all = [...developments, ...europeRoundup];
    const gate = runQualityGate({ frontmatter: makeFrontmatter(all), body: LONG_BODY, developments, europeRoundup, weekStart, weekEnd });
    expect(gate.ok).toBe(false);
    expect(gate.errors.some((e) => /Europe roundup must be disjoint/.test(e))).toBe(true);
  });

  it('rejects a duplicate sourceUrl across two reports', () => {
    const developments = Array.from({ length: 10 }, (_, i) => makeDevelopment(i));
    developments[1] = { ...developments[1], sourceUrl: developments[0].sourceUrl };
    const gate = runQualityGate({ frontmatter: makeFrontmatter(developments), body: LONG_BODY, developments, weekStart, weekEnd });
    expect(gate.ok).toBe(false);
    expect(gate.errors.some((e) => /duplicates a sourceUrl/.test(e))).toBe(true);
  });

  it('rejects a duplicated (normalized) title even with different sources', () => {
    const developments = Array.from({ length: 10 }, (_, i) => makeDevelopment(i));
    developments[1] = { ...developments[1], title: developments[0].title.toUpperCase() + '  ' };
    const gate = runQualityGate({ frontmatter: makeFrontmatter(developments), body: LONG_BODY, developments, weekStart, weekEnd });
    expect(gate.ok).toBe(false);
    expect(gate.errors.some((e) => /duplicates a title/.test(e))).toBe(true);
  });

  // Two genuinely distinct restrictions for the same country/weekend (e.g.
  // Austria's general weekend ban and its additional summer corridor
  // restrictions) must NOT be treated as duplicates just for sharing a
  // country and date range.
  it('allows two distinct reports for the same country and overlapping dates', () => {
    const developments = Array.from({ length: 10 }, (_, i) => makeDevelopment(i, { country: 'Austria' }));
    developments[1] = { ...developments[1], title: 'A completely different Austria report', country: 'Austria' };
    const gate = runQualityGate({ frontmatter: makeFrontmatter(developments), body: LONG_BODY, developments, weekStart, weekEnd });
    expect(gate.ok).toBe(true);
  });
});

describe('runQualityGate - other requirements', () => {
  it('requires at least one driving-ban report', () => {
    const developments = Array.from({ length: 8 }, (_, i) => makeDevelopment(i, { isDrivingBan: false }));
    const gate = runQualityGate({ frontmatter: makeFrontmatter(developments), body: LONG_BODY, developments, weekStart, weekEnd });
    expect(gate.ok).toBe(false);
    expect(gate.errors.some((e) => /no driving-ban/.test(e))).toBe(true);
  });

  it('requires a meaningful recommendedAction for every report', () => {
    const developments = Array.from({ length: 8 }, (_, i) => makeDevelopment(i));
    developments[2] = { ...developments[2], recommendedAction: 'n/a' };
    const gate = runQualityGate({ frontmatter: makeFrontmatter(developments), body: LONG_BODY, developments, weekStart, weekEnd });
    expect(gate.ok).toBe(false);
    expect(gate.errors.some((e) => /no meaningful recommendedAction/.test(e))).toBe(true);
  });

  it('rejects a report whose validTo is before the target week (stale/expired development)', () => {
    const developments = Array.from({ length: 8 }, (_, i) => makeDevelopment(i));
    developments[3] = { ...developments[3], validFrom: '2026-08-21', validTo: '2026-08-23' };
    const gate = runQualityGate({ frontmatter: makeFrontmatter(developments), body: LONG_BODY, developments, weekStart, weekEnd });
    expect(gate.ok).toBe(false);
    expect(gate.errors.some((e) => /already ended/.test(e))).toBe(true);
  });

  it('rejects when frontmatter cites a source no report actually uses', () => {
    const developments = Array.from({ length: 8 }, (_, i) => makeDevelopment(i));
    const frontmatter = makeFrontmatter(developments);
    frontmatter.sources.push({ name: 'Unused source', url: 'https://example.test/unused' });
    const gate = runQualityGate({ frontmatter, body: LONG_BODY, developments, weekStart, weekEnd });
    expect(gate.ok).toBe(false);
    expect(gate.errors.some((e) => /not cited by any report/.test(e))).toBe(true);
  });

  it('rejects publication when a required critical source is omitted', () => {
    const developments = Array.from({ length: 10 }, (_, i) => makeDevelopment(i));
    const gate = runQualityGate({
      frontmatter: makeFrontmatter(developments),
      body: LONG_BODY,
      developments,
      weekStart,
      weekEnd,
      requiredSourceUrls: ['https://example.test/critical-switzerland'],
    });
    expect(gate.ok).toBe(false);
    expect(gate.errors.some((e) => /critical verified development omitted/.test(e))).toBe(true);
  });

  it('rejects zero developments', () => {
    const gate = runQualityGate({ frontmatter: makeFrontmatter([]), body: LONG_BODY, developments: [], weekStart, weekEnd });
    expect(gate.ok).toBe(false);
  });
});
