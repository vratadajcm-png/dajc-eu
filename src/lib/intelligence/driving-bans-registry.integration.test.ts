import { describe, expect, it } from 'vitest';
import { DrivingBansRegistryAdapter } from './driving-bans-adapter';

/**
 * Contract integration test against the maintained DAJC registry itself.
 * It deliberately does not assert an exact event count: the curated registry is expected to evolve.
 */
describe('maintained DAJC Driving Bans registry -> Intelligence', () => {
  it('resolves the Sep-Oct 2026 operating window without schema failure', async () => {
    const adapter = new DrivingBansRegistryAdapter(
      '2026-09-01',
      '2026-10-31',
      '2026-08-31T13:10:00.000Z',
    );
    const snapshot = await adapter.fetchSnapshot();

    expect(snapshot.sourceId).toBe('dajc-driving-bans-registry');
    expect(snapshot.items.length).toBeGreaterThan(0);
    expect(snapshot.items.every((item) => item.topic === 'driving-ban')).toBe(true);
    expect(snapshot.items.every((item) => item.jurisdiction.length >= 2)).toBe(true);
    expect(snapshot.provenance.distributionPolicy).toBe('internal-only');

    // A maintenance warning is allowed and intentionally makes the source partial;
    // it must never prevent valid maintained occurrences from being normalized.
    if (!snapshot.complete) {
      expect(snapshot.warnings.length).toBeGreaterThan(0);
    }
  });
});
