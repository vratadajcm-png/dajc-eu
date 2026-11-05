// DAJC sandbox payment provider: synthetic payments for automated tests
// and for a staging (Vercel preview) dry run of the whole lifecycle. No
// money and no external service is involved. Events must carry an HMAC
// made with DAJC_AI_SANDBOX_WEBHOOK_SECRET, so a visitor cannot activate a
// subscription; the configuration refuses this provider in production
// (VERCEL_ENV=production) and paidAccess() ignores sandbox ledgers there.

import { randomBytes } from 'node:crypto';
import {
  addOneMonth, emptyEvent, hexEqual, hmacHex, WebhookAuthError,
  type CheckoutInput, type PaymentAdapter, type ProviderEvent, type WebhookRequest,
} from './types';

export const SANDBOX_SIGNATURE_HEADER = 'x-dajc-sandbox-signature';

export interface SandboxEventInput {
  id: string;
  type: 'checkout.completed' | 'payment.settled' | 'payment.failed' | 'payment.refunded' | 'payment.disputed' | 'subscription.cancel_at_period_end';
  checkoutRef?: string;
  customerRef?: string;
  paymentRef?: string;
  amountCents?: number;
  currency?: string;
  periodStart?: string;
  periodEnd?: string;
  billingCountry?: string;
  feeCents?: number;
  occurredAt: string;
}

/** Signs a synthetic event the way the sandbox adapter verifies it (tests, staging tooling). */
export function signSandboxEvent(secret: string, body: string, now: Date): string {
  const t = Math.floor(now.getTime() / 1000);
  return `t=${t},v1=${hmacHex(secret, `${t}.${body}`)}`;
}

const KINDS: Record<SandboxEventInput['type'], ProviderEvent['kind']> = {
  'checkout.completed': 'CHECKOUT_COMPLETED',
  'payment.settled': 'PAYMENT_SETTLED',
  'payment.failed': 'PAYMENT_FAILED',
  'payment.refunded': 'PAYMENT_REFUNDED',
  'payment.disputed': 'PAYMENT_DISPUTED',
  'subscription.cancel_at_period_end': 'CANCEL_AT_PERIOD_END',
};

export function createSandboxAdapter(settings: { secret: string; publicOrigin: string }): PaymentAdapter {
  let refunds = 0;
  return {
    provider: 'DAJC_SANDBOX',
    mode: 'sandbox',
    newCheckoutRef: () => `dco_${randomBytes(18).toString('base64url')}`,

    async createCheckout(input: CheckoutInput) {
      const url = new URL('/intelligence/ask', settings.publicOrigin);
      url.searchParams.set('sandbox_checkout', input.checkoutRef);
      return { redirectUrl: url.toString(), providerSessionRef: `sandbox_${input.checkoutRef}` };
    },

    async verifyWebhook(request: WebhookRequest) {
      const header = request.headers.get(SANDBOX_SIGNATURE_HEADER) ?? '';
      const parts = Object.fromEntries(header.split(',').map((p) => p.trim().split('=')));
      const t = Number(parts.t);
      if (!Number.isInteger(t) || !parts.v1) throw new WebhookAuthError('missing signature');
      if (Math.abs(request.now.getTime() / 1000 - t) > 300) throw new WebhookAuthError('timestamp outside tolerance');
      if (!hexEqual(parts.v1, hmacHex(settings.secret, `${t}.${request.rawBody}`))) throw new WebhookAuthError('signature mismatch');
      let body: SandboxEventInput;
      try {
        body = JSON.parse(request.rawBody);
      } catch {
        throw new WebhookAuthError('body is not JSON');
      }
      if (typeof body?.id !== 'string' || !KINDS[body.type]) throw new WebhookAuthError('unknown sandbox event');
      const event = emptyEvent('DAJC_SANDBOX', body.id, body.type, body.occurredAt);
      return [{
        ...event,
        kind: KINDS[body.type],
        checkoutRef: body.checkoutRef ?? null,
        customerRef: body.customerRef ?? null,
        paymentRef: body.paymentRef ?? null,
        amountCents: body.amountCents ?? null,
        currency: body.currency ?? null,
        periodStart: body.periodStart ?? (body.type === 'payment.settled' ? body.occurredAt : null),
        periodEnd: body.periodEnd ?? (body.type === 'payment.settled' ? addOneMonth(body.periodStart ?? body.occurredAt) : null),
        billingCountry: body.billingCountry ?? null,
        feeCents: body.feeCents ?? null,
      }];
    },

    async confirm(event: ProviderEvent) {
      return event;
    },

    async cancelAtPeriodEnd() {
      // The test harness sends the confirming event, as a real provider would.
    },

    async refund() {
      refunds += 1;
      return { refundRef: `sandbox_refund_${refunds}_${randomBytes(6).toString('hex')}` };
    },

    async managementUrl({ returnUrl }) {
      return returnUrl;
    },
  };
}
