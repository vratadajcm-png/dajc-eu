import { describe, expect, it } from 'vitest';
import { ensureOfficialCalendarLeadFloor } from '../lead-floor.mjs';

describe('ensureOfficialCalendarLeadFloor compatibility hook', () => {
  it('never pads the lead section with recurring calendar rules', () => {
    const article = {
      developments: Array.from({ length: 7 }, (_, i) => ({ title: `Lead ${i}`, sourceUrl: `https://x.test/${i}` })),
      europeRoundup: [{ title: 'Roundup', sourceUrl: 'https://x.test/r', recommendedAction: 'Check before dispatch.' }],
    };
    const result = ensureOfficialCalendarLeadFloor(article, []);
    expect(result.article.developments).toHaveLength(7);
    expect(result.added).toBe(0);
    expect(result.promoted).toBe(0);
  });

  it('removes non-actionable roundup noise but preserves actionable items', () => {
    const article = {
      developments: [],
      europeRoundup: [
        { title: 'Weak', sourceUrl: 'https://x.test/weak', recommendedAction: '' },
        { title: 'Useful', sourceUrl: 'https://x.test/useful', recommendedAction: 'Check route conditions before dispatch.' },
      ],
    };
    const result = ensureOfficialCalendarLeadFloor(article, []);
    expect(result.article.europeRoundup.map((x) => x.title)).toEqual(['Useful']);
  });
});
