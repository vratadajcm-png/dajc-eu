import { describe, expect, it } from 'vitest';
import {
  applyDeliveryOutcome,
  createOutboxRecord,
  DisabledIntelligenceDeliveryAdapter,
  leaseOutboxRecord,
  releaseExpiredLease,
} from './delivery';
import type { IntelligenceAlertCandidate } from './alerts';

const candidate: IntelligenceAlertCandidate = {
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
  channels: ['email'],
  createdAt: '2026-08-31T13:00:00.000Z',
  dedupeKey: 'user-1:change-1',
};

describe('DAJC Intelligence delivery state machine', () => {
  it('creates pending outbox records and leases only when available', () => {
    const pending = createOutboxRecord(candidate);
    expect(pending.state).toBe('pending');

    const leased = leaseOutboxRecord({
      record: pending,
      now: '2026-08-31T13:00:00.000Z',
      policy: { maxAttempts: 3, baseDelaySeconds: 60, maxDelaySeconds: 600, leaseSeconds: 120 },
    });
    expect(leased.state).toBe('leased');
    expect(leased.leaseUntil).toBe('2026-08-31T13:02:00.000Z');
  });

  it('marks successful delivery terminally', () => {
    const leased = leaseOutboxRecord({
      record: createOutboxRecord(candidate),
      now: '2026-08-31T13:00:00.000Z',
    });
    const delivered = applyDeliveryOutcome({
      record: leased,
      outcome: { result: 'delivered', providerReference: 'message-1' },
      now: '2026-08-31T13:00:05.000Z',
    });
    expect(delivered.state).toBe('delivered');
    expect(delivered.attemptCount).toBe(1);
    expect(delivered.deliveredAt).toBe('2026-08-31T13:00:05.000Z');
  });

  it('uses bounded exponential retry for retryable failures', () => {
    const policy = { maxAttempts: 3, baseDelaySeconds: 60, maxDelaySeconds: 600, leaseSeconds: 120 };
    const leased = leaseOutboxRecord({ record: createOutboxRecord(candidate), now: '2026-08-31T13:00:00.000Z', policy });
    const failed = applyDeliveryOutcome({
      record: leased,
      outcome: { result: 'retryable-failure', errorCode: 'provider-timeout' },
      now: '2026-08-31T13:00:10.000Z',
      policy,
    });
    expect(failed.state).toBe('failed');
    expect(failed.availableAt).toBe('2026-08-31T13:01:10.000Z');
  });

  it('moves to dead-letter after max attempts', () => {
    const policy = { maxAttempts: 1, baseDelaySeconds: 60, maxDelaySeconds: 600, leaseSeconds: 120 };
    const leased = leaseOutboxRecord({ record: createOutboxRecord(candidate), now: '2026-08-31T13:00:00.000Z', policy });
    const dead = applyDeliveryOutcome({
      record: leased,
      outcome: { result: 'retryable-failure', errorCode: 'provider-timeout' },
      now: '2026-08-31T13:00:10.000Z',
      policy,
    });
    expect(dead.state).toBe('dead-letter');
    expect(dead.attemptCount).toBe(1);
  });

  it('does not retry permanent failures', () => {
    const leased = leaseOutboxRecord({ record: createOutboxRecord(candidate), now: '2026-08-31T13:00:00.000Z' });
    const dead = applyDeliveryOutcome({
      record: leased,
      outcome: { result: 'permanent-failure', errorCode: 'invalid-recipient' },
      now: '2026-08-31T13:00:10.000Z',
    });
    expect(dead.state).toBe('dead-letter');
  });

  it('releases expired leases for safe retry', () => {
    const leased = leaseOutboxRecord({
      record: createOutboxRecord(candidate),
      now: '2026-08-31T13:00:00.000Z',
      policy: { maxAttempts: 3, baseDelaySeconds: 60, maxDelaySeconds: 600, leaseSeconds: 60 },
    });
    const released = releaseExpiredLease({ record: leased, now: '2026-08-31T13:02:00.000Z' });
    expect(released.state).toBe('failed');
    expect(released.lastErrorCode).toBe('lease-expired');
  });

  it('keeps real delivery adapters disabled by default', async () => {
    const adapter = new DisabledIntelligenceDeliveryAdapter('email');
    expect(adapter.enabled).toBe(false);
    await expect(adapter.deliver(candidate)).resolves.toEqual({
      result: 'suppressed',
      reasonCode: 'adapter-disabled',
    });
  });
});
