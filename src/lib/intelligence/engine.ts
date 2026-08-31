import {
  buildAlertCandidates,
  type IntelligenceAlertCandidate,
  type IntelligenceAlertRecipient,
} from './alerts';
import {
  detectIntelligenceChanges,
  type IntelligenceHistoryEntry,
  type IntelligenceSnapshotItem,
} from './change-detection';
import {
  validateAdapterRights,
  validateSourceSnapshot,
  withSnapshotProvenance,
  type IntelligenceSourceAdapter,
} from './source-adapter';
import type { IntelligenceStateStore } from './store';

export interface IntelligenceCycleResult {
  sourceId: string;
  complete: boolean;
  detected: IntelligenceHistoryEntry[];
  queuedAlerts: IntelligenceAlertCandidate[];
  warnings: string[];
}

function reconcileSnapshot(
  previous: IntelligenceSnapshotItem[],
  current: IntelligenceSnapshotItem[],
  complete: boolean,
): IntelligenceSnapshotItem[] {
  if (complete) return current;
  const merged = new Map(previous.map((item) => [item.key, item]));
  for (const item of current) merged.set(item.key, item);
  return [...merged.values()];
}

/**
 * One provider-neutral DAJC Intelligence processing cycle.
 * No adapter may bypass identity/rights validation or provenance, and no delivery side effect occurs here.
 * Durable stores must commit snapshot + history + outbox atomically.
 */
export async function runIntelligenceCycle(args: {
  adapter: IntelligenceSourceAdapter;
  store: IntelligenceStateStore;
  recipients: IntelligenceAlertRecipient[];
}): Promise<IntelligenceCycleResult> {
  validateAdapterRights(args.adapter);
  const rawSnapshot = await args.adapter.fetchSnapshot();
  const snapshot = validateSourceSnapshot(rawSnapshot);
  if (snapshot.sourceId !== args.adapter.sourceId) {
    throw new Error(`Adapter sourceId mismatch: ${args.adapter.sourceId} != ${snapshot.sourceId}`);
  }

  const previous = await args.store.readSnapshot(snapshot.sourceId);
  const current = withSnapshotProvenance(snapshot);
  const detected = detectIntelligenceChanges({
    previous,
    current,
    observedAt: snapshot.observedAt,
    currentSnapshotComplete: snapshot.complete,
  });

  const candidates = buildAlertCandidates({
    changes: detected.map((entry) => entry.change),
    recipients: args.recipients,
    createdAt: snapshot.observedAt,
  });

  const deliveryChecks = await Promise.all(
    candidates.map(async (candidate) => ({
      candidate,
      delivered: await args.store.hasDeliveredDedupeKey(candidate.dedupeKey),
    })),
  );
  const queuedAlerts = deliveryChecks
    .filter(({ delivered }) => !delivered)
    .map(({ candidate }) => candidate);

  const reconciledSnapshot = reconcileSnapshot(previous, current, snapshot.complete);
  await args.store.commitCycle({
    sourceId: snapshot.sourceId,
    snapshot: reconciledSnapshot,
    historyEntries: detected,
    alertCandidates: queuedAlerts,
  });

  return {
    sourceId: snapshot.sourceId,
    complete: snapshot.complete,
    detected,
    queuedAlerts,
    warnings: snapshot.warnings,
  };
}
