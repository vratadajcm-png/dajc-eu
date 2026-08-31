import { z } from 'zod';
import {
  intelligenceChangeSchema,
  type IntelligenceChange,
} from './preferences';

export const intelligenceSnapshotItemSchema = z.object({
  key: z.string().min(1),
  jurisdiction: z.string().min(2).max(16),
  topic: intelligenceChangeSchema.shape.topic,
  materiality: intelligenceChangeSchema.shape.materiality,
  effectiveFrom: z.string().datetime().optional(),
  effectiveTo: z.string().datetime().optional(),
  sourceUrl: z.string().url().optional(),
  sourceLabel: z.string().optional(),
  summary: z.string().min(1),
  payload: z.record(z.string(), z.unknown()).default({}),
});

export type IntelligenceSnapshotItem = z.infer<typeof intelligenceSnapshotItemSchema>;

export const intelligenceHistoryEntrySchema = z.object({
  change: intelligenceChangeSchema,
  previousFingerprint: z.string().optional(),
  currentFingerprint: z.string().optional(),
});

export type IntelligenceHistoryEntry = z.infer<typeof intelligenceHistoryEntrySchema>;

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, nested]) => [key, stableValue(nested)]),
    );
  }
  return value;
}

export function fingerprintSnapshotItem(item: IntelligenceSnapshotItem): string {
  const comparable = {
    jurisdiction: item.jurisdiction,
    topic: item.topic,
    materiality: item.materiality,
    effectiveFrom: item.effectiveFrom ?? null,
    effectiveTo: item.effectiveTo ?? null,
    sourceUrl: item.sourceUrl ?? null,
    sourceLabel: item.sourceLabel ?? null,
    summary: item.summary,
    payload: stableValue(item.payload),
  };
  return JSON.stringify(comparable);
}

function changeId(key: string, observedAt: string, changeType: IntelligenceChange['changeType']) {
  return `${key}:${changeType}:${observedAt}`;
}

function classifyChangedItem(
  previous: IntelligenceSnapshotItem,
  current: IntelligenceSnapshotItem,
): IntelligenceChange['changeType'] {
  if (previous.effectiveTo && current.effectiveTo) {
    const previousEnd = Date.parse(previous.effectiveTo);
    const currentEnd = Date.parse(current.effectiveTo);
    if (Number.isFinite(previousEnd) && Number.isFinite(currentEnd) && currentEnd > previousEnd) {
      return 'extended';
    }
  }
  return 'changed';
}

export function detectIntelligenceChanges(args: {
  previous: IntelligenceSnapshotItem[];
  current: IntelligenceSnapshotItem[];
  observedAt: string;
}): IntelligenceHistoryEntry[] {
  const observedAt = z.string().datetime().parse(args.observedAt);
  const previous = args.previous.map((item) => intelligenceSnapshotItemSchema.parse(item));
  const current = args.current.map((item) => intelligenceSnapshotItemSchema.parse(item));

  const previousByKey = new Map(previous.map((item) => [item.key, item]));
  const currentByKey = new Map(current.map((item) => [item.key, item]));
  const history: IntelligenceHistoryEntry[] = [];

  for (const item of current) {
    const prior = previousByKey.get(item.key);
    const currentFingerprint = fingerprintSnapshotItem(item);

    if (!prior) {
      history.push({
        change: {
          id: changeId(item.key, observedAt, 'added'),
          jurisdiction: item.jurisdiction,
          topic: item.topic,
          changeType: 'added',
          materiality: item.materiality,
          effectiveFrom: item.effectiveFrom,
          effectiveTo: item.effectiveTo,
          sourceUrl: item.sourceUrl,
          sourceLabel: item.sourceLabel,
          observedAt,
          summary: item.summary,
        },
        currentFingerprint,
      });
      continue;
    }

    const previousFingerprint = fingerprintSnapshotItem(prior);
    if (previousFingerprint === currentFingerprint) continue;

    const changeType = classifyChangedItem(prior, item);
    history.push({
      change: {
        id: changeId(item.key, observedAt, changeType),
        jurisdiction: item.jurisdiction,
        topic: item.topic,
        changeType,
        materiality: item.materiality,
        effectiveFrom: item.effectiveFrom,
        effectiveTo: item.effectiveTo,
        sourceUrl: item.sourceUrl,
        sourceLabel: item.sourceLabel,
        observedAt,
        summary: item.summary,
      },
      previousFingerprint,
      currentFingerprint,
    });
  }

  for (const prior of previous) {
    if (currentByKey.has(prior.key)) continue;
    history.push({
      change: {
        id: changeId(prior.key, observedAt, 'cancelled'),
        jurisdiction: prior.jurisdiction,
        topic: prior.topic,
        changeType: 'cancelled',
        materiality: prior.materiality,
        effectiveFrom: prior.effectiveFrom,
        effectiveTo: prior.effectiveTo,
        sourceUrl: prior.sourceUrl,
        sourceLabel: prior.sourceLabel,
        observedAt,
        summary: prior.summary,
      },
      previousFingerprint: fingerprintSnapshotItem(prior),
    });
  }

  return history.map((entry) => intelligenceHistoryEntrySchema.parse(entry));
}

/**
 * Append-only helper for future persistence adapters.
 * Existing history is never rewritten; duplicate change IDs are ignored.
 */
export function appendHistory(
  existing: IntelligenceHistoryEntry[],
  detected: IntelligenceHistoryEntry[],
): IntelligenceHistoryEntry[] {
  const parsedExisting = existing.map((entry) => intelligenceHistoryEntrySchema.parse(entry));
  const seen = new Set(parsedExisting.map((entry) => entry.change.id));
  const additions = detected
    .map((entry) => intelligenceHistoryEntrySchema.parse(entry))
    .filter((entry) => !seen.has(entry.change.id));
  return [...parsedExisting, ...additions];
}
