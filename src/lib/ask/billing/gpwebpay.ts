// GP webpay adapter (Česká spořitelna card acquiring; target option).
//
// HTTP API: the customer is redirected to the gateway with parameters
// signed by the merchant's private key (DIGEST = base64 RSA-SHA1 over the
// values joined by "|"). The gateway redirects the customer back with the
// result signed by GP's key: DIGEST over the returned values and DIGEST1
// over the same values plus MERCHANTNUMBER. Both are verified with the GP
// public key before anything is applied; a browser cannot forge them, and
// replays are harmless because each ORDERNUMBER is applied once.
//
// Card registration for recurring payments uses USERPARAM1 = "R". Renewal
// charges (processRecurringPayment), refunds (processRefund) and payment
// status queries use the GP webpay Web Services API (SOAP, signed), which
// needs the merchant's WS credentials: until the merchant contract exists
// they are NotSupportedByProvider and are done in the GP portal as reviewed
// manual actions. The contract is verified against synthetic keys only and
// must be validated in the GP webpay test environment.

import { createSign, createVerify, randomInt } from 'node:crypto';
import {
  addOneMonth, emptyEvent, NotSupportedByProvider, WebhookAuthError,
  type CheckoutInput, type PaymentAdapter, type ProviderEvent, type WebhookRequest,
} from './types';

export interface GpWebpaySettings {
  merchantNumber: string;
  privateKeyPem: string;
  privateKeyPassphrase?: string;
  gpPublicKeyPem: string;
  mode: 'sandbox' | 'live';
}

export const GP_WEBPAY_URL = {
  sandbox: 'https://test.3dsecure.gpwebpay.com/pgw/order.do',
  live: 'https://3dsecure.gpwebpay.com/pgw/order.do',
} as const;

/** Order of the signed request fields (HTTP API). */
const REQUEST_FIELDS = ['MERCHANTNUMBER', 'OPERATION', 'ORDERNUMBER', 'AMOUNT', 'CURRENCY', 'DEPOSITFLAG', 'MERORDERNUM', 'URL', 'DESCRIPTION', 'MD', 'USERPARAM1', 'LANG'] as const;
/** Order of the signed response fields. */
const RESPONSE_FIELDS = ['OPERATION', 'ORDERNUMBER', 'MERORDERNUM', 'MD', 'PRCODE', 'SRCODE', 'RESULTTEXT', 'USERPARAM1', 'ADDINFO', 'TOKEN', 'EXPIRY', 'ACSRES', 'ACCODE', 'PANPATTERN', 'DAYTOCAPTURE', 'TOKENREGSTATUS', 'ACRC', 'RRN', 'PAR', 'TRACEID'] as const;

const EUR = '978';

export function signGpRequest(params: Record<string, string>, privateKeyPem: string, passphrase?: string): string {
  const data = REQUEST_FIELDS.filter((f) => params[f] !== undefined).map((f) => params[f]).join('|');
  return createSign('RSA-SHA1').update(data, 'utf8').sign({ key: privateKeyPem, passphrase }, 'base64');
}

export function gpResponseDigestInput(params: URLSearchParams, withMerchant: string | null): string {
  const values = RESPONSE_FIELDS.filter((f) => params.has(f)).map((f) => params.get(f) ?? '');
  if (withMerchant !== null) values.push(withMerchant);
  return values.join('|');
}

export function verifyGpResponse(params: URLSearchParams, merchantNumber: string, gpPublicKeyPem: string): void {
  const digest = params.get('DIGEST');
  const digest1 = params.get('DIGEST1');
  if (!digest || !digest1) throw new WebhookAuthError('missing signature');
  const ok = (data: string, signature: string) => {
    try {
      return createVerify('RSA-SHA1').update(data, 'utf8').verify(gpPublicKeyPem, signature, 'base64');
    } catch {
      return false;
    }
  };
  if (!ok(gpResponseDigestInput(params, null), digest) || !ok(gpResponseDigestInput(params, merchantNumber), digest1)) {
    throw new WebhookAuthError('signature mismatch');
  }
}

export function createGpWebpayAdapter(settings: GpWebpaySettings): PaymentAdapter {
  return {
    provider: 'GP_WEBPAY',
    mode: settings.mode,
    // ORDERNUMBER is numeric (max 15 digits) and must be unique per merchant.
    newCheckoutRef: () => `${Date.now()}${String(randomInt(0, 100)).padStart(2, '0')}`.slice(0, 15),

    async createCheckout(input: CheckoutInput) {
      const params: Record<string, string> = {
        MERCHANTNUMBER: settings.merchantNumber,
        OPERATION: 'CREATE_ORDER',
        ORDERNUMBER: input.checkoutRef,
        AMOUNT: '1500',
        CURRENCY: EUR,
        DEPOSITFLAG: '1',
        URL: input.returnUrl,
        DESCRIPTION: 'DAJC AI monthly',
        USERPARAM1: 'R',
        LANG: input.lang === 'cs' ? 'CZ' : 'EN',
      };
      params.DIGEST = signGpRequest(params, settings.privateKeyPem, settings.privateKeyPassphrase);
      const url = new URL(GP_WEBPAY_URL[settings.mode]);
      for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
      return { redirectUrl: url.toString(), providerSessionRef: input.checkoutRef };
    },

    async verifyWebhook(request: WebhookRequest) {
      const params = request.query ?? new URLSearchParams(request.rawBody);
      verifyGpResponse(params, settings.merchantNumber, settings.gpPublicKeyPem);
      const order = params.get('ORDERNUMBER') ?? '';
      if (!/^\d{1,15}$/.test(order)) throw new WebhookAuthError('invalid order number');
      const prcode = params.get('PRCODE') ?? '';
      const srcode = params.get('SRCODE') ?? '';
      const occurredAt = request.now.toISOString();
      const event = emptyEvent('GP_WEBPAY', `gp:${order}:${prcode}:${srcode}`, `RETURN ${prcode}/${srcode}`, occurredAt);
      if (params.get('OPERATION') !== 'CREATE_ORDER') return [event];
      if (prcode === '0' && srcode === '0') {
        return [{
          ...event, kind: 'PAYMENT_SETTLED', checkoutRef: order, paymentRef: `gp-${order}`, customerRef: `gp-master-${order}`,
          amountCents: 1500, currency: 'EUR', periodStart: occurredAt, periodEnd: addOneMonth(occurredAt),
        }];
      }
      return [{ ...event, kind: 'PAYMENT_FAILED', checkoutRef: order, customerRef: `gp-master-${order}` }];
    },

    // The signed return is GP's own statement that the order was paid.
    async confirm(event: ProviderEvent) {
      return event;
    },

    async cancelAtPeriodEnd() {
      // DAJC stops creating recurring charges; nothing to call at GP.
    },

    async refund() {
      throw new NotSupportedByProvider('GP_WEBPAY', 'refund');
    },

    async managementUrl() {
      return null;
    },

    async chargeRenewal() {
      // processRecurringPayment (Web Services API) needs the merchant's WS contract and credentials.
      throw new NotSupportedByProvider('GP_WEBPAY', 'recurring charge');
    },
  };
}
