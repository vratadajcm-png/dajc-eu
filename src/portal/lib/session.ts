// Session issuance/validation shared by ADMIN and PARTNER_CONTACT principals
// (see partner_portal_sessions in src/portal/db/schema.ts for why these
// share one mechanism). Same never-store-the-raw-value rule as
// src/portal/lib/tokens.ts and invitations: the cookie carries the raw
// session token, the database only ever sees its SHA-256 hash.
import type { AstroCookies } from 'astro';
import { and, eq, isNull } from 'drizzle-orm';
import { getPortalDb } from '../db/client';
import { sessions, partnerContacts } from '../db/schema';
import { generateSecureToken, hashToken } from './tokens';
import { isAllowlistedAdmin } from '../config/adminAllowlist';

const SESSION_COOKIE = 'dajc_portal_session';
const CSRF_COOKIE = 'dajc_portal_csrf';
const SESSION_TTL_SECONDS = 12 * 60 * 60; // 12h - short-lived by design; re-auth via magic link, not "remember me"

export type PrincipalType = 'ADMIN' | 'PARTNER_CONTACT';

export interface PortalSession {
  id: string;
  principalType: PrincipalType;
  principalRef: string;
  expiresAt: Date;
}

// `secure` is derived from the actual request protocol, not
// process.env.NODE_ENV - Vercel's Node runtime does not guarantee NODE_ENV
// is set to "production" for arbitrary adapter-built serverless functions
// the way it does for framework-managed ones (that guarantee is
// Next.js-specific), so trusting it here could silently ship session/CSRF
// cookies without the Secure flag in real production. Checking the
// request's own protocol is unambiguous regardless of platform env-var
// behavior, and self-corrects if the site is ever served over both
// http/https during migration.
function cookieOptions(maxAgeSeconds: number, httpOnly: boolean, secure: boolean) {
  return {
    httpOnly,
    secure,
    sameSite: 'lax' as const,
    path: '/partner-portal',
    maxAge: maxAgeSeconds,
  };
}

export async function createSession(
  principalType: PrincipalType,
  principalRef: string
): Promise<{ rawToken: string; expiresAt: Date }> {
  const db = getPortalDb();
  const rawToken = generateSecureToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000);

  await db.insert(sessions).values({
    principalType,
    principalRef,
    tokenHash: hashToken(rawToken),
    expiresAt,
  });

  return { rawToken, expiresAt };
}

export function setSessionCookies(cookies: AstroCookies, rawToken: string, expiresAt: Date, requestUrl: URL): void {
  const maxAge = Math.max(1, Math.floor((expiresAt.getTime() - Date.now()) / 1000));
  const secure = requestUrl.protocol === 'https:';
  cookies.set(SESSION_COOKIE, rawToken, cookieOptions(maxAge, true, secure));
  // CSRF cookie is deliberately NOT httpOnly - the double-submit pattern
  // requires same-origin JS/form code to be able to read it and echo it
  // back on state-changing requests. It carries no session authority by
  // itself.
  cookies.set(CSRF_COOKIE, generateSecureToken(), cookieOptions(maxAge, false, secure));
}

export function clearSessionCookies(cookies: AstroCookies): void {
  cookies.delete(SESSION_COOKIE, { path: '/partner-portal' });
  cookies.delete(CSRF_COOKIE, { path: '/partner-portal' });
}

export async function getCurrentSession(cookies: AstroCookies): Promise<PortalSession | null> {
  const rawToken = cookies.get(SESSION_COOKIE)?.value;
  if (!rawToken) return null;

  const db = getPortalDb();
  const tokenHash = hashToken(rawToken);
  const [row] = await db
    .select()
    .from(sessions)
    .where(and(eq(sessions.tokenHash, tokenHash), isNull(sessions.revokedAt)))
    .limit(1);

  if (!row) return null;
  if (row.expiresAt.getTime() <= Date.now()) return null;

  await db.update(sessions).set({ lastSeenAt: new Date() }).where(eq(sessions.id, row.id));

  return {
    id: row.id,
    principalType: row.principalType,
    principalRef: row.principalRef,
    expiresAt: row.expiresAt,
  };
}

export async function revokeSession(cookies: AstroCookies): Promise<void> {
  const rawToken = cookies.get(SESSION_COOKIE)?.value;
  if (rawToken) {
    const db = getPortalDb();
    await db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.tokenHash, hashToken(rawToken)));
  }
  clearSessionCookies(cookies);
}

// CSRF: double-submit cookie check for every state-changing (non-GET)
// portal request. Cross-site requests cannot read the CSRF cookie's value
// (browser same-origin policy), so they cannot supply a matching token.
export function validateCsrfToken(cookies: AstroCookies, submittedToken: string | null | undefined): boolean {
  const cookieValue = cookies.get(CSRF_COOKIE)?.value;
  if (!cookieValue || !submittedToken) return false;
  return cookieValue === submittedToken;
}

// Makes a CSRF token available to a page BEFORE a session exists (login
// request form, invitation activation form) so those pre-auth,
// state-changing POSTs are still protected. createSession()/
// setSessionCookies() above reissue the cookie at login; this only fills
// it in when it's still missing.
const CSRF_STANDALONE_TTL_SECONDS = 60 * 60; // 1h - long enough to fill in a form, short-lived by default

export function ensureCsrfCookie(cookies: AstroCookies, requestUrl: URL): string {
  const existing = cookies.get(CSRF_COOKIE)?.value;
  if (existing) return existing;

  const token = generateSecureToken();
  cookies.set(CSRF_COOKIE, token, cookieOptions(CSRF_STANDALONE_TTL_SECONDS, false, requestUrl.protocol === 'https:'));
  return token;
}

// --- Principal resolution -----------------------------------------------------

export interface AdminPrincipal {
  type: 'ADMIN';
  email: string;
}

export interface PartnerContactPrincipal {
  type: 'PARTNER_CONTACT';
  contactId: string;
  partnerId: string;
  email: string;
  role: 'PARTNER_ADMIN' | 'DEVELOPER' | 'READ_ONLY';
}

// Resolves the session to an ADMIN principal. Returns null if there is no
// valid session, the session is not an ADMIN session, or (defense in
// depth) the admin's email has since been removed from the allowlist.
export async function requireAdminPrincipal(cookies: AstroCookies): Promise<AdminPrincipal | null> {
  const session = await getCurrentSession(cookies);
  if (!session || session.principalType !== 'ADMIN') return null;
  if (!isAllowlistedAdmin(session.principalRef)) return null;

  return { type: 'ADMIN', email: session.principalRef };
}

// Resolves the session to an active PARTNER_CONTACT principal. Suspended or
// revoked contacts are rejected here even with an otherwise-valid session
// token, so a suspension takes effect immediately without needing to hunt
// down and revoke every outstanding session row.
export async function requirePartnerContactPrincipal(
  cookies: AstroCookies
): Promise<PartnerContactPrincipal | null> {
  const session = await getCurrentSession(cookies);
  if (!session || session.principalType !== 'PARTNER_CONTACT') return null;

  const db = getPortalDb();
  const [contact] = await db
    .select()
    .from(partnerContacts)
    .where(eq(partnerContacts.id, session.principalRef))
    .limit(1);

  if (!contact || contact.status !== 'ACTIVE') return null;

  return {
    type: 'PARTNER_CONTACT',
    contactId: contact.id,
    partnerId: contact.partnerId,
    email: contact.email,
    role: contact.role,
  };
}
