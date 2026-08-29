import { describe, expect, it } from 'vitest';
import {
  mergeRoundupSupplement,
  roundupNeedsSupplement,
  sanitizeRoundup,
} from '../roundup-breadth.mjs';

function item(country, n) {
  return {
    country,
    title: `Report ${n}`,
    sourceUrl: `https://example.test/${n}`,
  };
}

describe('roundup breadth', () => {
  it('requires at least ten reports and six countries', () => {
    expect(roundupNeedsSupplement([item('Spain', 1), item('Romania', 2)]).needsSupplement).toBe(true);

    const tenFromFive = Array.from({ length: 10 }, (_, i) =>
      item(['Spain', 'Romania', 'Denmark', 'Portugal', 'Croatia'][i % 5], i + 1)
    );
    expect(roundupNeedsSupplement(tenFromFive).needsSupplement).toBe(true);

    const tenFromSix = Array.from({ length: 10 }, (_, i) =>
      item(['Spain', 'Romania', 'Denmark', 'Portugal', 'Croatia', 'Switzerland'][i % 6], i + 20)
    );
    const result = roundupNeedsSupplement(tenFromSix);
    expect(result.needsSupplement).toBe(false);
    expect(result.reportCount).toBe(10);
    expect(result.countryCount).toBe(6);
  });

  it('fills country breadth first, then report depth to ten', () => {
    const existing = [item('Spain', 1), item('Romania', 2)];
    const supplement = [
      item('Spain', 3),
      item('Denmark', 4),
      item('Portugal', 5),
      item('Croatia', 6),
      item('Switzerland', 7),
      item('Spain', 8),
      item('Romania', 9),
      item('Denmark', 10),
      item('Portugal', 11),
      item('Croatia', 12),
      item('Switzerland', 13),
    ];
    const merged = mergeRoundupSupplement(existing, supplement, new Set());
    expect(merged).toHaveLength(10);
    expect(new Set(merged.map((x) => x.country)).size).toBeGreaterThanOrEqual(6);
  });

  it('removes roundup items whose source is already used by a lead', () => {
    const lead = [{ ...item('Slovenia', 1), isDrivingBan: true }];
    const roundup = [
      { ...item('Slovenia', 1), isDrivingBan: true, title: 'Routine Sunday HGV ban reminder' },
      item('Spain', 2),
    ];
    const cleaned = sanitizeRoundup(roundup, lead, { suppressEvergreenSunday: true });
    expect(cleaned.map((x) => x.country)).toEqual(['Spain']);
  });

  it('removes routine evergreen Sunday reminders after the policy date', () => {
    const roundup = [
      { ...item('Austria', 1), isDrivingBan: true, title: 'Standard Sunday HGV driving ban' },
      { ...item('France', 2), isDrivingBan: true, title: 'Exceptional transport weekend movement ban' },
    ];
    const cleaned = sanitizeRoundup(roundup, [], { suppressEvergreenSunday: true });
    expect(cleaned.map((x) => x.country)).toEqual(['France']);
  });

  it('does not reuse a source already used by a lead report', () => {
    const existing = [item('Spain', 1), item('Romania', 2)];
    const blocked = item('Denmark', 4);
    const supplement = [blocked, item('Portugal', 5)];
    const merged = mergeRoundupSupplement(existing, supplement, new Set([blocked.sourceUrl]));
    expect(merged.some((x) => x.sourceUrl === blocked.sourceUrl)).toBe(false);
    expect(merged.map((x) => x.country)).toContain('Portugal');
  });
});
