// One adapter contract for every card payment provider of paid DAJC AI
// (EUR 15 / month). The billing service (service.ts) never trusts a browser:
//
// - verifyWebhook() authenticates the provider's request (signature,
//   timestamp tolerance, constant-time comparison) and maps it to neutral
//   ProviderEvents. It never decides who the user is: the service resolves
//   the user from records the server created (checkout, customer binding).
// - confirm() optionally re-reads the payment from the provider's API with
//   the merchant's secret before access is granted (defence in depth for
//   providers whose webhook carries only an identifier).
// - Money moves only through createCheckout (customer pays at the provider),
//   cancelAtPeriodEnd and refund. In "live" mode these are additionally
//   blocked by DAJC_AI_LIVE_PAYMENTS_RELEASED (a reviewed code change).

import { createHmac, timingSafeEqual } from 'node:crypto';
import type { CardProvider } from '../paid/subscription';

export type ProviderEventKind =
  | 'CHECKOUT_COMPLETED'
  | 'PAYMENT_SETTLED'
  | 'PAYMENT_FAILED'
  | 'PAYMENT_REFUNDED'
  | 'PAYMENT_DISPUTED'
  | 'CANCEL_AT_PERIOD_END'
  | 'IGNORED';

export interface ProviderEvent {
  provider: CardProvider;
  eventId: string;
  kind: ProviderEventKind;
  /** Provider event type, for the audit trail. */
  sourceType: string;
  occurredAt: string;
  /** DAJC's own reference that the server gave the provider at checkout. */
  checkoutRef: string | null;
  customerRef: string | null;
  subscriptionRef: string | null;
  paymentRef: string | null;
  amountCents: number | null;
  currency: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  feeCents: number | null;
  /** ISO 3166-1 alpha-2 billing country, for OSS VAT; never the address. */
  billingCountry: string | null;
  /** Whether the service must call confirm() before applying a payment. */
  needsConfirmation: boolean;
}

export interface CheckoutInput {
  checkoutRef: string;
  /** Pseudonymous DAJC user id; never an e-mail address. */
  userId: string;
  successUrl: string;
  cancelUrl: string;
  returnUrl: string;
  lang: 'en' | 'cs';
}

export interface CheckoutResult {
  redirectUrl: string;
  providerSessionRef: string | null;
}

export interface WebhookRequest {
  rawBody: string;
  headers: Headers;
  /** Query parameters of a signed browser return (GP webpay). */
  query?: URLSearchParams;
  now: Date;
}

export class WebhookAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WebhookAuthError';
  }
}

/** The provider could not be reached or answered with a temporary error. */
export class PaymentProviderUnavailable extends Error {
  constructor(readonly provider: CardProvider, message: string) {
    super(`${provider}: ${message}`);
    this.name = 'PaymentProviderUnavailable';
  }
}

/** The provider refused the request (configuration, validation): retrying will not help. */
export class PaymentProviderRejected extends Error {
  constructor(readonly provider: CardProvider, message: string) {
    super(`${provider}: ${message}`);
    this.name = 'PaymentProviderRejected';
  }
}

export class NotSupportedByProvider extends Error {
  constructor(readonly provider: CardProvider, operation: string) {
    super(`${provider}: ${operation} is not available through the API integration; use the merchant portal and record it as a reviewed manual action`);
    this.name = 'NotSupportedByProvider';
  }
}

export interface PaymentAdapter {
  readonly provider: CardProvider;
  readonly mode: 'sandbox' | 'live';
  /** A new, unguessable checkout reference in the provider's accepted format. */
  newCheckoutRef(): string;
  createCheckout(input: CheckoutInput): Promise<CheckoutResult>;
  verifyWebhook(request: WebhookRequest): Promise<ProviderEvent[]>;
  /** Re-reads a payment from the provider API; null = not settled / not as expected. */
  confirm(event: ProviderEvent): Promise<ProviderEvent | null>;
  cancelAtPeriodEnd(input: { customerRef: string; subscriptionRef: string | null }): Promise<void>;
  refund(input: { paymentRef: string; amountCents: number; idempotencyKey: string }): Promise<{ refundRef: string }>;
  /** A provider-hosted page to change the card or cancel, where available. */
  managementUrl(input: { customerRef: string; returnUrl: string }): Promise<string | null>;
  /**
   * Merchant-initiated renewal with the card the customer saved for the
   * merchant, for providers without a provider-side subscription (Revolut,
   * GP webpay). 'submitted' grants nothing: access is extended only by the
   * provider's verified settlement event for checkoutRef. Absent = the provider
   * renews on its own (Stripe subscriptions).
   */
  chargeRenewal?(input: { customerRef: string; checkoutRef: string }): Promise<RenewalResult>;
}

export interface RenewalResult {
  status: 'submitted' | 'declined' | 'no_saved_card';
  providerRef: string | null;
  reason?: string | null;
}

export type FetchFn = typeof fetch;

/** Constant-time comparison of two hex HMAC digests. */
export function hexEqual(a: string, b: string): boolean {
  if (!/^[0-9a-f]+$/i.test(a) || !/^[0-9a-f]+$/i.test(b) || a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
}

export function hmacHex(secret: string, payload: string): string {
  return createHmac('sha256', secret).update(payload, 'utf8').digest('hex');
}

export function emptyEvent(provider: CardProvider, eventId: string, sourceType: string, occurredAt: string): ProviderEvent {
  return {
    provider, eventId, kind: 'IGNORED', sourceType, occurredAt, checkoutRef: null, customerRef: null, subscriptionRef: null,
    paymentRef: null, amountCents: null, currency: null, periodStart: null, periodEnd: null, feeCents: null, billingCountry: null,
    needsConfirmation: false,
  };
}

/** Adds one calendar month (clamped to the month end), as card subscriptions do. */
export function addOneMonth(iso: string): string {
  const start = new Date(iso);
  const year = start.getUTCFullYear();
  const month = start.getUTCMonth() + 1;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const day = Math.min(start.getUTCDate(), lastDay);
  return new Date(Date.UTC(year, month, day, start.getUTCHours(), start.getUTCMinutes(), start.getUTCSeconds())).toISOString();
}

export const unixToIso = (seconds: unknown): string | null =>
  typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000).toISOString() : null;

export const countryCode = (value: unknown): string | null =>
  typeof value === 'string' && /^[A-Za-z]{2}$/.test(value) ? value.toUpperCase() : null;

export async function providerFetch(provider: CardProvider, fetchFn: FetchFn, url: string, init: RequestInit, timeoutMs = 15_000): Promise<any> {
  let response: Response;
  try {
    response = await fetchFn(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    throw new PaymentProviderUnavailable(provider, (error as Error)?.name === 'TimeoutError' || (error as Error)?.name === 'AbortError' ? 'timeout' : 'network error');
  }
  // Never echo the body: it may contain customer data.
  if (response.status === 429 || response.status >= 500) throw new PaymentProviderUnavailable(provider, `HTTP ${response.status}`);
  if (!response.ok) throw new PaymentProviderRejected(provider, `HTTP ${response.status}`);
  try {
    return await response.json();
  } catch {
    throw new PaymentProviderUnavailable(provider, 'invalid JSON response');
  }
}
