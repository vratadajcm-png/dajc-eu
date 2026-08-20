// Passwordless magic-link login shared by ADMIN (allowlisted DAJC staff)
// and PARTNER_CONTACT (already-activated partner users) principals - see
// docs/PARTNER_PORTAL.md "Admin auth". Same single-use/hashed-token
// discipline as invitations (src/portal/lib/tokens.ts).
//
// Every request-side function below returns the SAME generic result
// regardless of whether the email is actually recognized/eligible, and
// only sends an email / issues a token when it is - this prevents the
// login-request endpoint from being usable to enumerate admin or partner
// contact email addresses.
import { and, eq, isNull } from 'drizzle-orm';
import { getPortalDb } from '../db/client';
import { loginTokens, partnerContacts } from '../db/schema';
import { generateSecureToken, hashToken } from './tokens';
import { recordAuditEvent } from './audit';
import { createSession, type PrincipalType } from './session';
import { isAllowlistedAdmin } from '../config/adminAllowlist';

const LOGIN_TOKEN_TTL_MINUTES = 15;

async function issueLoginToken(
  principalType: PrincipalType,
  principalRef: string,
  email: string
): Promise<{ rawToken: string; expiresAt: Date }> {
  const db = getPortalDb();
  const rawToken = generateSecureToken();
  const expiresAt = new Date(Date.now() + LOGIN_TOKEN_TTL_MINUTES * 60 * 1000);

  await db.insert(loginTokens).values({
    principalType,
    principalRef,
    email: email.trim().toLowerCase(),
    tokenHash: hashToken(rawToken),
    expiresAt,
  });

  return { rawToken, expiresAt };
}

// Returns a token to email only if the address is allowlisted; otherwise
// null (caller still renders the generic "check your email" response).
export async function requestAdminLoginToken(email: string): Promise<{ rawToken: string; expiresAt: Date } | null> {
  const normalized = email.trim().toLowerCase();
  if (!isAllowlistedAdmin(normalized)) return null;
  return issueLoginToken('ADMIN', normalized, normalized);
}

// Returns a token only if an ACTIVE partner contact owns this email.
export async function requestPartnerContactLoginToken(
  email: string
): Promise<{ rawToken: string; expiresAt: Date } | null> {
  const db = getPortalDb();
  const normalized = email.trim().toLowerCase();
  const [contact] = await db
    .select()
    .from(partnerContacts)
    .where(and(eq(partnerContacts.email, normalized), eq(partnerContacts.status, 'ACTIVE')))
    .limit(1);
  if (!contact) return null;
  return issueLoginToken('PARTNER_CONTACT', contact.id, normalized);
}

export class LoginTokenInvalidError extends Error {
  constructor() {
    super('Sign-in link is invalid, expired, or already used.');
    this.name = 'LoginTokenInvalidError';
  }
}

export async function consumeLoginToken(
  rawToken: string
): Promise<{ principalType: PrincipalType; rawSessionToken: string; sessionExpiresAt: Date }> {
  const db = getPortalDb();
  const tokenHash = hashToken(rawToken);

  return db.transaction(async (tx) => {
    const [record] = await tx.select().from(loginTokens).where(eq(loginTokens.tokenHash, tokenHash)).limit(1);

    if (!record || record.consumedAt || record.expiresAt.getTime() <= Date.now()) {
      await recordAuditEvent({
        actor: record?.email ?? 'anonymous',
        actorType: 'SYSTEM',
        action: 'login.failed',
        metadata: { reason: !record ? 'not_found' : record.consumedAt ? 'already_used' : 'expired' },
      });
      throw new LoginTokenInvalidError();
    }

    // Re-validate eligibility at consume time, not just at request time -
    // an admin removed from the allowlist or a contact suspended in the
    // few minutes the link was live must not still be able to redeem it.
    if (record.principalType === 'ADMIN' && !isAllowlistedAdmin(record.principalRef)) {
      await recordAuditEvent({ actor: record.email, actorType: 'SYSTEM', action: 'login.failed', metadata: { reason: 'no_longer_allowlisted' } });
      throw new LoginTokenInvalidError();
    }
    if (record.principalType === 'PARTNER_CONTACT') {
      const [contact] = await tx.select().from(partnerContacts).where(eq(partnerContacts.id, record.principalRef)).limit(1);
      if (!contact || contact.status !== 'ACTIVE') {
        await recordAuditEvent({ actor: record.email, actorType: 'SYSTEM', action: 'login.failed', metadata: { reason: 'contact_not_active' } });
        throw new LoginTokenInvalidError();
      }
      await tx.update(partnerContacts).set({ lastLoginAt: new Date() }).where(eq(partnerContacts.id, contact.id));
    }

    // Single-use, race-safe: the WHERE clause re-asserts consumedAt IS NULL
    // as a compare-and-swap and the affected-row count is checked. The
    // initial read above only rejects a *sequential* replay (a second call
    // after the first already committed); without this CAS + check, two
    // truly concurrent requests for the same raw token would both pass
    // that read (READ COMMITTED doesn't block plain SELECTs) and this
    // UPDATE - having no condition beyond the id - would let both
    // "succeed" and each mint its own session, defeating single-use under
    // race rather than just under sequential reuse.
    const consumed = await tx
      .update(loginTokens)
      .set({ consumedAt: new Date() })
      .where(and(eq(loginTokens.id, record.id), isNull(loginTokens.consumedAt)))
      .returning({ id: loginTokens.id });

    if (consumed.length === 0) {
      await recordAuditEvent({ actor: record.email, actorType: 'SYSTEM', action: 'login.failed', metadata: { reason: 'concurrent_use' } });
      throw new LoginTokenInvalidError();
    }

    await recordAuditEvent({
      actor: record.email,
      actorType: record.principalType === 'ADMIN' ? 'ADMIN' : 'PARTNER_CONTACT',
      action: 'login.succeeded',
    });

    const { rawToken: rawSessionToken, expiresAt: sessionExpiresAt } = await createSession(
      record.principalType,
      record.principalRef
    );

    return { principalType: record.principalType, rawSessionToken, sessionExpiresAt };
  });
}
