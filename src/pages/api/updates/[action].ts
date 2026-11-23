import type { APIRoute } from 'astro';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { Resend } from 'resend';

// Server only. All three actions use one purpose-limited Neon schema.
// No raw IP, email, verification token or SQL errors are written to logs.
export const prerender = false;
const PURPOSES = new Set(['launch', 'newsletter']);
const json = (status: number, data: Record<string, unknown>) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow' },
  });
const emailValid = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 254;
const tokenValid = (value: string) => /^[A-Za-z0-9_-]{40,64}$/.test(value);
const newToken = () => randomBytes(32).toString('base64url');
const hash = (value: string, key: string) => createHmac('sha256', key).update(value).digest('hex');
const apiKeys = () => ({
  db: process.env.DAJC_UPDATES_DATABASE_URL,
  token: process.env.DAJC_UPDATES_TOKEN_KEY,
  abuse: process.env.DAJC_UPDATES_HASH_KEY,
  resend: process.env.RESEND_API_KEY,
});
function validOrigin(request: Request) {
  const origin = request.headers.get('origin');
  if (!origin) return false;
  const url = new URL(request.url);
  return origin === 'https://www.dajc.eu' || origin === 'https://dajc.eu'
    || (process.env.VERCEL_ENV === 'preview' && url.hostname.endsWith('.vercel.app') && origin === url.origin);
}
function linkRoot() {
  if (process.env.VERCEL_ENV === 'preview' && process.env.VERCEL_URL &&
      /^[a-z0-9][a-z0-9.-]+\.vercel\.app$/i.test(process.env.VERCEL_URL)) {
    return 'https://' + process.env.VERCEL_URL;
  }
  return 'https://www.dajc.eu';
}
class TooManyAttempts extends Error {}

export const POST: APIRoute = async ({ request, params, clientAddress }) => {
  const action = params.action;
  if (!['subscribe', 'confirm', 'unsubscribe'].includes(action || '')) return json(404, { ok: false });
  if (!validOrigin(request)) return json(403, { ok: false, error: 'Request origin not allowed.' });
  if (!request.headers.get('content-type')?.includes('application/json')) return json(415, { ok: false });
  let data: Record<string, unknown>;
  try {
    const raw = await request.text();
    if (raw.length > 1500) return json(413, { ok: false });
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') return json(400, { ok: false });
    data = parsed as Record<string, unknown>;
  } catch { return json(400, { ok: false }); }

  // Unsubscription and confirmation remain available even if acquisition is paused.
  if (action === 'subscribe' && process.env.DAJC_UPDATES_ENABLED !== 'true') {
    return json(503, { ok: false, error: 'Online subscriptions are not available yet.' });
  }
  const keys = apiKeys();
  if (!keys.db || !keys.token || !keys.abuse || (action === 'subscribe' && !keys.resend)) {
    return json(503, { ok: false, error: 'Subscription service unavailable.' });
  }

  const sql = postgres(keys.db, { max: 2, connect_timeout: 10, idle_timeout: 10 });
  try {
    if (action === 'subscribe') {
      if (typeof data.website === 'string' && data.website.trim()) return json(200, { ok: true });
      const email = typeof data.email === 'string' ? data.email.trim().toLowerCase() : '';
      const purpose = typeof data.purpose === 'string' ? data.purpose : '';
      if (!emailValid(email) || !PURPOSES.has(purpose) || data.consent !== true) {
        return json(400, { ok: false, error: 'Provide a valid email, purpose and explicit consent.' });
      }

      const verify = newToken(), unsubscribe = newToken();
      const verifyHash = hash(verify, keys.token);
      const unsubscribeHash = hash(unsubscribe, keys.token);
      const bucket = new Date(Math.floor(Date.now() / 3_600_000) * 3_600_000).toISOString();
      const networkHash = hash('ip:' + (clientAddress || 'unknown'), keys.abuse);
      const emailHash = hash('email:' + email, keys.abuse);
      const shouldSend = await sql.begin(async tx => {
        // Two distributed limits: a network and an address cannot cause unlimited mail.
        for (const [actor, maximum] of [[networkHash, 5], [emailHash, 3]] as const) {
          const attempt = await tx`
            INSERT INTO public.updates_rate_limits (actor_hash, window_start, attempts)
            VALUES (${actor}, ${bucket}::timestamptz, 1)
            ON CONFLICT (actor_hash, window_start) DO UPDATE SET attempts = updates_rate_limits.attempts + 1
            WHERE updates_rate_limits.attempts < ${maximum}
            RETURNING attempts`;
          if (!attempt.length) throw new TooManyAttempts();
        }
        const saved = await tx`
          INSERT INTO public.updates_subscriptions
            (id,email,purpose,status,verification_hash,unsubscribe_hash,verification_expires_at,last_verification_sent_at)
          VALUES
            (${randomUUID()}::uuid,${email},${purpose},'pending',${verifyHash},${unsubscribeHash},
             now()+interval '24 hours',now())
          ON CONFLICT (email,purpose) DO UPDATE SET
            status='pending', verification_hash=excluded.verification_hash,
            unsubscribe_hash=excluded.unsubscribe_hash,
            verification_expires_at=excluded.verification_expires_at,
            last_verification_sent_at=now(), updated_at=now()
          WHERE updates_subscriptions.status='pending'
            AND (updates_subscriptions.last_verification_sent_at IS NULL
              OR updates_subscriptions.last_verification_sent_at < now()-interval '15 minutes')
          RETURNING id`;
        return saved.length > 0;
      });

      if (shouldSend) {
        const origin = linkRoot();
        const confirmation = origin + '/updates/confirm?token=' + encodeURIComponent(verify);
        const removal = origin + '/updates/unsubscribe?token=' + encodeURIComponent(unsubscribe);
        const subject = purpose === 'launch' ? 'DAJC — confirm one launch notification' : 'DAJC — confirm newsletter subscription';
        const result = await new Resend(keys.resend!).emails.send({
          from: process.env.DAJC_UPDATES_EMAIL_FROM || 'DAJC <team@dajc.eu>',
          to: [email],
          subject,
          text: [
            'You requested ' + (purpose === 'launch' ? 'a single commercial launch notification' : 'ongoing DAJC project news') + '.',
            'This is independent from Platform testing and does not buy a service.',
            '',
            'Confirm your email (expires in 24 hours):',
            confirmation,
            '',
            'Do not confirm if you did not request this message.',
            'To cancel this request or unsubscribe later:',
            removal,
            '',
            'DAJC · team@dajc.eu',
          ].join('\n'),
        });
        if (result.error) {
          console.error('DAJC updates confirmation delivery failed');
          return json(503, { ok: false, error: 'We could not send the confirmation email. Please try again later.' });
        }
      }

      // Best-effort cleanup, also scheduled separately during inactive periods.
      await Promise.allSettled([
        sql`DELETE FROM public.updates_rate_limits WHERE window_start < now() - interval '48 hours'`,
        sql`DELETE FROM public.updates_subscriptions WHERE status='pending' AND created_at < now() - interval '7 days'`,
      ]);
      return json(200, { ok: true, message: 'If your request is eligible, check your email to confirm.' });
    }

    const token = typeof data.token === 'string' ? data.token : '';
    if (!tokenValid(token)) return json(400, { ok: false, error: 'Invalid or expired link.' });
    const digest = hash(token, keys.token);
    if (action === 'confirm') {
      const updated = await sql`
        UPDATE public.updates_subscriptions SET
          status='active', confirmed_at=now(), verification_hash=NULL,
          verification_expires_at=NULL, updated_at=now()
        WHERE verification_hash=${digest} AND status='pending'
          AND verification_expires_at > now()
        RETURNING id`;
      return updated.length ? json(200, { ok: true, message: 'Subscription confirmed.' })
        : json(400, { ok: false, error: 'Invalid or expired link.' });
    }

    await sql`DELETE FROM public.updates_subscriptions WHERE unsubscribe_hash=${digest}`;
    return json(200, { ok: true, message: 'Your request is cancelled or your subscription is removed.' });
  } catch (error) {
    if (error instanceof TooManyAttempts) return json(429, { ok: false, error: 'Too many requests. Please try again later.' });
    console.error('DAJC updates service operation failed');
    return json(503, { ok: false, error: 'Subscription service unavailable.' });
  } finally {
    await sql.end({ timeout: 1 }).catch(() => {});
  }
};
