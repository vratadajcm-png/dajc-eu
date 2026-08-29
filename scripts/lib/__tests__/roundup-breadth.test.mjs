import { describe, expect, it } from 'vitest';
import {
  mergeRoundupSupplement,
  roundupNeedsSupplement,
} from '../roundup-breadth.mjs';

function item(country, n) {
  return {
    country,
    title: `Report ${n}`,
    sourceUrl: `https://example.test/${n}`,
  };
}

describe('roundup breadth', () => {
  it('requires both three reports and three countries', () => {
    expect(roundupNeedsSupplement([item('Spain', 1), item('Romania', 2)]).needsSupplement).toBe(true);
    expect(roundupNeedsSupplement([item('Spain', 1), item('Spain', 2), item('Spain', 3)]).needsSupplement).toBe(true);
    expect(roundupNeedsSupplement([item('Spain', 1), item('Romania', 2), item('Denmark', 3)]).needsSupplement).toBe(false);
  });

  it('adds only unused items that increase country breadth', () => {
    const existing = [item('Spain', 1), item('Romania', 2)];
    const supplement = [
      item('Spain', 3),
      item('Denmark', 4),
      item('Portugal', 5),
    ];
    const merged = mergeRoundupSupplement(existing, supplement, new Set());
    expect(merged).toHaveLength(3);
    expect(merged.map((x) => x.country)).toEqual(['Spain', 'Romania', 'Denmark']);
  });

  it('does not reuse a source already used by a lead report', () => {
    const existing = [item('Spain', 1), item('Romania', 2)];
    const blocked = item('Denmark', 4);
    const supplement = [blocked, item('Portugal', 5)];
    const merged = mergeRoundupSupplement(existing, supplement, new Set([blocked.sourceUrl]));
    expect(merged.map((x) => x.country)).toEqual(['Spain', 'Romania', 'Portugal']);
  });
});
