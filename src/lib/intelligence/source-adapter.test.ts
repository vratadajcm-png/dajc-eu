import { describe, expect, it } from 'vitest';
import type { IntelligenceSourceRights } from './persistence-contract';
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

function rights(redistribution: IntelligenceSourceRights['redistribution']): IntelligenceSourceRights {
  return {
    sourceId: snapshot.sourceId,
    policyVersion: 'test-v1',
    storageScope: 'public-shared',
    storage: 'allowed',
    history: 'allowed',
    derivedIntelligence: 'allowed',
    redistribution,
    attributionRequired: true,
    evidenceReference: 'test evidence',
    purpose: 'unit test',
  };
}

describe('DAJC Intelligence source adapter boundary', () => {
  it('adds canonical source provenance to normalized items', () => {
    const items = withSnapshotProvenance(snapshot);
    expect(items[0].sourceLabel).toBe('Authority source');
    expect(items[0].sourceUrl).toBe('https://example.com/source');
  });

  it('fails closed for commercial redistribution when snapshot provenance is unknown', () => {
    expect(mayCommerciallyRedistribute({ snapshot, rights: rights('allowed') })).toBe(false);
  });

  it('fails closed when provenance allows redistribution but evidence-backed rights do not', () => {
    const distributableSnapshot = {
      ...snapshot,
      provenance: { ...snapshot.provenance, distributionPolicy: 'redistribution-allowed' as const },
    };
    expect(mayCommerciallyRedistribute({ snapshot: distributableSnapshot, rights: rights('unknown') })).toBe(false);
    expect(mayCommerciallyRedistribute({ snapshot: distributableSnapshot, rights: rights('denied') })).toBe(false);
  });

  it('allows commercial redistribution only when provenance and rights both explicitly allow it', () => {
    expect(mayCommerciallyRedistribute({
      snapshot: {
        ...snapshot,
        provenance: { ...snapshot.provenance, distributionPolicy: 'redistribution-allowed' },
      },
      rights: rights('allowed'),
    })).toBe(true);
  });

  it('fails closed when rights belong to another source', () => {
    expect(mayCommerciallyRedistribute({
      snapshot: {
        ...snapshot,
        provenance: { ...snapshot.provenance, distributionPolicy: 'redistribution-allowed' },
      },
      rights: { ...rights('allowed'), sourceId: 'other-source' },
    })).toBe(false);
  });

  it('rejects item-level source URL conflicting with adapter provenance', () => {
    expect(() => validateSourceSnapshot({
      ...snapshot,
      items: [{ ...snapshot.items[0], sourceUrl: 'https://example.com/other' }],
    })).toThrow('does not match adapter provenance URL');
  });
});
