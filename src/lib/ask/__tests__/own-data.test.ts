import { describe, expect, it } from 'vitest';
import { getDrivingBansSnapshot } from '../../../../config/driving-ban-calendars/runtime.mjs';
import { datesToCheck, findingLeads, formatWeight, lookupDrivingBans, NO_CONFIRMED_BAN_FINDING, type DrivingBansView } from '../own-data';
import { isAllowedSourceUrl } from '../official-sources';
import { fixtureView, NOW, SUNDAY } from './helpers';

const view = fixtureView();

describe('own verified data from the published registry (fixture)', () => {
  it('uses verified events of the published period through the shared contract', () => {
    const result = lookupDrivingBans({ jurisdictions: ['CZ', 'AT', 'DE'], dates: [SUNDAY] }, { view, now: NOW });
    expect(Object.fromEntries(Object.entries(result.verification).map(([code, v]) => [code, v.outcome]))).toEqual({ CZ: 'BAN_FOUND', AT: 'BAN_FOUND', DE: 'INSUFFICIENT_VERIFIED_DATA' });
    expect(result.verification.AT.coverageComplete).toBe(false);
    expect(result.verification.CZ).toMatchObject({ coverageComplete: true, verificationState: 'PRIMARY_VERIFIED', lastVerified: '2026-09-26T15:25:00.000Z', period: { from: '2026-10-01', to: '2026-11-30' } });
    expect(result.records.map((r) => r.jurisdiction)).toEqual(['CZ', 'AT']);
  });

  it('states "no confirmed ban" only for a country verified in full; elsewhere missing events stay insufficient data', () => {
    const result = lookupDrivingBans({ jurisdictions: ['CZ', 'AT', 'DE'], dates: ['2026-11-03'] }, { view, now: NOW });
    expect(result.verification.CZ.outcome).toBe('NO_CONFIRMED_BAN');
    expect(result.verification.AT.outcome).toBe('INSUFFICIENT_VERIFIED_DATA');
    expect(result.verification.DE.outcome).toBe('INSUFFICIENT_VERIFIED_DATA');
    expect(result.records).toHaveLength(1);
    expect(result.records[0]).toMatchObject({ id: 'dajc:no-confirmed-ban:cz', jurisdiction: 'CZ' });
    expect(result.records[0].text).toContain(NO_CONFIRMED_BAN_FINDING);
    expect(result.records[0].text).toMatch(/Temporary traffic restrictions, roadworks and permit conditions are not part of the registry/);
  });

  it('treats dates outside the published period as insufficient verified data and offers only official leads', () => {
    const result = lookupDrivingBans({ jurisdictions: ['AT', 'CZ'], dates: ['2026-12-06'] }, { view, now: NOW });
    expect(result.verification.AT.outcome).toBe('INSUFFICIENT_VERIFIED_DATA');
    expect(result.verification.CZ.outcome).toBe('INSUFFICIENT_VERIFIED_DATA');
    expect(result.records).toHaveLength(0);
    expect(result.leads).toEqual(['https://www.ris.bka.gv.at/stvo-42', 'https://www.mdcr.gov.cz/zakon-361']);
  });

  it('is insufficient as a whole when only some asked days are decided', () => {
    const result = lookupDrivingBans({ jurisdictions: ['CZ'], dates: [SUNDAY, '2026-12-06'] }, { view, now: NOW });
    expect(result.verification.CZ.outcome).toBe('INSUFFICIENT_VERIFIED_DATA');
    expect(result.verification.CZ.days).toEqual([{ date: SUNDAY, outcome: 'BAN_FOUND' }, { date: '2026-12-06', outcome: 'INSUFFICIENT_VERIFIED_DATA' }]);
    expect(result.records.map((r) => r.id)).toEqual(['dajc:cz-sunday-2026-11-01']);
  });

  it('lists exceptions in the record without assessing them', () => {
    const [record] = lookupDrivingBans({ jurisdictions: ['CZ'], dates: [SUNDAY] }, { view, now: NOW }).records;
    expect(record.facts.exceptions).toBe('Perishable goods.');
    expect(record.text).toContain('Exceptions (listed, not assessed for any transport): Perishable goods.');
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

describe('own verified data (real published registry, invariants only)', () => {
  // Only invariants: the weekly data updates must never break these tests.
  const real = getDrivingBansSnapshot(new Date()) as unknown as DrivingBansView;
  const codes = real.jurisdictions.map((j) => j.jurisdiction);

  it('says "no confirmed ban" only for countries verified in full', () => {
    const result = lookupDrivingBans({ jurisdictions: codes, dates: [real.window.from] }, { view: real, now: new Date() });
    for (const v of Object.values(result.verification)) {
      const row = real.jurisdictions.find((j) => j.jurisdiction === v.jurisdiction)!;
      if (v.outcome === 'NO_CONFIRMED_BAN') expect(row.coverage_complete).toBe(true);
      if (!row.coverage_complete) expect(v.outcome).not.toBe('NO_CONFIRMED_BAN');
    }
    for (const record of result.records) expect(record.text).toMatch(/^DAJC verified (driving-ban record|registry statement)/);
  });

  it('treats any day after the published period as insufficient verified data', () => {
    const after = new Date(Date.parse(`${real.window.to}T00:00:00Z`) + 2 * 86_400_000).toISOString().slice(0, 10);
    const result = lookupDrivingBans({ jurisdictions: codes, dates: [after] }, { view: real, now: new Date() });
    expect(new Set(Object.values(result.verification).map((v) => v.outcome))).toEqual(new Set(['INSUFFICIENT_VERIFIED_DATA']));
    expect(result.records).toHaveLength(0);
    expect(result.leads.every(isAllowedSourceUrl)).toBe(true);
  });
});
