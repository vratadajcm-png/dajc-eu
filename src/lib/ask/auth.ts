// Sign-in with a one-time e-mail link (Resend). Same token discipline as
// the Partner Portal (src/portal/lib/tokens.ts): the raw token exists only
// in the e-mail and the browser; the database stores its SHA-256 hash.
//
// The link carries the token in the URL fragment (#login=...), which
// browsers never send to a server, so it never reaches access logs or
// analytics; the page script posts it once to /api/ask/verify. E-mail
// scanners that prefetch links therefore cannot consume it either.
//
// The e-mail address itself is never stored: users are identified by an
// HMAC fingerprint keyed with DAJC_ASK_EMAIL_PEPPER.

import { createHmac } from 'node:crypto';
import { generateSecureToken, hashToken } from '../../portal/lib/tokens';
import { SESSION_TTL_DAYS, type AskConfig } from './config';
import { t, type UiLang } from './i18n';
import type { AskMailer } from './email';
import type { AskStore } from './store/types';

export const LOGIN_TOKEN_TTL_MINUTES = 15;
export const SESSION_COOKIE = 'dajc_ask_session';

const RATE = {
  perIpHour: 5,
  perEmailHour: 3,
  perEmailDay: 6,
  globalDay: 300,
};

export function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const email = raw.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[^\s@<>()",;:]{2,}$/.test(email)) return null;
  return email;
}

export function fingerprint(pepper: string, kind: 'email' | 'ip', value: string): string {
  return createHmac('sha256', pepper).update(`${kind}:${value}`, 'utf8').digest('hex');
}

export function loginLink(origin: string, rawToken: string, lang: UiLang): string {
  const query = lang === 'en' ? '' : `?lang=${lang}`;
  return `${origin}/intelligence/ask${query}#login=${rawToken}`;
}

export type LoginRequestResult = 'sent' | 'invalid' | 'limited';

export async function requestLoginLink(
  { email: rawEmail, ip, lang }: { email: unknown; ip: string; lang: UiLang },
  { config, store, mailer, now = new Date() }: { config: AskConfig; store: AskStore; mailer: AskMailer; now?: Date },
): Promise<LoginRequestResult> {
  const email = normalizeEmail(rawEmail);
  const ipKey = fingerprint(config.emailPepper, 'ip', ip || 'unknown');
  if (!(await store.hitRateLimit(`login-ip:${ipKey}`, 3600, RATE.perIpHour, now))) return 'limited';
  if (!email) return 'invalid';
  const emailHmac = fingerprint(config.emailPepper, 'email', email);
  if (!(await store.hitRateLimit(`login-email-h:${emailHmac}`, 3600, RATE.perEmailHour, now))) return 'limited';
  if (!(await store.hitRateLimit(`login-email-d:${emailHmac}`, 86_400, RATE.perEmailDay, now))) return 'limited';
  if (!(await store.hitRateLimit('login-global', 86_400, RATE.globalDay, now))) return 'limited';

  await store.purgeExpired(now);
  const rawToken = generateSecureToken();
  await store.createLoginToken({
    tokenHash: hashToken(rawToken),
    emailHmac,
    expiresAt: new Date(now.getTime() + LOGIN_TOKEN_TTL_MINUTES * 60_000),
  });
  const link = loginLink(config.publicOrigin, rawToken, lang);
  // Fixed text only: the recipient is caller-supplied, so no caller text
  // may appear in a mail sent from a DAJC domain.
  await mailer.send({
    to: email,
    subject: t(lang, 'email.subject'),
    text: `${t(lang, 'email.body')}\n\n${link}\n\n${t(lang, 'email.ignore')}\n\nDAJC - dajc.eu`,
  });
  return 'sent';
}

export async function completeLogin(
  rawToken: unknown,
  { store, now = new Date() }: { store: AskStore; now?: Date },
): Promise<{ sessionToken: string; expiresAt: Date } | null> {
  if (typeof rawToken !== 'string' || !/^[A-Za-z0-9_-]{20,100}$/.test(rawToken)) return null;
  const emailHmac = await store.consumeLoginToken(hashToken(rawToken), now);
  if (!emailHmac) return null;
  const userId = await store.upsertUser(emailHmac, now);
  const sessionToken = generateSecureToken();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_DAYS * 86_400_000);
  await store.createSession({ tokenHash: hashToken(sessionToken), userId, expiresAt });
  return { sessionToken, expiresAt };
}

export async function currentUserId(sessionToken: string | undefined, { store, now = new Date() }: { store: AskStore; now?: Date }): Promise<string | null> {
  if (!sessionToken || !/^[A-Za-z0-9_-]{20,100}$/.test(sessionToken)) return null;
  const session = await store.getSession(hashToken(sessionToken), now);
  return session?.userId ?? null;
}

export async function endSession(sessionToken: string | undefined, { store }: { store: AskStore }): Promise<void> {
  if (sessionToken && /^[A-Za-z0-9_-]{20,100}$/.test(sessionToken)) await store.deleteSession(hashToken(sessionToken));
}
