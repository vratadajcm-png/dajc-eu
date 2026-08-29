import { describe, expect, it } from 'vitest';
import { ensureOfficialCalendarLeadFloor } from '../lead-floor.mjs';

function official(i) {
  return {
    isOfficialCalendar: true,
    country: 'Country',
    title: `Calendar restriction ${i}`,
    summary: `Restriction ${i} applies in the target week.`,
    routeScope: `Route ${i}`,
    vehicleScope: 'HGV > 7.5t',
    timeWindow: 'Sunday 08:00-22:00',
    validFrom: '2026-09-06',
    validTo: '2026-09-06',
    impact: 'Movement prohibited in the window.',
    recommendedAction: 'Plan transit outside the restriction window.',
    exemptions: '',
    isDrivingBan: true,
    sourceUrl: `https://official.example/rule-${i}`,
    sourceName: `Official source ${i}`,
  };
}

describe('ensureOfficialCalendarLeadFloor', () => {
  it('fills a short lead set only from omitted verified official-calendar candidates', () => {
    const verified = Array.from({ length: 11 }, (_, i) => official(i + 1));
    const article = {
      developments: verified.slice(0, 7).map((c) => ({
        ...c,
        whatChanged: c.summary,
        where: c.routeScope,
      })),
      europeRoundup: [{ ...verified[7], whatChanged: verified[7].summary, where: verified[7].routeScope }, {
        country: 'Other',
        title: 'Other useful report',
        sourceUrl: 'https://other.example/report',
        sourceName: 'Other source',
      }],
    };

    const result = ensureOfficialCalendarLeadFloor(article, verified);
    expect(result.article.developments).toHaveLength(10);
    expect(result.added).toBe(3);
    expect(result.article.europeRoundup.length).toBeGreaterThanOrEqual(1);
  });

  it('never pads with non-calendar candidates', () => {
    const article = { developments: [], europeRoundup: [{ title: 'Roundup', sourceUrl: 'https://x.test', sourceName: 'X' }] };
    const verified = Array.from({ length: 20 }, (_, i) => ({
      ...official(i + 1),
      isOfficialCalendar: false,
    }));
    const result = ensureOfficialCalendarLeadFloor(article, verified);
    expect(result.article.developments).toHaveLength(0);
    expect(result.added).toBe(0);
  });

  it('does not consume the final roundup item to force the lead floor', () => {
    const verified = Array.from({ length: 10 }, (_, i) => official(i + 1));
    const article = {
      developments: verified.slice(0, 9).map((c) => ({ ...c, whatChanged: c.summary, where: c.routeScope })),
      europeRoundup: [{ ...verified[9], whatChanged: verified[9].summary, where: verified[9].routeScope }],
    };
    const result = ensureOfficialCalendarLeadFloor(article, verified);
    expect(result.article.developments).toHaveLength(9);
    expect(result.article.europeRoundup).toHaveLength(1);
  });
});
