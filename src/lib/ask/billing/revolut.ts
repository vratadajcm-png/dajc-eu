// Revolut Business Merchant adapter (target option). Plain fetch, no SDK.
//
// Webhooks: "Revolut-Signature: v1=<hex>[,v1=<hex>]" and
// "Revolut-Request-Timestamp: <unix ms>", where
// v1 = HMAC-SHA256(signing secret, "v1.<timestamp>.<raw body>").
// The body names only the event and the order, so every payment event is
// confirmed by re-reading the order from the Merchant API with the secret
// key (confirm()) before any access is granted.
//
// Recurring billing: the Merchant API charges a saved card with a new order
// per period (merchant-initiated). DAJC creates that order server-side; the
// period always comes from DAJC's own checkout record, never from the body.
// Contract verified against synthetic fixtures only - it must be validated
// in the Revolut Merchant sandbox before any live use.

import { randomBytes } from 'node:crypto';
import {
  emptyEvent, hexEqual, hmacHex, NotSupportedByProvider, PaymentProviderRejected, providerFetch, WebhookAuthError,
  type CheckoutInput, type FetchFn, type PaymentAdapter, type ProviderEvent, type WebhookRequest,
} from './types';

export interface RevolutSettings {
  secretKey: string;
  webhookSecret: string;
  mode: 'sandbox' | 'live';
  apiVersion?: string;
  fetchFn?: FetchFn;
  toleranceMs?: number;
}

export const REVOLUT_API = { sandbox: 'https://sandbox-merchant.revolut.com/api', live: 'https://merchant.revolut.com/api' } as const;

export function verifyRevolutSignature(rawBody: string, headers: Headers, secret: string, now: Date, toleranceMs = 300_000): void {
  const header = headers.get('revolut-signature');
  const timestamp = headers.get('revolut-request-timestamp');
  if (!header || !timestamp || !/^\d{10,16}$/.test(timestamp)) throw new WebhookAuthError('missing signature');
  if (Math.abs(now.getTime() - Number(timestamp)) > toleranceMs) throw new WebhookAuthError('timestamp outside tolerance');
  const expected = hmacHex(secret, `v1.${timestamp}.${rawBody}`);
  const candidates = header.split(',').map((part) => part.trim()).filter((part) => part.startsWith('v1=')).map((part) => part.slice(3));
  if (!candidates.some((sig) => hexEqual(sig, expected))) throw new WebhookAuthError('signature mismatch');
}

const PAYMENT_EVENTS: Record<string, ProviderEvent['kind']> = {
  ORDER_COMPLETED: 'PAYMENT_SETTLED',
  ORDER_PAYMENT_FAILED: 'PAYMENT_FAILED',
  ORDER_PAYMENT_DECLINED: 'PAYMENT_FAILED',
  DISPUTE_ACTION_REQUIRED: 'PAYMENT_DISPUTED',
};

export function createRevolutAdapter(settings: RevolutSettings): PaymentAdapter {
  const fetchFn = settings.fetchFn ?? fetch;
  const base = REVOLUT_API[settings.mode];
  const headers = {
    authorization: `Bearer ${settings.secretKey}`,
    'content-type': 'application/json',
    'revolut-api-version': settings.apiVersion ?? '2024-09-01',
  };
  return {
    provider: 'REVOLUT_MERCHANT',
    mode: settings.mode,
    newCheckoutRef: () => `dco_${randomBytes(18).toString('base64url')}`,

    async createCheckout(input: CheckoutInput) {
      const order = await providerFetch('REVOLUT_MERCHANT', fetchFn, `${base}/orders`, {
        method: 'POST', headers: { ...headers, 'idempotency-key': input.checkoutRef },
        body: JSON.stringify({
          amount: 1500, currency: 'EUR', merchant_order_ext_ref: input.checkoutRef,
          description: 'DAJC AI - monthly subscription', redirect_url: input.successUrl,
          // Save the card for the following merchant-initiated monthly orders.
          save_payment_method_for: 'merchant',
        }),
      });
      if (typeof order?.checkout_url !== 'string' || !order.checkout_url.startsWith('https://')) throw new PaymentProviderRejected('REVOLUT_MERCHANT', 'order without checkout URL');
      return { redirectUrl: order.checkout_url, providerSessionRef: typeof order.id === 'string' ? order.id : null };
    },

    async verifyWebhook(request: WebhookRequest) {
      verifyRevolutSignature(request.rawBody, request.headers, settings.webhookSecret, request.now, settings.toleranceMs);
      let body: any;
      try {
        body = JSON.parse(request.rawBody);
      } catch {
        throw new WebhookAuthError('body is not JSON');
      }
      const type = String(body?.event ?? '');
      const orderId = typeof body?.order_id === 'string' ? body.order_id : null;
      if (!type || !orderId) throw new WebhookAuthError('not a Revolut order event');
      const event = emptyEvent('REVOLUT_MERCHANT', `${type}:${orderId}`, type, request.now.toISOString());
      const kind = PAYMENT_EVENTS[type];
      if (!kind) return [event];
      return [{
        ...event, kind, paymentRef: orderId,
        checkoutRef: typeof body.merchant_order_ext_ref === 'string' ? body.merchant_order_ext_ref : null,
        needsConfirmation: kind === 'PAYMENT_SETTLED',
      }];
    },

    async confirm(event: ProviderEvent) {
      if (!event.paymentRef) return null;
      const order = await providerFetch('REVOLUT_MERCHANT', fetchFn, `${base}/orders/${encodeURIComponent(event.paymentRef)}`, { method: 'GET', headers });
      const state = String(order?.state ?? '').toUpperCase();
      const amount = Number(order?.amount ?? order?.order_amount?.value);
      const currency = String(order?.currency ?? order?.order_amount?.currency ?? '').toUpperCase();
      if (state !== 'COMPLETED' || amount !== 1500 || currency !== 'EUR') return null;
      if (event.checkoutRef && order.merchant_order_ext_ref !== event.checkoutRef) return null;
      const payment = Array.isArray(order?.payments) ? order.payments[0] : null;
      const fee = Number(payment?.fees?.[0]?.amount ?? NaN);
      return {
        ...event,
        amountCents: amount,
        currency,
        customerRef: typeof order?.customer?.id === 'string' ? order.customer.id : (typeof order?.customer_id === 'string' ? order.customer_id : null),
        occurredAt: typeof order?.completed_at === 'string' ? new Date(order.completed_at).toISOString() : event.occurredAt,
        billingCountry: typeof payment?.payment_method?.card?.card_country === 'string' ? payment.payment_method.card.card_country.toUpperCase().slice(0, 2) : null,
        feeCents: Number.isInteger(fee) ? fee : null,
        needsConfirmation: false,
      };
    },

    async cancelAtPeriodEnd() {
      // Nothing to cancel at Revolut: DAJC simply creates no further renewal order.
    },

    async refund({ paymentRef, amountCents, idempotencyKey }) {
      const refund = await providerFetch('REVOLUT_MERCHANT', fetchFn, `${base}/orders/${encodeURIComponent(paymentRef)}/refund`, {
        method: 'POST', headers: { ...headers, 'idempotency-key': idempotencyKey },
        body: JSON.stringify({ amount: amountCents, currency: 'EUR', description: 'DAJC AI refund' }),
      });
      if (typeof refund?.id !== 'string') throw new PaymentProviderRejected('REVOLUT_MERCHANT', 'refund without id');
      return { refundRef: refund.id };
    },

    async managementUrl() {
      // No hosted customer portal: card changes go through a new checkout.
      return null;
    },

    // Merchant-initiated renewal (API version 2024-09-01+):
    //   GET  /customers/{id}/payment-methods?only_merchant=true  -> card saved for the merchant
    //   POST /orders {amount, currency, customer.id, merchant_order_ext_ref}
    //   POST /orders/{order_id}/payments {saved_payment_method: {type, id, initiator: "merchant"}}
    // The settlement still arrives as ORDER_COMPLETED and is confirmed via the API.
    async chargeRenewal({ customerRef, checkoutRef }) {
      const methods = await providerFetch('REVOLUT_MERCHANT', fetchFn, `${base}/customers/${encodeURIComponent(customerRef)}/payment-methods?only_merchant=true`, { method: 'GET', headers });
      const list = Array.isArray(methods) ? methods : Array.isArray(methods?.payment_methods) ? methods.payment_methods : [];
      const card = list.find((m: any) => typeof m?.id === 'string' && (m.type === 'card' || m.type === 'CARD') && String(m.saved_for ?? 'MERCHANT').toUpperCase() === 'MERCHANT');
      if (!card) return { status: 'no_saved_card' as const, providerRef: null };
      const order = await providerFetch('REVOLUT_MERCHANT', fetchFn, `${base}/orders`, {
        method: 'POST', headers: { ...headers, 'idempotency-key': checkoutRef },
        body: JSON.stringify({ amount: 1500, currency: 'EUR', customer: { id: customerRef }, merchant_order_ext_ref: checkoutRef, description: 'DAJC AI - monthly subscription renewal' }),
      });
      if (typeof order?.id !== 'string') throw new PaymentProviderRejected('REVOLUT_MERCHANT', 'renewal order without id');
      const payment = await providerFetch('REVOLUT_MERCHANT', fetchFn, `${base}/orders/${encodeURIComponent(order.id)}/payments`, {
        method: 'POST', headers: { ...headers, 'idempotency-key': `${checkoutRef}:pay` },
        body: JSON.stringify({ saved_payment_method: { type: 'card', id: card.id, initiator: 'merchant' } }),
      });
      const state = String(payment?.state ?? '').toLowerCase();
      if (['declined', 'soft_declined', 'failed', 'cancelled'].includes(state)) {
        return { status: 'declined' as const, providerRef: order.id, reason: typeof payment?.decline_reason === 'string' ? payment.decline_reason.slice(0, 60) : state };
      }
      return { status: 'submitted' as const, providerRef: order.id };
    },
  };
}

export { NotSupportedByProvider };
