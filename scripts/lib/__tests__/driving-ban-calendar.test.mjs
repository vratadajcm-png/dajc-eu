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
    expect(findings).toHaveLength(14);
    const countries = findings.map((f) => f.country).sort();
    expect(countries).toEqual(
      ['Austria', 'Austria', 'Czechia', 'Czechia', 'France', 'France', 'Germany', 'Hungary', 'Italy', 'Poland', 'Slovakia', 'Slovenia', 'Slovenia', 'Switzerland'].sort()
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
    expect(new Set(flaggedCountries)).toEqual(new Set(['DE', 'PL', 'IT', 'SI', 'AT']));
  });

  it('still resolves standing-rule entries for a far-future year', () => {
    const countries = findings.map((f) => f.country);
    expect(countries).toContain('Czechia');
    expect(countries).toContain('Slovakia');
    expect(countries).toContain('France');
    expect(countries).toContain('Slovenia');
    expect(countries).toContain('Switzerland');
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

  it('has enough independently sourced calendar restrictions for a useful weekly brief', () => {
    expect(maintenanceErrors).toEqual([]);
    expect(findings).toHaveLength(11);
  });

  it('carries the post-1-September Slovak Sunday window from the effective Slov-Lex version', () => {
    const slovakia = findings.find((f) => f.country === 'Slovakia');
    expect(slovakia).toBeTruthy();
    expect(slovakia.timeWindow).toContain('06:00-22:00');
    expect(slovakia.sourceUrl).toContain('20260901');
  });

  it('includes the Italian 6 September restriction from Decree 325/2025', () => {
    const italy = findings.find((f) => f.country === 'Italy');
    expect(italy).toBeTruthy();
    expect(italy.validFrom).toBe('2026-09-06');
    expect(italy.timeWindow).toContain('07:00-22:00');
  });

  it('keeps Czech general-HGV and special-vehicle regimes distinct', () => {
    const czech = findings.filter((f) => f.country === 'Czechia');
    expect(czech).toHaveLength(2);
    expect(new Set(czech.map((f) => f.sourceUrl)).size).toBe(2);
    expect(czech.some((f) => /special vehicles/i.test(f.title))).toBe(true);
  });

  it('includes both the Slovenian Sunday rule and the last tourist-season Saturday restriction', () => {
    const slovenia = findings.filter((f) => f.country === 'Slovenia');
    expect(slovenia).toHaveLength(2);
    expect(slovenia.some((f) => f.timeWindow.includes('08:00-22:00'))).toBe(true);
    expect(slovenia.some((f) => f.timeWindow.includes('06:00-16:00'))).toBe(true);
  });

  it('keeps the French general HGV ban distinct from the exceptional-transport regime', () => {
    const france = findings.filter((f) => f.country === 'France');
    expect(france).toHaveLength(2);
    expect(new Set(france.map((f) => f.sourceUrl)).size).toBe(2);
  });
});
