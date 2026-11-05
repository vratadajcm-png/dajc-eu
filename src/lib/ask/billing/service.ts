// Billing lifecycle of paid DAJC AI (EUR 15 / month):
//   checkout -> verified payment -> activation -> renewal -> invoice
//   -> cancellation (access until the paid period ends) -> refund / dispute.
//
// Access is granted only from a provider event that verifyWebhook() has
// authenticated (and, where the provider's webhook carries only an id,
// confirm() has re-read from the provider API). The user is resolved from
// records DAJC created server-side - the checkout (bound to the signed-in
// user) or the customer binding made from that checkout - never from a
// browser or from free fields of the event. Every event is applied exactly
// once (provider, eventId) together with its ledger change, accounting
// outbox entries and audit record.

import { createHash } from 'node:crypto';
import type { AskStore } from '../store/types';
import type { PaidConfig } from '../paid/config';
import { applyVerifiedPaymentEvent, paidAccess, DAJC_AI_MONTHLY_EUR_CENTS, type SubscriptionLedger, type VerifiedPaymentEvent } from '../paid/subscription';
import type { OutboxInput, PaidStore, RefundRow } from '../store/paid-types';
import { isoDay } from '../own-data';
import {
  NotSupportedByProvider, PaymentProviderRejected, PaymentProviderUnavailable, WebhookAuthError,
  type PaymentAdapter, type ProviderEvent, type WebhookRequest,
} from './types';

export interface BillingDeps {
  config: PaidConfig;
  askStore: AskStore;
  paid: PaidStore;
  adapter: PaymentAdapter;
  publicOrigin: string;
  env: Record<string, string | undefined>;
  /** Result of paidReleased(); passed to paidAccess(). */
  released: boolean;
  now?: () => Date;
}

const CHECKOUT_TTL_MS = 24 * 3_600_000;
const LEDGER_ERRORS = new Set(['INVALID_VERIFIED_PAYMENT_EVENT', 'INVALID_PAID_PLAN', 'INVALID_SUBSCRIPTION_PERIOD', 'INVALID_PAYMENT_REFERENCE', 'PAYMENT_REFERENCE_CONFLICT', 'SUBSCRIPTION_SUBJECT_MISMATCH']);
const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');
const nowOf = (deps: Pick<BillingDeps, 'now'>) => deps.now?.() ?? new Date();

export interface SubscriptionStatus {
  active: boolean;
  reason: string;
  paidUntil: string | null;
  cancelAtPeriodEnd: boolean;
  provider: string | null;
  priceEurCents: number;
  periods: Array<{ paymentRef: string; from: string; until: string; reversed: boolean }>;
  refunds: Array<{ paymentRef: string; status: RefundRow['status']; createdAt: string }>;
}

export function accessOf(userId: string, ledger: SubscriptionLedger | null, deps: Pick<BillingDeps, 'env' | 'released'>, now: Date) {
  return paidAccess({ authenticatedUserId: userId, ledger, now, env: { ...deps.env, DAJC_AI_PAID_ENABLED: deps.env.DAJC_AI_PAID_ENABLED }, released: deps.released });
}

export async function subscriptionStatus(userId: string, deps: BillingDeps): Promise<SubscriptionStatus> {
  const now = nowOf(deps);
  const ledger = await deps.paid.getLedger(userId);
  const access = accessOf(userId, ledger, deps, now);
  const refunds = await deps.paid.listRefundRequests(userId);
  return {
    active: access.allowed,
    reason: access.reason,
    paidUntil: access.paidUntil,
    cancelAtPeriodEnd: Boolean(ledger?.cancelAtPeriodEnd),
    provider: ledger?.provider ?? null,
    priceEurCents: DAJC_AI_MONTHLY_EUR_CENTS,
    periods: (ledger?.settled ?? []).map((p) => ({ paymentRef: p.paymentRef, from: p.from, until: p.until, reversed: ledger!.reversedPaymentRefs.includes(p.paymentRef) })),
    refunds: refunds.map((r) => ({ paymentRef: r.paymentRef, status: r.status, createdAt: r.createdAt.toISOString() })),
  };
}

export type CheckoutOutcome =
  | { status: 'redirect'; url: string; checkoutRef: string }
  | { status: 'already_active' | 'limited' | 'unavailable' | 'rejected' };

export async function startCheckout(userId: string, lang: 'en' | 'cs', deps: BillingDeps): Promise<CheckoutOutcome> {
  const now = nowOf(deps);
  if (accessOf(userId, await deps.paid.getLedger(userId), deps, now).allowed) return { status: 'already_active' };
  if (!(await deps.askStore.hitRateLimit(`checkout:${userId}`, 3600, 5, now))) return { status: 'limited' };
  const checkoutRef = deps.adapter.newCheckoutRef();
  const page = new URL('/intelligence/ask', deps.publicOrigin);
  if (lang === 'cs') page.searchParams.set('lang', 'cs');
  const success = new URL(page);
  success.searchParams.set('billing', 'success');
  const cancel = new URL(page);
  cancel.searchParams.set('billing', 'cancelled');
  const returnUrl = new URL(`/api/ask/billing/return/${deps.adapter.provider === 'GP_WEBPAY' ? 'gpwebpay' : 'provider'}`, deps.publicOrigin);
  // The server-side record exists before the customer can pay.
  await deps.paid.createCheckout({
    checkoutRef, userId, provider: deps.adapter.provider, amountCents: DAJC_AI_MONTHLY_EUR_CENTS, currency: 'EUR',
    status: 'OPEN', providerSessionRef: null, createdAt: now, expiresAt: new Date(now.getTime() + CHECKOUT_TTL_MS),
  });
  try {
    const result = await deps.adapter.createCheckout({ checkoutRef, userId, successUrl: success.toString(), cancelUrl: cancel.toString(), returnUrl: returnUrl.toString(), lang });
    await deps.paid.setCheckoutStatus(checkoutRef, 'OPEN', result.providerSessionRef);
    await deps.paid.appendAudit({ actor: `user:${userId}`, action: 'CHECKOUT_STARTED', subject: `user:${userId}`, details: { provider: deps.adapter.provider, checkoutRef, mode: deps.adapter.mode } }, now);
    return { status: 'redirect', url: result.redirectUrl, checkoutRef };
  } catch (error) {
    await deps.paid.setCheckoutStatus(checkoutRef, 'EXPIRED');
    await deps.paid.appendAudit({ actor: 'system', action: 'CHECKOUT_FAILED', subject: `user:${userId}`, details: { provider: deps.adapter.provider, error: (error as Error)?.name } }, now);
    if (error instanceof PaymentProviderUnavailable) return { status: 'unavailable' };
    if (error instanceof PaymentProviderRejected) return { status: 'rejected' };
    throw error;
  }
}

export type EventOutcome = 'applied' | 'duplicate' | 'ignored' | 'retry' | 'rejected';

export interface WebhookOutcome {
  status: 'ok' | 'auth_failed' | 'retry';
  events: Array<{ eventId: string; kind: string; outcome: EventOutcome }>;
}

async function resolveUser(event: ProviderEvent, deps: BillingDeps): Promise<{ userId: string | null; fromCheckout: boolean }> {
  if (event.checkoutRef) {
    const checkout = await deps.paid.getCheckout(event.checkoutRef);
    if (checkout && checkout.provider === event.provider) return { userId: checkout.userId, fromCheckout: true };
  }
  if (event.customerRef) {
    const customer = await deps.paid.findCustomer(event.provider, event.customerRef);
    if (customer) return { userId: customer.userId, fromCheckout: false };
  }
  if (event.paymentRef) {
    const userId = await deps.paid.findUserByPaymentRef(event.provider, event.paymentRef);
    if (userId) return { userId, fromCheckout: false };
  }
  return { userId: null, fromCheckout: false };
}

function outboxFor(event: ProviderEvent, userId: string, ledger: SubscriptionLedger | null): OutboxInput[] {
  const ref = `${event.provider}:${event.paymentRef}`;
  if (event.kind === 'PAYMENT_SETTLED') {
    const items: OutboxInput[] = [{
      idemKey: `invoice:${ref}`, kind: 'INVOICE',
      payload: {
        provider: event.provider, paymentRef: event.paymentRef, userRef: userId, amountCents: event.amountCents, currency: event.currency,
        periodStart: event.periodStart, periodEnd: event.periodEnd, paidAt: event.occurredAt, billingCountry: event.billingCountry,
      },
    }];
    if (event.feeCents !== null) {
      items.push({ idemKey: `fee:${ref}`, kind: 'GATEWAY_FEE', payload: { provider: event.provider, paymentRef: event.paymentRef, feeCents: event.feeCents, currency: event.currency, at: event.occurredAt } });
    }
    return items;
  }
  if (event.kind === 'PAYMENT_REFUNDED') {
    const period = ledger?.settled.find((p) => p.paymentRef === event.paymentRef);
    return [{ idemKey: `credit:${ref}`, kind: 'CREDIT_NOTE', payload: { provider: event.provider, paymentRef: event.paymentRef, userRef: userId, amountCents: period?.amountCents ?? DAJC_AI_MONTHLY_EUR_CENTS, currency: 'EUR', refundedAt: event.occurredAt } }];
  }
  if (event.kind === 'PAYMENT_DISPUTED') {
    return [{ idemKey: `dispute:${ref}`, kind: 'DISPUTE_NOTICE', payload: { provider: event.provider, paymentRef: event.paymentRef, userRef: userId, at: event.occurredAt } }];
  }
  return [];
}

function verifiedEvent(event: ProviderEvent, userId: string, customerRef: string): VerifiedPaymentEvent {
  const base = { eventId: event.eventId, provider: event.provider, customerRef, userId, occurredAt: new Date(event.occurredAt).toISOString() };
  switch (event.kind) {
    case 'PAYMENT_SETTLED':
      return {
        ...base, kind: 'PAYMENT_SETTLED', paymentRef: event.paymentRef!, amountCents: event.amountCents ?? -1, currency: (event.currency ?? '') as 'EUR',
        periodStart: event.periodStart ? new Date(event.periodStart).toISOString() : '', periodEnd: event.periodEnd ? new Date(event.periodEnd).toISOString() : '',
      };
    case 'PAYMENT_REFUNDED':
    case 'PAYMENT_DISPUTED':
      return { ...base, kind: event.kind, paymentRef: event.paymentRef! };
    case 'PAYMENT_FAILED':
    case 'CANCEL_AT_PERIOD_END':
      return { ...base, kind: event.kind };
    default:
      throw new Error('NOT_A_LEDGER_EVENT');
  }
}

async function handleEvent(raw: ProviderEvent, payloadSha256: string, deps: BillingDeps): Promise<EventOutcome> {
  const now = nowOf(deps);
  if (raw.provider !== deps.adapter.provider) return 'rejected';
  const record = (outcome: 'IGNORED' | 'REJECTED', action: string, userId: string | null, details: Record<string, unknown> = {}) =>
    deps.paid.applyPaymentEvent({
      provider: raw.provider, eventId: raw.eventId, kind: raw.kind, payloadSha256, receivedAt: now, userId, customerRef: raw.customerRef,
      mutate: null, outbox: [], ignoredOutcome: outcome,
      audit: { actor: `provider:${raw.provider}`, action, subject: userId ? `user:${userId}` : `provider:${raw.provider}`, details: { eventId: raw.eventId, sourceType: raw.sourceType, ...details } },
    });

  if (raw.kind === 'IGNORED') {
    const result = await record('IGNORED', 'PROVIDER_EVENT_IGNORED', null);
    return result === 'duplicate' ? 'duplicate' : 'ignored';
  }

  let event = raw;
  if (event.needsConfirmation) {
    const confirmed = await deps.adapter.confirm(event);
    if (!confirmed) {
      const result = await record('REJECTED', 'PAYMENT_NOT_CONFIRMED', null, { paymentRef: event.paymentRef });
      return result === 'duplicate' ? 'duplicate' : 'rejected';
    }
    event = confirmed;
  }

  const { userId } = await resolveUser(event, deps);

  if (event.kind === 'CHECKOUT_COMPLETED') {
    const checkout = event.checkoutRef ? await deps.paid.getCheckout(event.checkoutRef) : null;
    if (!checkout || checkout.provider !== event.provider || !event.customerRef) {
      const result = await record('REJECTED', 'CHECKOUT_UNKNOWN', null, { checkoutRef: event.checkoutRef });
      return result === 'duplicate' ? 'duplicate' : 'rejected';
    }
    const bound = await deps.paid.bindCustomer({ provider: event.provider, customerRef: event.customerRef, userId: checkout.userId, subscriptionRef: event.subscriptionRef });
    if (bound === 'conflict') {
      const result = await record('REJECTED', 'CUSTOMER_BOUND_TO_OTHER_USER', checkout.userId, { checkoutRef: checkout.checkoutRef });
      return result === 'duplicate' ? 'duplicate' : 'rejected';
    }
    await deps.paid.setCheckoutStatus(checkout.checkoutRef, 'COMPLETED');
    const result = await record('IGNORED', 'CHECKOUT_COMPLETED', checkout.userId, { checkoutRef: checkout.checkoutRef });
    return result === 'duplicate' ? 'duplicate' : 'applied';
  }

  if (!userId) {
    // A payment the server cannot attribute yet (e.g. delivered before the
    // checkout record is visible): the provider redelivers it later.
    if (event.kind === 'PAYMENT_SETTLED') return 'retry';
    const result = await record('IGNORED', 'UNATTRIBUTED_EVENT', null, { kind: event.kind, paymentRef: event.paymentRef });
    return result === 'duplicate' ? 'duplicate' : 'ignored';
  }

  const ledger = await deps.paid.getLedger(userId);
  const customerRef = event.customerRef ?? ledger?.customerRef ?? (event.checkoutRef ? `chk-${event.checkoutRef}` : null);
  if (!customerRef || (event.kind !== 'PAYMENT_SETTLED' && !ledger)) {
    const result = await record('IGNORED', 'NO_SUBSCRIPTION_FOR_EVENT', userId, { kind: event.kind });
    return result === 'duplicate' ? 'duplicate' : 'ignored';
  }
  if (event.kind === 'PAYMENT_SETTLED' && event.customerRef) {
    const bound = await deps.paid.bindCustomer({ provider: event.provider, customerRef: event.customerRef, userId, subscriptionRef: event.subscriptionRef });
    if (bound === 'conflict') {
      const result = await record('REJECTED', 'CUSTOMER_BOUND_TO_OTHER_USER', userId, { paymentRef: event.paymentRef });
      return result === 'duplicate' ? 'duplicate' : 'rejected';
    }
    if (event.checkoutRef) await deps.paid.setCheckoutStatus(event.checkoutRef, 'COMPLETED');
  }

  let duplicateSubscription = false;
  const verified = verifiedEvent(event, userId, customerRef);
  const mutate = (current: SubscriptionLedger | null): SubscriptionLedger => {
    let previous = current;
    // A new subscription (new provider customer) after an earlier one: keep
    // the history of paid and reversed periods under the new subject.
    if (previous && verified.kind === 'PAYMENT_SETTLED' && (previous.provider !== verified.provider || previous.customerRef !== verified.customerRef)) {
      duplicateSubscription = accessOf(userId, previous, deps, now).allowed;
      previous = { ...previous, provider: verified.provider, customerRef: verified.customerRef, cancelAtPeriodEnd: false };
    }
    if (previous && verified.kind !== 'PAYMENT_SETTLED') {
      return applyVerifiedPaymentEvent(previous, { ...verified, provider: previous.provider, customerRef: previous.customerRef } as VerifiedPaymentEvent);
    }
    return applyVerifiedPaymentEvent(previous, verified);
  };
  let result: 'applied' | 'duplicate' | 'ignored';
  try {
    result = await deps.paid.applyPaymentEvent({
      provider: event.provider, eventId: event.eventId, kind: event.kind, payloadSha256, receivedAt: now, userId, customerRef,
      mutate, outbox: outboxFor(event, userId, ledger),
      audit: {
        actor: `provider:${event.provider}`, action: event.kind, subject: `user:${userId}`,
        details: { eventId: event.eventId, sourceType: event.sourceType, paymentRef: event.paymentRef, amountCents: event.amountCents, periodEnd: event.periodEnd, mode: deps.adapter.mode },
      },
    });
  } catch (error) {
    // An authentic event the subscription rules refuse (wrong price, impossible
    // period, conflicting reference): nothing was applied; record it for a human
    // instead of letting the provider redeliver it forever.
    const reason = String((error as Error)?.message ?? '');
    if (!LEDGER_ERRORS.has(reason)) throw error;
    const recorded = await record('REJECTED', 'PAYMENT_EVENT_REJECTED', userId, { reason, kind: event.kind, paymentRef: event.paymentRef, amountCents: event.amountCents });
    return recorded === 'duplicate' ? 'duplicate' : 'rejected';
  }
  if (result === 'applied' && duplicateSubscription && event.paymentRef) {
    // Two paid subscriptions at once: keep access, queue the newer payment for a reviewed refund.
    await deps.paid.createRefundRequest({ userId, provider: event.provider, paymentRef: event.paymentRef, reason: 'DUPLICATE_SUBSCRIPTION', status: 'PENDING_REVIEW' }, now);
  }
  if (result === 'applied' && event.kind === 'PAYMENT_REFUNDED' && event.paymentRef) {
    const pending = (await deps.paid.listRefundRequests(userId)).find((r) => r.paymentRef === event.paymentRef && r.status === 'APPROVED');
    if (pending) await deps.paid.decideRefundRequest(pending.id, 'APPROVED', 'EXECUTED', `provider:${event.provider}`, now);
  }
  return result;
}

export async function processWebhook(request: Omit<WebhookRequest, 'now'>, deps: BillingDeps): Promise<WebhookOutcome> {
  const now = nowOf(deps);
  let events: ProviderEvent[];
  try {
    events = await deps.adapter.verifyWebhook({ ...request, now });
  } catch (error) {
    if (error instanceof WebhookAuthError) {
      // Counted, never applied. No body or header is stored.
      await deps.paid.appendAudit({ actor: 'anonymous', action: 'WEBHOOK_REJECTED', subject: `provider:${deps.adapter.provider}`, details: { reason: error.message } }, now).catch(() => undefined);
      return { status: 'auth_failed', events: [] };
    }
    throw error;
  }
  const payloadSha256 = sha256(request.query ? request.query.toString() : request.rawBody);
  const results: WebhookOutcome['events'] = [];
  for (const event of events) {
    const outcome = await handleEvent(event, payloadSha256, deps);
    results.push({ eventId: event.eventId, kind: event.kind, outcome });
  }
  return { status: results.some((r) => r.outcome === 'retry') ? 'retry' : 'ok', events: results };
}

export type CancelOutcome = 'requested' | 'no_subscription' | 'unavailable';

export async function requestCancellation(userId: string, deps: BillingDeps): Promise<CancelOutcome> {
  const now = nowOf(deps);
  const ledger = await deps.paid.getLedger(userId);
  if (!ledger) return 'no_subscription';
  const customer = (await deps.paid.findCustomersOfUser(userId)).find((c) => c.provider === ledger.provider && c.customerRef === ledger.customerRef);
  try {
    await deps.adapter.cancelAtPeriodEnd({ customerRef: ledger.customerRef, subscriptionRef: customer?.subscriptionRef ?? null });
  } catch (error) {
    if (error instanceof PaymentProviderUnavailable) return 'unavailable';
    throw error;
  }
  await deps.paid.appendAudit({ actor: `user:${userId}`, action: 'CANCELLATION_REQUESTED', subject: `user:${userId}`, details: { provider: ledger.provider } }, now);
  if (deps.adapter.provider !== 'STRIPE') {
    // Providers without a provider-side subscription: DAJC itself stops renewals.
    // A cancellation never grants access, so the signed-in request is sufficient.
    await deps.paid.applyPaymentEvent({
      provider: ledger.provider, eventId: `dajc-cancel:${userId}:${now.getTime()}`, kind: 'CANCEL_AT_PERIOD_END', payloadSha256: sha256(`cancel:${userId}`),
      receivedAt: now, userId, customerRef: ledger.customerRef,
      mutate: (current) => applyVerifiedPaymentEvent(current, { kind: 'CANCEL_AT_PERIOD_END', eventId: `dajc-cancel:${userId}:${now.getTime()}`, provider: ledger.provider, customerRef: ledger.customerRef, userId, occurredAt: now.toISOString() }),
      outbox: [], audit: { actor: `user:${userId}`, action: 'CANCEL_AT_PERIOD_END', subject: `user:${userId}` },
    });
  }
  return 'requested';
}

export type RefundOutcome =
  | { status: 'executed' | 'pending_review'; requestId: string }
  | { status: 'not_eligible'; reason: string }
  | { status: 'exists' | 'no_payment' | 'unavailable' };

/** Self-service refund of the latest payment under the approved policy; everything else goes to human review. */
export async function requestRefund(userId: string, reason: string, deps: BillingDeps): Promise<RefundOutcome> {
  const now = nowOf(deps);
  const ledger = await deps.paid.getLedger(userId);
  const latest = ledger?.settled.filter((p) => !ledger.reversedPaymentRefs.includes(p.paymentRef)).sort((a, b) => Date.parse(b.from) - Date.parse(a.from))[0];
  if (!ledger || !latest) return { status: 'no_payment' };
  const previous = await deps.paid.listRefundRequests(userId);
  if (previous.some((r) => r.paymentRef === latest.paymentRef)) return { status: 'exists' };
  const policy = deps.config.refund;
  const withinWindow = now.getTime() - Date.parse(latest.from) <= policy.windowDays * 86_400_000;
  const selfServiceUsed = previous.filter((r) => r.decidedBy === 'policy:self-service').length;
  const usage = await deps.paid.getPaidUsage(userId, isoDay(now), isoDay(now).slice(0, 7));
  const selfService = withinWindow && selfServiceUsed < policy.maxSelfService && usage.month <= policy.maxPaidQuestions;
  const cleanReason = String(reason || 'REQUESTED_BY_CUSTOMER').replace(/[^\p{L}\p{N} .,_-]/gu, '').slice(0, 200) || 'REQUESTED_BY_CUSTOMER';
  const created = await deps.paid.createRefundRequest({ userId, provider: ledger.provider, paymentRef: latest.paymentRef, reason: cleanReason, status: selfService ? 'APPROVED' : 'PENDING_REVIEW' }, now);
  if (created.status === 'exists') return { status: 'exists' };
  await deps.paid.appendAudit({ actor: `user:${userId}`, action: selfService ? 'REFUND_APPROVED_BY_POLICY' : 'REFUND_REQUESTED', subject: `user:${userId}`, details: { paymentRef: latest.paymentRef, withinWindow, selfServiceUsed, paidQuestions: usage.month } }, now);
  if (!selfService) return { status: 'pending_review', requestId: created.id };
  await deps.paid.decideRefundRequest(created.id, 'APPROVED', 'APPROVED', 'policy:self-service', now);
  return executeRefund(created.id, userId, latest.paymentRef, latest.amountCents, 'policy:self-service', deps);
}

async function executeRefund(requestId: string, userId: string, paymentRef: string, amountCents: number, decidedBy: string, deps: BillingDeps): Promise<RefundOutcome> {
  const now = nowOf(deps);
  try {
    const { refundRef } = await deps.adapter.refund({ paymentRef, amountCents, idempotencyKey: `refund:${requestId}` });
    await deps.paid.appendAudit({ actor: decidedBy, action: 'REFUND_SUBMITTED', subject: `user:${userId}`, details: { paymentRef, refundRef, mode: deps.adapter.mode } }, now);
    // Access ends when the provider confirms the refund (PAYMENT_REFUNDED event).
    await deps.paid.decideRefundRequest(requestId, 'APPROVED', 'APPROVED', decidedBy, now, refundRef);
    return { status: 'executed', requestId };
  } catch (error) {
    if (error instanceof NotSupportedByProvider) {
      await deps.paid.decideRefundRequest(requestId, 'APPROVED', 'PENDING_REVIEW', decidedBy, now);
      return { status: 'pending_review', requestId };
    }
    if (error instanceof PaymentProviderUnavailable) return { status: 'unavailable' };
    await deps.paid.decideRefundRequest(requestId, 'APPROVED', 'FAILED', decidedBy, now);
    await deps.paid.appendAudit({ actor: decidedBy, action: 'REFUND_FAILED', subject: `user:${userId}`, details: { paymentRef, error: (error as Error)?.name } }, now);
    return { status: 'not_eligible', reason: 'provider_rejected' };
  }
}

/** A billing reviewer (role BILLING_REVIEWER, granted by the owner) decides a queued refund. */
export async function decideRefund(reviewerId: string, requestId: string, approve: boolean, deps: BillingDeps): Promise<RefundOutcome | { status: 'forbidden' | 'not_found' }> {
  const now = nowOf(deps);
  if (!(await deps.paid.isReviewer(reviewerId, 'BILLING_REVIEWER'))) return { status: 'forbidden' };
  const request = (await deps.paid.listRefundRequests(null, 'PENDING_REVIEW')).find((r) => r.id === requestId);
  if (!request) return { status: 'not_found' };
  if (request.userId === reviewerId) return { status: 'forbidden' };
  if (!approve) {
    await deps.paid.decideRefundRequest(requestId, 'PENDING_REVIEW', 'REJECTED', `reviewer:${reviewerId}`, now);
    await deps.paid.appendAudit({ actor: `reviewer:${reviewerId}`, action: 'REFUND_REJECTED', subject: `user:${request.userId}`, details: { paymentRef: request.paymentRef } }, now);
    return { status: 'not_eligible', reason: 'rejected_by_reviewer' };
  }
  if (!(await deps.paid.decideRefundRequest(requestId, 'PENDING_REVIEW', 'APPROVED', `reviewer:${reviewerId}`, now))) return { status: 'not_found' };
  const ledger = await deps.paid.getLedger(request.userId);
  const amount = ledger?.settled.find((p) => p.paymentRef === request.paymentRef)?.amountCents ?? DAJC_AI_MONTHLY_EUR_CENTS;
  return executeRefund(requestId, request.userId, request.paymentRef, amount, `reviewer:${reviewerId}`, deps);
}

export async function paymentManagementUrl(userId: string, deps: BillingDeps): Promise<string | null> {
  const ledger = await deps.paid.getLedger(userId);
  if (!ledger) return null;
  const returnUrl = new URL('/intelligence/ask', deps.publicOrigin).toString();
  try {
    return await deps.adapter.managementUrl({ customerRef: ledger.customerRef, returnUrl });
  } catch {
    return null;
  }
}
