// GP webpay returns the customer with a GET redirect or a cross-site POST
// form. Both are accepted only with GP's signature; the CSRF rule stays
// Astro's for every other request (origin-check parity below).

import { createSign, generateKeyPairSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GP_RETURN_MAX_BYTES, handleBillingReturn } from '../account-handlers';
import type { AccountRuntime } from '../account/runtime';
import { createGpWebpayAdapter, gpResponseDigestInput } from '../billing/gpwebpay';
import { startCheckout } from '../billing/service';
import type { RouteContext } from '../handlers';
import type { PaidRuntime } from '../paid/runtime';
import { billingDeps } from '../paid/runtime';
import type { AskRuntime } from '../runtime';
import { MemoryAskStore } from '../store/memory';
import { MemoryPaidStore } from '../store/paid-memory';
import { isForbiddenCrossOrigin, originCheck, SIGNED_CROSS_SITE_POSTS } from '../../security/origin-check';
// Astro's own implementation, for the parity test only (not a package export).
import { isForbiddenCrossOriginRequest as astroForbidden } from '../../../../node_modules/astro/dist/core/app/origin-check.js';
import { fakeProviders, testConfig } from './helpers';
import { paidConfig } from './paid-helpers';

const NOW = new Date('2026-11-05T10:00:00.000Z');
const ORIGIN = 'https://www.dajc.eu';
const RETURN_PATH = '/api/ask/billing/return/gpwebpay';
const MERCHANT = '1234567890';

function setup() {
  const merchant = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const gp = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const pem = (k: any, type: 'private' | 'public') => k.export({ type: type === 'private' ? 'pkcs8' : 'spki', format: 'pem' }).toString();
  const adapter = createGpWebpayAdapter({ merchantNumber: MERCHANT, privateKeyPem: pem(merchant.privateKey, 'private'), gpPublicKeyPem: pem(gp.publicKey, 'public'), mode: 'sandbox' });
  const store = new MemoryAskStore();
  const paid = new MemoryPaidStore(store);
  const ask: AskRuntime = { config: testConfig(), store, providers: fakeProviders(), mailer: { async send() {} }, now: () => NOW };
  const env = { DAJC_AI_PAID_ENABLED: 'true' };
  const paidRuntime: PaidRuntime = { ask, config: paidConfig({ provider: 'GP_WEBPAY' }), paid, adapter, env, released: true, accounting: null, now: () => NOW };
  const rt: AccountRuntime = { ask, paid, keyring: paidRuntime.config.keyring, paidRuntime, env, now: () => NOW };
  const signed = (values: Record<string, string>) => {
    const q = new URLSearchParams(values);
    const sign = (data: string) => createSign('RSA-SHA1').update(data).sign(gp.privateKey, 'base64');
    q.set('DIGEST', sign(gpResponseDigestInput(q, null)));
    q.set('DIGEST1', sign(gpResponseDigestInput(q, MERCHANT)));
    return q;
  };
  return { rt, paid, store, paidRuntime, signed };
}

async function checkoutFor(s: ReturnType<typeof setup>) {
  const userId = await s.store.upsertUser(`hmac-${Math.random()}`, NOW);
  const outcome = await startCheckout(userId, 'cs', billingDeps(s.paidRuntime));
  expect(outcome.status).toBe('redirect');
  const order = new URL((outcome as { url: string }).url).searchParams.get('ORDERNUMBER')!;
  return { userId, order };
}

function ctx(method: string, { query, body, contentType, origin = 'https://3dsecure.gpwebpay.com' }: { query?: URLSearchParams; body?: string; contentType?: string; origin?: string } = {}): RouteContext {
  const url = new URL(`${ORIGIN}${RETURN_PATH}${query ? `?${query}` : ''}`);
  const headers: Record<string, string> = {};
  if (contentType) headers['content-type'] = contentType;
  if (origin) headers.origin = origin;
  return { request: new Request(url, { method, headers, body: method === 'GET' || method === 'HEAD' ? undefined : body ?? '' }), url, cookies: { get: () => undefined, set() {}, delete() {} } as any, clientAddress: '127.0.0.1' };
}

const outcomeOf = (response: Response) => new URL(response.headers.get('location')!).searchParams.get('billing');

describe('GP webpay return (GET redirect or POST form)', () => {
  it('settles from a signed GET return', async () => {
    const s = setup();
    const { userId, order } = await checkoutFor(s);
    const response = await handleBillingReturn('gpwebpay', ctx('GET', { query: s.signed({ OPERATION: 'CREATE_ORDER', ORDERNUMBER: order, PRCODE: '0', SRCODE: '0', RESULTTEXT: 'OK' }) }), s.rt);
    expect(response.status).toBe(303);
    expect(outcomeOf(response)).toBe('success');
    expect((await s.paid.getLedger(userId))?.settled).toHaveLength(1);
  });

  it('settles from a signed cross-site POST form once; a replay changes nothing', async () => {
    const s = setup();
    const { userId, order } = await checkoutFor(s);
    const body = s.signed({ OPERATION: 'CREATE_ORDER', ORDERNUMBER: order, PRCODE: '0', SRCODE: '0', RESULTTEXT: 'OK' }).toString();
    const post = () => handleBillingReturn('gpwebpay', ctx('POST', { body, contentType: 'application/x-www-form-urlencoded; charset=UTF-8' }), s.rt);
    const first = await post();
    expect(first.status).toBe(303);
    expect(outcomeOf(first)).toBe('success');
    expect(outcomeOf(await post())).toBe('success');
    expect((await s.paid.getLedger(userId))?.settled).toHaveLength(1);
  });

  it('refuses forged, wrongly encoded, oversized or mixed returns, and other methods', async () => {
    const s = setup();
    const { userId, order } = await checkoutFor(s);
    const good = s.signed({ OPERATION: 'CREATE_ORDER', ORDERNUMBER: order, PRCODE: '0', SRCODE: '0', RESULTTEXT: 'OK' });
    const forged = s.signed({ OPERATION: 'CREATE_ORDER', ORDERNUMBER: order, PRCODE: '14', SRCODE: '0', RESULTTEXT: 'Duplicate' });
    forged.set('PRCODE', '0');
    const form = 'application/x-www-form-urlencoded';
    const cases: RouteContext[] = [
      ctx('POST', { body: forged.toString(), contentType: form }),
      ctx('POST', { body: JSON.stringify(Object.fromEntries(good)), contentType: 'application/json' }),
      ctx('POST', { body: good.toString(), contentType: 'multipart/form-data; boundary=x' }),
      ctx('POST', { body: good.toString() }),
      ctx('POST', { body: `${good}&PAD=${'x'.repeat(GP_RETURN_MAX_BYTES)}`, contentType: form }),
      // The signed parameters in the query of a POST are ignored: the body is the source.
      ctx('POST', { query: good, body: '', contentType: form }),
    ];
    for (const c of cases) {
      const response = await handleBillingReturn('gpwebpay', c, s.rt);
      expect(response.status).toBe(303);
      expect(outcomeOf(response)).toBe('failed');
    }
    expect((await s.paid.getLedger(userId))?.settled ?? []).toHaveLength(0);
    expect((await handleBillingReturn('gpwebpay', ctx('PUT', { body: good.toString(), contentType: form }), s.rt)).status).toBe(405);
    expect((await handleBillingReturn('gpwebpay', ctx('DELETE'), s.rt)).status).toBe(405);
    // Another provider name or a runtime without GP webpay: not found.
    expect((await handleBillingReturn('stripe', ctx('GET', { query: good }), s.rt)).status).toBe(404);
    expect((await handleBillingReturn('gpwebpay', ctx('GET', { query: good }), null)).status).toBe(404);
  });
});

describe('same-origin check (replaces security.checkOrigin)', () => {
  const methods = ['GET', 'HEAD', 'OPTIONS', 'POST', 'PUT', 'PATCH', 'DELETE'];
  const types = [null, 'application/x-www-form-urlencoded', 'application/x-www-form-urlencoded; charset=UTF-8', 'multipart/form-data; boundary=x', 'text/plain', 'TEXT/PLAIN', 'application/json', 'application/octet-stream'];
  const origins = [null, ORIGIN, 'https://evil.example', 'null', 'https://3dsecure.gpwebpay.com'];
  const paths = ['/api/ask/paid/query', '/api/ask/account/delete', '/api/ask/billing/webhook/stripe', '/api/ask/maintenance/run', '/intelligence/ask', `${RETURN_PATH}/`, '/api/ask/billing/return/gpwebpay2', '/api/ask/billing/return/stripe'];
  const request = (method: string, path: string, type: string | null, origin: string | null) => {
    const headers: Record<string, string> = {};
    if (type) headers['content-type'] = type;
    if (origin) headers.origin = origin;
    return new Request(`${ORIGIN}${path}`, { method, headers });
  };

  it('decides exactly like Astro for every request outside the one exception', () => {
    let compared = 0;
    for (const method of methods) for (const type of types) for (const origin of origins) for (const path of [...paths, RETURN_PATH]) {
      for (const prerendered of [false, true]) {
        const req = request(method, path, type, origin);
        const url = new URL(req.url);
        expect(isForbiddenCrossOrigin(req, url, prerendered), `${method} ${path} ${type} ${origin}`).toBe(astroForbidden(req, url, prerendered));
        const exempt = path === RETURN_PATH && method === 'POST' && type?.split(';')[0].trim().toLowerCase() === 'application/x-www-form-urlencoded';
        if (!exempt) expect(originCheck(req, url, prerendered) !== null, `${method} ${path} ${type} ${origin}`).toBe(astroForbidden(req, url, prerendered));
        compared += 1;
      }
    }
    expect(compared).toBeGreaterThan(2000);
  });

  it('exempts only the signed GP webpay return POST with a url-encoded body', () => {
    expect(SIGNED_CROSS_SITE_POSTS.map((e) => e.path)).toEqual([RETURN_PATH]);
    const allowed = request('POST', RETURN_PATH, 'application/x-www-form-urlencoded', 'https://3dsecure.gpwebpay.com');
    expect(originCheck(allowed, new URL(allowed.url), false)).toBeNull();
    for (const [method, path, type] of [
      ['POST', RETURN_PATH, 'multipart/form-data; boundary=x'],
      ['POST', RETURN_PATH, 'text/plain'],
      ['POST', RETURN_PATH, null],
      ['PUT', RETURN_PATH, 'application/x-www-form-urlencoded'],
      ['POST', `${RETURN_PATH}/`, 'application/x-www-form-urlencoded'],
      ['POST', '/api/ask/billing/return/GPWEBPAY', 'application/x-www-form-urlencoded'],
      ['POST', '/api/ask/account/delete', 'application/x-www-form-urlencoded'],
    ] as const) {
      const req = request(method, path, type, 'https://evil.example');
      const refused = originCheck(req, new URL(req.url), false);
      expect(refused?.status, `${method} ${path} ${type}`).toBe(403);
    }
  });

  it('is wired as the first middleware step whenever Astro\'s own check is off', () => {
    const config = readFileSync('astro.config.mjs', 'utf8');
    const middleware = readFileSync('src/middleware.ts', 'utf8');
    expect(config).toMatch(/security:\s*\{\s*checkOrigin:\s*false\s*\}/);
    const body = middleware.slice(middleware.indexOf('defineMiddleware(async (context, next) => {'));
    const firstStatement = body.split('\n').slice(1).find((line) => line.trim() && !line.trim().startsWith('//'))!;
    expect(firstStatement.trim()).toBe('const forbidden = originCheck(context.request, context.url, context.isPrerendered);');
  });
});
