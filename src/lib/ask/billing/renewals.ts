// Monthly renewal for providers without a provider-side subscription
// (Revolut Merchant: merchant-initiated charge of the card saved for the
// merchant; GP webpay: recurring payment via the Web Services API, blocked
// until the merchant WS contract exists). Stripe renews by itself.
//
// - Runs from the scheduled maintenance call, never from a browser.
// - A renewal is a server-side checkout record bound to the user, with a
//   deterministic reference per period and attempt, so a retried run never
//   charges twice; the provider also receives it as idempotency key.
// - 'submitted' grants nothing. Access is extended only by the provider's
//   verified settlement event for that checkout (processWebhook).
// - Cancelled subscriptions, refunded or disputed periods and expired access
//   are never renewed. A declined charge is recorded (PAYMENT_FAILED) and retried
//   at most MAX_ATTEMPTS times, 24 hours apart, within the grace period.

import { createHash } from 'node:crypto';
import { applyVerifiedPaymentEvent, DAJC_AI_MONTHLY_EUR_CENTS, type CardProvider, type SubscriptionLedger } from '../paid/subscription';
import type { BillingDeps } from './service';
import { NotSupportedByProvider, PaymentProviderRejected, PaymentProviderUnavailable } from './types';

export const RENEWAL_LEAD_MS = 24 * 3_600_000;
export const RENEWAL_GRACE_MS = 3 * 86_400_000;
export const RENEWAL_RETRY_MS = 24 * 3_600_000;
export const MAX_ATTEMPTS = 3;
const RENEWING: CardProvider[] = ['REVOLUT_MERCHANT', 'GP_WEBPAY', 'DAJC_SANDBOX'];

export interface RenewalRunResult {
  considered: number;
  submitted: number;
  declined: number;
  blocked: number;
  skipped: number;
  unavailable: number;
}

/** The period end a renewal would continue, if the ledger is due for one now. */
export function dueUntil(ledger: SubscriptionLedger, now: Date): string | null {
  if (ledger.cancelAtPeriodEnd) return null;
  const valid = ledger.settled.filter((p) => !ledger.reversedPaymentRefs.includes(p.paymentRef));
  // Any reversal (refund, dispute) stops automatic renewal until a new checkout.
  if (valid.length === 0 || valid.length < ledger.settled.length) return null;
  const latest = valid.sort((a, b) => Date.parse(b.until) - Date.parse(a.until))[0];
  const until = Date.parse(latest.until);
  if (now.getTime() < until - RENEWAL_LEAD_MS || now.getTime() > until + RENEWAL_GRACE_MS) return null;
  return latest.until;
}

export function renewalRef(userId: string, periodEnd: string, attempt: number): string {
  return `rnw_${createHash('sha256').update(`${userId}|${periodEnd}|${attempt}`).digest('base64url').slice(0, 32)}`;
}

export async function runRenewals(deps: BillingDeps): Promise<RenewalRunResult> {
  const now = deps.now?.() ?? new Date();
  const result: RenewalRunResult = { considered: 0, submitted: 0, declined: 0, blocked: 0, skipped: 0, unavailable: 0 };
  const adapter = deps.adapter;
  if (!adapter.chargeRenewal || !RENEWING.includes(adapter.provider)) return result;
  for (const { userId, ledger } of await deps.paid.listRenewableLedgers([adapter.provider])) {
    const until = dueUntil(ledger, now);
    if (!until) continue;
    result.considered += 1;
    // Find the next attempt for this period; never two attempts within RENEWAL_RETRY_MS.
    let attempt = 1;
    let previous = null;
    for (; attempt <= MAX_ATTEMPTS; attempt++) {
      const existing = await deps.paid.getCheckout(renewalRef(userId, until, attempt));
      if (!existing) break;
      previous = existing;
    }
    if (attempt > MAX_ATTEMPTS || (previous && previous.status === 'COMPLETED') || (previous && now.getTime() - previous.createdAt.getTime() < RENEWAL_RETRY_MS)) {
      result.skipped += 1;
      continue;
    }
    const checkoutRef = renewalRef(userId, until, attempt);
    await deps.paid.createCheckout({
      checkoutRef, userId, provider: adapter.provider, amountCents: DAJC_AI_MONTHLY_EUR_CENTS, currency: 'EUR',
      status: 'OPEN', providerSessionRef: null, createdAt: now, expiresAt: new Date(now.getTime() + RENEWAL_GRACE_MS),
    });
    try {
      const outcome = await adapter.chargeRenewal({ customerRef: ledger.customerRef, checkoutRef });
      await deps.paid.setCheckoutStatus(checkoutRef, 'OPEN', outcome.providerRef);
      if (outcome.status === 'submitted') {
        result.submitted += 1;
        await deps.paid.appendAudit({ actor: 'system:renewal', action: 'RENEWAL_SUBMITTED', subject: `user:${userId}`, details: { provider: adapter.provider, checkoutRef, attempt, periodEnd: until, mode: adapter.mode } }, now);
        continue;
      }
      result.declined += 1;
      await deps.paid.setCheckoutStatus(checkoutRef, 'EXPIRED');
      const eventId = `renewal-declined:${checkoutRef}`;
      // A declined charge is a fact about the subscription, but it never changes paid access.
      await deps.paid.applyPaymentEvent({
        provider: adapter.provider, eventId, kind: 'PAYMENT_FAILED', payloadSha256: createHash('sha256').update(eventId).digest('hex'), receivedAt: now,
        userId, customerRef: ledger.customerRef,
        mutate: (current) => applyVerifiedPaymentEvent(current, { kind: 'PAYMENT_FAILED', eventId, provider: ledger.provider, customerRef: ledger.customerRef, userId, occurredAt: now.toISOString() }),
        outbox: [], audit: { actor: 'system:renewal', action: 'RENEWAL_DECLINED', subject: `user:${userId}`, details: { provider: adapter.provider, checkoutRef, attempt, reason: outcome.status === 'no_saved_card' ? 'no_saved_card' : outcome.reason ?? null } },
      });
    } catch (error) {
      await deps.paid.setCheckoutStatus(checkoutRef, 'EXPIRED');
      if (error instanceof NotSupportedByProvider) {
        result.blocked += 1;
        await deps.paid.appendAudit({ actor: 'system:renewal', action: 'RENEWAL_BLOCKED', subject: `user:${userId}`, details: { provider: adapter.provider, reason: 'provider API contract missing' } }, now);
      } else if (error instanceof PaymentProviderUnavailable || error instanceof PaymentProviderRejected) {
        result.unavailable += 1;
        await deps.paid.appendAudit({ actor: 'system:renewal', action: 'RENEWAL_ERROR', subject: `user:${userId}`, details: { provider: adapter.provider, error: error.name } }, now);
      } else {
        throw error;
      }
    }
  }
  return result;
}
