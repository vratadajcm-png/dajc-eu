// Route logic for the DAJC AI account, paid DAJC AI, billing webhooks and
// reviewers (/api/ask/account/*, /api/ask/paid/*, /api/ask/billing/*,
// /api/ask/review/*). Same rules as handlers.ts:
//   - 404 while the feature is off (runtime null) - nothing reveals it exists;
//   - state-changing browser requests need a DAJC Origin and a JSON body (CSRF);
//   - the user is always the one of the HttpOnly session cookie, never a body field;
//   - payment webhooks are authenticated by the provider's signature only.

import { createHash, timingSafeEqual } from 'node:crypto';
import { currentUserId, SESSION_COOKIE } from './auth';
import {
  consentState, deleteAccount, exportAccount, listHistory, listMemory, memoryItem, reportError, saveMemory, setConsent, type AccountDeps,
} from './account/service';
import type { AccountRuntime } from './account/runtime';
import type { AskEnv } from './config';
import { decideRefund, paymentManagementUrl, processWebhook, requestCancellation, requestRefund, startCheckout, subscriptionStatus, accessOf } from './billing/service';
import { COOKIE_PATH, json, notFound, originAllowed, readJson, sessionToken, type RouteContext } from './handlers';
import { t, uiLang, type UiLang } from './i18n';
import { approve, confirmSource, propose, reject, revoke, verifyIndependently } from './learning/workflow';
import { billingDeps } from './paid/runtime';
import { comparePermit, transportSchema } from './paid/permits';
import { askPaidQuestion, extractPermit, type PaidQueryDeps } from './paid/query';
import { isoDay } from './own-data';
import { runAccountingOutbox } from './accounting/outbox-worker';
import { runRenewals } from './billing/renewals';
import { monthlyReport, reportCsv } from './accounting/report';
import { publishedKnowledge } from './learning/workflow';
import { operationalHealth, preflight } from './monitoring';

const WEBHOOK_MAX_BYTES = 256 * 1024;
// Vercel functions accept request bodies up to 4.5 MB; a 3 MB PDF is ~4 MB in base64.
const PERMIT_MAX_BYTES = 4_400_000;

async function user(ctx: RouteContext, rt: AccountRuntime): Promise<string | null> {
  return currentUserId(sessionToken(ctx), { store: rt.ask.store, now: rt.now?.() ?? rt.ask.now?.() });
}

function nowOf(rt: AccountRuntime): Date {
  return rt.now?.() ?? rt.ask.now?.() ?? new Date();
}

function accountDeps(rt: AccountRuntime, paidActive: boolean): AccountDeps {
  const cfg = rt.paidRuntime?.config;
  return {
    paid: rt.paid, keyring: rt.keyring, now: () => nowOf(rt), paidActive,
    retention: {
      historyDays: cfg?.historyRetentionDays ?? 90, historyMaxEntries: cfg?.historyMaxEntries ?? 200,
      memoryDays: cfg?.memoryRetentionDays ?? 365, memoryMaxItems: cfg?.memoryMaxItems ?? 50,
    },
  };
}

async function isPaid(rt: AccountRuntime, userId: string): Promise<boolean> {
  if (!rt.paidRuntime) return false;
  return accessOf(userId, await rt.paid.getLedger(userId), { env: rt.paidRuntime.env, released: rt.paidRuntime.released }, nowOf(rt)).allowed;
}

type Guarded = { rt: AccountRuntime; userId: string; body: Record<string, unknown>; lang: UiLang };

async function guard(ctx: RouteContext, rt: AccountRuntime | null, method: 'GET' | 'POST', maxBytes?: number): Promise<Guarded | Response> {
  if (!rt) return notFound();
  if (ctx.request.method !== method) return json({ ok: false }, 405);
  let body: Record<string, unknown> = {};
  if (method === 'POST') {
    if (!originAllowed(ctx.request, rt.ask)) return json({ ok: false }, 403);
    const parsed = await readJson(ctx.request, maxBytes);
    if (!parsed) return json({ ok: false }, 400);
    body = parsed;
  }
  const lang = uiLang(String(body.lang || ctx.url.searchParams.get('lang') || ''));
  const userId = await user(ctx, rt);
  if (!userId) return json({ ok: false, signedIn: false, error: t(lang, 'invalidLink') }, 401);
  return { rt, userId, body, lang };
}

// --- Account -----------------------------------------------------------------

export async function handleAccount(action: string, ctx: RouteContext, rt: AccountRuntime | null): Promise<Response> {
  try {
    switch (action) {
      case 'status': {
        const g = await guard(ctx, rt, 'GET');
        if (g instanceof Response) return g;
        const paidActive = await isPaid(g.rt, g.userId);
        const deps = accountDeps(g.rt, paidActive);
        const now = nowOf(g.rt);
        const paidRt = g.rt.paidRuntime;
        const usage = paidRt ? await g.rt.paid.getPaidUsage(g.userId, isoDay(now), isoDay(now).slice(0, 7)) : null;
        return json({
          ok: true,
          signedIn: true,
          paidAvailable: Boolean(paidRt),
          paidActive,
          mode: paidRt ? { provider: paidRt.config.provider, payments: paidRt.config.mode, staging: paidRt.config.staging } : null,
          subscription: paidRt ? await subscriptionStatus(g.userId, billingDeps(paidRt)) : null,
          fairUse: paidRt ? { ...paidRt.config.fairUse, usedToday: usage?.day ?? 0, usedThisMonth: usage?.month ?? 0 } : null,
          consents: await consentState(g.userId, deps),
          storageAvailable: g.rt.keyring !== null,
        });
      }
      case 'consent': {
        const g = await guard(ctx, rt, 'POST');
        if (g instanceof Response) return g;
        const result = await setConsent(g.userId, g.body.purpose, g.body.granted, accountDeps(g.rt, await isPaid(g.rt, g.userId)));
        return json({ ok: result === 'ok', result }, result === 'ok' ? 200 : result === 'invalid' ? 400 : 409);
      }
      case 'export': {
        const g = await guard(ctx, rt, 'GET');
        if (g instanceof Response) return g;
        const data = await exportAccount(g.userId, accountDeps(g.rt, await isPaid(g.rt, g.userId)));
        await g.rt.paid.appendAudit({ actor: `user:${g.userId}`, action: 'DATA_EXPORTED', subject: `user:${g.userId}` }, nowOf(g.rt));
        return new Response(JSON.stringify(data, null, 2), {
          status: 200,
          headers: { 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': 'attachment; filename="dajc-ai-data.json"', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow, noarchive', 'X-Content-Type-Options': 'nosniff' },
        });
      }
      case 'delete': {
        const g = await guard(ctx, rt, 'POST');
        if (g instanceof Response) return g;
        if (g.body.confirm !== 'DELETE') return json({ ok: false, error: 'confirm' }, 400);
        const paidRt = g.rt.paidRuntime;
        const result = await deleteAccount(g.userId, {
          ...accountDeps(g.rt, false),
          cancelRenewal: async () => (paidRt ? requestCancellation(g.userId, billingDeps(paidRt)) : 'no_subscription'),
        });
        if (result === 'unavailable') return json({ ok: false, error: t(g.lang, 'systemError') }, 503);
        ctx.cookies.delete(SESSION_COOKIE, { path: COOKIE_PATH });
        return json({ ok: true });
      }
      case 'feedback': {
        const g = await guard(ctx, rt, 'POST', 64 * 1024);
        if (g instanceof Response) return g;
        const result = await reportError(g.userId, { category: g.body.category, answer: g.body.answer, comment: g.body.comment }, {
          ...accountDeps(g.rt, await isPaid(g.rt, g.userId)),
          rateLimit: (key) => g.rt.ask.store.hitRateLimit(key, 86_400, 20, nowOf(g.rt)),
        });
        return json({ ok: result === 'ok', result }, result === 'ok' ? 200 : result === 'limited' ? 429 : 400);
      }
      case 'history': {
        if (ctx.request.method === 'GET') {
          const g = await guard(ctx, rt, 'GET');
          if (g instanceof Response) return g;
          return json({ ok: true, items: await listHistory(g.userId, accountDeps(g.rt, await isPaid(g.rt, g.userId))) });
        }
        const g = await guard(ctx, rt, 'POST');
        if (g instanceof Response) return g;
        const id = g.body.id === 'all' ? 'all' : typeof g.body.id === 'string' && /^[0-9a-f-]{36}$/i.test(g.body.id) ? g.body.id : null;
        if (!id) return json({ ok: false }, 400);
        return json({ ok: true, deleted: await g.rt.paid.deleteHistory(g.userId, id) });
      }
      case 'memory': {
        if (ctx.request.method === 'GET') {
          const g = await guard(ctx, rt, 'GET');
          if (g instanceof Response) return g;
          return json({ ok: true, items: await listMemory(g.userId, accountDeps(g.rt, await isPaid(g.rt, g.userId))) });
        }
        const g = await guard(ctx, rt, 'POST', 16 * 1024);
        if (g instanceof Response) return g;
        if (g.body.delete !== undefined) {
          const id = g.body.delete === 'all' ? 'all' : typeof g.body.delete === 'string' && /^[0-9a-f-]{36}$/i.test(g.body.delete) ? g.body.delete : null;
          if (!id) return json({ ok: false }, 400);
          return json({ ok: true, deleted: await g.rt.paid.deleteMemory(g.userId, id) });
        }
        const result = await saveMemory(g.userId, { id: g.body.id, kind: g.body.kind, content: g.body.content }, accountDeps(g.rt, await isPaid(g.rt, g.userId)));
        const status = result.status === 'ok' ? 200 : result.status === 'invalid' ? 400 : result.status === 'not_found' ? 404 : 409;
        return json({ ok: result.status === 'ok', ...result }, status);
      }
      default:
        return notFound();
    }
  } catch (error) {
    console.error(`[dajc-ai] account ${action} failed: ${(error as Error)?.name || 'Error'}`);
    return json({ ok: false }, 500);
  }
}

// --- Billing -----------------------------------------------------------------

export async function handleBilling(action: string, ctx: RouteContext, rt: AccountRuntime | null): Promise<Response> {
  if (!rt?.paidRuntime) return notFound();
  const deps = billingDeps(rt.paidRuntime);
  try {
    if (action === 'checkout' || action === 'cancel' || action === 'refund' || action === 'manage') {
      const g = await guard(ctx, rt, 'POST');
      if (g instanceof Response) return g;
      if (action === 'checkout') {
        const result = await startCheckout(g.userId, g.lang, deps);
        if (result.status === 'redirect') return json({ ok: true, url: result.url });
        return json({ ok: false, result: result.status }, result.status === 'limited' ? 429 : result.status === 'already_active' ? 409 : 503);
      }
      if (action === 'cancel') {
        const result = await requestCancellation(g.userId, deps);
        return json({ ok: result === 'requested', result }, result === 'requested' ? 200 : result === 'no_subscription' ? 409 : 503);
      }
      if (action === 'refund') {
        const result = await requestRefund(g.userId, String(g.body.reason ?? ''), deps);
        return json({ ok: result.status === 'executed' || result.status === 'pending_review', result: result.status }, result.status === 'unavailable' ? 503 : 200);
      }
      const url = await paymentManagementUrl(g.userId, deps);
      return json({ ok: Boolean(url), url });
    }
    return notFound();
  } catch (error) {
    console.error(`[dajc-ai] billing ${action} failed: ${(error as Error)?.name || 'Error'}`);
    return json({ ok: false }, 500);
  }
}

const WEBHOOK_PATH: Record<string, string> = { stripe: 'STRIPE', revolut: 'REVOLUT_MERCHANT', sandbox: 'DAJC_SANDBOX' };

/** Provider-to-server webhooks: no cookie, no Origin; the signature is the authentication. */
export async function handleBillingWebhook(provider: string, ctx: RouteContext, rt: AccountRuntime | null): Promise<Response> {
  if (!rt?.paidRuntime || WEBHOOK_PATH[provider] !== rt.paidRuntime.adapter.provider) return notFound();
  if (ctx.request.method !== 'POST') return json({ ok: false }, 405);
  if (Number(ctx.request.headers.get('content-length') || 0) > WEBHOOK_MAX_BYTES) return json({ ok: false }, 413);
  const rawBody = await ctx.request.text();
  if (rawBody.length > WEBHOOK_MAX_BYTES) return json({ ok: false }, 413);
  try {
    const result = await processWebhook({ rawBody, headers: ctx.request.headers }, billingDeps(rt.paidRuntime));
    if (result.status === 'auth_failed') return json({ ok: false }, 400);
    if (result.status === 'retry') return json({ ok: false, retry: true }, 503);
    return json({ ok: true, events: result.events.map((e) => ({ outcome: e.outcome })) });
  } catch (error) {
    // Nothing was applied (one transaction); the provider redelivers.
    console.error(`[dajc-ai] webhook failed: ${(error as Error)?.name || 'Error'}`);
    return json({ ok: false }, 500);
  }
}

/** GP webpay signed browser return: verify, apply, then redirect to the account page. */
/** GP webpay returns a handful of short fields; anything larger is not a GP return. */
export const GP_RETURN_MAX_BYTES = 8 * 1024;

/**
 * The parameters of a GP webpay return: the query string of a GET redirect,
 * or the url-encoded body of a POST form. Never both, never another format.
 */
async function gpReturnParams(request: Request, url: URL): Promise<URLSearchParams | null> {
  if (request.method === 'GET') return url.searchParams;
  if (request.method !== 'POST') return null;
  const mediaType = (request.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  if (mediaType !== 'application/x-www-form-urlencoded') return null;
  if (Number(request.headers.get('content-length') || 0) > GP_RETURN_MAX_BYTES) return null;
  const body = await request.text();
  if (body.length > GP_RETURN_MAX_BYTES) return null;
  return new URLSearchParams(body);
}

export async function handleBillingReturn(provider: string, ctx: RouteContext, rt: AccountRuntime | null): Promise<Response> {
  if (!rt?.paidRuntime || provider !== 'gpwebpay' || rt.paidRuntime.adapter.provider !== 'GP_WEBPAY') return notFound();
  if (ctx.request.method !== 'GET' && ctx.request.method !== 'POST') return json({ ok: false, error: 'METHOD_NOT_ALLOWED' }, 405);
  const page = new URL('/intelligence/ask', rt.ask.config.publicOrigin);
  let outcome = 'failed';
  try {
    const params = await gpReturnParams(ctx.request, ctx.url);
    if (!params) throw new Error('unsupported GP return');
    // The signature (DIGEST, DIGEST1) is verified by the adapter before any change.
    const result = await processWebhook({ rawBody: '', headers: ctx.request.headers, query: params }, billingDeps(rt.paidRuntime));
    outcome = result.status === 'ok' && result.events.some((e) => e.kind === 'PAYMENT_SETTLED' && (e.outcome === 'applied' || e.outcome === 'duplicate')) ? 'success' : 'failed';
  } catch {
    outcome = 'failed';
  }
  page.searchParams.set('billing', outcome);
  return new Response(null, { status: 303, headers: { Location: page.toString(), 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });
}

// --- Paid DAJC AI --------------------------------------------------------------

function paidQueryDeps(g: Guarded, ctx: RouteContext): PaidQueryDeps {
  const paidRt = g.rt.paidRuntime!;
  return {
    askConfig: g.rt.ask.config, store: g.rt.ask.store, providers: g.rt.ask.providers, providerFactory: g.rt.ask.providerFactory, paid: g.rt.paid, paidConfig: paidRt.config,
    env: paidRt.env, released: paidRt.released, sessionToken: sessionToken(ctx), now: () => nowOf(g.rt),
    pipeline: { ...g.rt.ask.pipeline, knowledge: (query) => publishedKnowledge(query, { paid: g.rt.paid, now: () => nowOf(g.rt) }) },
  };
}

export async function handlePaid(action: string, ctx: RouteContext, rt: AccountRuntime | null): Promise<Response> {
  if (!rt?.paidRuntime) return notFound();
  try {
    const g = await guard(ctx, rt, 'POST', action === 'permit-extract' ? PERMIT_MAX_BYTES : 32 * 1024);
    if (g instanceof Response) return g;
    if (action === 'query') {
      const outcome = await askPaidQuestion(g.userId, g.body, g.lang, paidQueryDeps(g, ctx));
      switch (outcome.status) {
        case 'answered':
          return json({ ok: true, ...outcome });
        case 'not_paid':
          return json({ ok: false, result: 'not_paid' }, 402);
        case 'limit':
          return json({ ok: false, result: 'limit', scope: outcome.scope, usage: outcome.usage }, 429);
        case 'budget':
          return json({ ok: false, result: 'budget', error: t(g.lang, 'budgetReached') }, 503);
        case 'invalid':
          return json({ ok: false, result: 'invalid', error: t(g.lang, 'questionInvalid') }, 400);
        default:
          return json({ ok: false, result: 'error', error: t(g.lang, 'systemError') }, 500);
      }
    }
    if (action === 'permit-compare') {
      if (!(await isPaid(g.rt, g.userId))) return json({ ok: false, result: 'not_paid' }, 402);
      let transport = g.body.transport;
      if (typeof g.body.cargoId === 'string') {
        const cargo = await memoryItem(g.userId, g.body.cargoId, 'CARGO', accountDeps(g.rt, true));
        if (!cargo) return json({ ok: false }, 404);
        const { lengthM, widthM, heightM, massKg } = cargo as Record<string, number | undefined>;
        transport = { lengthM, widthM, heightM, massKg, ...(typeof transport === 'object' && transport ? transport : {}) };
      }
      const parsedTransport = transportSchema.safeParse(transport);
      const comparison = parsedTransport.success ? comparePermit(g.body.permit, parsedTransport.data) : null;
      if (!comparison) return json({ ok: false, result: 'invalid' }, 400);
      return json({ ok: true, comparison });
    }
    if (action === 'permit-extract') {
      const outcome = await extractPermit(g.userId, { fileBase64: g.body.fileBase64 }, paidQueryDeps(g, ctx));
      const status = outcome.status === 'extracted' ? 200 : outcome.status === 'not_paid' ? 402 : outcome.status === 'no_consent' ? 409 : outcome.status === 'invalid_file' ? 400 : outcome.status === 'limit' ? 429 : outcome.status === 'budget' ? 503 : 500;
      return json({ ok: outcome.status === 'extracted', ...outcome }, status);
    }
    return notFound();
  } catch (error) {
    console.error(`[dajc-ai] paid ${action} failed: ${(error as Error)?.name || 'Error'}`);
    return json({ ok: false }, 500);
  }
}

// --- Reviewers ---------------------------------------------------------------

export async function handleReview(action: string, ctx: RouteContext, rt: AccountRuntime | null): Promise<Response> {
  if (!rt) return notFound();
  try {
    if (action === 'queue') {
      const g = await guard(ctx, rt, 'GET');
      if (g instanceof Response) return g;
      const knowledgeReviewer = await g.rt.paid.isReviewer(g.userId, 'KNOWLEDGE_REVIEWER');
      const billingReviewer = await g.rt.paid.isReviewer(g.userId, 'BILLING_REVIEWER');
      if (!knowledgeReviewer && !billingReviewer) return notFound();
      return json({
        ok: true,
        // Error reports without their encrypted comments: reviewers see category, level and official sources.
        feedback: knowledgeReviewer ? (await g.rt.paid.listFeedback('NEW', 100)).map(({ commentCiphertext: _c, keyId: _k, userId: _u, ...f }) => f) : [],
        knowledge: knowledgeReviewer ? (await g.rt.paid.listKnowledge({})).filter((k) => ['PENDING', 'SOURCE_CHECKED', 'VERIFIED'].includes(k.status)) : [],
        refunds: billingReviewer ? (await g.rt.paid.listRefundRequests(null, 'PENDING_REVIEW')).map(({ userId: _u, ...r }) => r) : [],
      });
    }
    const g = await guard(ctx, rt, 'POST', 32 * 1024);
    if (g instanceof Response) return g;
    const deps = { paid: g.rt.paid, now: () => nowOf(g.rt) };
    const id = String(g.body.id ?? '');
    let result: { status: string } | null = null;
    switch (action) {
      case 'propose': result = await propose(g.userId, g.body.fields, deps); break;
      case 'source-check': result = await confirmSource(g.userId, id, deps); break;
      case 'verify': result = await verifyIndependently(g.userId, id, deps); break;
      case 'approve': result = await approve(g.userId, id, { approvedLegalScope: g.body.approvedLegalScope === true }, deps); break;
      case 'reject': result = await reject(g.userId, id, deps); break;
      case 'revoke': result = await revoke(g.userId, id, deps); break;
      case 'refund':
        if (!g.rt.paidRuntime) return notFound();
        result = await decideRefund(g.userId, id, g.body.approve === true, billingDeps(g.rt.paidRuntime));
        break;
      default:
        return notFound();
    }
    const status = result.status === 'ok' || result.status === 'executed' || result.status === 'not_eligible' || result.status === 'pending_review' ? 200 : result.status === 'forbidden' ? 403 : result.status === 'not_found' ? 404 : 409;
    return json({ ok: status === 200, ...result }, status);
  } catch (error) {
    console.error(`[dajc-ai] review ${action} failed: ${(error as Error)?.name || 'Error'}`);
    return json({ ok: false }, 500);
  }
}

// --- Maintenance (scheduled) -------------------------------------------------

export const MAINTENANCE_SECRET_MIN_LENGTH = 32;
const sha256 = (value: string) => createHash('sha256').update(value, 'utf8').digest();

/**
 * What the maintenance bearer must hash to. Preferred: DAJC_AI_MAINTENANCE_SECRET_SHA256
 * (64 hex characters) - the deployment then stores only a verifier, never the
 * bearer itself. Fallback: DAJC_AI_MAINTENANCE_SECRET (>= 32 characters), for
 * local runs. When the hash variable is set the plaintext one is ignored; an
 * invalid hash or a short secret disables maintenance (fail closed).
 */
export function maintenanceVerifier(env: AskEnv): Buffer | null {
  const hex = env.DAJC_AI_MAINTENANCE_SECRET_SHA256?.trim();
  if (hex) return /^[0-9a-fA-F]{64}$/.test(hex) ? Buffer.from(hex.toLowerCase(), 'hex') : null;
  const plain = env.DAJC_AI_MAINTENANCE_SECRET;
  return plain && plain.length >= MAINTENANCE_SECRET_MIN_LENGTH ? sha256(plain) : null;
}

const MAINTENANCE_METHODS: Record<string, string> = { run: 'POST', requeue: 'POST', report: 'GET', health: 'GET', preflight: 'GET' };

/**
 * Called by a scheduler or the on-call operator with
 * "Authorization: Bearer <DAJC_AI_MAINTENANCE_SECRET>":
 * POST run (renewals, accounting sync, retention purge), GET report (monthly),
 * GET health (monitoring), POST requeue (dead-letter recovery) and
 * GET preflight (settings by name; works before the features are configured).
 */
export async function handleMaintenance(action: string, ctx: RouteContext, rt: AccountRuntime | null, env: AskEnv = rt?.env ?? process.env): Promise<Response> {
  const verifier = maintenanceVerifier(env);
  if (!verifier) return notFound();
  // The bearer is only hashed and compared in constant time; it is never
  // logged, stored or echoed (see monitoring.test.ts).
  const auth = ctx.request.headers.get('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (token.length < MAINTENANCE_SECRET_MIN_LENGTH || !timingSafeEqual(sha256(token), verifier)) return notFound();
  const method = MAINTENANCE_METHODS[action];
  if (!method) return notFound();
  if (ctx.request.method !== method) return json({ ok: false, error: 'METHOD_NOT_ALLOWED' }, 405);
  if (action === 'preflight') return json({ ok: true, preflight: preflight(env) });
  if (!rt) return notFound();
  const now = nowOf(rt);
  try {
    if (action === 'health') {
      const health = await operationalHealth({ paid: rt.paid, ask: { store: rt.ask.store, config: rt.ask.config }, now });
      return json({ ok: true, health });
    }
    if (action === 'requeue') {
      const body = await readJson(ctx.request);
      const idemKey = typeof body?.idemKey === 'string' ? body.idemKey.trim() : '';
      if (!idemKey || idemKey.length > 200) return json({ ok: false, error: 'INVALID_REQUEST' }, 400);
      if (!(await rt.paid.requeueOutbox(idemKey, now))) return json({ ok: false, error: 'NOT_DEAD_LETTER' }, 409);
      await rt.paid.appendAudit({ actor: 'system:maintenance', action: 'ACCOUNTING_REQUEUED', subject: `outbox:${idemKey}`, details: {} }, now);
      return json({ ok: true, requeued: idemKey });
    }
    if (action === 'run') {
      const renewals = rt.paidRuntime ? await runRenewals(billingDeps(rt.paidRuntime)) : null;
      const accounting = await runAccountingOutbox({ paid: rt.paid, client: rt.paidRuntime?.accounting?.client ?? null, config: rt.paidRuntime?.accounting?.config ?? null, now: () => now });
      const purged = await rt.paid.purgePersonalData(now);
      await rt.ask.store.purgeExpired(now);
      return json({ ok: true, renewals, accounting, purged });
    }
    if (action === 'report') {
      const month = ctx.url.searchParams.get('month') || isoDay(now).slice(0, 7);
      const report = await monthlyReport({ paid: rt.paid, month, config: rt.paidRuntime?.accounting?.config ?? null, now });
      if (ctx.url.searchParams.get('format') === 'csv') {
        return new Response(reportCsv(report), { status: 200, headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Cache-Control': 'no-store' } });
      }
      return json({ ok: true, report });
    }
    return notFound();
  } catch (error) {
    console.error(`[dajc-ai] maintenance ${action} failed: ${(error as Error)?.name || 'Error'}`);
    return json({ ok: false }, 500);
  }
}
