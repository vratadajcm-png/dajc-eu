import { z } from 'zod';
import {
  intelligencePreferenceSchema,
  intelligenceChangeSchema,
  isRelevantChange,
  type IntelligenceChange,
  type IntelligencePreferences,
} from './preferences';

export const intelligenceAlertRecipientSchema = z.object({
  id: z.string().min(1).max(120),
  organizationId: z.string().min(1).max(120).optional(),
  preferences: intelligencePreferenceSchema,
  channels: z.array(z.enum(['in-app', 'email', 'push', 'webhook'])).min(1).default(['in-app']),
});

export type IntelligenceAlertRecipient = z.infer<typeof intelligenceAlertRecipientSchema>;

export const intelligenceAlertCandidateSchema = z.object({
  id: z.string(),
  recipientId: z.string(),
  organizationId: z.string().optional(),
  change: intelligenceChangeSchema,
  channels: intelligenceAlertRecipientSchema.shape.channels,
  createdAt: z.string().datetime(),
  dedupeKey: z.string(),
});

export type IntelligenceAlertCandidate = z.infer<typeof intelligenceAlertCandidateSchema>;

function candidateId(recipientId: string, changeId: string) {
  return `${recipientId}:${changeId}`;
}

export function buildAlertCandidates(args: {
  changes: IntelligenceChange[];
  recipients: IntelligenceAlertRecipient[];
  createdAt: string;
}): IntelligenceAlertCandidate[] {
  const createdAt = z.string().datetime().parse(args.createdAt);
  const changes = args.changes.map((change) => intelligenceChangeSchema.parse(change));
  const recipients = args.recipients.map((recipient) => intelligenceAlertRecipientSchema.parse(recipient));
  const candidates: IntelligenceAlertCandidate[] = [];

  for (const recipient of recipients) {
    for (const change of changes) {
      if (!isRelevantChange(change, recipient.preferences)) continue;
      const id = candidateId(recipient.id, change.id);
      candidates.push(intelligenceAlertCandidateSchema.parse({
        id,
        recipientId: recipient.id,
        organizationId: recipient.organizationId,
        change,
        channels: recipient.channels,
        createdAt,
        dedupeKey: id,
      }));
    }
  }

  return candidates;
}

/**
 * Delivery adapters use this before sending. It deliberately does not send anything itself.
 * A future DB-backed outbox can persist delivered dedupe keys atomically.
 */
export function removeDeliveredCandidates(
  candidates: IntelligenceAlertCandidate[],
  deliveredDedupeKeys: Iterable<string>,
): IntelligenceAlertCandidate[] {
  const delivered = new Set(deliveredDedupeKeys);
  return candidates
    .map((candidate) => intelligenceAlertCandidateSchema.parse(candidate))
    .filter((candidate) => !delivered.has(candidate.dedupeKey));
}

export function hasImmediateChannel(recipient: IntelligenceAlertRecipient): boolean {
  const parsed = intelligenceAlertRecipientSchema.parse(recipient);
  return parsed.channels.some((channel) => channel === 'push' || channel === 'webhook');
}

export function effectiveAlertMode(preferences: IntelligencePreferences) {
  return intelligencePreferenceSchema.parse(preferences).alertMode;
}
