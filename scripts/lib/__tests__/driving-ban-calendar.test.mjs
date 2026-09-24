import { describe, expect, it } from 'vitest';
import { resolveDrivingBanFindings } from '../driving-ban-calendar.mjs';
import * as calendarRuntime from '../../../config/driving-ban-calendars/runtime.mjs';

// W35 2026: Monday 24 August - Sunday 30 August.
const w35Start = new Date('2026-08-24T00:00:00Z');
const w35End = new Date('2026-08-30T00:00:00Z');

describe('resolveDrivingBanFindings - W35 2026', () => {
  const { findings, maintenanceErrors } = resolveDrivingBanFindings({ weekStart: w35Start, weekEnd: w35End, year: 2026 });

  it('has no maintenance errors for the seeded 2026 calendars', () => {
    expect(maintenanceErrors).toEqual([]);
  });

  it('produces the authoritative W35 restrictions without depending on news volume', () => {
    expect(findings).toHaveLength(16);
    const countries = findings.map((f) => f.country).sort();
    expect(countries).toEqual(
      ['Austria', 'Austria', 'Czechia', 'Czechia', 'France', 'France', 'Germany', 'Hungary', 'Italy', 'Liechtenstein', 'Luxembourg', 'Poland', 'Slovakia', 'Slovenia', 'Slovenia', 'Switzerland'].sort()
    );
  });

  it('marks every resolved finding as a verified driving ban with a direct source URL', () => {
    for (const finding of findings) {
      expect(finding.isDrivingBan).toBe(true);
      expect(finding.type).toBe('driving_ban');
      expect(finding.confidence).toBe('verified');
      expect(finding.sourceUrl).toMatch(/^https:\/\//);
    }
  });

  it('every finding overlaps the target week (no stale or future-only dates)', () => {
    for (const finding of findings) {
      if (finding.validTo) expect(new Date(finding.validTo) >= w35Start).toBe(true);
      if (finding.validFrom) expect(new Date(finding.validFrom) <= w35End).toBe(true);
    }
  });

  it("does not describe Germany's Saturday ban as a nationwide all-roads ban", () => {
    const germany = findings.find((f) => f.country === 'Germany');
    expect(germany.routeScope.toLowerCase()).toContain('officially balm-listed');
  });

  it('keeps the two Austria reports distinct (general ban vs. summer corridor restrictions)', () => {
    const austriaReports = findings.filter((f) => f.country === 'Austria');
    expect(austriaReports).toHaveLength(2);
    expect(austriaReports[0].title).not.toBe(austriaReports[1].title);
    expect(new Set(austriaReports.map((f) => f.sourceUrl)).size).toBe(2);
  });
});

describe('resolveDrivingBanFindings - annual-calendar maintenance', () => {
  // A year with no seeded annual calendar (e.g. Italy's decree, which is
  // explicitly year-scoped) must fail loudly, not silently reuse 2026's dates.
  const farFutureStart = new Date('2031-08-25T00:00:00Z'); // a Monday
  const farFutureEnd = new Date('2031-08-31T00:00:00Z');
  const { findings, maintenanceErrors } = resolveDrivingBanFindings({
    weekStart: farFutureStart,
    weekEnd: farFutureEnd,
    year: 2031,
  });

  it('reports a maintenance error for every year-scoped annual calendar', () => {
    const flaggedCountries = maintenanceErrors.map((m) => m.match(/^\[([A-Z]+)\//)[1]);
    // Annual calendars plus the year-scoped public-holiday dates.
    expect(new Set(flaggedCountries)).toEqual(new Set(['DE', 'PL', 'IT', 'SI', 'AT', 'CZ', 'CH', 'FR', 'HU', 'SK']));
  });

  it("keeps Germany's standing Sunday ban outside the summer-Saturday season of an unseeded year", () => {
    const { getCalendarById } = calendarRuntime;
    const germany = getCalendarById('de-summer-weekend-ban');
    const resolved = germany.resolve(new Date('2031-01-06T00:00:00Z'), new Date('2031-01-12T00:00:00Z'), 2031);
    expect(resolved.maintenanceError).toBeUndefined();
    expect(resolved.occurrences[0].validFrom).toBe('2031-01-12');
  });

  it('keeps non-evergreen special/seasonal standing rules while suppressing evergreen Sunday baselines', () => {
    const countries = findings.map((f) => f.country);
    expect(countries).toContain('Czechia'); // special-vehicle seasonal rule
    expect(countries).toContain('France');  // exceptional-transport weekend rule
    expect(countries).toContain('Hungary'); // summer restriction
    expect(countries).not.toContain('Slovakia');
    expect(countries).not.toContain('Slovenia');
    expect(countries).not.toContain('Switzerland');
  });
});


describe('resolveDrivingBanFindings - W36 2026', () => {
  const weekStart = new Date('2026-08-31T00:00:00Z');
  const weekEnd = new Date('2026-09-06T00:00:00Z');
  const { findings, maintenanceErrors } = resolveDrivingBanFindings({
    weekStart,
    weekEnd,
    year: 2026,
  });

  it('suppresses evergreen Sunday/weekend baselines after 1 September', () => {
    expect(maintenanceErrors).toEqual([]);
    const countries = findings.map((f) => f.country);
    // Real, dated exceptions may appear for Germany; only the evergreen
    // Sunday baseline is excluded by the editorial policy.
    expect(findings.some((f) => f.country === 'Germany' && /General Sunday driving ban/i.test(f.title))).toBe(false);
    expect(findings.some((f) => f.country === 'Germany' && /Low-water exception/i.test(f.title))).toBe(true);
    expect(countries).not.toContain('Slovakia');
    expect(countries).not.toContain('Austria');
    expect(countries).not.toContain('Switzerland');
  });

  it('keeps seasonal and exceptional-transport restrictions but drops routine Sunday-only calendar entries', () => {
    expect(findings.some((f) => f.country === 'Czechia' && /special vehicles/i.test(f.title))).toBe(true);
    expect(findings.some((f) => f.country === 'France' && /exceptional-transport/i.test(f.title))).toBe(true);
    expect(findings.some((f) => f.country === 'Italy')).toBe(false);
    expect(findings.some((f) => f.country === 'Slovenia' && f.timeWindow.includes('06:00-16:00'))).toBe(true);
  });

  it('does not repeat standard Czech, French or Slovenian evergreen weekend rules', () => {
    expect(findings.some((f) => /Standard Sunday driving ban/i.test(f.title))).toBe(false);
    expect(findings.some((f) => /General HGV weekend driving ban/i.test(f.title))).toBe(false);
    expect(findings.some((f) => /Sunday HGV driving restriction/i.test(f.title))).toBe(false);
  });
});


describe('driving-ban registry - public holidays and full 2026 calendars', () => {
  const { getCalendarById, restrictionTypesOf } = calendarRuntime;
  const resolveWeek = (id, monday) => {
    const weekStart = new Date(`${monday}T00:00:00Z`);
    const weekEnd = new Date(weekStart.getTime() + 6 * 86_400_000);
    return getCalendarById(id).resolve(weekStart, weekEnd, 2026);
  };

  it.each([
    ['de-public-holiday-ban-2026', '2026-09-28', '2026-10-03', 'Saturday 3 October 2026 00:00-22:00'],
    ['cz-public-holiday-ban-2026', '2026-09-28', '2026-09-28', 'Monday 28 September 2026 13:00-22:00'],
    ['at-public-holiday-ban-2026', '2026-10-26', '2026-10-26', 'Monday 26 October 2026 00:00-22:00'],
    ['hu-public-holiday-ban-2026', '2026-10-19', '2026-10-22', 'Thursday 22 October 2026 22:00'],
    ['si-public-holiday-ban-2026', '2026-10-26', '2026-10-31', 'Saturday 31 October 2026 08:00-22:00'],
    ['fr-general-hgv-public-holiday-ban-2026', '2026-11-09', '2026-11-10', 'Tuesday 10 November 2026 22:00'],
    ['sk-public-holiday-ban-2026', '2026-12-21', '2026-12-24', 'each day 06:00-22:00'],
  ])('%s resolves the holiday in the week of %s', (id, monday, validFrom, windowText) => {
    const { occurrences, maintenanceError } = resolveWeek(id, monday);
    expect(maintenanceError).toBeUndefined();
    expect(occurrences).toHaveLength(1);
    expect(occurrences[0].validFrom).toBe(validFrom);
    expect(occurrences[0].timeWindow).toContain(windowText);
  });

  it('lists a holiday only in the week in which it starts', () => {
    expect(resolveWeek('fr-exceptional-transport-public-holiday-ban-2026', '2026-11-09').occurrences).toHaveLength(1);
    expect(resolveWeek('fr-exceptional-transport-public-holiday-ban-2026', '2026-11-16').occurrences).toHaveLength(0);
  });

  it('returns every Italian decree day in a week, not just the first', () => {
    const december = resolveWeek('it-md-325-2025-calendar', '2026-12-21').occurrences.map((o) => o.validFrom);
    expect(december).toEqual(['2026-12-25', '2026-12-26', '2026-12-27']);
    const october = resolveWeek('it-md-325-2025-calendar', '2026-10-12').occurrences;
    expect(october.map((o) => o.timeWindow)).toEqual(['Sunday 18 October 2026 09:00-22:00']);
  });

  it('applies the Hungarian winter weekend rule outside July-August only', () => {
    expect(resolveWeek('hu-weekend-ban-outside-summer', '2026-09-21').occurrences[0].timeWindow)
      .toBe('Saturday 26 September 2026 22:00 to Sunday 27 September 2026 22:00');
    expect(resolveWeek('hu-weekend-ban-outside-summer', '2026-08-10').occurrences).toHaveLength(0);
  });

  it("lists Italy's decree under both general and exceptional restriction types", () => {
    expect(restrictionTypesOf(getCalendarById('it-md-325-2025-calendar'))).toEqual(['general', 'exceptional']);
    expect(restrictionTypesOf(getCalendarById('de-summer-weekend-ban'))).toEqual(['general']);
    expect(restrictionTypesOf(getCalendarById('fr-exceptional-transport-weekend-ban'))).toEqual(['exceptional']);
  });
});

describe('Slovakia - Section 39 as amended from 1 September 2026', () => {
  const rule = calendarRuntime.getCalendarById('sk-section-39-weekend-ban');
  const week = (monday) => {
    const start = new Date(`${monday}T00:00:00Z`);
    return rule.resolve(start, new Date(start.getTime() + 6 * 86_400_000), start.getUTCFullYear()).occurrences[0];
  };

  it('uses the amended 09:00 Saturday / 06:00 Sunday start in summer 2027', () => {
    expect(week('2027-07-05').timeWindow).toBe('Saturday 10 July 2027 09:00-19:00; Sunday 11 July 2027 06:00-22:00');
  });

  it('keeps the pre-amendment windows for summer 2026', () => {
    expect(week('2026-08-24').timeWindow).toBe('Saturday 29 August 2026 07:00-19:00; Sunday 30 August 2026 00:00-22:00');
  });
});
