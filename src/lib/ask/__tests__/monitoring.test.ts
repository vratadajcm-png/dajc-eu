// Monitoring and recovery behind the maintenance secret: health, dead-letter
// requeue and the preflight of settings (names only, never values).

import { describe, expect, it } from 'vitest';
import { handleMaintenance } from '../account-handlers';
import type { AccountRuntime } from '../account/runtime';
import { DAJC_ASK_ORCHESTRATOR_PRODUCTION_RELEASED } from '../config';
import type { RouteContext } from '../handlers';
import { operationalHealth, OUTBOX_STALE_MS, preflight } from '../monitoring';
import type { AskRuntime } from '../runtime';
import { budgetCaps } from '../service';
import { MemoryAskStore } from '../store/memory';
import { MemoryPaidStore } from '../store/paid-memory';
import { fakeProviders, FULL_ENV, NOW, testConfig } from './helpers';

const SECRET = 'maintenance-secret-for-tests-only-0123456789';
const PRICING = { openai: { input: 1, output: 4 }, anthropic: { input: 3, output: 15 }, gemini: { input: 0.5, output: 2 }, perplexity: { request: 0.005 } };
const ORCHESTRATOR_ENV: Record<string, string> = {
  ...FULL_ENV,
  DAJC_ASK_AI_ROUTING: 'orchestrator',
  DAJC_ASK_OPENAI_API_KEY: 'ask-openai-value-never-shown', DAJC_ASK_OPENAI_MODEL: 'test-openai-model',
  DAJC_ASK_ANTHROPIC_API_KEY: 'ask-anthropic-value-never-shown', DAJC_ASK_ANTHROPIC_MODEL: 'test-anthropic-model',
  DAJC_ASK_GEMINI_API_KEY: 'ask-gemini-value-never-shown', DAJC_ASK_GEMINI_MODEL: 'test-gemini-model',
  DAJC_ASK_PERPLEXITY_API_KEY: 'ask-perplexity-value-never-shown',
  DAJC_ASK_PROVIDER_PRICING_USD: JSON.stringify(PRICING),
  DAJC_AI_MAINTENANCE_SECRET: SECRET,
};

function setup(env: Record<string, string | undefined> = { DAJC_AI_MAINTENANCE_SECRET: SECRET }) {
  const ask = new MemoryAskStore();
  const paid = new MemoryPaidStore(ask);
  const askRuntime: AskRuntime = { config: testConfig(), store: ask, providers: fakeProviders(), mailer: { async send() {} }, now: () => NOW };
  const rt: AccountRuntime = { ask: askRuntime, paid, keyring: null, paidRuntime: null, env, now: () => NOW };
  return { ask, paid, rt };
}

function ctx(action: string, { method = 'GET', auth = `Bearer ${SECRET}`, body }: { method?: string; auth?: string | null; body?: unknown } = {}): RouteContext {
  const url = new URL(`https://www.dajc.eu/api/ask/maintenance/${action}`);
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (auth) headers.authorization = auth;
  return { request: new Request(url, { method, headers, body: method === 'GET' ? undefined : JSON.stringify(body ?? {}) }), url, cookies: { get: () => undefined, set() {}, delete() {} } as any, clientAddress: '127.0.0.1' };
}

async function call(action: string, rt: AccountRuntime | null, options: Parameters<typeof ctx>[1] = {}, env?: Record<string, string | undefined>) {
  const response = await handleMaintenance(action, ctx(action, options), rt, env);
  return { status: response.status, body: response.status === 404 ? null : await response.json() };
}

describe('maintenance access', () => {
  it('answers 404 without a configured secret or with a wrong bearer, 405 for the wrong method', async () => {
    const { rt } = setup();
    expect((await call('health', setup({}).rt)).status).toBe(404);
    expect((await call('health', setup({ DAJC_AI_MAINTENANCE_SECRET: 'too-short' }).rt, { auth: 'Bearer too-short' })).status).toBe(404);
    expect((await call('health', rt, { auth: null })).status).toBe(404);
    expect((await call('health', rt, { auth: `Bearer ${SECRET}x` })).status).toBe(404);
    expect((await call('nothing', rt)).status).toBe(404);
    expect((await call('health', rt, { method: 'POST' })).status).toBe(405);
    expect((await call('run', rt, { method: 'GET' })).status).toBe(405);
    expect((await call('requeue', rt, { method: 'GET' })).status).toBe(405);
    expect((await call('health', rt)).status).toBe(200);
  });

  it('serves the preflight before the features are configured, other actions only with the runtime', async () => {
    const env = { DAJC_AI_MAINTENANCE_SECRET: SECRET };
    const preflightOnly = await call('preflight', null, {}, env);
    expect(preflightOnly.status).toBe(200);
    expect(preflightOnly.body.preflight.ask.ready).toBe(false);
    expect((await call('health', null, {}, env)).status).toBe(404);
  });
});

describe('health', () => {
  it('is ok on a quiet system', async () => {
    const { rt } = setup();
    const { body } = await call('health', rt);
    expect(body.health).toMatchObject({ status: 'ok', alerts: [], outbox: { pending: 0, dead: 0, oldestPendingMinutes: null }, audit: { brokenAtId: null } });
    expect(body.health.askBudget).toEqual({ monthUsed: 0, dayUsed: 0 });
  });

  it('raises dead letters as critical, redacts their errors and recovers them with an audited requeue', async () => {
    const { rt, paid } = setup();
    await paid.enqueueOutbox([{ idemKey: 'inv:1', kind: 'INVOICE', payload: { amountCents: 1500 } }], NOW);
    const item = (await paid.getOutbox('inv:1'))!;
    await paid.failOutbox(item.id, 'HTTP 400: Adresář jan.novak@example.com již existuje', null, NOW);

    const { body } = await call('health', rt);
    expect(body.health.status).toBe('critical');
    expect(body.health.alerts).toContain('OUTBOX_DEAD_LETTER');
    expect(body.health.outbox.deadItems).toEqual([{ idemKey: 'inv:1', kind: 'INVOICE', attempts: 1, lastError: 'HTTP 400: Adresář [e-mail] již existuje' }]);
    expect(JSON.stringify(body)).not.toContain('jan.novak');

    expect((await call('requeue', rt, { method: 'POST', body: {} })).status).toBe(400);
    expect((await call('requeue', rt, { method: 'POST', body: { idemKey: 'inv:missing' } })).status).toBe(409);
    expect(await call('requeue', rt, { method: 'POST', body: { idemKey: 'inv:1' } })).toEqual({ status: 200, body: { ok: true, requeued: 'inv:1' } });
    expect((await call('requeue', rt, { method: 'POST', body: { idemKey: 'inv:1' } })).status).toBe(409);
    expect(await paid.getOutbox('inv:1')).toMatchObject({ status: 'PENDING', attempts: 0 });
    expect((await paid.listAudit('outbox:inv:1', 10)).map((a) => [a.actor, a.action])).toEqual([['system:maintenance', 'ACCOUNTING_REQUEUED']]);
    expect((await call('health', rt)).body.health.alerts).not.toContain('OUTBOX_DEAD_LETTER');
  });

  it('reports a stale outbox, refused payment events and webhooks, renewal problems and waiting reviews', async () => {
    const { paid } = setup();
    const old = new Date(NOW.getTime() - OUTBOX_STALE_MS - 60_000);
    await paid.enqueueOutbox([{ idemKey: 'inv:old', kind: 'INVOICE', payload: {} }], old);
    await paid.applyPaymentEvent({
      provider: 'STRIPE', eventId: 'evt_rejected', kind: 'PAYMENT_SETTLED', payloadSha256: 'a'.repeat(64), receivedAt: NOW, userId: null, customerRef: null,
      mutate: null, outbox: [], ignoredOutcome: 'REJECTED', audit: { actor: 'provider:STRIPE', action: 'PAYMENT_EVENT_REJECTED', subject: 'provider:STRIPE' },
    });
    // Outside the 24-hour window: not counted.
    await paid.applyPaymentEvent({
      provider: 'STRIPE', eventId: 'evt_old', kind: 'PAYMENT_SETTLED', payloadSha256: 'b'.repeat(64), receivedAt: new Date(NOW.getTime() - 25 * 3_600_000), userId: null, customerRef: null,
      mutate: null, outbox: [], ignoredOutcome: 'REJECTED', audit: { actor: 'provider:STRIPE', action: 'PAYMENT_EVENT_REJECTED', subject: 'provider:STRIPE' },
    });
    await paid.appendAudit({ actor: 'anonymous', action: 'WEBHOOK_REJECTED', subject: 'provider:STRIPE', details: { reason: 'signature' } }, NOW);
    await paid.appendAudit({ actor: 'system:renewal', action: 'RENEWAL_DECLINED', subject: 'user:u1', details: {} }, NOW);
    await paid.appendAudit({ actor: 'system:renewal', action: 'RENEWAL_SUBMITTED', subject: 'user:u2', details: {} }, NOW);
    await paid.createRefundRequest({ userId: 'u1', provider: 'STRIPE', paymentRef: 'pay_1', reason: 'r', status: 'PENDING_REVIEW' }, NOW);

    const health = await operationalHealth({ paid, now: NOW });
    expect(health.status).toBe('attention');
    expect(health.alerts.sort()).toEqual(['OUTBOX_STALE', 'PAYMENT_EVENTS_REJECTED', 'REFUNDS_WAITING', 'RENEWAL_PROBLEM', 'WEBHOOK_REJECTED']);
    expect(health.outbox.oldestPendingMinutes).toBe(Math.floor((OUTBOX_STALE_MS + 60_000) / 60_000));
    expect(health.last24h).toEqual({ paymentEvents: { applied: 0, ignored: 0, rejected: 1 }, webhooksRejected: 1, renewals: { submitted: 1, declined: 1, errors: 0, blocked: 0 } });
    expect(health.askBudget).toBeNull();
  });

  it('detects an edited audit record as critical', async () => {
    const { paid } = setup();
    await paid.appendAudit({ actor: 'system', action: 'A', subject: 's', details: { n: 1 } }, NOW);
    await paid.appendAudit({ actor: 'system', action: 'B', subject: 's', details: { n: 2 } }, NOW);
    expect((await operationalHealth({ paid, now: NOW })).audit).toEqual({ checkedRecords: 2, brokenAtId: null });
    paid.audit[1].details = { n: 3 };
    const health = await operationalHealth({ paid, now: NOW });
    expect(health.status).toBe('critical');
    expect(health.alerts).toContain('AUDIT_CHAIN_BROKEN');
    expect(health.audit.brokenAtId).toBe(paid.audit[1].id);
  });

  it('warns when the Ask budget is 80 % used', async () => {
    const { ask, paid, rt } = setup();
    const caps = budgetCaps(rt.ask.config, NOW);
    expect(await ask.reserveBudget(caps, Math.ceil(caps.dailyCapMicro! * 0.85))).toBe(true);
    const health = await operationalHealth({ paid, ask: { store: ask, config: rt.ask.config }, now: NOW });
    expect(health.alerts).toContain('ASK_BUDGET_HIGH');
    expect(health.askBudget!.dayUsed).toBeGreaterThanOrEqual(0.85);
    expect(health.askBudget!.monthUsed).toBeLessThan(0.8);
  });
});

describe('preflight', () => {
  it('names missing settings without values and shows the orchestrator is ready in a preview with three vendors', () => {
    const result = preflight({ ...ORCHESTRATOR_ENV, VERCEL_ENV: 'preview' });
    expect(result.environment).toBe('preview');
    expect(result.ask).toMatchObject({ routing: 'orchestrator', ready: true, problems: [] });
    expect(result.orchestrator).toMatchObject({ requested: true, allowedInThisEnvironment: true, independent: true, search: true, pricing: true, budgets: { monthly: true, daily: true }, separateKeys: true, ready: true });
    // The legacy two-vendor model names stay set; without a price for them
    // OpenAI is left out (named), and the other vendors still check each other.
    expect(result.orchestrator.configuredProviders.sort()).toEqual(['anthropic', 'gemini', 'perplexity']);
    expect(result.orchestrator.missing.openai).toEqual(['DAJC_ASK_PROVIDER_PRICING_USD.openai.models.classifier-model-from-env']);
    expect(result.orchestrator.missing.xai).toEqual(expect.arrayContaining(['DAJC_ASK_XAI_API_KEY']));
    expect(JSON.stringify(result.orchestrator.missing)).not.toContain('DAJC_RESEARCH_');
    const priced = { ...PRICING, openai: { ...PRICING.openai, models: { 'classifier-model-from-env': { input: 0.2, output: 1.25 } } } };
    const all = preflight({ ...ORCHESTRATOR_ENV, DAJC_ASK_PROVIDER_PRICING_USD: JSON.stringify(priced), VERCEL_ENV: 'preview' });
    expect(all.orchestrator.configuredProviders.sort()).toEqual(['anthropic', 'gemini', 'openai', 'perplexity']);
    expect(all.orchestrator.ready).toBe(true);
    const text = JSON.stringify(result);
    for (const [name, value] of Object.entries(ORCHESTRATOR_ENV)) {
      if (/KEY|SECRET|PEPPER|DB_URL/.test(name)) expect(text, name).not.toContain(value);
    }
  });

  it('never allows the orchestrator in production and explains a missing daily budget or a shared key', () => {
    const production = preflight({ ...ORCHESTRATOR_ENV, VERCEL_ENV: 'production' });
    expect(DAJC_ASK_ORCHESTRATOR_PRODUCTION_RELEASED).toBe(false);
    expect(production.orchestrator).toMatchObject({ allowedInThisEnvironment: false, ready: false });
    expect(production.ask.ready).toBe(false);

    const noDaily = preflight({ ...ORCHESTRATOR_ENV, DAJC_ASK_DAILY_BUDGET_EUR: undefined, VERCEL_ENV: 'preview' });
    expect(noDaily.orchestrator).toMatchObject({ budgets: { monthly: true, daily: false }, ready: false });

    const shared = preflight({ ...ORCHESTRATOR_ENV, DAJC_RESEARCH_GEMINI_API_KEY: ORCHESTRATOR_ENV.DAJC_ASK_GEMINI_API_KEY, VERCEL_ENV: 'preview' });
    expect(shared.orchestrator).toMatchObject({ separateKeys: false, ready: false });

    const oneVendor = preflight({ ...FULL_ENV, DAJC_ASK_OPENAI_MODEL: 'test-openai-model', DAJC_ASK_PROVIDER_PRICING_USD: JSON.stringify(PRICING), VERCEL_ENV: 'preview' });
    expect(oneVendor.orchestrator).toMatchObject({ requested: false, independent: false, ready: false });
    // The current (direct) routing is reported separately and unaffected.
    expect(oneVendor.ask).toMatchObject({ routing: 'direct', ready: true });
  });

  it('reports the paid and accounting gates without enabling anything', () => {
    const result = preflight({ DAJC_AI_PAID_ENABLED: 'true', DAJC_AI_PAYMENT_PROVIDER: 'sandbox', DAJC_AI_PAYMENT_MODE: 'sandbox', VERCEL_ENV: 'production' });
    expect(result.paid).toMatchObject({ enabled: true, released: false, livePaymentsReleased: false, ready: false });
    expect(result.paid.problems.join(' ')).toMatch(/never allowed in production/);
    expect(result.accounting).toMatchObject({ liveReleased: false, ready: false });
    expect(result.account).toEqual({ enabled: false, dataKeys: 'DAJC_AI_DATA_KEYS is missing' });
  });
});
