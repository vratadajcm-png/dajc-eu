import { describe, expect, it } from 'vitest';
import {
  resolveDrivingBanRegistrySnapshot,
  type DrivingBanRule,
} from './driving-bans-adapter';

const baseRule: DrivingBanRule = {
  id: 'de-test-ban',
  country: 'DE',
  countryName: 'Germany',
  sourceUrl: 'https://example.com/de',
  sourceName: 'Example authority',
  legalBasis: 'Example HGV rule',
  vehicleScope: 'Vehicles above 7.5t',
  routeScope: 'Nationwide',
  resolve() {
    return {
      occurrences: [{
        title: 'Test restriction',
        validFrom: '2026-09-06',
        validTo: '2026-09-06',
        timeWindow: '00:00-22:00',
        impact: 'No affected movements.',
      }],
    };
  },
};

describe('DAJC Driving Bans Intelligence adapter', () => {
  it('normalizes maintained registry occurrences into Intelligence snapshot items', () => {
    const snapshot = resolveDrivingBanRegistrySnapshot({
      rules: [baseRule],
      from: '2026-09-01',
      to: '2026-09-30',
      observedAt: '2026-08-31T13:00:00.000Z',
    });
    expect(snapshot.complete).toBe(true);
    expect(snapshot.items).toHaveLength(1);
    expect(snapshot.items[0]).toMatchObject({
      jurisdiction: 'DE',
      topic: 'driving-ban',
      materiality: 'high',
      sourceUrl: 'https://example.com/de',
      sourceLabel: 'Example authority',
    });
    expect(snapshot.provenance.distributionPolicy).toBe('internal-only');
  });

  it('deduplicates the same occurrence resolved from multiple weekly iterations', () => {
    const snapshot = resolveDrivingBanRegistrySnapshot({
      rules: [baseRule],
      from: '2026-09-01',
      to: '2026-09-30',
      observedAt: '2026-08-31T13:00:00.000Z',
    });
    expect(snapshot.items).toHaveLength(1);
  });

  it('marks the snapshot incomplete when annual-calendar maintenance is missing', () => {
    const rule: DrivingBanRule = {
      ...baseRule,
      id: 'annual-missing',
      resolve() {
        return { maintenanceError: 'No 2026 calendar seeded', occurrences: [] };
      },
    };
    const snapshot = resolveDrivingBanRegistrySnapshot({
      rules: [rule],
      from: '2026-09-01',
      to: '2026-09-30',
      observedAt: '2026-08-31T13:00:00.000Z',
    });
    expect(snapshot.complete).toBe(false);
    expect(snapshot.warnings.some((warning) => warning.includes('No 2026 calendar seeded'))).toBe(true);
  });

  it('marks the snapshot incomplete instead of converting a resolver failure into cancellations', () => {
    const rule: DrivingBanRule = {
      ...baseRule,
      id: 'broken-rule',
      resolve() {
        throw new Error('provider parse failed');
      },
    };
    const snapshot = resolveDrivingBanRegistrySnapshot({
      rules: [rule],
      from: '2026-09-01',
      to: '2026-09-30',
      observedAt: '2026-08-31T13:00:00.000Z',
    });
    expect(snapshot.complete).toBe(false);
    expect(snapshot.items).toEqual([]);
    expect(snapshot.warnings[0]).toContain('provider parse failed');
  });

  it('rejects an invalid date window', () => {
    expect(() => resolveDrivingBanRegistrySnapshot({
      rules: [baseRule],
      from: '2026-10-01',
      to: '2026-09-01',
      observedAt: '2026-08-31T13:00:00.000Z',
    })).toThrow('Invalid Driving Bans Intelligence date window');
  });
});
