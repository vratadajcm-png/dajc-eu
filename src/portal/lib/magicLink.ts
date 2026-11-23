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
import { intelligenceMembers, intelligenceOrganisations } from '../db/intelligenceSchema';
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

// DAJC Intelligence customers: a token only for an ACTIVE member of an ACTIVE organisation.
export async function requestCustomerLoginToken(email: string): Promise<{ rawToken: string; expiresAt: Date } | null> {
  const member = await activeCustomerMember({ email: email.trim().toLowerCase() });
  if (!member) return null;
  return issueLoginToken('CUSTOMER', member.id, member.email);
}

// The member behind a customer principal, only while both member and organisation are active.
async function activeCustomerMember(where: { email: string } | { id: string }, db = getPortalDb()) {
  const [row] = await db
    .select({ id: intelligenceMembers.id, email: intelligenceMembers.email, memberStatus: intelligenceMembers.status, organisationStatus: intelligenceOrganisations.status })
    .from(intelligenceMembers)
    .innerJoin(intelligenceOrganisations, eq(intelligenceOrganisations.id, intelligenceMembers.organisationId))
    .where('email' in where ? eq(intelligenceMembers.email, where.email) : eq(intelligenceMembers.id, where.id))
    .limit(1);
  return row && row.memberStatus === 'ACTIVE' && row.organisationStatus === 'ACTIVE' ? row : null;
}

export class LoginTokenInvalidError extends Error {
  constructor() {
    super('Sign-in link is invalid, expired, or already used.');
    this.name = 'LoginTokenInvalidError';
  }
}

// `allowed` is the area's principal types: the portal callback never redeems a customer
// link and the customer callback never redeems an admin or partner link. A link for
// another area is rejected without being consumed.
//
// Everything that must be atomic (re-validation, single-use consumption, the new
// session) runs on the transaction itself; the audit entry is written after the
// transaction, so a failed attempt is still recorded although its transaction rolled
// back, and no statement ever waits for a second connection while the transaction holds
// the only one (the client is created with max: 1).
export async function consumeLoginToken(
  rawToken: string,
  allowed: readonly PrincipalType[] = ['ADMIN', 'PARTNER_CONTACT']
): Promise<{ principalType: PrincipalType; rawSessionToken: string; sessionExpiresAt: Date }> {
  const db = getPortalDb();
  const tokenHash = hashToken(rawToken);

  type Outcome =
    | { ok: false; actor: string; reason: string }
    | { ok: true; email: string; principalType: PrincipalType; rawSessionToken: string; sessionExpiresAt: Date };

  const outcome: Outcome = await db.transaction(async (tx): Promise<Outcome> => {
    const [record] = await tx.select().from(loginTokens).where(eq(loginTokens.tokenHash, tokenHash)).limit(1);

    if (record && !allowed.includes(record.principalType)) return { ok: false, actor: record.email, reason: 'wrong_area' };
    if (!record || record.consumedAt || record.expiresAt.getTime() <= Date.now()) {
      return { ok: false, actor: record?.email ?? 'anonymous', reason: !record ? 'not_found' : record.consumedAt ? 'already_used' : 'expired' };
    }

    // Re-validate eligibility at consume time, not just at request time -
    // an admin removed from the allowlist or a contact suspended in the
    // few minutes the link was live must not still be able to redeem it.
    if (record.principalType === 'ADMIN' && !isAllowlistedAdmin(record.principalRef)) {
      return { ok: false, actor: record.email, reason: 'no_longer_allowlisted' };
    }
    if (record.principalType === 'PARTNER_CONTACT') {
      const [contact] = await tx.select().from(partnerContacts).where(eq(partnerContacts.id, record.principalRef)).limit(1);
      if (!contact || contact.status !== 'ACTIVE') return { ok: false, actor: record.email, reason: 'contact_not_active' };
      await tx.update(partnerContacts).set({ lastLoginAt: new Date() }).where(eq(partnerContacts.id, contact.id));
    }
    if (record.principalType === 'CUSTOMER') {
      const member = await activeCustomerMember({ id: record.principalRef }, tx as unknown as typeof db);
      if (!member) return { ok: false, actor: record.email, reason: 'customer_not_active' };
      await tx.update(intelligenceMembers).set({ lastLoginAt: new Date() }).where(eq(intelligenceMembers.id, member.id));
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

    if (consumed.length === 0) return { ok: false, actor: record.email, reason: 'concurrent_use' };

    const { rawToken: rawSessionToken, expiresAt: sessionExpiresAt } = await createSession(
      record.principalType,
      record.principalRef,
      tx as unknown as typeof db
    );

    return { ok: true, email: record.email, principalType: record.principalType, rawSessionToken, sessionExpiresAt };
  });

  if ('reason' in outcome) {
    await recordAuditEvent({ actor: outcome.actor, actorType: 'SYSTEM', action: 'login.failed', metadata: { reason: outcome.reason } });
    throw new LoginTokenInvalidError();
  }
  await recordAuditEvent({
    actor: outcome.email,
    actorType: outcome.principalType === 'ADMIN' ? 'ADMIN' : outcome.principalType === 'CUSTOMER' ? 'CUSTOMER' : 'PARTNER_CONTACT',
    action: 'login.succeeded',
  });
  return { principalType: outcome.principalType, rawSessionToken: outcome.rawSessionToken, sessionExpiresAt: outcome.sessionExpiresAt };
}
