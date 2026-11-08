import { describe, expect, it } from 'vitest';
import { fingerprint, SESSION_COOKIE } from '../auth';
import { handleLogin, handleLogout, handleQuery, handleStatus, handleVerify, type RouteContext } from '../handlers';
import type { AskRuntime } from '../runtime';
import { MemoryAskStore } from '../store/memory';
import { fixtureView, NOW, fakeProviders, firstOwnSourceId, ownRecordQuote, testConfig } from './helpers';
import type { JsonCallParams } from '../providers';

class Jar {
  values = new Map<string, string>();
  options = new Map<string, Record<string, unknown>>();
  get(name: string) {
    const value = this.values.get(name);
    return value === undefined ? undefined : { value };
  }
  set(name: string, value: string, options: Record<string, unknown>) {
    this.values.set(name, value);
    this.options.set(name, options);
  }
  delete(name: string) {
    this.values.delete(name);
  }
}

function runtime() {
  const sent: Array<{ to: string; subject: string; text: string }> = [];
  const store = new MemoryAskStore();
  const rt: AskRuntime & { sent: typeof sent; store: MemoryAskStore } = {
    config: testConfig(),
    store,
    providers: fakeProviders({
      draft: (params: JsonCallParams) => ({
        claims: [{ text: 'In Czechia the Sunday and public holiday driving ban applies on that day.', source_id: firstOwnSourceId(params), quote: ownRecordQuote(params) }],
        covers_question: true,
      }),
    }),
    mailer: { async send(message) { sent.push(message); } },
    now: () => NOW,
    pipeline: { view: fixtureView(), findings: [] },
    sent,
  };
  return rt;
}

function request(path: string, body: unknown, { jar = new Jar(), origin = 'https://www.dajc.eu' as string | null, ip = '203.0.113.7', method = 'POST' } = {}): RouteContext {
  const url = new URL(`https://www.dajc.eu${path}`);
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (origin) headers.origin = origin;
  return {
    request: new Request(url, { method, headers, body: method === 'GET' ? undefined : JSON.stringify(body) }),
    url,
    cookies: jar,
    clientAddress: ip,
  };
}

async function signIn(rt: ReturnType<typeof runtime>, jar = new Jar(), email = 'driver@example.com') {
  await handleLogin(request('/api/ask/login', { email, lang: 'en' }, { jar }), rt);
  const link = rt.sent.at(-1)!.text.match(/https:\/\/\S+#login=(\S+)/)!;
  const res = await handleVerify(request('/api/ask/verify', { token: link[1] }, { jar }), rt);
  return { res, jar, token: link[1] };
}

describe('e-mail sign-in with a one-time link', () => {
  it('sends a fixed-text link and stores only fingerprints, never the address', async () => {
    const rt = runtime();
    const res = await handleLogin(request('/api/ask/login', { email: ' Driver@Example.com ', lang: 'cs' }), rt);
    expect(res.status).toBe(200);
    expect(rt.sent).toHaveLength(1);
    expect(rt.sent[0].to).toBe('driver@example.com');
    expect(rt.sent[0].subject).toBe('Váš přihlašovací odkaz DAJC');
    expect(rt.sent[0].text).toMatch(/^Tímto jednorázovým odkazem/);
    expect(rt.sent[0].text).toMatch(/https:\/\/www\.dajc\.eu\/intelligence\/ask\?lang=cs#login=[A-Za-z0-9_-]{43}/);
    const stored = JSON.stringify([...rt.store.loginTokens.entries()]);
    expect(stored).not.toContain('driver@example.com');
    expect(stored).toContain(fingerprint(rt.config.emailPepper, 'email', 'driver@example.com'));
  });

  it('answers the same for an invalid address and sends nothing', async () => {
    const rt = runtime();
    const res = await handleLogin(request('/api/ask/login', { email: 'not-an-address' }), rt);
    expect(res.status).toBe(200);
    expect(rt.sent).toHaveLength(0);
  });

  it('accepts a link once and sets a scoped HttpOnly session cookie', async () => {
    const rt = runtime();
    const { res, jar, token } = await signIn(rt);
    expect(res.status).toBe(200);
    expect(jar.options.get(SESSION_COOKIE)).toMatchObject({ httpOnly: true, secure: true, sameSite: 'lax', path: '/api/ask', maxAge: 7 * 86_400 });
    const again = await handleVerify(request('/api/ask/verify', { token }), rt);
    expect(again.status).toBe(400);
  });

  it('rejects an expired link', async () => {
    const rt = runtime();
    await handleLogin(request('/api/ask/login', { email: 'driver@example.com' }), rt);
    const token = rt.sent[0].text.match(/#login=(\S+)/)![1];
    rt.now = () => new Date(NOW.getTime() + 16 * 60_000);
    expect((await handleVerify(request('/api/ask/verify', { token }), rt)).status).toBe(400);
  });

  it('rate-limits sign-in requests', async () => {
    const rt = runtime();
    const statuses = [];
    for (let i = 0; i < 4; i++) statuses.push((await handleLogin(request('/api/ask/login', { email: 'driver@example.com' }), rt)).status);
    expect(statuses).toEqual([200, 200, 200, 429]);
    expect(rt.sent).toHaveLength(3);
  });

  it('refuses requests from other origins or without JSON (CSRF)', async () => {
    const rt = runtime();
    expect((await handleLogin(request('/api/ask/login', { email: 'a@b.cz' }, { origin: 'https://evil.example' }), rt)).status).toBe(403);
    expect((await handleLogin(request('/api/ask/login', { email: 'a@b.cz' }, { origin: null }), rt)).status).toBe(403);
    const ctx = request('/api/ask/login', {});
    ctx.request = new Request(ctx.url, { method: 'POST', headers: { origin: 'https://www.dajc.eu', 'content-type': 'text/plain' }, body: 'email=a@b.cz' });
    expect((await handleLogin(ctx, rt)).status).toBe(400);
  });
});

describe('questions over HTTP', () => {
  it('requires a session', async () => {
    const rt = runtime();
    expect((await handleQuery(request('/api/ask/query', { question: 'Is there a ban in Czechia on Sunday?' }), rt)).status).toBe(401);
  });

  it('answers with the AI label, level and support link text, then enforces the daily limit', async () => {
    const rt = runtime();
    const { jar } = await signIn(rt);
    for (let i = 0; i < 3; i++) {
      const res = await handleQuery(request('/api/ask/query', { question: 'Is there a truck driving ban in Czechia on 1 November 2026?', lang: 'en' }, { jar }), rt);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.answer.level).toBe('VERIFIED');
      expect(body.answer.ui.aiNotice).toBe('This answer was generated by AI based on verified sources.');
      expect(body.answer.ui.supportText).toMatch(/no benefits and no extra questions/);
      expect(body.usage).toEqual({ used: i + 1, limit: 3, remaining: 2 - i });
    }
    const limited = await handleQuery(request('/api/ask/query', { question: 'Is there a truck driving ban in Czechia on 1 November 2026?', lang: 'cs' }, { jar }), rt);
    expect(limited.status).toBe(429);
    expect((await limited.json()).error).toBe('Dnes jste využili všech 3 dotazů. Limit se obnoví o půlnoci (pražského času).');
  });

  it('answers 503 once the cost cap is reached', async () => {
    const rt = runtime();
    const { jar } = await signIn(rt);
    await rt.store.settleBudget({ monthKey: '2026-10', dayKey: '2026-10-25' }, 0, 20_000_000);
    const res = await handleQuery(request('/api/ask/query', { question: 'Is there a truck driving ban in Czechia on Sunday?' }, { jar }), rt);
    expect(res.status).toBe(503);
    const status = await handleStatus(request('/api/ask/status', undefined, { jar, method: 'GET' }), rt);
    expect(await status.json()).toMatchObject({ ok: true, signedIn: true, available: false, remaining: 3 });
  });

  it('signs out', async () => {
    const rt = runtime();
    const { jar } = await signIn(rt);
    expect((await handleLogout(request('/api/ask/logout', {}, { jar }), rt)).status).toBe(200);
    expect(jar.get(SESSION_COOKIE)).toBeUndefined();
    expect(rt.store.sessions.size).toBe(0);
  });

  it('never indexes or caches API answers', async () => {
    const rt = runtime();
    const res = await handleStatus(request('/api/ask/status', undefined, { method: 'GET' }), rt);
    expect(res.headers.get('x-robots-tag')).toMatch(/noindex/);
    expect(res.headers.get('cache-control')).toBe('no-store');
  });
});
