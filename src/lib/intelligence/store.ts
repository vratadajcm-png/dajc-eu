import type { IntelligenceAlertCandidate } from './alerts';
import type { IntelligenceHistoryEntry, IntelligenceSnapshotItem } from './change-detection';

export interface IntelligenceStateStore {
  readSnapshot(sourceId: string): Promise<IntelligenceSnapshotItem[]>;
  replaceSnapshot(sourceId: string, snapshot: IntelligenceSnapshotItem[]): Promise<void>;
  appendHistory(entries: IntelligenceHistoryEntry[]): Promise<void>;
  enqueueAlerts(candidates: IntelligenceAlertCandidate[]): Promise<void>;
  hasDeliveredDedupeKey(dedupeKey: string): Promise<boolean>;
}

/**
 * Test/demo implementation only. Production persistence must use a durable datastore
 * with atomic history/outbox semantics and tenant-aware access controls.
 */
export class InMemoryIntelligenceStateStore implements IntelligenceStateStore {
  private snapshots = new Map<string, IntelligenceSnapshotItem[]>();
  private history: IntelligenceHistoryEntry[] = [];
  private outbox: IntelligenceAlertCandidate[] = [];
  private delivered = new Set<string>();

  async readSnapshot(sourceId: string): Promise<IntelligenceSnapshotItem[]> {
    return structuredClone(this.snapshots.get(sourceId) ?? []);
  }

  async replaceSnapshot(sourceId: string, snapshot: IntelligenceSnapshotItem[]): Promise<void> {
    this.snapshots.set(sourceId, structuredClone(snapshot));
  }

  async appendHistory(entries: IntelligenceHistoryEntry[]): Promise<void> {
    const seen = new Set(this.history.map((entry) => entry.change.id));
    for (const entry of entries) {
      if (!seen.has(entry.change.id)) {
        this.history.push(structuredClone(entry));
        seen.add(entry.change.id);
      }
    }
  }

  async enqueueAlerts(candidates: IntelligenceAlertCandidate[]): Promise<void> {
    const seen = new Set(this.outbox.map((candidate) => candidate.dedupeKey));
    for (const candidate of candidates) {
      if (!seen.has(candidate.dedupeKey) && !this.delivered.has(candidate.dedupeKey)) {
        this.outbox.push(structuredClone(candidate));
        seen.add(candidate.dedupeKey);
      }
    }
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
