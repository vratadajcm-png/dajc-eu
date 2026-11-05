import { describe, expect, it } from 'vitest';
import {
  applyVerifiedPaymentEvent, paidAccess, DAJC_AI_MONTHLY_EUR_CENTS,
  type VerifiedPaymentEvent,
} from '../paid/subscription';

const T = new Date('2026-11-05T12:00:00.000Z');
const event: VerifiedPaymentEvent = {
  kind: 'PAYMENT_SETTLED', eventId: 'evt_20261105_1', provider: 'STRIPE',
  customerRef: 'cust_12345', userId: 'user_12345',
  occurredAt: '2026-11-05T09:00:00.000Z',
  paymentRef: 'payment_12345', amountCents: DAJC_AI_MONTHLY_EUR_CENTS, currency: 'EUR',
  periodStart: '2026-11-05T00:00:00.000Z', periodEnd: '2026-12-05T00:00:00.000Z',
};
const reverse = (kind: 'PAYMENT_REFUNDED' | 'PAYMENT_DISPUTED', suffix = '2'): VerifiedPaymentEvent => ({
  kind, eventId: 'evt_20261105_' + suffix, provider: 'STRIPE',
  customerRef: 'cust_12345', userId: 'user_12345',
  occurredAt: '2026-11-05T10:00:00.000Z', paymentRef: 'payment_12345',
});
const access = (ledger: ReturnType<typeof applyVerifiedPaymentEvent> | null, overrides: Record<string, unknown> = {}) =>
  paidAccess({
    authenticatedUserId: 'user_12345',
    ledger,
    now: T,
    env: { DAJC_AI_PAID_ENABLED: 'true' },
    released: true,
    ...overrides,
  });

describe('DAJC AI paid v1 entitlement contract — no live merchant or webhook', () => {
  it('is disabled in production even with valid payment and a flag', () => {
    const ledger = applyVerifiedPaymentEvent(null, event);
    expect(paidAccess({
      authenticatedUserId: 'user_12345', ledger, now: T,
      env: { DAJC_AI_PAID_ENABLED: 'true' },
    })).toMatchObject({ allowed: false, reason: 'DISABLED' });
    expect(access(ledger, { env: {} })).toMatchObject({ allowed: false, reason: 'DISABLED' });
  });

  it('allows only an authenticated owner with a settled current period', () => {
    const ledger = applyVerifiedPaymentEvent(null, event);
    expect(access(ledger)).toMatchObject({ allowed: true, reason: 'ACTIVE', paidUntil: event.periodEnd });
    expect(access(ledger, { authenticatedUserId: null })).toMatchObject({ allowed: false, reason: 'UNAUTHENTICATED' });
    expect(access(ledger, { authenticatedUserId: 'user_other' })).toMatchObject({ allowed: false, reason: 'WRONG_CUSTOMER' });
    expect(access(null)).toMatchObject({ allowed: false, reason: 'NO_SUBSCRIPTION' });
    expect(access(ledger, { now: new Date(event.periodEnd) })).toMatchObject({ allowed: false, reason: 'EXPIRED' });
    expect(access(ledger, { now: new Date('2026-11-04T00:00:00.000Z') })).toMatchObject({ allowed: false, reason: 'EXPIRED' });
  });

  it('rejects forged pricing, wrong currency, impossible periods and subject mismatch', () => {
    expect(() => applyVerifiedPaymentEvent(null, { ...event, amountCents: 1000 })).toThrow('INVALID_PAID_PLAN');
    expect(() => applyVerifiedPaymentEvent(null, { ...event, currency: 'USD' as 'EUR' })).toThrow('INVALID_PAID_PLAN');
    expect(() => applyVerifiedPaymentEvent(null, { ...event, periodEnd: event.periodStart })).toThrow('INVALID_SUBSCRIPTION_PERIOD');
    const ledger = applyVerifiedPaymentEvent(null, event);
    expect(() => applyVerifiedPaymentEvent(ledger, { ...event, eventId: 'evt_other_123', userId: 'user_other' })).toThrow('SUBSCRIPTION_SUBJECT_MISMATCH');
    expect(() => applyVerifiedPaymentEvent(ledger, { ...event, eventId: 'evt_other_456', provider: 'GP_WEBPAY' })).toThrow('SUBSCRIPTION_SUBJECT_MISMATCH');
  });

  it('does not grant access from a failed payment or a cancellation request', () => {
    const failed: VerifiedPaymentEvent = { ...event, kind: 'PAYMENT_FAILED' };
    const ledger = applyVerifiedPaymentEvent(null, failed);
    expect(access(ledger)).toMatchObject({ allowed: false, reason: 'EXPIRED' });
    const paid = applyVerifiedPaymentEvent(null, event);
    const canceled = applyVerifiedPaymentEvent(paid, { ...event, kind: 'CANCEL_AT_PERIOD_END', eventId: 'evt_cancel_1234' });
    expect(canceled.cancelAtPeriodEnd).toBe(true);
    expect(access(canceled).allowed).toBe(true); // paid through period end
    expect(access(canceled, { now: new Date('2026-12-06T00:00:00.000Z') }).allowed).toBe(false);
  });

  it('makes replayed payment and refund events idempotent', () => {
    const first = applyVerifiedPaymentEvent(null, event);
    expect(applyVerifiedPaymentEvent(first, event)).toEqual(first);
    const refunded = applyVerifiedPaymentEvent(first, reverse('PAYMENT_REFUNDED'));
    expect(access(refunded)).toMatchObject({ allowed: false, reason: 'EXPIRED' });
    expect(applyVerifiedPaymentEvent(refunded, reverse('PAYMENT_REFUNDED'))).toEqual(refunded);
  });

  it('does not resurrect refunded periods when provider events arrive out of order', () => {
    const refundedFirst = applyVerifiedPaymentEvent(null, reverse('PAYMENT_REFUNDED'));
    const settledLate = applyVerifiedPaymentEvent(refundedFirst, event);
    expect(access(settledLate)).toMatchObject({ allowed: false, reason: 'EXPIRED' });
    const disputed = applyVerifiedPaymentEvent(applyVerifiedPaymentEvent(null, event), reverse('PAYMENT_DISPUTED'));
    expect(access(disputed)).toMatchObject({ allowed: false, reason: 'EXPIRED' });
  });

  it('keeps unrelated paid renewal intact if a prior period is refunded', () => {
    const first = applyVerifiedPaymentEvent(null, event);
    const renewal: VerifiedPaymentEvent = {
      ...event, eventId: 'evt_20261205_3', paymentRef: 'payment_renewal_2',
      periodStart: '2026-12-05T00:00:00.000Z', periodEnd: '2027-01-05T00:00:00.000Z',
    };
    const withRenewal = applyVerifiedPaymentEvent(first, renewal);
    const reversedFirst = applyVerifiedPaymentEvent(withRenewal, reverse('PAYMENT_REFUNDED'));
    expect(access(reversedFirst)).toMatchObject({ allowed: false, reason: 'EXPIRED' });
    expect(access(reversedFirst, { now: new Date('2026-12-12T12:00:00.000Z') })).toMatchObject({ allowed: true, reason: 'ACTIVE' });
  });
});
