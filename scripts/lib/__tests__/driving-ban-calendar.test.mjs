import { describe, expect, it } from 'vitest';
import { resolveDrivingBanFindings } from '../driving-ban-calendar.mjs';

// W35 2026: Monday 24 August - Sunday 30 August.
const w35Start = new Date('2026-08-24T00:00:00Z');
const w35End = new Date('2026-08-30T00:00:00Z');

describe('resolveDrivingBanFindings - W35 2026', () => {
  const { findings, maintenanceErrors } = resolveDrivingBanFindings({ weekStart: w35Start, weekEnd: w35End, year: 2026 });

  it('has no maintenance errors for the seeded 2026 calendars', () => {
    expect(maintenanceErrors).toEqual([]);
  });

  it('produces the authoritative W35 restrictions without depending on news volume', () => {
    expect(findings).toHaveLength(18);
    const countries = findings.map((f) => f.country).sort();
    expect(countries).toEqual(
      [
        'Austria', 'Austria', 'Austria', 'Croatia', 'Czechia', 'Czechia', 'France', 'France', 'Germany',
        'Hungary', 'Italy', 'Italy', 'Poland', 'Slovakia', 'Slovenia', 'Slovenia', 'Spain', 'Switzerland',
      ].sort()
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

  it('keeps the three Austria reports distinct (general ban, summer corridors, night ban)', () => {
    const austriaReports = findings.filter((f) => f.country === 'Austria');
    expect(austriaReports).toHaveLength(3);
    expect(new Set(austriaReports.map((f) => f.title)).size).toBe(3);
    expect(new Set(austriaReports.map((f) => f.sourceUrl)).size).toBe(3);
  });

  // The weekly quality gate rejects an article in which two reports share a
  // sourceUrl (scripts/lib/quality-gate.mjs), so two calendar entries that
  // resolve in the same week must never cite the same page - even when the
  // same authority publishes both rules.
  it('gives every resolved finding its own sourceUrl', () => {
    const urls = findings.map((f) => f.sourceUrl);
    expect(new Set(urls).size).toBe(urls.length);
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
    expect(new Set(flaggedCountries)).toEqual(new Set(['DE', 'PL', 'IT', 'SI', 'AT', 'ES']));
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
    expect(countries).not.toContain('Germany');
    expect(countries).not.toContain('Slovakia');
    expect(countries).not.toContain('Austria');
    expect(countries).not.toContain('Switzerland');
  });

  it('keeps seasonal and exceptional-transport restrictions but drops routine Sunday-only calendar entries', () => {
    expect(findings.some((f) => f.country === 'Czechia' && /special vehicles/i.test(f.title))).toBe(true);
    expect(findings.some((f) => f.country === 'France' && /exceptional-transport/i.test(f.title))).toBe(true);
    // The ordinary Italian calendar stays out of W36; the separate ADR
    // class 1/7 restriction is seasonal and ends that weekend, so it stays.
    expect(findings.some((f) => f.country === 'Italy' && !/ADR/i.test(f.title))).toBe(false);
    expect(findings.some((f) => f.country === 'Italy' && /ADR class 1 and class 7/i.test(f.title))).toBe(true);
    expect(findings.some((f) => f.country === 'Slovenia' && f.timeWindow.includes('06:00-16:00'))).toBe(true);
  });

  it('does not repeat standard Czech, French or Slovenian evergreen weekend rules', () => {
    expect(findings.some((f) => /Standard Sunday driving ban/i.test(f.title))).toBe(false);
    expect(findings.some((f) => /General HGV weekend driving ban/i.test(f.title))).toBe(false);
    expect(findings.some((f) => /Sunday HGV driving restriction/i.test(f.title))).toBe(false);
  });
});
