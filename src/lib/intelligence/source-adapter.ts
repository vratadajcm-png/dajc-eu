import { z } from 'zod';
import {
  intelligenceSnapshotItemSchema,
  type IntelligenceSnapshotItem,
} from './change-detection';
import {
  intelligenceSourceRightsSchema,
  type IntelligenceSourceRights,
} from './persistence-contract';

export const intelligenceSourceSnapshotSchema = z.object({
  sourceId: z.string().min(1).max(120),
  observedAt: z.string().datetime(),
  complete: z.boolean(),
  provenance: z.object({
    sourceLabel: z.string().min(1).max(200),
    sourceUrl: z.string().url().optional(),
    licence: z.string().max(200).optional(),
    distributionPolicy: z.enum([
      'internal-only',
      'derived-only',
      'redistribution-allowed',
      'unknown',
    ]).default('unknown'),
  }),
  items: z.array(intelligenceSnapshotItemSchema),
  warnings: z.array(z.string()).default([]),
});

export type IntelligenceSourceSnapshot = z.infer<typeof intelligenceSourceSnapshotSchema>;

export interface IntelligenceSourceAdapter {
  readonly sourceId: string;
  readonly rights: IntelligenceSourceRights;
  fetchSnapshot(): Promise<IntelligenceSourceSnapshot>;
}

export function validateAdapterRights(
  adapter: Pick<IntelligenceSourceAdapter, 'sourceId' | 'rights'>,
): IntelligenceSourceRights {
  const rights = intelligenceSourceRightsSchema.parse(adapter.rights);
  if (rights.sourceId !== adapter.sourceId) {
    throw new Error(`Adapter rights sourceId mismatch: ${adapter.sourceId} != ${rights.sourceId}`);
  }
  return rights;
}

export function validateSourceSnapshot(
  snapshot: IntelligenceSourceSnapshot,
): IntelligenceSourceSnapshot {
  const parsed = intelligenceSourceSnapshotSchema.parse(snapshot);

  for (const item of parsed.items) {
    if (item.sourceUrl && parsed.provenance.sourceUrl && item.sourceUrl !== parsed.provenance.sourceUrl) {
      throw new Error(`Snapshot item ${item.key} sourceUrl does not match adapter provenance URL`);
    }
  }

  return parsed;
}

export function withSnapshotProvenance(
  snapshot: IntelligenceSourceSnapshot,
): IntelligenceSnapshotItem[] {
  const parsed = validateSourceSnapshot(snapshot);
  return parsed.items.map((item) => ({
    ...item,
    sourceLabel: item.sourceLabel ?? parsed.provenance.sourceLabel,
    sourceUrl: item.sourceUrl ?? parsed.provenance.sourceUrl,
  }));
}

export function mayCommerciallyRedistribute(snapshot: IntelligenceSourceSnapshot): boolean {
  return validateSourceSnapshot(snapshot).provenance.distributionPolicy === 'redistribution-allowed';
}
