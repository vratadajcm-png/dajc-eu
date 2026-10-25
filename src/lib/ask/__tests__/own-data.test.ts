import { describe, expect, it } from 'vitest';
import { canonicalDrivingBans } from '../../../../config/driving-ban-calendars/canonical.mjs';
import { datesToCheck, findingLeads, formatWeight, lookupDrivingBans, type CanonicalLike } from '../own-data';
import { isAllowedSourceUrl } from '../official-sources';
import { FIXTURE_CANONICAL, NOW, SUNDAY } from './helpers';

describe('own verified data (fixture)', () => {
  it('uses verified events inside the reviewed window', () => {
    const result = lookupDrivingBans({ jurisdictions: ['CZ', 'AT', 'DE'], dates: [SUNDAY] }, { data: FIXTURE_CANONICAL, now: NOW });
    expect(result.coverage).toEqual({ CZ: 'complete', AT: 'partial', DE: 'missing' });
    expect(result.records.map((r) => r.jurisdiction)).toEqual(['CZ', 'AT']);
  });

  it('never turns missing events into "no ban"', () => {
    const result = lookupDrivingBans({ jurisdictions: ['CZ'], dates: ['2026-11-03'] }, { data: FIXTURE_CANONICAL, now: NOW });
    expect(result.records).toHaveLength(0);
    expect(result.coverage.CZ).toBe('missing');
  });

  it('marks dates after the window (e.g. after 30 November 2026) as stale and offers only official leads', () => {
    const result = lookupDrivingBans({ jurisdictions: ['AT'], dates: ['2026-12-06'] }, { data: FIXTURE_CANONICAL, now: NOW });
    expect(result.coverage.AT).toBe('stale');
    expect(result.records).toHaveLength(0);
    expect(result.leads).toEqual(['https://www.ris.bka.gv.at/stvo-42']);
  });

  it('checks the next seven days when the question names no date', () => {
    expect(datesToCheck([], NOW)).toEqual(['2026-10-25', '2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31']);
  });

  it('formats weight conditions for the template', () => {
    expect(formatWeight({ any_of: [{ operator: '>', value: 7500, unit: 'kg', applies_to: 'lorry' }, { operator: 'any', applies_to: 'tractors' }] }))
      .toBe('> 7.5 t (lorry); or any mass (tractors)');
  });

  it('uses only official-tier Weekly findings as leads', () => {
    const findings = [
      { jurisdiction: 'PL', type: 'road_closure', sourceUrl: 'https://www.gov.pl/web/gddkia/closure', sourceTier: 'official', publishedAt: '2026-10-20' },
      { jurisdiction: 'PL', type: 'road_closure', sourceUrl: 'https://news.example.com/closure', sourceTier: 'industry', publishedAt: '2026-10-21' },
      { jurisdiction: 'DE', type: 'road_closure', sourceUrl: 'https://www.autobahn.de/x', sourceTier: 'official', publishedAt: '2026-10-22' },
    ];
    expect(findingLeads({ jurisdictions: ['PL'], topic: 'road_restriction' }, { findings })).toEqual(['https://www.gov.pl/web/gddkia/closure']);
  });
});

describe('own verified data (real dataset, invariants only)', () => {
  // Only invariants: the weekly data updates must never break these tests.
  const data = canonicalDrivingBans as unknown as CanonicalLike;
  const codes = data.jurisdictions.map((j) => j.jurisdiction);
  const insideDay = data.window.from;

  it('reports "complete" only for PRIMARY_VERIFIED jurisdictions with full coverage', () => {
    const result = lookupDrivingBans({ jurisdictions: codes, dates: [insideDay] }, { data, now: NOW });
    for (const [code, coverage] of Object.entries(result.coverage)) {
      const row = data.jurisdictions.find((j) => j.jurisdiction === code)!;
      if (coverage === 'complete') expect(row.verification_state === 'PRIMARY_VERIFIED' && row.coverage_complete).toBe(true);
    }
    for (const record of result.records) expect(record.text).toMatch(/^DAJC verified driving-ban record/);
  });

  it('treats any day after the window as stale', () => {
    const after = new Date(Date.parse(`${data.window.to}T00:00:00Z`) + 2 * 86_400_000).toISOString().slice(0, 10);
    const result = lookupDrivingBans({ jurisdictions: codes, dates: [after] }, { data, now: NOW });
    expect(new Set(Object.values(result.coverage))).toEqual(new Set(['stale']));
    expect(result.leads.every(isAllowedSourceUrl)).toBe(true);
  });
});
