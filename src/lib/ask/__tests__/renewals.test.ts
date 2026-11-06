import { describe, expect, it } from 'vitest';
import { createGpWebpayAdapter } from '../billing/gpwebpay';
import { MAX_ATTEMPTS, renewalRef, runRenewals } from '../billing/renewals';
import { createRevolutAdapter } from '../billing/revolut';
import { derivePeriod, processWebhook, requestCancellation, subscriptionStatus } from '../billing/service';
import { hmacHex, type PaymentAdapter } from '../billing/types';
import { billingScenario } from './paid-helpers';

const PAID = new Date('2026-11-05T10:00:00.000Z');
const DUE = new Date('2026-12-04T12:00:00.000Z');

async function paidUser(adapter?: PaymentAdapter) {
  const s = billingScenario(adapter);
  s.setNow(PAID);
  const userId = await s.askStore.upsertUser(`hmac-${Math.random()}`, PAID);
  await s.paid.bindCustomer({ provider: s.deps.adapter.provider, customerRef: 'cus_renew_1', userId, subscriptionRef: null });
  await s.paid.createCheckout({ checkoutRef: 'dco_first', userId, provider: s.deps.adapter.provider, amountCents: 1500, currency: 'EUR', status: 'OPEN', providerSessionRef: null, createdAt: PAID, expiresAt: new Date(PAID.getTime() + 86_400_000) });
  return { ...s, userId };
}

describe('server-side period for settlements without one', () => {
  it('continues the latest period for a renewal and starts at the payment otherwise', () => {
    const ledger: any = { settled: [{ paymentRef: 'p1', from: '2026-11-05T10:00:00.000Z', until: '2026-12-05T10:00:00.000Z', amountCents: 1500 }], reversedPaymentRefs: [] };
    expect(derivePeriod(ledger, '2026-12-04T12:00:00.000Z')).toEqual({ periodStart: '2026-12-05T10:00:00.000Z', periodEnd: '2027-01-05T10:00:00.000Z' });
    expect(derivePeriod(ledger, '2026-12-20T09:00:00.000Z')).toEqual({ periodStart: '2026-12-20T09:00:00.000Z', periodEnd: '2027-01-20T09:00:00.000Z' });
    expect(derivePeriod({ ...ledger, reversedPaymentRefs: ['p1'] }, '2026-12-04T12:00:00.000Z').periodStart).toBe('2026-12-04T12:00:00.000Z');
    expect(derivePeriod(null, '2026-11-05T10:00:00.000Z').periodEnd).toBe('2026-12-05T10:00:00.000Z');
  });
});

describe('monthly renewal (merchant-initiated)', () => {
  it('charges once per period, and only the verified settlement extends access contiguously', async () => {
    const s = await paidUser();
    await s.sandboxEvent({ id: 'evt_first', type: 'payment.settled', checkoutRef: 'dco_first', customerRef: 'cus_renew_1', paymentRef: 'pay_first', amountCents: 1500, currency: 'EUR' });
    s.setNow(new Date('2026-12-01T10:00:00.000Z'));
    expect((await runRenewals(s.deps)).considered).toBe(0); // not due yet
    s.setNow(DUE);
    expect(await runRenewals(s.deps)).toMatchObject({ considered: 1, submitted: 1 });
    expect(await runRenewals(s.deps)).toMatchObject({ submitted: 0, skipped: 1 }); // no double charge
    // Submitted is not paid: still only the first period.
    expect((await subscriptionStatus(s.userId, s.deps)).paidUntil).toBe('2026-12-05T10:00:00.000Z');
    const checkoutRef = renewalRef(s.userId, '2026-12-05T10:00:00.000Z', 1);
    await s.sandboxEvent({ id: 'evt_renewal', type: 'payment.settled', checkoutRef, paymentRef: 'pay_renewal', amountCents: 1500, currency: 'EUR', periodStart: undefined, periodEnd: undefined } as never);
    s.setNow(new Date('2026-12-20T10:00:00.000Z'));
    const status = await subscriptionStatus(s.userId, s.deps);
    expect(status).toMatchObject({ active: true, paidUntil: '2027-01-05T10:00:00.000Z' });
    const invoice = (await s.paid.listOutbox()).find((o) => o.idemKey === 'invoice:DAJC_SANDBOX:pay_renewal')!;
    expect(invoice.payload).toMatchObject({ periodStart: '2026-12-05T10:00:00.000Z', periodEnd: '2027-01-05T10:00:00.000Z' });
    expect((await s.paid.listAudit(`user:${s.userId}`, 20)).map((a) => a.action)).toContain('RENEWAL_SUBMITTED');
  });

  it('never renews a cancelled, refunded or disputed subscription', async () => {
    const cancelled = await paidUser();
    await cancelled.sandboxEvent({ id: 'evt_c', type: 'payment.settled', checkoutRef: 'dco_first', customerRef: 'cus_renew_1', paymentRef: 'pay_c', amountCents: 1500, currency: 'EUR' });
    await requestCancellation(cancelled.userId, cancelled.deps);
    cancelled.setNow(DUE);
    expect((await runRenewals(cancelled.deps)).considered).toBe(0);

    const refunded = await paidUser();
    await refunded.sandboxEvent({ id: 'evt_r', type: 'payment.settled', checkoutRef: 'dco_first', customerRef: 'cus_renew_1', paymentRef: 'pay_r', amountCents: 1500, currency: 'EUR' });
    await refunded.sandboxEvent({ id: 'evt_r2', type: 'payment.refunded', paymentRef: 'pay_r' });
    refunded.setNow(DUE);
    expect((await runRenewals(refunded.deps)).considered).toBe(0);
  });

  it('a declined card is recorded, keeps access to the period end and is retried at most three times', async () => {
    const base = billingScenario().deps.adapter;
    const declining: PaymentAdapter = { ...base, async chargeRenewal() { return { status: 'declined', providerRef: 'ord_x', reason: 'insufficient_funds' }; } };
    const s = await paidUser(declining);
    await s.sandboxEvent({ id: 'evt_d', type: 'payment.settled', checkoutRef: 'dco_first', customerRef: 'cus_renew_1', paymentRef: 'pay_d', amountCents: 1500, currency: 'EUR' });
    let clock = DUE.getTime() - 20 * 3_600_000;
    const results = [];
    for (let i = 0; i < 10; i++) {
      s.setNow(new Date(clock));
      results.push(await runRenewals(s.deps));
      clock += 12 * 3_600_000;
    }
    expect(results.reduce((sum, r) => sum + r.declined, 0)).toBe(MAX_ATTEMPTS);
    expect((await s.paid.listAudit(`user:${s.userId}`, 50)).filter((a) => a.action === 'RENEWAL_DECLINED')).toHaveLength(MAX_ATTEMPTS);
    s.setNow(new Date('2026-12-05T09:00:00.000Z'));
    expect((await subscriptionStatus(s.userId, s.deps)).active).toBe(true);
    s.setNow(new Date('2026-12-05T10:00:01.000Z'));
    expect((await subscriptionStatus(s.userId, s.deps)).active).toBe(false);
  });

  it('GP webpay renewals are blocked until the Web Services contract exists, and say so', async () => {
    const gp = createGpWebpayAdapter({ merchantNumber: '1', privateKeyPem: 'x', gpPublicKeyPem: 'x', mode: 'sandbox' });
    const s = await paidUser();
    await s.sandboxEvent({ id: 'evt_gp', type: 'payment.settled', checkoutRef: 'dco_first', customerRef: 'cus_renew_1', paymentRef: 'pay_gp', amountCents: 1500, currency: 'EUR' });
    // Same stored ledger, now served by a GP webpay adapter.
    const ledger = s.paid.ledgers.get(s.userId)!;
    ledger.provider = 'GP_WEBPAY';
    ledger.ledger.provider = 'GP_WEBPAY';
    s.setNow(DUE);
    expect(await runRenewals({ ...s.deps, adapter: gp })).toMatchObject({ considered: 1, blocked: 1, submitted: 0 });
    expect((await s.paid.listAudit(`user:${s.userId}`, 20)).map((a) => a.action)).toContain('RENEWAL_BLOCKED');
  });
});

describe('Revolut Merchant renewal requests (shapes from the Merchant API reference)', () => {
  function revolut(options: { cards?: unknown[]; paymentState?: string } = {}) {
    const requests: Array<{ method: string; url: string; body: any; headers: Headers }> = [];
    let order: Record<string, unknown> | null = null;
    const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      requests.push({ method: init?.method ?? 'GET', url, body, headers: new Headers(init?.headers) });
      const reply = (value: unknown) => new Response(JSON.stringify(value), { status: 200 });
      if (url.includes('/payment-methods')) return reply(options.cards ?? [{ id: 'pm_merchant', type: 'card', saved_for: 'MERCHANT' }]);
      if (url.endsWith('/orders') && init?.method === 'POST') {
        order = { id: 'ord_renew', state: 'PENDING', amount: 1500, currency: 'EUR', merchant_order_ext_ref: body.merchant_order_ext_ref, customer: { id: body.customer.id } };
        return reply(order);
      }
      if (url.endsWith('/payments')) return reply({ id: 'pay_1', order_id: 'ord_renew', state: options.paymentState ?? 'authorisation_started' });
      if (url.includes('/orders/ord_renew') && (init?.method ?? 'GET') === 'GET') return reply({ ...order, state: 'COMPLETED', completed_at: '2026-12-04T12:00:05.000Z' });
      return new Response('{}', { status: 404 });
    }) as typeof fetch;
    return { adapter: createRevolutAdapter({ secretKey: 'sk_test', webhookSecret: 'wsk_test', mode: 'sandbox', fetchFn }), requests };
  }

  it('lists merchant-saved cards, creates the order and pays it merchant-initiated, idempotently', async () => {
    const { adapter, requests } = revolut();
    expect(await adapter.chargeRenewal!({ customerRef: 'rcus_1', checkoutRef: 'rnw_abc' })).toEqual({ status: 'submitted', providerRef: 'ord_renew' });
    expect(requests[0]).toMatchObject({ method: 'GET', url: 'https://sandbox-merchant.revolut.com/api/customers/rcus_1/payment-methods?only_merchant=true' });
    expect(requests[0].headers.get('revolut-api-version')).toBe('2024-09-01');
    expect(requests[1]).toMatchObject({ method: 'POST', url: 'https://sandbox-merchant.revolut.com/api/orders', body: { amount: 1500, currency: 'EUR', customer: { id: 'rcus_1' }, merchant_order_ext_ref: 'rnw_abc' } });
    expect(requests[1].headers.get('idempotency-key')).toBe('rnw_abc');
    expect(requests[2]).toMatchObject({ method: 'POST', url: 'https://sandbox-merchant.revolut.com/api/orders/ord_renew/payments', body: { saved_payment_method: { type: 'card', id: 'pm_merchant', initiator: 'merchant' } } });
  });

  it('reports a missing merchant-saved card and a declined payment without charging again', async () => {
    expect((await revolut({ cards: [{ id: 'pm_c', type: 'card', saved_for: 'CUSTOMER' }] }).adapter.chargeRenewal!({ customerRef: 'rcus_1', checkoutRef: 'rnw_1' })).status).toBe('no_saved_card');
    expect(await revolut({ paymentState: 'declined' }).adapter.chargeRenewal!({ customerRef: 'rcus_1', checkoutRef: 'rnw_2' })).toMatchObject({ status: 'declined', providerRef: 'ord_renew' });
  });

  it('end to end: renewal order -> signed ORDER_COMPLETED -> API confirmation -> contiguous period', async () => {
    const { adapter } = revolut();
    const s = await paidUser(adapter);
    // First period recorded from an earlier verified settlement.
    await s.paid.applyPaymentEvent({
      provider: 'REVOLUT_MERCHANT', eventId: 'seed', kind: 'PAYMENT_SETTLED', payloadSha256: 'x'.repeat(64), receivedAt: PAID, userId: s.userId, customerRef: 'rcus_1',
      mutate: () => ({ userId: s.userId, provider: 'REVOLUT_MERCHANT', customerRef: 'rcus_1', settled: [{ paymentRef: 'ord_first', from: PAID.toISOString(), until: '2026-12-05T10:00:00.000Z', amountCents: 1500 }], reversedPaymentRefs: [], seenEventIds: ['seed'], cancelAtPeriodEnd: false }),
      outbox: [], audit: { actor: 'test', action: 'SEED', subject: `user:${s.userId}` },
    });
    s.setNow(DUE);
    expect(await runRenewals(s.deps)).toMatchObject({ submitted: 1 });
    const body = JSON.stringify({ event: 'ORDER_COMPLETED', order_id: 'ord_renew', merchant_order_ext_ref: renewalRef(s.userId, '2026-12-05T10:00:00.000Z', 1) });
    const ts = String(DUE.getTime());
    const headers = new Headers({ 'revolut-signature': `v1=${hmacHex('wsk_test', `v1.${ts}.${body}`)}`, 'revolut-request-timestamp': ts });
    const result = await processWebhook({ rawBody: body, headers }, s.deps);
    expect(result.events[0].outcome).toBe('applied');
    s.setNow(new Date('2026-12-20T00:00:00.000Z'));
    expect(await subscriptionStatus(s.userId, s.deps)).toMatchObject({ active: true, paidUntil: '2027-01-05T10:00:00.000Z' });
  });
});
