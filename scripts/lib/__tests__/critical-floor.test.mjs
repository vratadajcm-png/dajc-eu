import { describe, expect, it } from 'vitest';
import {
  attachCriticalGroupSources,
  criticalWeeklyGroups,
  isCriticalWeeklyCandidate,
  missingCriticalGroups,
} from '../critical-floor.mjs';

const now = new Date('2026-10-01T10:00:00Z');
const ctx = { now, weekStart: new Date('2026-10-05T00:00:00Z'), weekEnd: new Date('2026-10-11T00:00:00Z') };

const swiss = {
  country: 'Switzerland',
  type: 'escort_requirement',
  title: 'Bundesrat will schweizweite Vorgaben für private Ausnahmetransportbegleitungen',
  summary: 'Switzerland proposes nationwide private escort rules for Ausnahmetransporte; consultation open until 20 November 2026.',
  sourceUrl: 'https://www.astra.admin.ch/de/newnsb/escort',
  sourceName: 'ASTRA',
  publishedAt: '2026-09-29',
  status: 'active',
};

describe('critical weekly coverage', () => {
  it('marks a recently published exceptional-transport regulatory change as critical', () => {
    expect(isCriticalWeeklyCandidate(swiss, ctx)).toBe(true);
  });

  // Regression (W41): the ASTRA announcement of 6 May 2026 was flagged as
  // critical news in October because the crawler first saw it this week.
  it('never treats an old announcement as critical just because it was discovered this week', () => {
    const discoveredNowPublishedInMay = {
      ...swiss,
      title: 'Vereinfachte Bewilligung von Ausnahmetransporten und Anpassungen bei Fahrverboten',
      type: 'driving_ban',
      status: 'new',
      firstSeenAt: '2026-09-28T06:00:00Z',
      publishedAt: '2026-05-06',
    };
    expect(isCriticalWeeklyCandidate(discoveredNowPublishedInMay, ctx)).toBe(false);
  });

  it('never treats an undated page as critical', () => {
    expect(isCriticalWeeklyCandidate({ ...swiss, publishedAt: null, status: 'new' }, ctx)).toBe(false);
  });

  it('does not force generic infrastructure news', () => {
    expect(isCriticalWeeklyCandidate({
      ...swiss,
      type: 'infrastructure',
      title: 'General bridge project',
      summary: 'A general bridge project opened in 2026.',
    }, ctx)).toBe(false);
  });

  it('groups several official pages about one development', () => {
    const second = { ...swiss, title: 'Vorlage UVEK-Verordnung zur Ausnahmetransportbegleitung', sourceUrl: 'https://www.astra.admin.ch/de/atbv.pdf' };
    const groups = criticalWeeklyGroups([swiss, second], ctx);
    expect(groups).toHaveLength(1);
    expect(groups[0].candidates.map((c) => c.sourceUrl)).toEqual([swiss.sourceUrl, second.sourceUrl]);
  });

  it('reports a critical group as missing until one of its pages is cited', () => {
    const groups = criticalWeeklyGroups([swiss], ctx);
    expect(missingCriticalGroups({ developments: [], europeRoundup: [] }, groups)).toHaveLength(1);
    expect(missingCriticalGroups({ developments: [{ sourceUrl: swiss.sourceUrl }], europeRoundup: [] }, groups)).toHaveLength(0);
  });

  it('never writes report text itself (no raw-candidate injection)', () => {
    const groups = criticalWeeklyGroups([swiss], ctx);
    const article = attachCriticalGroupSources({ developments: [], europeRoundup: [] }, groups);
    expect(article.developments).toEqual([]);
    expect(article.europeRoundup).toEqual([]);
  });

  it('attaches sibling pages as "Also see" only when they are not already a report of their own', () => {
    const second = { ...swiss, title: 'ATBV draft ordinance on exceptional transport escorts', sourceUrl: 'https://www.astra.admin.ch/de/atbv.pdf' };
    const third = { ...swiss, title: 'Private exceptional transport escort topic page with details', sourceUrl: 'https://www.astra.admin.ch/de/private' };
    const groups = criticalWeeklyGroups([swiss, second, third], ctx);
    const article = attachCriticalGroupSources({
      developments: [
        { title: 'Escort rules', sourceUrl: swiss.sourceUrl },
        { title: 'Separate report', sourceUrl: third.sourceUrl },
      ],
      europeRoundup: [],
    }, groups);
    expect(article.developments[0].additionalSources.map((x) => x.url)).toEqual([second.sourceUrl]);
    expect(article.developments[1].additionalSources || []).toEqual([]);
  });
});
