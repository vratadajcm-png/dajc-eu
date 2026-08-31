import { z } from 'zod';
import { intelligenceAlertCandidateSchema, type IntelligenceAlertCandidate } from './alerts';

export const intelligenceDeliveryStateSchema = z.enum([
  'pending',
  'leased',
  'delivered',
  'failed',
  'suppressed',
  'dead-letter',
]);

export type IntelligenceDeliveryState = z.infer<typeof intelligenceDeliveryStateSchema>;

export const intelligenceOutboxRecordSchema = z.object({
  candidate: intelligenceAlertCandidateSchema,
  state: intelligenceDeliveryStateSchema,
  attemptCount: z.number().int().nonnegative(),
  availableAt: z.string().datetime(),
  leaseUntil: z.string().datetime().optional(),
  lastErrorCode: z.string().max(160).optional(),
  deliveredAt: z.string().datetime().optional(),
});

export type IntelligenceOutboxRecord = z.infer<typeof intelligenceOutboxRecordSchema>;

export const intelligenceRetryPolicySchema = z.object({
  maxAttempts: z.number().int().min(1).max(20),
  baseDelaySeconds: z.number().int().min(1).max(86_400),
  maxDelaySeconds: z.number().int().min(1).max(604_800),
  leaseSeconds: z.number().int().min(10).max(3_600),
});

export type IntelligenceRetryPolicy = z.infer<typeof intelligenceRetryPolicySchema>;

export const defaultIntelligenceRetryPolicy: IntelligenceRetryPolicy = {
  maxAttempts: 5,
  baseDelaySeconds: 60,
  maxDelaySeconds: 3_600,
  leaseSeconds: 120,
};

export type IntelligenceDeliveryOutcome =
  | { result: 'delivered'; providerReference?: string }
  | { result: 'retryable-failure'; errorCode: string }
  | { result: 'permanent-failure'; errorCode: string }
  | { result: 'suppressed'; reasonCode: string };

export interface IntelligenceDeliveryAdapter {
  readonly channel: IntelligenceAlertCandidate['channels'][number];
  readonly enabled: boolean;
  deliver(candidate: IntelligenceAlertCandidate): Promise<IntelligenceDeliveryOutcome>;
}

export class DisabledIntelligenceDeliveryAdapter implements IntelligenceDeliveryAdapter {
  readonly enabled = false;

  constructor(readonly channel: IntelligenceDeliveryAdapter['channel']) {}

  async deliver(): Promise<IntelligenceDeliveryOutcome> {
    return { result: 'suppressed', reasonCode: 'adapter-disabled' };
  }
}

function addSeconds(iso: string, seconds: number): string {
  return new Date(Date.parse(iso) + seconds * 1_000).toISOString();
}

function retryDelaySeconds(attemptCount: number, policy: IntelligenceRetryPolicy): number {
  const exponent = Math.max(0, attemptCount - 1);
  return Math.min(policy.maxDelaySeconds, policy.baseDelaySeconds * (2 ** exponent));
}

export function createOutboxRecord(
  candidate: IntelligenceAlertCandidate,
): IntelligenceOutboxRecord {
  const parsed = intelligenceAlertCandidateSchema.parse(candidate);
  return intelligenceOutboxRecordSchema.parse({
    candidate: parsed,
    state: 'pending',
    attemptCount: 0,
    availableAt: parsed.createdAt,
  });
}

export function leaseOutboxRecord(args: {
  record: IntelligenceOutboxRecord;
  now: string;
  policy?: IntelligenceRetryPolicy;
}): IntelligenceOutboxRecord {
  const record = intelligenceOutboxRecordSchema.parse(args.record);
  const now = z.string().datetime().parse(args.now);
  const policy = intelligenceRetryPolicySchema.parse(args.policy ?? defaultIntelligenceRetryPolicy);

  if (!['pending', 'failed'].includes(record.state)) {
    throw new Error(`Cannot lease outbox record from state ${record.state}`);
  }
  if (Date.parse(record.availableAt) > Date.parse(now)) {
    throw new Error('Outbox record is not available yet');
  }

  return intelligenceOutboxRecordSchema.parse({
    ...record,
    state: 'leased',
    leaseUntil: addSeconds(now, policy.leaseSeconds),
    lastErrorCode: undefined,
  });
}

export function applyDeliveryOutcome(args: {
  record: IntelligenceOutboxRecord;
  outcome: IntelligenceDeliveryOutcome;
  now: string;
  policy?: IntelligenceRetryPolicy;
}): IntelligenceOutboxRecord {
  const record = intelligenceOutboxRecordSchema.parse(args.record);
  const now = z.string().datetime().parse(args.now);
  const policy = intelligenceRetryPolicySchema.parse(args.policy ?? defaultIntelligenceRetryPolicy);

  if (record.state !== 'leased') {
    throw new Error(`Delivery outcome requires leased state, got ${record.state}`);
  }

  const attemptCount = record.attemptCount + 1;

  if (args.outcome.result === 'delivered') {
    return intelligenceOutboxRecordSchema.parse({
      ...record,
      state: 'delivered',
      attemptCount,
      leaseUntil: undefined,
      deliveredAt: now,
      lastErrorCode: undefined,
    });
  }

  if (args.outcome.result === 'suppressed') {
    return intelligenceOutboxRecordSchema.parse({
      ...record,
      state: 'suppressed',
      attemptCount,
      leaseUntil: undefined,
      lastErrorCode: args.outcome.reasonCode,
    });
  }

  if (args.outcome.result === 'permanent-failure' || attemptCount >= policy.maxAttempts) {
    return intelligenceOutboxRecordSchema.parse({
      ...record,
      state: 'dead-letter',
      attemptCount,
      leaseUntil: undefined,
      lastErrorCode: args.outcome.errorCode,
    });
  }

  return intelligenceOutboxRecordSchema.parse({
    ...record,
    state: 'failed',
    attemptCount,
    leaseUntil: undefined,
    lastErrorCode: args.outcome.errorCode,
    availableAt: addSeconds(now, retryDelaySeconds(attemptCount, policy)),
  });
}

export function releaseExpiredLease(args: {
  record: IntelligenceOutboxRecord;
  now: string;
}): IntelligenceOutboxRecord {
  const record = intelligenceOutboxRecordSchema.parse(args.record);
  const now = z.string().datetime().parse(args.now);

  if (record.state !== 'leased') return record;
  if (!record.leaseUntil || Date.parse(record.leaseUntil) > Date.parse(now)) return record;

  return intelligenceOutboxRecordSchema.parse({
    ...record,
    state: 'failed',
    leaseUntil: undefined,
    lastErrorCode: 'lease-expired',
    availableAt: now,
  });
}
