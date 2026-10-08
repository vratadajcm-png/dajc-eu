import { describe, expect, it } from 'vitest';
import { filterGeneratedItems } from '../generated-item-filter.mjs';

const weekStart = new Date('2026-09-07T00:00:00Z');
const weekEnd = new Date('2026-09-13T00:00:00Z');

function item(overrides = {}) {
  return {
    country: 'Switzerland',
    title: 'Exceptional transport permit update',
    whatChanged: 'A verified exceptional transport road permit rule changed.',
    where: 'Road network',
    recommendedAction: 'Check the new permit procedure before dispatch.',
    validFrom: '',
    validTo: '',
    sourceUrl: 'https://example.test/1',
    sourceName: 'Road authority',
    ...overrides,
  };
}

describe('filterGeneratedItems', () => {
  it('keeps a valid transport item', () => {
    expect(filterGeneratedItems([item()], { weekStart, weekEnd }).kept).toHaveLength(1);
  });

  it('drops AI-invented malformed dates', () => {
    const result = filterGeneratedItems([item({ validFrom: '2026' })], { weekStart, weekEnd });
    expect(result.kept).toHaveLength(0);
    expect(result.dropped[0].reason).toMatch(/invalid validFrom/);
  });

  it('drops developments starting beyond the one-month outlook', () => {
    const result = filterGeneratedItems([item({ validFrom: '2026-11-16' })], { weekStart, weekEnd });
    expect(result.kept).toHaveLength(0);
    expect(result.dropped[0].reason).toMatch(/beyond the outlook/);
  });

  it('keeps a change taking effect within the one-month outlook', () => {
    expect(filterGeneratedItems([item({ validFrom: '2026-10-01' })], { weekStart, weekEnd }).kept).toHaveLength(1);
  });

  it('drops short closures', () => {
    const result = filterGeneratedItems([item({
      title: 'Motorway full closure',
      whatChanged: 'The motorway is fully closed to traffic for two days.',
      validFrom: '2026-09-08',
      validTo: '2026-09-10',
    })], { weekStart, weekEnd });
    expect(result.kept).toHaveLength(0);
    expect(result.dropped[0].reason).toMatch(/only 2 days/);
  });

  it('drops duplicate source URLs already consumed by another section', () => {
    const result = filterGeneratedItems([item()], {
      weekStart,
      weekEnd,
      usedSourceUrls: new Set(['https://example.test/1']),
    });
    expect(result.kept).toHaveLength(0);
    expect(result.dropped[0].reason).toBe('duplicate sourceUrl');
  });

  it('re-applies the full eligibility rules to the verified record behind an item', () => {
    const now = new Date('2026-09-04T10:00:00Z');
    const candidatesByUrl = new Map([
      ['https://example.test/1', {
        country: 'Switzerland',
        title: 'Vereinfachte Bewilligung von Ausnahmetransporten',
        summary: 'Ab dem 1. Juli 2026 werden Bewilligungen für Ausnahmetransporte vereinfacht erteilt.',
        sourceUrl: 'https://example.test/1',
        sourceName: 'ASTRA',
        publishedAt: '2026-05-06',
      }],
    ]);
    const result = filterGeneratedItems([item()], {
      weekStart,
      weekEnd,
      candidatesByUrl,
      eligibilityContext: { now, weekStart, weekEnd, previousEditions: new Map() },
    });
    expect(result.kept).toHaveLength(0);
    expect(result.dropped[0].reason).toMatch(/older than the 7-day freshness window/);
  });

  it('drops an item whose source is not a verified candidate', () => {
    const result = filterGeneratedItems([item({ sourceUrl: 'https://example.test/invented' })], {
      weekStart,
      weekEnd,
      candidatesByUrl: new Map(),
      eligibilityContext: { now: new Date('2026-09-04T10:00:00Z'), weekStart, weekEnd },
    });
    expect(result.kept).toHaveLength(0);
    expect(result.dropped[0].reason).toBe('sourceUrl is not a verified candidate');
  });
});
