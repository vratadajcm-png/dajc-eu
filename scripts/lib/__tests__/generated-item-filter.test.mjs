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

  it('drops future-only developments', () => {
    const result = filterGeneratedItems([item({ validFrom: '2026-11-16' })], { weekStart, weekEnd });
    expect(result.kept).toHaveLength(0);
    expect(result.dropped[0].reason).toMatch(/had not started yet/);
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
});
