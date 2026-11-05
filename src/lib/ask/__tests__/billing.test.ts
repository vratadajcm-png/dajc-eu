import { createSign, generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createGpWebpayAdapter, gpResponseDigestInput, signGpRequest } from '../billing/gpwebpay';
import { createRevolutAdapter, verifyRevolutSignature } from '../billing/revolut';
import { createSandboxAdapter, signSandboxEvent, SANDBOX_SIGNATURE_HEADER, type SandboxEventInput } from '../billing/sandbox';
import { decideRefund, processWebhook, requestCancellation, requestRefund, startCheckout, subscriptionStatus, type BillingDeps } from '../billing/service';
import { createStripeAdapter, mapStripeEvent, verifyStripeSignature } from '../billing/stripe';
import { addOneMonth, hmacHex, PaymentProviderUnavailable, WebhookAuthError, type PaymentAdapter } from '../billing/types';
import { readPaidConfig, paidReleased, type PaidConfig } from '../paid/config';
import { parseDataKeys } from '../crypto';
import { MemoryAskStore } from '../store/memory';
import { MemoryPaidStore } from '../store/paid-memory';

const NOW = new Date('2026-11-05T10:00:00.000Z');
const SECRET = 'sandbox-secret-0123456789abcdef0123456789';
const KEYS = `k1:${Buffer.alloc(32, 7).toString('base64')}`;

export function paidConfig(overrides: Partial<PaidConfig> = {}): PaidConfig {
  return {
    provider: 'DAJC_SANDBOX', mode: 'sandbox', staging: false, keyring: parseDataKeys(KEYS).keyring!,
    fairUse: { dailyQuestions: 30, monthlyQuestions: 400, userMonthlyCostEur: 5 },
    refund: { windowDays: 14, maxSelfService: 1, maxPaidQuestions: 20 },
    historyRetentionDays: 90, historyMaxEntries: 200, memoryRetentionDays: 365, memoryMaxItems: 50,
    stripe: null, revolut: null, gpwebpay: null, sandbox: { secret: SECRET },
    ...overrides,
  };
}

export function billingScenario(adapter?: PaymentAdapter) {
  const askStore = new MemoryAskStore();
  const paid = new MemoryPaidStore(askStore);
  let clock = NOW;
  const deps: BillingDeps = {
    config: paidConfig(), askStore, paid, adapter: adapter ?? createSandboxAdapter({ secret: SECRET, publicOrigin: 'https://www.dajc.eu' }),
    publicOrigin: 'https://www.dajc.eu', env: { DAJC_AI_PAID_ENABLED: 'true' }, released: true, now: () => clock,
  };
  return {
    deps, askStore, paid,
    setNow(date: Date) { clock = date; },
    async sandboxEvent(event: Omit<SandboxEventInput, 'occurredAt'> & { occurredAt?: string }, secret = SECRET) {
      const body = JSON.stringify({ occurredAt: clock.toISOString(), ...event });
      const headers = new Headers({ [SANDBOX_SIGNATURE_HEADER]: signSandboxEvent(secret, body, clock) });
      return processWebhook({ rawBody: body, headers }, deps);
    },
  };
}

describe('payment provider signatures', () => {
  it('Stripe: accepts only a fresh signature over the exact body', () => {
    const body = '{"id":"evt_1","type":"invoice.paid"}';
    const t = Math.floor(NOW.getTime() / 1000);
    const good = `t=${t},v1=${hmacHex('whsec_test', `${t}.${body}`)}`;
    expect(() => verifyStripeSignature(body, good, 'whsec_test', NOW)).not.toThrow();
    expect(() => verifyStripeSignature(body, `t=${t},v1=deadbeef,v1=${hmacHex('whsec_test', `${t}.${body}`)}`, 'whsec_test', NOW)).not.toThrow();
    expect(() => verifyStripeSignature(`${body} `, good, 'whsec_test', NOW)).toThrow(WebhookAuthError);
    expect(() => verifyStripeSignature(body, good, 'whsec_other', NOW)).toThrow('signature mismatch');
    expect(() => verifyStripeSignature(body, good, 'whsec_test', new Date(NOW.getTime() + 600_000))).toThrow('timestamp outside tolerance');
    expect(() => verifyStripeSignature(body, null, 'whsec_test', NOW)).toThrow('missing signature');
  });

  it('Stripe: maps settlement, failures, cancellation, full refunds and disputes', () => {
    const paid = mapStripeEvent({
      id: 'evt_paid', type: 'invoice.paid', created: 1793872800,
      data: { object: { id: 'in_1', customer: 'cus_1', subscription: 'sub_1', payment_intent: 'pi_1', amount_paid: 1500, currency: 'eur', customer_address: { country: 'de' }, subscription_details: { metadata: { dajc_checkout: 'dco_x' } }, lines: { data: [{ period: { start: 1793872800, end: 1796464800 } }] } } },
    });
    expect(paid).toMatchObject({ kind: 'PAYMENT_SETTLED', paymentRef: 'pi_1', amountCents: 1500, currency: 'EUR', billingCountry: 'DE', checkoutRef: 'dco_x', customerRef: 'cus_1' });
    expect(mapStripeEvent({ id: 'evt_r', type: 'charge.refunded', data: { object: { refunded: false, payment_intent: 'pi_1' } } }).kind).toBe('IGNORED');
    expect(mapStripeEvent({ id: 'evt_r', type: 'charge.refunded', data: { object: { refunded: true, payment_intent: 'pi_1', customer: 'cus_1' } } })).toMatchObject({ kind: 'PAYMENT_REFUNDED', paymentRef: 'pi_1' });
    expect(mapStripeEvent({ id: 'evt_d', type: 'charge.dispute.created', data: { object: { payment_intent: 'pi_1' } } })).toMatchObject({ kind: 'PAYMENT_DISPUTED' });
    expect(mapStripeEvent({ id: 'evt_c', type: 'customer.subscription.updated', data: { object: { id: 'sub_1', customer: 'cus_1', cancel_at_period_end: true } } }).kind).toBe('CANCEL_AT_PERIOD_END');
    expect(mapStripeEvent({ id: 'evt_u', type: 'customer.subscription.updated', data: { object: { id: 'sub_1', cancel_at_period_end: false } } }).kind).toBe('IGNORED');
  });

  it('Stripe: a test-mode endpoint refuses live events', async () => {
    const adapter = createStripeAdapter({ secretKey: 'sk_test_x', webhookSecret: 'whsec_test', priceId: 'price_1', mode: 'sandbox' });
    const body = JSON.stringify({ id: 'evt_live', type: 'invoice.paid', livemode: true, data: { object: {} } });
    const t = Math.floor(NOW.getTime() / 1000);
    const headers = new Headers({ 'stripe-signature': `t=${t},v1=${hmacHex('whsec_test', `${t}.${body}`)}` });
    await expect(adapter.verifyWebhook({ rawBody: body, headers, now: NOW })).rejects.toThrow('livemode mismatch');
  });

  it('Revolut: verifies the v1 signature and confirms the order through the API', async () => {
    const body = JSON.stringify({ event: 'ORDER_COMPLETED', order_id: 'ord_1', merchant_order_ext_ref: 'dco_abc' });
    const ts = String(NOW.getTime());
    const headers = new Headers({ 'revolut-signature': `v1=${hmacHex('wsk_secret', `v1.${ts}.${body}`)}`, 'revolut-request-timestamp': ts });
    expect(() => verifyRevolutSignature(body, headers, 'wsk_secret', NOW)).not.toThrow();
    expect(() => verifyRevolutSignature(body.replace('ord_1', 'ord_2'), headers, 'wsk_secret', NOW)).toThrow(WebhookAuthError);
    let order: Record<string, unknown> = { id: 'ord_1', state: 'COMPLETED', amount: 1500, currency: 'EUR', merchant_order_ext_ref: 'dco_abc', customer: { id: 'rcus_1' }, completed_at: NOW.toISOString() };
    const adapter = createRevolutAdapter({ secretKey: 'sk_x', webhookSecret: 'wsk_secret', mode: 'sandbox', fetchFn: (async () => new Response(JSON.stringify(order), { status: 200 })) as typeof fetch });
    const [event] = await adapter.verifyWebhook({ rawBody: body, headers, now: NOW });
    expect(event).toMatchObject({ kind: 'PAYMENT_SETTLED', needsConfirmation: true, paymentRef: 'ord_1' });
    expect(await adapter.confirm(event)).toMatchObject({ amountCents: 1500, customerRef: 'rcus_1', needsConfirmation: false });
    order = { ...order, amount: 100 };
    expect(await adapter.confirm(event)).toBeNull();
    order = { ...order, amount: 1500, state: 'PENDING' };
    expect(await adapter.confirm(event)).toBeNull();
  });

  it('GP webpay: signs the request and accepts only a return signed by GP', async () => {
    const merchant = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const gp = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const pem = (k: any, type: 'private' | 'public') => k.export({ type: type === 'private' ? 'pkcs8' : 'spki', format: 'pem' }).toString();
    const adapter = createGpWebpayAdapter({ merchantNumber: '1234567890', privateKeyPem: pem(merchant.privateKey, 'private'), gpPublicKeyPem: pem(gp.publicKey, 'public'), mode: 'sandbox' });
    const checkout = await adapter.createCheckout({ checkoutRef: '17000000000001', userId: 'u', successUrl: 'https://www.dajc.eu/s', cancelUrl: 'https://www.dajc.eu/c', returnUrl: 'https://www.dajc.eu/api/ask/billing/return/gpwebpay', lang: 'cs' });
    const url = new URL(checkout.redirectUrl);
    expect(url.origin).toBe('https://test.3dsecure.gpwebpay.com');
    const params = Object.fromEntries(url.searchParams);
    expect(params).toMatchObject({ AMOUNT: '1500', CURRENCY: '978', USERPARAM1: 'R', ORDERNUMBER: '17000000000001' });
    expect(signGpRequest(params, pem(merchant.privateKey, 'private'))).toBe(params.DIGEST);

    const signedReturn = (values: Record<string, string>) => {
      const q = new URLSearchParams(values);
      const sign = (data: string) => createSign('RSA-SHA1').update(data).sign(gp.privateKey, 'base64');
      q.set('DIGEST', sign(gpResponseDigestInput(q, null)));
      q.set('DIGEST1', sign(gpResponseDigestInput(q, '1234567890')));
      return q;
    };
    const ok = signedReturn({ OPERATION: 'CREATE_ORDER', ORDERNUMBER: '17000000000001', PRCODE: '0', SRCODE: '0', RESULTTEXT: 'OK', USERPARAM1: 'R' });
    const [settled] = await adapter.verifyWebhook({ rawBody: '', headers: new Headers(), query: ok, now: NOW });
    expect(settled).toMatchObject({ kind: 'PAYMENT_SETTLED', checkoutRef: '17000000000001', amountCents: 1500, periodEnd: addOneMonth(NOW.toISOString()) });
    const forged = new URLSearchParams(signedReturn({ OPERATION: 'CREATE_ORDER', ORDERNUMBER: '17000000000001', PRCODE: '14', SRCODE: '0', RESULTTEXT: 'Duplicate' }));
    forged.set('PRCODE', '0');
    await expect(adapter.verifyWebhook({ rawBody: '', headers: new Headers(), query: forged, now: NOW })).rejects.toThrow('signature mismatch');
    const declined = signedReturn({ OPERATION: 'CREATE_ORDER', ORDERNUMBER: '17000000000002', PRCODE: '28', SRCODE: '3000', RESULTTEXT: 'Declined' });
    expect((await adapter.verifyWebhook({ rawBody: '', headers: new Headers(), query: declined, now: NOW }))[0].kind).toBe('PAYMENT_FAILED');
    await expect(adapter.refund({ paymentRef: 'gp-1', amountCents: 1500, idempotencyKey: 'x' })).rejects.toThrow('merchant portal');
  });

  it('adds calendar months the way card subscriptions renew', () => {
    expect(addOneMonth('2026-01-31T10:00:00.000Z')).toBe('2026-02-28T10:00:00.000Z');
    expect(addOneMonth('2026-11-05T10:00:00.000Z')).toBe('2026-12-05T10:00:00.000Z');
    expect(addOneMonth('2026-12-15T00:00:00.000Z')).toBe('2027-01-15T00:00:00.000Z');
  });
});

describe('paid configuration is fail-closed', () => {
  const base = { DAJC_AI_PAYMENT_PROVIDER: 'sandbox', DAJC_AI_PAYMENT_MODE: 'sandbox', DAJC_AI_DATA_KEYS: KEYS, DAJC_AI_SANDBOX_WEBHOOK_SECRET: SECRET };
  it('needs the reviewed release or a sandbox preview deployment', () => {
    expect(readPaidConfig(base, false).problems.join(' ')).toMatch(/not released/);
    expect(paidReleased({ ...base, VERCEL_ENV: 'production', DAJC_AI_STAGING_SANDBOX: 'true' }, false).released).toBe(false);
    expect(paidReleased({ ...base, VERCEL_ENV: 'preview', DAJC_AI_STAGING_SANDBOX: 'true' }, false)).toEqual({ released: true, staging: true });
    expect(readPaidConfig({ ...base, VERCEL_ENV: 'preview', DAJC_AI_STAGING_SANDBOX: 'true' }, false).ok).toBe(true);
  });

  it('never takes live payments, never runs the sandbox in production and validates keys', () => {
    expect(readPaidConfig({ ...base, DAJC_AI_PAYMENT_MODE: 'live' }, true).problems.join(' ')).toMatch(/live payments are not released/);
    expect(readPaidConfig({ ...base, VERCEL_ENV: 'production' }, true).problems.join(' ')).toMatch(/sandbox provider is never allowed in production/);
    const stripe = { ...base, DAJC_AI_PAYMENT_PROVIDER: 'stripe', DAJC_AI_STRIPE_SECRET_KEY: 'sk_live_x', DAJC_AI_STRIPE_WEBHOOK_SECRET: 'whsec_x', DAJC_AI_STRIPE_PRICE_ID: 'price_1' };
    expect(readPaidConfig(stripe, true).problems.join(' ')).toMatch(/test-mode key in sandbox mode/);
    expect(readPaidConfig({ ...stripe, DAJC_AI_STRIPE_SECRET_KEY: 'sk_test_x' }, true).ok).toBe(true);
    expect(readPaidConfig({ ...base, DAJC_AI_DATA_KEYS: 'k1:short' }, true).problems.join(' ')).toMatch(/32 bytes/);
    const problems = readPaidConfig({ ...base, DAJC_AI_SANDBOX_WEBHOOK_SECRET: 'super-secret-value-that-must-not-leak-1234' , DAJC_AI_DATA_KEYS: '' }, true).problems.join(' ');
    expect(problems).not.toContain('super-secret-value');
  });
});

describe('billing lifecycle (sandbox provider, synthetic data)', () => {
  async function paidUser() {
    const s = billingScenario();
    const userId = await s.askStore.upsertUser('hmac-user', NOW);
    const checkout = await startCheckout(userId, 'cs', s.deps);
    if (checkout.status !== 'redirect') throw new Error('no checkout');
    return { ...s, userId, checkoutRef: checkout.checkoutRef, redirect: checkout.url };
  }

  it('activates only after a verified settlement, once, and grants access until the period ends', async () => {
    const s = await paidUser();
    expect(s.redirect).toContain('sandbox_checkout=');
    expect((await subscriptionStatus(s.userId, s.deps)).active).toBe(false);
    // A forged event (wrong secret) changes nothing.
    expect((await s.sandboxEvent({ id: 'evt_forged', type: 'payment.settled', checkoutRef: s.checkoutRef, customerRef: 'scus_1', paymentRef: 'pay_1', amountCents: 1500, currency: 'EUR' }, 'wrong-secret-0123456789abcdef0123')).status).toBe('auth_failed');
    expect((await subscriptionStatus(s.userId, s.deps)).active).toBe(false);
    const settled = await s.sandboxEvent({ id: 'evt_1', type: 'payment.settled', checkoutRef: s.checkoutRef, customerRef: 'scus_1', paymentRef: 'pay_1', amountCents: 1500, currency: 'EUR', billingCountry: 'CZ' });
    expect(settled.events[0].outcome).toBe('applied');
    const replay = await s.sandboxEvent({ id: 'evt_1', type: 'payment.settled', checkoutRef: s.checkoutRef, customerRef: 'scus_1', paymentRef: 'pay_1', amountCents: 1500, currency: 'EUR' });
    expect(replay.events[0].outcome).toBe('duplicate');
    const status = await subscriptionStatus(s.userId, s.deps);
    expect(status).toMatchObject({ active: true, paidUntil: '2026-12-05T10:00:00.000Z', priceEurCents: 1500 });
    expect((await s.paid.listOutbox()).map((o) => o.kind)).toEqual(['INVOICE']);
    expect((await startCheckout(s.userId, 'en', s.deps)).status).toBe('already_active');
    s.setNow(new Date('2026-12-05T10:00:01.000Z'));
    expect((await subscriptionStatus(s.userId, s.deps)).active).toBe(false);
  });

  it('rejects a forged price and a payment for someone else\'s customer', async () => {
    const s = await paidUser();
    const cheap = await s.sandboxEvent({ id: 'evt_cheap', type: 'payment.settled', checkoutRef: s.checkoutRef, customerRef: 'scus_1', paymentRef: 'pay_cheap', amountCents: 100, currency: 'EUR' });
    expect(cheap).toMatchObject({ status: 'ok', events: [{ outcome: 'rejected' }] });
    expect((await subscriptionStatus(s.userId, s.deps)).active).toBe(false);
    expect((await s.paid.listOutbox()).length).toBe(0);
    expect((await s.paid.listAudit(`user:${s.userId}`, 20)).find((a) => a.action === 'PAYMENT_EVENT_REJECTED')?.details).toMatchObject({ reason: 'INVALID_PAID_PLAN' });
    const other = await s.askStore.upsertUser('hmac-other', NOW);
    await s.paid.bindCustomer({ provider: 'DAJC_SANDBOX', customerRef: 'scus_taken', userId: other, subscriptionRef: null });
    const result = await s.sandboxEvent({ id: 'evt_x', type: 'payment.settled', checkoutRef: s.checkoutRef, customerRef: 'scus_taken', paymentRef: 'pay_x', amountCents: 1500, currency: 'EUR' });
    expect(result.events[0].outcome).toBe('rejected');
    expect((await subscriptionStatus(s.userId, s.deps)).active).toBe(false);
  });

  it('asks the provider to redeliver a payment it cannot attribute yet (late or out-of-order webhook)', async () => {
    const s = await paidUser();
    const early = await s.sandboxEvent({ id: 'evt_early', type: 'payment.settled', checkoutRef: 'dco_unknown', customerRef: 'scus_unknown', paymentRef: 'pay_e', amountCents: 1500, currency: 'EUR' });
    expect(early).toMatchObject({ status: 'retry' });
    // The redelivery with the server-created checkout is applied normally.
    const late = await s.sandboxEvent({ id: 'evt_early', type: 'payment.settled', checkoutRef: s.checkoutRef, customerRef: 'scus_unknown', paymentRef: 'pay_e', amountCents: 1500, currency: 'EUR' });
    expect(late.events[0].outcome).toBe('applied');
  });

  it('failed renewal keeps the paid period and does not extend it', async () => {
    const s = await paidUser();
    await s.sandboxEvent({ id: 'evt_1', type: 'payment.settled', checkoutRef: s.checkoutRef, customerRef: 'scus_1', paymentRef: 'pay_1', amountCents: 1500, currency: 'EUR' });
    s.setNow(new Date('2026-12-05T09:00:00.000Z'));
    expect((await s.sandboxEvent({ id: 'evt_fail', type: 'payment.failed', customerRef: 'scus_1' })).events[0].outcome).toBe('applied');
    expect((await subscriptionStatus(s.userId, s.deps)).active).toBe(true);
    s.setNow(new Date('2026-12-05T10:00:01.000Z'));
    expect((await subscriptionStatus(s.userId, s.deps)).active).toBe(false);
    // Retried card payment succeeds: a new period, from the provider's statement.
    await s.sandboxEvent({ id: 'evt_retry', type: 'payment.settled', customerRef: 'scus_1', paymentRef: 'pay_2', amountCents: 1500, currency: 'EUR' });
    expect((await subscriptionStatus(s.userId, s.deps)).active).toBe(true);
  });

  it('self-service cancellation keeps access until the end of the paid period', async () => {
    const s = await paidUser();
    await s.sandboxEvent({ id: 'evt_1', type: 'payment.settled', checkoutRef: s.checkoutRef, customerRef: 'scus_1', paymentRef: 'pay_1', amountCents: 1500, currency: 'EUR' });
    expect(await requestCancellation(s.userId, s.deps)).toBe('requested');
    const status = await subscriptionStatus(s.userId, s.deps);
    expect(status).toMatchObject({ active: true, cancelAtPeriodEnd: true });
    expect((await s.paid.listAudit(`user:${s.userId}`, 20)).map((a) => a.action)).toContain('CANCELLATION_REQUESTED');
  });

  it('self-service refund within the window: provider refund, then revocation and a credit note', async () => {
    const s = await paidUser();
    await s.sandboxEvent({ id: 'evt_1', type: 'payment.settled', checkoutRef: s.checkoutRef, customerRef: 'scus_1', paymentRef: 'pay_1', amountCents: 1500, currency: 'EUR' });
    const refund = await requestRefund(s.userId, 'not useful', s.deps);
    expect(refund.status).toBe('executed');
    // Access ends only when the provider confirms the refund.
    expect((await subscriptionStatus(s.userId, s.deps)).active).toBe(true);
    await s.sandboxEvent({ id: 'evt_ref', type: 'payment.refunded', customerRef: 'scus_1', paymentRef: 'pay_1' });
    expect((await subscriptionStatus(s.userId, s.deps)).active).toBe(false);
    expect((await s.paid.listOutbox()).map((o) => o.kind)).toEqual(['INVOICE', 'CREDIT_NOTE']);
    expect((await s.paid.listRefundRequests(s.userId))[0].status).toBe('EXECUTED');
    expect((await requestRefund(s.userId, 'again', s.deps)).status).toBe('no_payment');
  });

  it('refund abuse: a second refund or a late request goes to a human billing reviewer', async () => {
    const s = await paidUser();
    await s.sandboxEvent({ id: 'evt_1', type: 'payment.settled', checkoutRef: s.checkoutRef, customerRef: 'scus_1', paymentRef: 'pay_1', amountCents: 1500, currency: 'EUR' });
    s.setNow(new Date('2026-11-25T10:00:00.000Z'));
    const late = await requestRefund(s.userId, 'late', s.deps);
    expect(late.status).toBe('pending_review');
    const reviewer = await s.askStore.upsertUser('hmac-reviewer', NOW);
    expect((await decideRefund(reviewer, (late as { requestId: string }).requestId, true, s.deps)).status).toBe('forbidden');
    s.paid.reviewerRoles.add(`${reviewer}|BILLING_REVIEWER`);
    expect((await decideRefund(s.userId, (late as { requestId: string }).requestId, true, s.deps)).status).toBe('forbidden');
    expect((await decideRefund(reviewer, (late as { requestId: string }).requestId, false, s.deps)).status).toBe('not_eligible');
    expect((await s.paid.listRefundRequests(s.userId))[0].status).toBe('REJECTED');
  });

  it('a dispute revokes access for the disputed period and is reported', async () => {
    const s = await paidUser();
    await s.sandboxEvent({ id: 'evt_1', type: 'payment.settled', checkoutRef: s.checkoutRef, customerRef: 'scus_1', paymentRef: 'pay_1', amountCents: 1500, currency: 'EUR' });
    // Disputes may carry only the payment reference.
    await s.sandboxEvent({ id: 'evt_dis', type: 'payment.disputed', paymentRef: 'pay_1' });
    expect((await subscriptionStatus(s.userId, s.deps)).active).toBe(false);
    expect((await s.paid.listOutbox()).map((o) => o.kind)).toContain('DISPUTE_NOTICE');
  });

  it('payment gateway outage: checkout is reported unavailable and nothing is activated', async () => {
    const adapter = createSandboxAdapter({ secret: SECRET, publicOrigin: 'https://www.dajc.eu' });
    const down: PaymentAdapter = { ...adapter, async createCheckout() { throw new PaymentProviderUnavailable('DAJC_SANDBOX', 'HTTP 503'); } };
    const s = billingScenario(down);
    const userId = await s.askStore.upsertUser('hmac-user', NOW);
    expect((await startCheckout(userId, 'en', s.deps)).status).toBe('unavailable');
    expect([...s.paid.checkouts.values()][0].status).toBe('EXPIRED');
    expect((await subscriptionStatus(userId, s.deps)).active).toBe(false);
  });

  it('limits checkout creation per user', async () => {
    const s = billingScenario();
    const userId = await s.askStore.upsertUser('hmac-user', NOW);
    const results = [];
    for (let i = 0; i < 6; i++) results.push((await startCheckout(userId, 'en', s.deps)).status);
    expect(results.filter((r) => r === 'limited')).toHaveLength(1);
  });

  it('a database failure while applying an event lets the provider redeliver it', async () => {
    const s = await paidUser();
    s.paid.failNext = 'applyPaymentEvent';
    await expect(s.sandboxEvent({ id: 'evt_db', type: 'payment.settled', checkoutRef: s.checkoutRef, customerRef: 'scus_1', paymentRef: 'pay_db', amountCents: 1500, currency: 'EUR' })).rejects.toThrow('simulated database failure');
    expect((await s.sandboxEvent({ id: 'evt_db', type: 'payment.settled', checkoutRef: s.checkoutRef, customerRef: 'scus_1', paymentRef: 'pay_db', amountCents: 1500, currency: 'EUR' })).events[0].outcome).toBe('applied');
  });
});
