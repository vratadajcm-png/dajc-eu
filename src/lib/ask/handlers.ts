// Route logic for /api/ask/*, kept here so tests can drive it with fake
// dependencies. The Astro files in src/pages/api/ask only pass the request
// and getAskRuntime() through.
//
// Every handler answers 404 while the feature is off (runtime === null),
// the same deny-by-default behaviour as the Partner Portal. State-changing
// requests need a same-site Origin and a JSON body (CSRF), and the session
// cookie is HttpOnly, SameSite=Lax and scoped to /api/ask.

import { completeLogin, currentUserId, endSession, requestLoginLink, SESSION_COOKIE } from './auth';
import { SESSION_TTL_DAYS } from './config';
import { t, uiLang } from './i18n';
import type { AskRuntime } from './runtime';
import { askQuestion, budgetAvailable, getUsage } from './service';

export interface CookieJar {
  get(name: string): { value: string } | undefined;
  set(name: string, value: string, options: Record<string, unknown>): void;
  delete(name: string, options?: Record<string, unknown>): void;
}

export interface RouteContext {
  request: Request;
  url: URL;
  cookies: CookieJar;
  clientAddress?: string;
}

const COOKIE_PATH = '/api/ask';
const MAX_BODY_BYTES = 8_192;
const PUBLIC_ORIGINS = ['https://www.dajc.eu', 'https://dajc.eu'];

const BASE_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Robots-Tag': 'noindex, nofollow, noarchive',
  'X-Content-Type-Options': 'nosniff',
};

export function notFound(): Response {
  return new Response('Not found', {
    status: 404,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow, noarchive' },
  });
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: BASE_HEADERS });
}

function originAllowed(request: Request, runtime: AskRuntime): boolean {
  const origin = request.headers.get('origin');
  return Boolean(origin && new Set([runtime.config.publicOrigin, ...PUBLIC_ORIGINS]).has(origin));
}

async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  if (!(request.headers.get('content-type') || '').toLowerCase().includes('application/json')) return null;
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return null;
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function sessionToken(ctx: RouteContext): string | undefined {
  return ctx.cookies.get(SESSION_COOKIE)?.value;
}

async function guardPost(ctx: RouteContext, runtime: AskRuntime | null): Promise<{ runtime: AskRuntime; body: Record<string, unknown> } | Response> {
  if (!runtime) return notFound();
  if (ctx.request.method !== 'POST') return json({ ok: false }, 405);
  if (!originAllowed(ctx.request, runtime)) return json({ ok: false }, 403);
  const body = await readJson(ctx.request);
  if (!body) return json({ ok: false }, 400);
  return { runtime, body };
}

export async function handleLogin(ctx: RouteContext, runtime: AskRuntime | null): Promise<Response> {
  const guarded = await guardPost(ctx, runtime);
  if (guarded instanceof Response) return guarded;
  const lang = uiLang(String(guarded.body.lang || ''));
  try {
    const result = await requestLoginLink(
      { email: guarded.body.email, ip: ctx.clientAddress || 'unknown', lang },
      { config: guarded.runtime.config, store: guarded.runtime.store, mailer: guarded.runtime.mailer, now: guarded.runtime.now?.() },
    );
    if (result === 'limited') return json({ ok: false, error: t(lang, 'tooManyRequests') }, 429);
    // Same answer for valid and invalid addresses.
    return json({ ok: true, message: t(lang, 'linkSent') });
  } catch (error) {
    console.error(`[ask] login request failed: ${(error as Error)?.name || 'Error'}`);
    return json({ ok: false, error: t(lang, 'systemError') }, 500);
  }
}

export async function handleVerify(ctx: RouteContext, runtime: AskRuntime | null): Promise<Response> {
  const guarded = await guardPost(ctx, runtime);
  if (guarded instanceof Response) return guarded;
  const lang = uiLang(String(guarded.body.lang || ''));
  try {
    const session = await completeLogin(guarded.body.token, { store: guarded.runtime.store, now: guarded.runtime.now?.() });
    if (!session) return json({ ok: false, error: t(lang, 'invalidLink') }, 400);
    ctx.cookies.set(SESSION_COOKIE, session.sessionToken, {
      httpOnly: true,
      secure: ctx.url.protocol === 'https:',
      sameSite: 'lax',
      path: COOKIE_PATH,
      maxAge: SESSION_TTL_DAYS * 86_400,
    });
    return json({ ok: true, message: t(lang, 'signedIn') });
  } catch (error) {
    console.error(`[ask] sign-in failed: ${(error as Error)?.name || 'Error'}`);
    return json({ ok: false, error: t(lang, 'systemError') }, 500);
  }
}

export async function handleLogout(ctx: RouteContext, runtime: AskRuntime | null): Promise<Response> {
  const guarded = await guardPost(ctx, runtime);
  if (guarded instanceof Response) return guarded;
  await endSession(sessionToken(ctx), { store: guarded.runtime.store }).catch(() => undefined);
  ctx.cookies.delete(SESSION_COOKIE, { path: COOKIE_PATH });
  return json({ ok: true });
}

export async function handleStatus(ctx: RouteContext, runtime: AskRuntime | null): Promise<Response> {
  if (!runtime) return notFound();
  if (ctx.request.method !== 'GET') return json({ ok: false }, 405);
  try {
    const deps = { config: runtime.config, store: runtime.store, now: runtime.now };
    const available = await budgetAvailable(deps);
    const userId = await currentUserId(sessionToken(ctx), { store: runtime.store, now: runtime.now?.() });
    if (!userId) return json({ ok: true, signedIn: false, available });
    const usage = await getUsage(userId, deps);
    return json({ ok: true, signedIn: true, available, ...usage });
  } catch (error) {
    console.error(`[ask] status failed: ${(error as Error)?.name || 'Error'}`);
    return json({ ok: false }, 500);
  }
}

export async function handleQuery(ctx: RouteContext, runtime: AskRuntime | null): Promise<Response> {
  const guarded = await guardPost(ctx, runtime);
  if (guarded instanceof Response) return guarded;
  const { body } = guarded;
  const rt = guarded.runtime;
  const lang = uiLang(String(body.lang || ''));
  try {
    const userId = await currentUserId(sessionToken(ctx), { store: rt.store, now: rt.now?.() });
    if (!userId) return json({ ok: false, error: t(lang, 'invalidLink'), signedIn: false }, 401);
    const outcome = await askQuestion(userId, body.question, lang, { config: rt.config, store: rt.store, providers: rt.providers, now: rt.now, pipeline: rt.pipeline });
    switch (outcome.status) {
      case 'answered':
        return json({ ok: true, answer: outcome.answer, usage: { used: outcome.used, limit: outcome.limit, remaining: Math.max(0, outcome.limit - outcome.used) } });
      case 'invalid':
        return json({ ok: false, error: t(lang, 'questionInvalid') }, 400);
      case 'limit':
        return json({ ok: false, error: t(lang, 'limitReached', { limit: outcome.limit }) }, 429);
      case 'budget':
        return json({ ok: false, error: t(lang, 'budgetReached'), available: false }, 503);
      default:
        return json({ ok: false, error: t(lang, 'systemError') }, 500);
    }
  } catch (error) {
    console.error(`[ask] query failed: ${(error as Error)?.name || 'Error'}`);
    return json({ ok: false, error: t(lang, 'systemError') }, 500);
  }
}
