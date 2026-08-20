// Proves the actual middleware used in production (src/middleware.ts, not
// a re-implementation) returns a server-side 404 for every Partner Portal
// path when the gate is off, and passes through untouched when it's on -
// spec item 13, "Gate musí být fail closed".
import { afterEach, describe, expect, it, vi } from 'vitest';
import { onRequest } from '../../middleware';

const ENV_KEY = 'DAJC_PARTNER_PORTAL_ENABLED';

function fakeContext(pathname: string) {
  return { url: new URL(`https://www.dajc.eu${pathname}`) } as Parameters<typeof onRequest>[0];
}

// onRequest's real MiddlewareHandler type allows a `void` return (Astro
// permits a middleware to fall through without producing a response); this
// one never does, so callers in this test file can rely on it.
async function callMiddleware(pathname: string, next: Parameters<typeof onRequest>[1]): Promise<Response> {
  const result = await onRequest(fakeContext(pathname), next);
  if (!result) throw new Error('Expected onRequest to return a Response.');
  return result;
}

afterEach(() => {
  delete process.env[ENV_KEY];
});

const PORTAL_PATHS = [
  '/partner-portal',
  '/partner-portal/admin',
  '/partner-portal/admin/login',
  '/partner-portal/admin/partners/00000000-0000-0000-0000-000000000000',
  '/partner-portal/admin/audit',
  '/partner-portal/activate/some-invitation-token',
  '/partner-portal/login',
  '/partner-portal/callback',
  '/partner-portal/dashboard',
  '/partner-portal/logout',
];

describe('portal middleware gate (disabled)', () => {
  for (const envValue of [undefined, '', 'false', 'TRUE', '1']) {
    it.each(PORTAL_PATHS)(`returns 404 for %s when env=${JSON.stringify(envValue)}`, async (path) => {
      if (envValue === undefined) delete process.env[ENV_KEY];
      else process.env[ENV_KEY] = envValue;

      const next = vi.fn(async () => new Response('should not be reached'));
      const response = await callMiddleware(path, next);

      expect(response.status).toBe(404);
      expect(next).not.toHaveBeenCalled();
    });
  }

  it('never leaks distinguishing information via headers/body between a gated route and a truly unknown one', async () => {
    process.env[ENV_KEY] = 'false';
    const next = vi.fn(async () => new Response('unreachable'));
    const knownRoute = await callMiddleware('/partner-portal/admin', next);
    const madeUpRoute = await callMiddleware('/partner-portal/this-route-does-not-exist', next);

    expect(knownRoute.status).toBe(madeUpRoute.status);
    expect(await knownRoute.text()).toBe(await madeUpRoute.text());
  });
});

describe('portal middleware gate (enabled)', () => {
  it('passes the request through to next() and adds noindex/no-store headers', async () => {
    process.env[ENV_KEY] = 'true';
    const inner = new Response('ok', { status: 200 });
    const next = vi.fn(async () => inner);

    const response = await callMiddleware('/partner-portal/admin', next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(200);
    expect(response.headers.get('X-Robots-Tag')).toContain('noindex');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });
});

describe('portal middleware gate (paths outside the portal)', () => {
  it('does not touch unrelated site routes regardless of the gate', async () => {
    delete process.env[ENV_KEY];
    const inner = new Response('public page', { status: 200 });
    const next = vi.fn(async () => inner);

    const response = await callMiddleware('/news', next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(200);
    expect(response.headers.get('X-Robots-Tag')).toBeNull();
  });
});
