// End-to-end customer lifecycle through the real route handlers, with
// synthetic data only: sandbox payment provider (signed synthetic events),
// fake AI providers, the Driving Bans fixture and a simulated ABRA Flexi.
//
//   registration -> free questions -> purchase -> activation -> paid expert
//   question -> accounting document -> cancellation -> refund -> credit note
//   -> account deletion
//
// Runs on the in-memory stores always, and on a real Postgres (RLS, grants,
// transactions) when DAJC_ASK_TEST_DB_URL is set (Application CI job
// "ask-postgres-integration"). No real payment, e-mail or AI call is made.

import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { createAbraClient } from '../accounting/abra-flexi';
import type { AccountingConfig } from '../accounting/config';
import { createFakeAbra } from '../accounting/fake-abra';
import { runAccountingOutbox } from '../accounting/outbox-worker';
import { handleAccount, handleBilling, handleBillingWebhook, handlePaid, handleReview } from '../account-handlers';
import type { AccountRuntime } from '../account/runtime';
import { SESSION_COOKIE } from '../auth';
import { createSandboxAdapter, signSandboxEvent, SANDBOX_SIGNATURE_HEADER } from '../billing/sandbox';
import { handleLogin, handleQuery, handleVerify, type RouteContext } from '../handlers';
import type { PaidRuntime } from '../paid/runtime';
import type { AskRuntime } from '../runtime';
import { MemoryAskStore } from '../store/memory';
import { MemoryPaidStore } from '../store/paid-memory';
import type { PaidStore } from '../store/paid-types';
import type { AskStore } from '../store/types';
import { fakeProviders, firstOwnSourceId, fixtureView, NOW, ownRecordQuote, SUNDAY, testConfig } from './helpers';
import { paidConfig } from './paid-helpers';

const TEST_DB_URL = process.env.DAJC_ASK_TEST_DB_URL;
const SANDBOX_SECRET = 'sandbox-secret-0123456789abcdef0123456789';
const ACCOUNTING: AccountingConfig = {
  mode: 'sandbox', abra: { baseUrl: 'https://abra.test.invalid', company: 'dajc_test', username: 'api', password: 'pw' },
  supplierCountry: 'CZ', vatRates: { CZ: 21, DE: 19 }, vatConfirmedBy: 'test fixture (not a real confirmation)',
  codes: { invoiceType: 'FAKTURA', creditNoteType: 'DOBROPIS', paymentMethod: 'KARTA', gatewayBankAccount: 'BRANA', gatewayFeeMovementType: 'POPLATKY' },
  itemName: 'DAJC AI', dueDays: 0,
};

class Jar {
  values = new Map<string, string>();
  get(name: string) {
    const value = this.values.get(name);
    return value === undefined ? undefined : { value };
  }
  set(name: string, value: string) {
    this.values.set(name, value);
  }
  delete(name: string) {
    this.values.delete(name);
  }
}

function ctx(path: string, { method = 'POST', body, jar = new Jar(), origin = 'https://www.dajc.eu', headers = {} as Record<string, string>, raw }: { method?: string; body?: unknown; jar?: Jar; origin?: string | null; headers?: Record<string, string>; raw?: string } = {}): RouteContext {
  const url = new URL(`https://www.dajc.eu${path}`);
  const h: Record<string, string> = { 'content-type': 'application/json', ...headers };
  if (origin) h.origin = origin;
  // A distinct client address per request: login rate limits persist in a shared test database.
  return { request: new Request(url, { method, headers: h, body: method === 'GET' ? undefined : raw ?? JSON.stringify(body ?? {}) }), url, cookies: jar, clientAddress: `test-${randomUUID()}` };
}

async function data(response: Response) {
  return { status: response.status, body: await response.json() };
}

function runtimes(ask: AskStore, paid: PaidStore) {
  const sent: Array<{ to: string; text: string }> = [];
  let clock = NOW;
  const abra = createFakeAbra({ company: 'dajc_test', username: 'api', password: 'pw' });
  const askRuntime: AskRuntime = {
    config: testConfig(), store: ask,
    providers: fakeProviders({
      draft: (params) => ({ claims: [{ text: 'In Czechia the Sunday and public holiday driving ban applies on that day.', source_id: firstOwnSourceId(params), quote: ownRecordQuote(params) }], covers_question: true }),
    }),
    mailer: { async send(message) { sent.push(message); } },
    now: () => clock,
    pipeline: { view: fixtureView(), findings: [] },
  };
  const env = { DAJC_AI_PAID_ENABLED: 'true', DAJC_AI_DRIVING_BANS_ENABLED: 'true' };
  const config = paidConfig();
  const paidRuntime: PaidRuntime = {
    ask: askRuntime, config, paid, adapter: createSandboxAdapter({ secret: SANDBOX_SECRET, publicOrigin: 'https://www.dajc.eu' }), env, released: true,
    accounting: { config: ACCOUNTING, client: createAbraClient({ ...ACCOUNTING.abra, fetchFn: abra.fetchFn }) }, now: () => clock,
  };
  const account: AccountRuntime = { ask: askRuntime, paid, keyring: config.keyring, paidRuntime, env, now: () => clock };
  return { account, askRuntime, paidRuntime, sent, abra, setNow: (d: Date) => { clock = d; }, now: () => clock };
}

async function signIn(rt: ReturnType<typeof runtimes>, email: string) {
  const jar = new Jar();
  expect((await handleLogin(ctx('/api/ask/login', { body: { email, lang: 'cs' }, jar }), rt.askRuntime)).status).toBe(200);
  const token = rt.sent.at(-1)!.text.match(/#login=(\S+)/)![1];
  expect((await handleVerify(ctx('/api/ask/verify', { body: { token }, jar }), rt.askRuntime)).status).toBe(200);
  // A login link works exactly once.
  expect((await handleVerify(ctx('/api/ask/verify', { body: { token }, jar: new Jar() }), rt.askRuntime)).status).toBe(400);
  return jar;
}

function sandboxWebhook(rt: ReturnType<typeof runtimes>, event: Record<string, unknown>, secret = SANDBOX_SECRET) {
  const raw = JSON.stringify({ occurredAt: rt.now().toISOString(), ...event });
  return handleBillingWebhook('sandbox', ctx('/api/ask/billing/webhook/sandbox', { raw, origin: null, headers: { [SANDBOX_SIGNATURE_HEADER]: signSandboxEvent(secret, raw, rt.now()) } }), rt.account);
}

function lifecycle(name: string, make: () => Promise<{ ask: AskStore; paid: PaidStore }>) {
  describe(`${name}: full customer lifecycle`, () => {
    it('registration -> free -> purchase -> paid -> invoice -> cancel -> refund -> deletion', async () => {
      const stores = await make();
      const rt = runtimes(stores.ask, stores.paid);
      const email = `driver-${randomUUID()}@example.com`;
      const jar = await signIn(rt, email);

      // Free tier: 3 questions a day, then the limit.
      for (let i = 0; i < 3; i++) {
        const free = await data(await handleQuery(ctx('/api/ask/query', { body: { question: `Is there a Sunday driving ban in Czechia on ${SUNDAY}?`, lang: 'en' }, jar }), rt.askRuntime));
        expect(free.status).toBe(200);
        expect(free.body.answer.level).toBe('VERIFIED');
      }
      expect((await handleQuery(ctx('/api/ask/query', { body: { question: 'One more question about Czechia?', lang: 'en' }, jar }), rt.askRuntime)).status).toBe(429);

      // Paid features stay closed for a free account, whatever the body claims.
      const sneaky = await data(await handlePaid('query', ctx('/api/ask/paid/query', { body: { question: 'Paid question please about CZ?', userId: 'someone', paid: true, released: true }, jar }), rt.account));
      expect(sneaky).toMatchObject({ status: 402, body: { result: 'not_paid' } });
      expect((await handlePaid('permit-compare', ctx('/api/ask/paid/permit-compare', { body: { permit: { maxWidthM: 3 }, transport: { widthM: 2.9 } }, jar }), rt.account)).status).toBe(402);
      expect((await data(await handleAccount('consent', ctx('/api/ask/account/consent', { body: { purpose: 'HISTORY', granted: true }, jar }), rt.account))).body.result).toBe('unavailable');
      expect((await data(await handleAccount('consent', ctx('/api/ask/account/consent', { body: { purpose: 'SHARED_LEARNING', granted: true }, jar }), rt.account))).body.result).toBe('unavailable');

      // Purchase: a server-side checkout, then a signed provider event activates.
      const checkout = await data(await handleBilling('checkout', ctx('/api/ask/billing/checkout', { body: { lang: 'cs' }, jar }), rt.account));
      expect(checkout.status).toBe(200);
      const checkoutRef = new URL(checkout.body.url).searchParams.get('sandbox_checkout');
      const settle = { id: `evt_${randomUUID()}`, type: 'payment.settled', checkoutRef, customerRef: `scus_${randomUUID()}`, paymentRef: `pay_${randomUUID()}`, amountCents: 1500, currency: 'EUR', billingCountry: 'DE', feeCents: 30 };
      expect((await sandboxWebhook(rt, settle, 'forged-secret-0123456789abcdef01234')).status).toBe(400);
      expect((await data(await handleAccount('status', ctx('/api/ask/account/status', { method: 'GET', jar }), rt.account))).body.paidActive).toBe(false);
      expect((await data(await sandboxWebhook(rt, settle))).body.events[0].outcome).toBe('applied');
      expect((await data(await sandboxWebhook(rt, settle))).body.events[0].outcome).toBe('duplicate');
      const status = await data(await handleAccount('status', ctx('/api/ask/account/status', { method: 'GET', jar }), rt.account));
      expect(status.body).toMatchObject({ paidActive: true, subscription: { active: true, priceEurCents: 1500, paidUntil: '2026-11-25T10:00:00.000Z' } });

      // Consents, then personal memory (a vehicle) and history.
      for (const purpose of ['HISTORY', 'MEMORY']) {
        expect((await handleAccount('consent', ctx('/api/ask/account/consent', { body: { purpose, granted: true }, jar }), rt.account)).status).toBe(200);
      }
      const saved = await data(await handleAccount('memory', ctx('/api/ask/account/memory', { body: { kind: 'VEHICLE', content: { name: 'Tractor + lowbed', vehicle: { configuration: 'ARTICULATED', combinationMassKg: 60000, widthM: 3.2, exceptionalTransport: true } } }, jar }), rt.account));
      expect(saved).toMatchObject({ status: 200, body: { ok: true } });

      // Paid expert question: verified AI answer + deterministic registry check with the saved vehicle.
      const paid = await data(await handlePaid('query', ctx('/api/ask/paid/query', { body: { question: `Driving ban in Czechia on ${SUNDAY} for my lowbed?`, vehicleId: saved.body.id, jurisdictions: ['CZ'], dates: [SUNDAY], lang: 'cs' }, jar }), rt.account));
      expect(paid.status).toBe(200);
      expect(paid.body.answer.level).toBe('VERIFIED');
      expect(paid.body.registry.status).toBe('ANSWER');
      expect(paid.body.registry.answer.completeness[0]).toMatchObject({ jurisdiction: 'CZ' });
      expect(paid.body.routing.available).toBe(false);
      expect(paid.body.historySaved).toBe(true);
      // Without the AI_PERSONAL_CONTEXT consent the vehicle never reached a model.
      const prompts = JSON.stringify((rt.askRuntime.providers as ReturnType<typeof fakeProviders>).calls.openai.map((c) => c.user));
      expect(prompts).not.toContain('60000');
      const history = await data(await handleAccount('history', ctx('/api/ask/account/history', { method: 'GET', jar }), rt.account));
      expect(history.body.items[0].question).toContain('lowbed');

      // Permit comparison (deterministic, never "legal").
      const compare = await data(await handlePaid('permit-compare', ctx('/api/ask/paid/permit-compare', { body: { permit: { maxWidthM: 3.0, maxMassKg: 70000, validFrom: '2026-10-01', validTo: '2026-11-30', jurisdiction: 'CZ' }, transport: { widthM: 3.2, massKg: 60000, date: SUNDAY, jurisdiction: 'CZ' } }, jar }), rt.account));
      expect(compare.body.comparison).toMatchObject({ status: 'DISCREPANCIES_FOUND', authorityConfirmationRequired: true });

      // Accounting: invoice with OSS VAT country, card payment pairing and gateway fee in ABRA.
      const worker = () => runAccountingOutbox({ paid: stores.paid, client: rt.paidRuntime.accounting!.client, config: ACCOUNTING, now: rt.now });
      await worker();
      await worker();
      const invoiceId = `ext:DAJC:invoice-DAJC_SANDBOX-${settle.paymentRef}`;
      expect(rt.abra.records.get('faktura-vydana')?.get(invoiceId)).toMatchObject({ statDph: 'code:DE', mena: 'code:EUR' });
      expect(rt.abra.records.get('banka')?.get(`ext:DAJC:payment-DAJC_SANDBOX-${settle.paymentRef}`)).toMatchObject({ sparovani: { uhrazovanaFak: { '#': invoiceId } } });
      expect(rt.abra.records.get('banka')?.get(`ext:DAJC:fee-DAJC_SANDBOX-${settle.paymentRef}`)).toMatchObject({ sumOsv: 0.3 });

      // Report an error on the answer.
      expect((await handleAccount('feedback', ctx('/api/ask/account/feedback', { body: { category: 'OUTDATED', answer: paid.body.answer, comment: 'Changed last week, call +420 777 123 456' }, jar }), rt.account)).status).toBe(200);

      // Export contains the decrypted personal data, and no e-mail address.
      const exported = await handleAccount('export', ctx('/api/ask/account/export', { method: 'GET', jar }), rt.account);
      const exportText = await exported.text();
      expect(exportText).toContain('Tractor + lowbed');
      expect(exportText).toContain('[phone]');
      expect(exportText).not.toContain(email);

      // Cancellation keeps the paid period.
      expect((await handleBilling('cancel', ctx('/api/ask/billing/cancel', { body: {}, jar }), rt.account)).status).toBe(200);
      expect((await data(await handleAccount('status', ctx('/api/ask/account/status', { method: 'GET', jar }), rt.account))).body.subscription).toMatchObject({ active: true, cancelAtPeriodEnd: true });

      // Refund within the window: executed at the provider, access ends on its confirmation, credit note follows.
      expect((await data(await handleBilling('refund', ctx('/api/ask/billing/refund', { body: { reason: 'trial' }, jar }), rt.account))).body.result).toBe('executed');
      await sandboxWebhook(rt, { id: `evt_${randomUUID()}`, type: 'payment.refunded', paymentRef: settle.paymentRef });
      expect((await handlePaid('query', ctx('/api/ask/paid/query', { body: { question: 'Another paid question about CZ?' }, jar }), rt.account)).status).toBe(402);
      await worker();
      expect(rt.abra.records.get('faktura-vydana')?.get(`ext:DAJC:credit-DAJC_SANDBOX-${settle.paymentRef}`)).toMatchObject({ typDokl: 'code:DOBROPIS', statDph: 'code:DE' });

      // Account deletion: the session ends, personal data is gone.
      expect((await handleAccount('delete', ctx('/api/ask/account/delete', { body: { confirm: 'nope' }, jar }), rt.account)).status).toBe(400);
      expect((await handleAccount('delete', ctx('/api/ask/account/delete', { body: { confirm: 'DELETE' }, jar }), rt.account)).status).toBe(200);
      expect(jar.get(SESSION_COOKIE)).toBeUndefined();
      expect((await handleAccount('status', ctx('/api/ask/account/status', { method: 'GET', jar }), rt.account)).status).toBe(401);
    }, 30_000);

    it('isolates customers: another user can neither read nor use someone else\'s data', async () => {
      const stores = await make();
      const rt = runtimes(stores.ask, stores.paid);
      const alice = await signIn(rt, `alice-${randomUUID()}@example.com`);
      const bob = await signIn(rt, `bob-${randomUUID()}@example.com`);
      for (const [jar, n] of [[alice, 1], [bob, 2]] as const) {
        const checkout = await data(await handleBilling('checkout', ctx('/api/ask/billing/checkout', { body: {}, jar }), rt.account));
        const checkoutRef = new URL(checkout.body.url).searchParams.get('sandbox_checkout');
        await sandboxWebhook(rt, { id: `evt_${randomUUID()}`, type: 'payment.settled', checkoutRef, customerRef: `scus_${n}_${randomUUID()}`, paymentRef: `pay_${randomUUID()}`, amountCents: 1500, currency: 'EUR' });
        await handleAccount('consent', ctx('/api/ask/account/consent', { body: { purpose: 'MEMORY', granted: true }, jar }), rt.account);
      }
      const cargo = await data(await handleAccount('memory', ctx('/api/ask/account/memory', { body: { kind: 'CARGO', content: { name: 'Alice transformer', widthM: 4.1, massKg: 120000 } }, jar: alice }), rt.account));
      const bobsMemory = await data(await handleAccount('memory', ctx('/api/ask/account/memory', { method: 'GET', jar: bob }), rt.account));
      expect(bobsMemory.body.items).toEqual([]);
      expect((await handlePaid('permit-compare', ctx('/api/ask/paid/permit-compare', { body: { cargoId: cargo.body.id, permit: { maxWidthM: 5 } }, jar: bob }), rt.account)).status).toBe(404);
      expect((await data(await handleAccount('memory', ctx('/api/ask/account/memory', { body: { id: cargo.body.id, kind: 'CARGO', content: { name: 'overwritten' } }, jar: bob }), rt.account))).status).toBe(404);
      expect((await data(await handleAccount('memory', ctx('/api/ask/account/memory', { body: { delete: cargo.body.id }, jar: bob }), rt.account))).body.deleted).toBe(0);
      expect((await data(await handleAccount('memory', ctx('/api/ask/account/memory', { method: 'GET', jar: alice }), rt.account))).body.items[0].content.name).toBe('Alice transformer');
      // Reviewer endpoints do not exist for a customer.
      expect((await handleReview('queue', ctx('/api/ask/review/queue', { method: 'GET', jar: alice }), rt.account)).status).toBe(404);
    }, 30_000);

    it('every account and paid route is CSRF-protected and requires a session', async () => {
      const stores = await make();
      const rt = runtimes(stores.ask, stores.paid);
      const jar = await signIn(rt, `csrf-${randomUUID()}@example.com`);
      expect((await handleAccount('consent', ctx('/api/ask/account/consent', { body: { purpose: 'MEMORY', granted: false }, jar, origin: 'https://evil.example' }), rt.account)).status).toBe(403);
      expect((await handleBilling('checkout', ctx('/api/ask/billing/checkout', { body: {}, jar, origin: null }), rt.account)).status).toBe(403);
      expect((await handlePaid('query', ctx('/api/ask/paid/query', { body: { question: 'Without a session?' } }), rt.account)).status).toBe(401);
      expect((await handleAccount('status', ctx('/api/ask/account/status', { method: 'GET', jar: Object.assign(new Jar(), { values: new Map([[SESSION_COOKIE, 'x'.repeat(43)]]) }) }), rt.account)).status).toBe(401);
      // Feature off: every route is a plain 404.
      expect((await handleAccount('status', ctx('/api/ask/account/status', { method: 'GET', jar }), null)).status).toBe(404);
      expect((await handlePaid('query', ctx('/api/ask/paid/query', { body: {}, jar }), { ...rt.account, paidRuntime: null })).status).toBe(404);
      expect((await handleBillingWebhook('sandbox', ctx('/api/ask/billing/webhook/sandbox', { raw: '{}' }), { ...rt.account, paidRuntime: null })).status).toBe(404);
      expect((await handleBillingWebhook('stripe', ctx('/api/ask/billing/webhook/stripe', { raw: '{}' }), rt.account)).status).toBe(404);
    }, 30_000);
  });
}

lifecycle('memory', async () => {
  const ask = new MemoryAskStore();
  return { ask, paid: new MemoryPaidStore(ask) };
});

describe.skipIf(!TEST_DB_URL)('postgres', () => {
  let client: { end: () => Promise<void> } | null = null;
  afterAll(async () => {
    await client?.end();
  });
  lifecycle('postgres', async () => {
    const [{ PostgresAskStore }, { PostgresPaidStore }, { drizzle }, { default: postgres }, schema] = await Promise.all([
      import('../store/postgres'), import('../store/paid-postgres'), import('drizzle-orm/postgres-js'), import('postgres'), import('../db/schema'),
    ]);
    const sql = postgres(TEST_DB_URL!, { max: 4, prepare: false });
    client = sql;
    const db = drizzle(sql, { schema });
    return { ask: new PostgresAskStore(db), paid: new PostgresPaidStore(db) };
  });
});
