import { describe, expect, it } from 'vitest';
import { InMemoryIntelligenceStateStore } from './store';
import type { IntelligenceCycleCommit } from './store';

const commit: IntelligenceCycleCommit = {
  sourceId: 'source-a',
  snapshot: [{
    key: 'item-1',
    jurisdiction: 'DE',
    topic: 'driving-ban',
    materiality: 'high',
    summary: 'Restriction A',
    payload: {},
  }],
  historyEntries: [{
    change: {
      id: 'change-1',
      jurisdiction: 'DE',
      topic: 'driving-ban',
      changeType: 'added',
      materiality: 'high',
      observedAt: '2026-08-31T13:00:00.000Z',
      summary: 'Restriction A',
    },
    currentFingerprint: 'fingerprint-1',
  }],
  alertCandidates: [{
    id: 'user-1:change-1',
    recipientId: 'user-1',
    organizationId: 'org-1',
    change: {
      id: 'change-1',
      jurisdiction: 'DE',
      topic: 'driving-ban',
      changeType: 'added',
      materiality: 'high',
      observedAt: '2026-08-31T13:00:00.000Z',
      summary: 'Restriction A',
    },
    channels: ['in-app'],
    createdAt: '2026-08-31T13:00:00.000Z',
    dedupeKey: 'user-1:change-1',
  }],
};

describe('DAJC Intelligence atomic state store contract', () => {
  it('commits snapshot, history and outbox as one store operation', async () => {
    const store = new InMemoryIntelligenceStateStore();
    await store.commitCycle(commit);

    expect(await store.readSnapshot('source-a')).toHaveLength(1);
    expect(store.getHistory()).toHaveLength(1);
    expect(store.getOutbox()).toHaveLength(1);
  });

  it('is idempotent for duplicate history and outbox entries', async () => {
    const store = new InMemoryIntelligenceStateStore();
    await store.commitCycle(commit);
    await store.commitCycle(commit);

    expect(store.getHistory()).toHaveLength(1);
    expect(store.getOutbox()).toHaveLength(1);
  });

  it('does not re-enqueue a candidate already marked delivered', async () => {
    const store = new InMemoryIntelligenceStateStore();
    await store.commitCycle(commit);
    store.markDelivered('user-1:change-1');
    await store.commitCycle(commit);

    expect(await store.hasDeliveredDedupeKey('user-1:change-1')).toBe(true);
    expect(store.getOutbox()).toHaveLength(0);
    expect(store.getHistory()).toHaveLength(1);
  });

  it('replaces the scoped current snapshot on a later committed cycle', async () => {
    const store = new InMemoryIntelligenceStateStore();
    await store.commitCycle(commit);
    await store.commitCycle({
      ...commit,
      snapshot: [{ ...commit.snapshot[0], summary: 'Restriction B' }],
      historyEntries: [],
      alertCandidates: [],
    });

    expect((await store.readSnapshot('source-a'))[0].summary).toBe('Restriction B');
  });
});
