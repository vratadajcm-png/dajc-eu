// Stripe adapter (fallback option). Plain fetch, no SDK.
//
// Webhooks: "Stripe-Signature: t=<unix>,v1=<hex>[,v1=<hex>]" where
// v1 = HMAC-SHA256(endpoint secret, "<t>.<raw body>"); tolerance 5 minutes.
// Event mapping (contract verified only against synthetic fixtures - the
// account's pinned API version must be checked in the Stripe test mode):
//   checkout.session.completed      -> CHECKOUT_COMPLETED (binds customer)
//   invoice.paid                    -> PAYMENT_SETTLED (amount, period, country)
//   invoice.payment_failed          -> PAYMENT_FAILED
//   customer.subscription.updated   -> CANCEL_AT_PERIOD_END when requested
//   customer.subscription.deleted   -> CANCEL_AT_PERIOD_END (no renewal)
//   charge.refunded (full)          -> PAYMENT_REFUNDED
//   charge.dispute.created          -> PAYMENT_DISPUTED
// The payment reference is the PaymentIntent id where present (refunds and
// disputes carry it), otherwise the invoice id.

import { randomBytes } from 'node:crypto';
import {
  addOneMonth, countryCode, emptyEvent, hexEqual, hmacHex, PaymentProviderRejected, providerFetch, unixToIso, WebhookAuthError,
  type CheckoutInput, type FetchFn, type PaymentAdapter, type ProviderEvent, type WebhookRequest,
} from './types';

export interface StripeSettings {
  secretKey: string;
  webhookSecret: string;
  priceId: string;
  mode: 'sandbox' | 'live';
  fetchFn?: FetchFn;
  toleranceSeconds?: number;
}

const API = 'https://api.stripe.com/v1';

export function verifyStripeSignature(rawBody: string, header: string | null, secret: string, now: Date, toleranceSeconds = 300): void {
  if (!header) throw new WebhookAuthError('missing signature');
  const parts = header.split(',').map((p) => p.trim().split('='));
  const timestamp = Number(parts.find(([k]) => k === 't')?.[1]);
  const signatures = parts.filter(([k]) => k === 'v1').map(([, v]) => v ?? '');
  if (!Number.isInteger(timestamp) || signatures.length === 0) throw new WebhookAuthError('malformed signature');
  if (Math.abs(now.getTime() / 1000 - timestamp) > toleranceSeconds) throw new WebhookAuthError('timestamp outside tolerance');
  const expected = hmacHex(secret, `${timestamp}.${rawBody}`);
  if (!signatures.some((sig) => hexEqual(sig, expected))) throw new WebhookAuthError('signature mismatch');
}

function form(values: Record<string, string>): string {
  return new URLSearchParams(values).toString();
}

function checkoutRefOf(object: any): string | null {
  const metadata = object?.subscription_details?.metadata ?? object?.parent?.subscription_details?.metadata ?? object?.metadata ?? {};
  const ref = metadata?.dajc_checkout;
  return typeof ref === 'string' && ref.length <= 200 ? ref : null;
}

const idOf = (value: unknown): string | null => (typeof value === 'string' ? value : typeof (value as any)?.id === 'string' ? (value as any).id : null);

export function mapStripeEvent(event: any): ProviderEvent {
  const type = String(event?.type ?? '');
  const object = event?.data?.object ?? {};
  const base = emptyEvent('STRIPE', String(event?.id ?? ''), type, unixToIso(event?.created) ?? new Date(0).toISOString());
  switch (type) {
    case 'checkout.session.completed':
      if (object.mode !== 'subscription') return base;
      return { ...base, kind: 'CHECKOUT_COMPLETED', checkoutRef: object.client_reference_id ?? null, customerRef: idOf(object.customer), subscriptionRef: idOf(object.subscription) };
    case 'invoice.paid': {
      const line = Array.isArray(object?.lines?.data) ? object.lines.data[0] : null;
      const subscription = idOf(object.subscription) ?? idOf(object?.parent?.subscription_details?.subscription);
      const periodStart = unixToIso(line?.period?.start);
      return {
        ...base, kind: 'PAYMENT_SETTLED', checkoutRef: checkoutRefOf(object), customerRef: idOf(object.customer), subscriptionRef: subscription,
        paymentRef: idOf(object.payment_intent) ?? idOf(object.id), amountCents: Number.isInteger(object.amount_paid) ? object.amount_paid : null,
        currency: typeof object.currency === 'string' ? object.currency.toUpperCase() : null,
        periodStart, periodEnd: unixToIso(line?.period?.end) ?? (periodStart ? addOneMonth(periodStart) : null),
        billingCountry: countryCode(object?.customer_address?.country), occurredAt: unixToIso(object?.status_transitions?.paid_at) ?? base.occurredAt,
      };
    }
    case 'invoice.payment_failed':
      return { ...base, kind: 'PAYMENT_FAILED', checkoutRef: checkoutRefOf(object), customerRef: idOf(object.customer), subscriptionRef: idOf(object.subscription) };
    case 'customer.subscription.updated':
      return object.cancel_at_period_end === true
        ? { ...base, kind: 'CANCEL_AT_PERIOD_END', customerRef: idOf(object.customer), subscriptionRef: idOf(object.id), checkoutRef: checkoutRefOf(object) }
        : base;
    case 'customer.subscription.deleted':
      return { ...base, kind: 'CANCEL_AT_PERIOD_END', customerRef: idOf(object.customer), subscriptionRef: idOf(object.id), checkoutRef: checkoutRefOf(object) };
    case 'charge.refunded':
      // Partial refunds keep access and are handled as a reviewed manual case.
      if (object.refunded !== true) return base;
      return { ...base, kind: 'PAYMENT_REFUNDED', customerRef: idOf(object.customer), paymentRef: idOf(object.payment_intent) ?? idOf(object.invoice) };
    case 'charge.dispute.created':
      return { ...base, kind: 'PAYMENT_DISPUTED', paymentRef: idOf(object.payment_intent), customerRef: null };
    default:
      return base;
  }
}

export function createStripeAdapter(settings: StripeSettings): PaymentAdapter {
  const fetchFn = settings.fetchFn ?? fetch;
  const auth = { authorization: `Bearer ${settings.secretKey}`, 'content-type': 'application/x-www-form-urlencoded' };
  return {
    provider: 'STRIPE',
    mode: settings.mode,
    newCheckoutRef: () => `dco_${randomBytes(18).toString('base64url')}`,

    async createCheckout(input: CheckoutInput) {
      const body = form({
        mode: 'subscription',
        'line_items[0][price]': settings.priceId,
        'line_items[0][quantity]': '1',
        client_reference_id: input.checkoutRef,
        'subscription_data[metadata][dajc_checkout]': input.checkoutRef,
        billing_address_collection: 'required',
        success_url: input.successUrl,
        cancel_url: input.cancelUrl,
        locale: input.lang,
      });
      const session = await providerFetch('STRIPE', fetchFn, `${API}/checkout/sessions`, { method: 'POST', headers: { ...auth, 'idempotency-key': input.checkoutRef }, body });
      if (typeof session?.url !== 'string' || !session.url.startsWith('https://')) throw new PaymentProviderRejected('STRIPE', 'checkout session without URL');
      return { redirectUrl: session.url, providerSessionRef: typeof session.id === 'string' ? session.id : null };
    },

    async verifyWebhook(request: WebhookRequest) {
      verifyStripeSignature(request.rawBody, request.headers.get('stripe-signature'), settings.webhookSecret, request.now, settings.toleranceSeconds);
      let event: any;
      try {
        event = JSON.parse(request.rawBody);
      } catch {
        throw new WebhookAuthError('body is not JSON');
      }
      if (typeof event?.id !== 'string' || !event.id.startsWith('evt_')) throw new WebhookAuthError('not a Stripe event');
      // A test-mode event must never reach a live endpoint and vice versa.
      if (typeof event.livemode === 'boolean' && event.livemode !== (settings.mode === 'live')) throw new WebhookAuthError('livemode mismatch');
      return [mapStripeEvent(event)];
    },

    // invoice.paid is a signed statement of settlement by Stripe itself.
    async confirm(event) {
      return event;
    },

    async cancelAtPeriodEnd({ subscriptionRef }) {
      if (!subscriptionRef) throw new PaymentProviderRejected('STRIPE', 'no subscription reference');
      await providerFetch('STRIPE', fetchFn, `${API}/subscriptions/${encodeURIComponent(subscriptionRef)}`, { method: 'POST', headers: auth, body: form({ cancel_at_period_end: 'true' }) });
    },

    async refund({ paymentRef, amountCents, idempotencyKey }) {
      const field = paymentRef.startsWith('pi_') ? 'payment_intent' : 'charge';
      const refund = await providerFetch('STRIPE', fetchFn, `${API}/refunds`, {
        method: 'POST', headers: { ...auth, 'idempotency-key': idempotencyKey },
        body: form({ [field]: paymentRef, amount: String(amountCents), reason: 'requested_by_customer' }),
      });
      if (typeof refund?.id !== 'string') throw new PaymentProviderRejected('STRIPE', 'refund without id');
      return { refundRef: refund.id };
    },

    async managementUrl({ customerRef, returnUrl }) {
      const portal = await providerFetch('STRIPE', fetchFn, `${API}/billing_portal/sessions`, { method: 'POST', headers: auth, body: form({ customer: customerRef, return_url: returnUrl }) });
      return typeof portal?.url === 'string' && portal.url.startsWith('https://') ? portal.url : null;
    },
  };
}
