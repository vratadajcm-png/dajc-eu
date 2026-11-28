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

const SESSION_TTL_SECONDS = 12 * 60 * 60; // 12h - short-lived by design; re-auth via magic link, not "remember me"

export type PrincipalType = 'ADMIN' | 'PARTNER_CONTACT' | 'CUSTOMER';

// Where a session's cookies live and which principals they may carry. The Partner
// Portal and the DAJC Intelligence customer area share the session table but never a
// cookie: a customer session is invisible under /partner-portal and the reverse.
export interface SessionScope {
  sessionCookie: string;
  csrfCookie: string;
  path: string;
  principalTypes: readonly PrincipalType[];
}
export const PORTAL_SESSION_SCOPE: SessionScope = { sessionCookie: 'dajc_portal_session', csrfCookie: 'dajc_portal_csrf', path: '/partner-portal', principalTypes: ['ADMIN', 'PARTNER_CONTACT'] };
export const CUSTOMER_SESSION_SCOPE: SessionScope = { sessionCookie: 'dajc_customer_session', csrfCookie: 'dajc_customer_csrf', path: '/intelligence/account', principalTypes: ['CUSTOMER'] };

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
function cookieOptions(maxAgeSeconds: number, httpOnly: boolean, secure: boolean, path: string) {
  return {
    httpOnly,
    secure,
    sameSite: 'lax' as const,
    path,
    maxAge: maxAgeSeconds,
  };
}

// `db` lets a caller create the session inside its own transaction (login consumption).
export async function createSession(
  principalType: PrincipalType,
  principalRef: string,
  db = getPortalDb()
): Promise<{ rawToken: string; expiresAt: Date }> {
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

export function setSessionCookies(cookies: AstroCookies, rawToken: string, expiresAt: Date, requestUrl: URL, scope: SessionScope = PORTAL_SESSION_SCOPE): void {
  const maxAge = Math.max(1, Math.floor((expiresAt.getTime() - Date.now()) / 1000));
  const secure = requestUrl.protocol === 'https:';
  cookies.set(scope.sessionCookie, rawToken, cookieOptions(maxAge, true, secure, scope.path));
  // CSRF cookie is deliberately NOT httpOnly - the double-submit pattern
  // requires same-origin JS/form code to be able to read it and echo it
  // back on state-changing requests. It carries no session authority by
  // itself.
  cookies.set(scope.csrfCookie, generateSecureToken(), cookieOptions(maxAge, false, secure, scope.path));
}

export function clearSessionCookies(cookies: AstroCookies, scope: SessionScope = PORTAL_SESSION_SCOPE): void {
  cookies.delete(scope.sessionCookie, { path: scope.path });
  cookies.delete(scope.csrfCookie, { path: scope.path });
}

export async function getCurrentSession(cookies: AstroCookies, scope: SessionScope = PORTAL_SESSION_SCOPE): Promise<PortalSession | null> {
  const rawToken = cookies.get(scope.sessionCookie)?.value;
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
  // A session only counts in the area it was issued for.
  if (!scope.principalTypes.includes(row.principalType)) return null;

  await db.update(sessions).set({ lastSeenAt: new Date() }).where(eq(sessions.id, row.id));

  return {
    id: row.id,
    principalType: row.principalType,
    principalRef: row.principalRef,
    expiresAt: row.expiresAt,
  };
}

export async function revokeSession(cookies: AstroCookies, scope: SessionScope = PORTAL_SESSION_SCOPE): Promise<void> {
  const rawToken = cookies.get(scope.sessionCookie)?.value;
  if (rawToken) {
    const db = getPortalDb();
    await db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.tokenHash, hashToken(rawToken)));
  }
  clearSessionCookies(cookies, scope);
}

// CSRF: double-submit cookie check for every state-changing (non-GET)
// portal request. Cross-site requests cannot read the CSRF cookie's value
// (browser same-origin policy), so they cannot supply a matching token.
export function validateCsrfToken(cookies: AstroCookies, submittedToken: string | null | undefined, scope: SessionScope = PORTAL_SESSION_SCOPE): boolean {
  const cookieValue = cookies.get(scope.csrfCookie)?.value;
  if (!cookieValue || !submittedToken) return false;
  return cookieValue === submittedToken;
}

// Makes a CSRF token available to a page BEFORE a session exists (login
// request form, invitation activation form) so those pre-auth,
// state-changing POSTs are still protected. createSession()/
// setSessionCookies() above reissue the cookie at login; this only fills
// it in when it's still missing.
const CSRF_STANDALONE_TTL_SECONDS = 60 * 60; // 1h - long enough to fill in a form, short-lived by default

export function ensureCsrfCookie(cookies: AstroCookies, requestUrl: URL, scope: SessionScope = PORTAL_SESSION_SCOPE): string {
  const existing = cookies.get(scope.csrfCookie)?.value;
  if (existing) return existing;

  const token = generateSecureToken();
  cookies.set(scope.csrfCookie, token, cookieOptions(CSRF_STANDALONE_TTL_SECONDS, false, requestUrl.protocol === 'https:', scope.path));
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
