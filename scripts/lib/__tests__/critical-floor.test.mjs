import { describe, expect, it } from 'vitest';
import {
  criticalWeeklyCandidates,
  ensureCriticalCoverage,
  isCriticalWeeklyCandidate,
} from '../critical-floor.mjs';

const swiss = {
  country: 'Switzerland',
  type: 'driving_ban',
  title: 'Private escort rules for exceptional transports',
  summary: 'Switzerland proposes simplified permits and nationwide private escort rules for Ausnahmetransporte.',
  sourceUrl: 'https://example.test/ch',
  sourceName: 'ASTRA',
  status: 'new',
};

describe('critical weekly coverage', () => {
  it('marks a fresh exceptional-transport regulatory change as critical', () => {
    expect(isCriticalWeeklyCandidate(swiss)).toBe(true);
  });

  it('keeps a same-week item critical after status ages to active', () => {
    const start = new Date('2026-08-24T00:00:00Z');
    const active = {
      ...swiss,
      status: 'active',
      firstSeenAt: '2026-08-26T08:00:00Z',
    };
    expect(isCriticalWeeklyCandidate(active, { discoveryWindowStart: start })).toBe(true);
  });

  it('does not treat routine official-calendar baselines as critical', () => {
    expect(isCriticalWeeklyCandidate({ ...swiss, isOfficialCalendar: true })).toBe(false);
  });

  it('does not force generic infrastructure news', () => {
    expect(isCriticalWeeklyCandidate({
      ...swiss,
      type: 'infrastructure',
      title: 'General bridge project',
      summary: 'A general bridge project opened in 2026.',
    })).toBe(false);
  });

  it('consolidates related critical sources into one report with additional sources', () => {
    const second = {
      ...swiss,
      title: 'Nationwide private exceptional-transport escort consultation',
      sourceUrl: 'https://example.test/ch-2',
    };
    const result = ensureCriticalCoverage(
      { developments: [], europeRoundup: [] },
      [swiss, second]
    );
    expect(result.critical).toHaveLength(2);
    expect(result.article.developments).toHaveLength(1);
    expect(result.article.developments[0].additionalSources.map((x) => x.url)).toContain(second.sourceUrl);
  });

  it('inserts an omitted critical item into the article', () => {
    const result = ensureCriticalCoverage(
      { developments: [], europeRoundup: [] },
      [swiss]
    );
    expect(result.article.developments).toHaveLength(1);
    expect(result.article.developments[0].sourceUrl).toBe(swiss.sourceUrl);
    expect(criticalWeeklyCandidates([swiss])).toHaveLength(1);
  });
});
