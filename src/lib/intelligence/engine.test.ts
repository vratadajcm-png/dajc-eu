import { describe, expect, it } from 'vitest';
import type { IntelligenceAlertRecipient } from './alerts';
import { runIntelligenceCycle } from './engine';
import type { IntelligenceSourceRights } from './persistence-contract';
import type { IntelligenceSourceAdapter, IntelligenceSourceSnapshot } from './source-adapter';
import { InMemoryIntelligenceStateStore } from './store';

const recipient: IntelligenceAlertRecipient = {
  id: 'r1',
  preferences: {
    jurisdictions: ['DE'],
    corridors: [],
    vehicleProfile: { adr: false, exceptionalTransport: false },
    alertTopics: ['driving-ban'],
    alertMode: 'material-only',
  },
  channels: ['in-app'],
};

function rights(sourceId: string): IntelligenceSourceRights {
  return {
    sourceId,
    policyVersion: 'test-v1',
    storageScope: 'public-shared',
    storage: 'allowed',
    history: 'allowed',
    derivedIntelligence: 'allowed',
    redistribution: 'unknown',
    attributionRequired: false,
    evidenceReference: 'test fixture',
    purpose: 'unit test',
  };
}

function adapter(snapshot: IntelligenceSourceSnapshot): IntelligenceSourceAdapter {
  return {
    sourceId: snapshot.sourceId,
    rights: rights(snapshot.sourceId),
    async fetchSnapshot() {
      return snapshot;
    },
  };
}

const baseSnapshot: IntelligenceSourceSnapshot = {
  sourceId: 'authority-de',
  observedAt: '2026-08-31T13:00:00.000Z',
  complete: true,
  provenance: {
    sourceLabel: 'German authority',
    sourceUrl: 'https://example.com/de',
    distributionPolicy: 'unknown',
  },
  items: [{
    key: 'DE:ban:1',
    jurisdiction: 'DE',
    topic: 'driving-ban',
    materiality: 'high',
    summary: 'Restriction A',
    payload: { thresholdKg: 7500 },
  }],
  warnings: [],
};

describe('DAJC Intelligence cycle', () => {
  it('detects, stores and queues a relevant new event once', async () => {
    const store = new InMemoryIntelligenceStateStore();
    const first = await runIntelligenceCycle({ adapter: adapter(baseSnapshot), store, recipients: [recipient] });
    expect(first.detected).toHaveLength(1);
    expect(first.queuedAlerts).toHaveLength(1);
    expect(store.getHistory()).toHaveLength(1);
    expect(store.getOutbox()).toHaveLength(1);

    const second = await runIntelligenceCycle({
      adapter: adapter({ ...baseSnapshot, observedAt: '2026-08-31T14:00:00.000Z' }),
      store,
      recipients: [recipient],
    });
    expect(second.detected).toEqual([]);
    expect(second.queuedAlerts).toEqual([]);
  });

  it('preserves missing prior items during an incomplete source snapshot', async () => {
    const store = new InMemoryIntelligenceStateStore();
    await runIntelligenceCycle({ adapter: adapter(baseSnapshot), store, recipients: [] });

    const partial = await runIntelligenceCycle({
      adapter: adapter({
        ...baseSnapshot,
        observedAt: '2026-08-31T14:00:00.000Z',
        complete: false,
        items: [],
        warnings: ['Source returned a partial response'],
      }),
      store,
      recipients: [],
    });
    expect(partial.detected).toEqual([]);
    expect(partial.warnings).toEqual(['Source returned a partial response']);
    expect(await store.readSnapshot('authority-de')).toHaveLength(1);
  });

  it('creates cancellation only after a later complete snapshot confirms disappearance', async () => {
    const store = new InMemoryIntelligenceStateStore();
    await runIntelligenceCycle({ adapter: adapter(baseSnapshot), store, recipients: [] });

    const cancelled = await runIntelligenceCycle({
      adapter: adapter({
        ...baseSnapshot,
        observedAt: '2026-08-31T15:00:00.000Z',
        complete: true,
        items: [],
      }),
      store,
      recipients: [],
    });
    expect(cancelled.detected).toHaveLength(1);
    expect(cancelled.detected[0].change.changeType).toBe('cancelled');
  });

  it('rejects a snapshot whose identity does not match its adapter', async () => {
    const store = new InMemoryIntelligenceStateStore();
    const mismatched: IntelligenceSourceAdapter = {
      sourceId: 'expected-source',
      rights: rights('expected-source'),
      async fetchSnapshot() {
        return baseSnapshot;
      },
    };
    await expect(runIntelligenceCycle({ adapter: mismatched, store, recipients: [] }))
      .rejects.toThrow('Adapter sourceId mismatch');
  });

  it('rejects adapter rights bound to another source identity', async () => {
    const store = new InMemoryIntelligenceStateStore();
    const mismatchedRights: IntelligenceSourceAdapter = {
      sourceId: 'authority-de',
      rights: rights('other-source'),
      async fetchSnapshot() {
        return baseSnapshot;
      },
    };
    await expect(runIntelligenceCycle({ adapter: mismatchedRights, store, recipients: [] }))
      .rejects.toThrow('Adapter rights sourceId mismatch');
  });
});
