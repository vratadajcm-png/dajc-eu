import type { IntelligenceAlertCandidate } from './alerts';
import type { IntelligenceHistoryEntry, IntelligenceSnapshotItem } from './change-detection';

export interface IntelligenceCycleCommit {
  sourceId: string;
  snapshot: IntelligenceSnapshotItem[];
  historyEntries: IntelligenceHistoryEntry[];
  alertCandidates: IntelligenceAlertCandidate[];
}

export interface IntelligenceStateStore {
  readSnapshot(sourceId: string): Promise<IntelligenceSnapshotItem[]>;
  commitCycle(commit: IntelligenceCycleCommit): Promise<void>;
  hasDeliveredDedupeKey(dedupeKey: string): Promise<boolean>;
}

/**
 * Test/demo implementation only. Production persistence must use a durable datastore
 * with one atomic transaction for snapshot + append-only history + alert outbox,
 * plus tenant-aware RLS/access controls from the persistence security contract.
 */
export class InMemoryIntelligenceStateStore implements IntelligenceStateStore {
  private snapshots = new Map<string, IntelligenceSnapshotItem[]>();
  private history: IntelligenceHistoryEntry[] = [];
  private outbox: IntelligenceAlertCandidate[] = [];
  private delivered = new Set<string>();

  async readSnapshot(sourceId: string): Promise<IntelligenceSnapshotItem[]> {
    return structuredClone(this.snapshots.get(sourceId) ?? []);
  }

  async commitCycle(commit: IntelligenceCycleCommit): Promise<void> {
    const nextHistory = structuredClone(this.history);
    const historySeen = new Set(nextHistory.map((entry) => entry.change.id));
    for (const entry of commit.historyEntries) {
      if (!historySeen.has(entry.change.id)) {
        nextHistory.push(structuredClone(entry));
        historySeen.add(entry.change.id);
      }
    }

    const nextOutbox = structuredClone(this.outbox);
    const outboxSeen = new Set(nextOutbox.map((candidate) => candidate.dedupeKey));
    for (const candidate of commit.alertCandidates) {
      if (!outboxSeen.has(candidate.dedupeKey) && !this.delivered.has(candidate.dedupeKey)) {
        nextOutbox.push(structuredClone(candidate));
        outboxSeen.add(candidate.dedupeKey);
      }
    }

    // Apply the staged state only after every part of the commit has been prepared.
    this.history = nextHistory;
    this.outbox = nextOutbox;
    this.snapshots.set(commit.sourceId, structuredClone(commit.snapshot));
  }

  async hasDeliveredDedupeKey(dedupeKey: string): Promise<boolean> {
    return this.delivered.has(dedupeKey);
  }

  markDelivered(dedupeKey: string): void {
    this.delivered.add(dedupeKey);
    this.outbox = this.outbox.filter((candidate) => candidate.dedupeKey !== dedupeKey);
  }

  getHistory(): IntelligenceHistoryEntry[] {
    return structuredClone(this.history);
  }

  getOutbox(): IntelligenceAlertCandidate[] {
    return structuredClone(this.outbox);
  }
}
