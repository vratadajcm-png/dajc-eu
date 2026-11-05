/**
 * Paid DAJC AI — offline, provider-agnostic subscription ledger policy.
 *
 * No payment provider, customer checkout, webhook endpoint, bank account or
 * production feature is activated by this module. Never construct a
 * VerifiedPaymentEvent from a browser request. A future server-only adapter
 * MUST cryptographically validate provider signatures AND payment settlement,
 * match the merchant account, then persist the event atomically with an
 * idempotency constraint. This pure reducer is not that authentication layer.
 *
 * It intentionally stores no e-mail, card data, bank details or AI questions.
 */
export const DAJC_AI_MONTHLY_EUR_CENTS = 1500;
export const DAJC_AI_PAID_RELEASED = false;

/** DAJC_SANDBOX: synthetic payments for automated and staging tests; never valid in production. */
export type CardProvider = 'STRIPE' | 'REVOLUT_MERCHANT' | 'GP_WEBPAY' | 'DAJC_SANDBOX';
export type SubscriptionEventKind = 'PAYMENT_SETTLED' | 'PAYMENT_REFUNDED' |
  'PAYMENT_DISPUTED' | 'CANCEL_AT_PERIOD_END' | 'PAYMENT_FAILED';

interface EventBase {
  eventId: string;
  provider: CardProvider;
  customerRef: string;
  /** DAJC user ID from authenticated server-side mapping, never the body. */
  userId: string;
  occurredAt: string;
}
export type VerifiedPaymentEvent = EventBase & (
  | { kind: 'PAYMENT_SETTLED'; paymentRef: string; amountCents: number; currency: 'EUR'; periodStart: string; periodEnd: string }
  | { kind: 'PAYMENT_REFUNDED' | 'PAYMENT_DISPUTED'; paymentRef: string }
  | { kind: 'CANCEL_AT_PERIOD_END' | 'PAYMENT_FAILED' }
);

interface PaidPeriod {
  paymentRef: string;
  from: string;
  until: string;
  amountCents: number;
}

export interface SubscriptionLedger {
  userId: string;
  provider: CardProvider;
  customerRef: string;
  settled: PaidPeriod[];
  reversedPaymentRefs: string[];
  seenEventIds: string[];
  cancelAtPeriodEnd: boolean;
}

const ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{3,191}$/;
const PROVIDERS: CardProvider[] = ['STRIPE', 'REVOLUT_MERCHANT', 'GP_WEBPAY', 'DAJC_SANDBOX'];
const KINDS: SubscriptionEventKind[] = [
  'PAYMENT_SETTLED', 'PAYMENT_REFUNDED', 'PAYMENT_DISPUTED',
  'CANCEL_AT_PERIOD_END', 'PAYMENT_FAILED',
];

function parseIso(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const result = Date.parse(value);
  return Number.isFinite(result) && new Date(result).toISOString() === value ? result : null;
}

function validateEvent(event: VerifiedPaymentEvent): void {
  if (!event || !ID.test(event.eventId) || !ID.test(event.customerRef) ||
      !ID.test(event.userId) || !PROVIDERS.includes(event.provider) ||
      !KINDS.includes(event.kind) || parseIso(event.occurredAt) === null) {
    throw new Error('INVALID_VERIFIED_PAYMENT_EVENT');
  }
  if (event.kind === 'PAYMENT_SETTLED') {
    if (!ID.test(event.paymentRef) || event.amountCents !== DAJC_AI_MONTHLY_EUR_CENTS ||
        event.currency !== 'EUR') throw new Error('INVALID_PAID_PLAN');
    const from = parseIso(event.periodStart);
    const until = parseIso(event.periodEnd);
    if (from === null || until === null || until <= from ||
        until - from < 27 * 86_400_000 || until - from > 32 * 86_400_000) {
      throw new Error('INVALID_SUBSCRIPTION_PERIOD');
    }
  } else if (event.kind === 'PAYMENT_DISPUTED' || event.kind === 'PAYMENT_REFUNDED') {
    if (!ID.test(event.paymentRef)) throw new Error('INVALID_PAYMENT_REFERENCE');
  }
}

/**
 * Only a signature-verified payment processing worker may call this reducer,
 * within a DB transaction. It cannot be called by a customer API route.
 * Duplicate events and out-of-order refunds are safe.
 */
export function applyVerifiedPaymentEvent(
  previous: SubscriptionLedger | null, event: VerifiedPaymentEvent,
): SubscriptionLedger {
  validateEvent(event);
  if (previous && (previous.userId !== event.userId ||
    previous.provider !== event.provider || previous.customerRef !== event.customerRef)) {
    throw new Error('SUBSCRIPTION_SUBJECT_MISMATCH');
  }
  const ledger: SubscriptionLedger = previous
    ? {
      ...previous,
      settled: previous.settled.map((p) => ({ ...p })),
      reversedPaymentRefs: [...previous.reversedPaymentRefs],
      seenEventIds: [...previous.seenEventIds],
    }
    : {
      userId: event.userId, provider: event.provider, customerRef: event.customerRef,
      settled: [], reversedPaymentRefs: [], seenEventIds: [], cancelAtPeriodEnd: false,
    };

  if (ledger.seenEventIds.includes(event.eventId)) return ledger;
  // In production, persist a unique (provider,eventId) pair atomically in
  // the database; keeping this list only documents deterministic semantics.
  ledger.seenEventIds.push(event.eventId);

  if (event.kind === 'PAYMENT_SETTLED') {
    const existing = ledger.settled.find((p) => p.paymentRef === event.paymentRef);
    if (existing) {
      if (existing.from !== event.periodStart || existing.until !== event.periodEnd ||
          existing.amountCents !== event.amountCents) throw new Error('PAYMENT_REFERENCE_CONFLICT');
      return ledger;
    }
    ledger.settled.push({
      paymentRef: event.paymentRef, from: event.periodStart,
      until: event.periodEnd, amountCents: event.amountCents,
    });
  } else if (event.kind === 'PAYMENT_REFUNDED' || event.kind === 'PAYMENT_DISPUTED') {
    if (!ledger.reversedPaymentRefs.includes(event.paymentRef)) {
      ledger.reversedPaymentRefs.push(event.paymentRef);
    }
  } else if (event.kind === 'CANCEL_AT_PERIOD_END') {
    ledger.cancelAtPeriodEnd = true;
  }
  // PAYMENT_FAILED never extends or revokes an already settled paid period.
  return ledger;
}

export type PaidAccessReason =
  'DISABLED' | 'UNAUTHENTICATED' | 'NO_SUBSCRIPTION' | 'WRONG_CUSTOMER' | 'EXPIRED' | 'ACTIVE';

/** Client supplied data must never supply authenticatedUserId. */
export function paidAccess(args: {
  authenticatedUserId: string | null;
  ledger: SubscriptionLedger | null;
  now: Date;
  env?: Record<string, string | undefined>;
  /** Tests only; production must use the false compile-time release constant. */
  released?: boolean;
}): { allowed: boolean; reason: PaidAccessReason; paidUntil: string | null } {
  const disabled = args.released !== true && !DAJC_AI_PAID_RELEASED;
  if (disabled || args.env?.DAJC_AI_PAID_ENABLED !== 'true') {
    return { allowed: false, reason: 'DISABLED', paidUntil: null };
  }
  if (!args.authenticatedUserId) return { allowed: false, reason: 'UNAUTHENTICATED', paidUntil: null };
  const ledger = args.ledger;
  if (!ledger) return { allowed: false, reason: 'NO_SUBSCRIPTION', paidUntil: null };
  // Synthetic sandbox payments never grant access in a production deployment.
  if (ledger.provider === 'DAJC_SANDBOX' && args.env?.VERCEL_ENV === 'production') {
    return { allowed: false, reason: 'NO_SUBSCRIPTION', paidUntil: null };
  }
  if (ledger.userId !== args.authenticatedUserId) {
    return { allowed: false, reason: 'WRONG_CUSTOMER', paidUntil: null };
  }
  const now = args.now.getTime();
  const active = ledger.settled.filter((period) =>
    !ledger.reversedPaymentRefs.includes(period.paymentRef) &&
    Date.parse(period.from) <= now && now < Date.parse(period.until)
  ).sort((a, b) => Date.parse(b.until) - Date.parse(a.until));
  if (active.length === 0) return { allowed: false, reason: 'EXPIRED', paidUntil: null };
  return { allowed: true, reason: 'ACTIVE', paidUntil: active[0].until };
}
