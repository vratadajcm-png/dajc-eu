import { describe, expect, it } from 'vitest';
import {
  mayCommerciallyRedistribute,
  validateSourceSnapshot,
  withSnapshotProvenance,
  type IntelligenceSourceSnapshot,
} from './source-adapter';

const snapshot: IntelligenceSourceSnapshot = {
  sourceId: 'authority-source',
  observedAt: '2026-08-31T13:00:00.000Z',
  complete: true,
  provenance: {
    sourceLabel: 'Authority source',
    sourceUrl: 'https://example.com/source',
    licence: 'Example licence',
    distributionPolicy: 'unknown',
  },
  items: [{
    key: 'DE:restriction:1',
    jurisdiction: 'DE',
    topic: 'route-restriction',
    materiality: 'high',
    summary: 'Restriction changed.',
    payload: {},
  }],
  warnings: [],
};

describe('DAJC Intelligence source adapter boundary', () => {
  it('adds canonical source provenance to normalized items', () => {
    const items = withSnapshotProvenance(snapshot);
    expect(items[0].sourceLabel).toBe('Authority source');
    expect(items[0].sourceUrl).toBe('https://example.com/source');
  });

  it('fails closed for commercial redistribution when rights are unknown', () => {
    expect(mayCommerciallyRedistribute(snapshot)).toBe(false);
  });

  it('allows commercial redistribution only when explicitly declared', () => {
    expect(mayCommerciallyRedistribute({
      ...snapshot,
      provenance: { ...snapshot.provenance, distributionPolicy: 'redistribution-allowed' },
    })).toBe(true);
  });

  it('rejects item-level source URL conflicting with adapter provenance', () => {
    expect(() => validateSourceSnapshot({
      ...snapshot,
      items: [{ ...snapshot.items[0], sourceUrl: 'https://example.com/other' }],
    })).toThrow('does not match adapter provenance URL');
  });
});
