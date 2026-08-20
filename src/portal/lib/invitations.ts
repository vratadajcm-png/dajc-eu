// Invitation issuance/acceptance. Single-use, time-limited, bound to one
// partner + one email, replay-protected - see docs/PARTNER_PORTAL.md
// section 3. The raw token only ever exists in the email link and the
// activation request; the database holds nothing but its SHA-256 digest
// (src/portal/lib/tokens.ts).
import { and, eq } from 'drizzle-orm';
import { getPortalDb } from '../db/client';
import { invitations, partnerContacts, partners } from '../db/schema';
import { generateSecureToken, hashToken } from './tokens';
import { recordAuditEvent } from './audit';
import { createSession } from './session';

const INVITATION_TTL_HOURS = 72;

export class PartnerNotEligibleError extends Error {
  constructor() {
    super('Partner must be verified before contacts can be invited.');
    this.name = 'PartnerNotEligibleError';
  }
}

export class InvitationInvalidError extends Error {
  constructor(public reason: 'not_found' | 'expired' | 'revoked' | 'already_used') {
    super('Invitation is invalid, expired, or already used.');
    this.name = 'InvitationInvalidError';
  }
}

export async function createInvitation(
  partnerId: string,
  email: string,
  issuedByEmail: string
): Promise<{ invitationId: string; rawToken: string; expiresAt: Date; partnerLegalName: string }> {
  const db = getPortalDb();
  const normalizedEmail = email.trim().toLowerCase();

  return db.transaction(async (tx) => {
    const [partner] = await tx.select().from(partners).where(eq(partners.id, partnerId)).limit(1);
    if (!partner) throw new PartnerNotEligibleError();
    if (partner.status === 'PENDING' || partner.status === 'REVOKED') {
      throw new PartnerNotEligibleError();
    }

    // Supersede any still-pending invitation for the same partner+email so
    // at most one valid token exists per invitee at a time.
    const stale = await tx
      .select({ id: invitations.id })
      .from(invitations)
      .where(
        and(eq(invitations.partnerId, partnerId), eq(invitations.email, normalizedEmail), eq(invitations.status, 'PENDING'))
      );
    for (const row of stale) {
      await tx.update(invitations).set({ status: 'REVOKED', revokedAt: new Date() }).where(eq(invitations.id, row.id));
    }

    const rawToken = generateSecureToken();
    const expiresAt = new Date(Date.now() + INVITATION_TTL_HOURS * 60 * 60 * 1000);

    const [created] = await tx
      .insert(invitations)
      .values({
        partnerId,
        email: normalizedEmail,
        tokenHash: hashToken(rawToken),
        issuedBy: issuedByEmail,
        expiresAt,
      })
      .returning({ id: invitations.id });

    // Ensure a contact row exists so it is visible in the admin UI as soon
    // as the invitation is issued, not only after acceptance.
    const [existingContact] = await tx
      .select()
      .from(partnerContacts)
      .where(and(eq(partnerContacts.partnerId, partnerId), eq(partnerContacts.email, normalizedEmail)))
      .limit(1);
    if (!existingContact) {
      await tx.insert(partnerContacts).values({ partnerId, email: normalizedEmail, status: 'INVITED' });
    } else if (existingContact.status !== 'ACTIVE') {
      await tx.update(partnerContacts).set({ status: 'INVITED', updatedAt: new Date() }).where(eq(partnerContacts.id, existingContact.id));
    }

    await recordAuditEvent({
      actor: issuedByEmail,
      actorType: 'ADMIN',
      action: 'invitation.generated',
      targetType: 'invitation',
      targetId: created.id,
      partnerId,
      metadata: { email: normalizedEmail },
    });

    return { invitationId: created.id, rawToken, expiresAt, partnerLegalName: partner.legalName };
  });
}

// Read-only, non-mutating check used only to decide what to render on the
// GET activation page (no "already used" state flip, no audit write - the
// authoritative, mutating check is acceptInvitation() below, called from
// the POST handler). Deliberately returns only a boolean, never the
// specific reason, so this cannot be used to distinguish "wrong token"
// from "right token, expired" etc. from the outside.
export async function peekInvitationIsAcceptable(rawToken: string): Promise<boolean> {
  const db = getPortalDb();
  const tokenHash = hashToken(rawToken);
  const [invitation] = await db.select().from(invitations).where(eq(invitations.tokenHash, tokenHash)).limit(1);
  if (!invitation) return false;
  if (invitation.status !== 'PENDING') return false;
  if (invitation.expiresAt.getTime() <= Date.now()) return false;
  return true;
}

export async function listInvitationsForPartner(partnerId: string) {
  const db = getPortalDb();
  return db.select().from(invitations).where(eq(invitations.partnerId, partnerId)).orderBy(invitations.issuedAt);
}

export async function revokeInvitation(invitationId: string, actorEmail: string): Promise<void> {
  const db = getPortalDb();
  await db.transaction(async (tx) => {
    const [invitation] = await tx.select().from(invitations).where(eq(invitations.id, invitationId)).limit(1);
    if (!invitation || invitation.status !== 'PENDING') return;

    await tx
      .update(invitations)
      .set({ status: 'REVOKED', revokedAt: new Date() })
      .where(eq(invitations.id, invitationId));

    await recordAuditEvent({
      actor: actorEmail,
      actorType: 'ADMIN',
      action: 'invitation.revoked',
      targetType: 'invitation',
      targetId: invitationId,
      partnerId: invitation.partnerId,
    });
  });
}

// Accepts a raw invitation token: validates single-use/time-limited state,
// activates the corresponding contact, and issues a PARTNER_CONTACT
// session. Any invalid path (unknown token, expired, revoked, already
// accepted/replayed) throws InvitationInvalidError - callers should render
// the same generic "invalid or expired" message for every reason to avoid
// turning this into a token/email enumeration oracle, while the audit log
// still records the specific reason internally.
export async function acceptInvitation(
  rawToken: string
): Promise<{ rawSessionToken: string; sessionExpiresAt: Date; partnerId: string }> {
  const db = getPortalDb();
  const tokenHash = hashToken(rawToken);

  return db.transaction(async (tx) => {
    const [invitation] = await tx.select().from(invitations).where(eq(invitations.tokenHash, tokenHash)).limit(1);

    if (!invitation) {
      await recordAuditEvent({ actor: 'anonymous', actorType: 'SYSTEM', action: 'invitation.replay_rejected', metadata: { reason: 'not_found' } });
      throw new InvitationInvalidError('not_found');
    }

    if (invitation.status === 'REVOKED') {
      await recordAuditEvent({
        actor: 'anonymous',
        actorType: 'SYSTEM',
        action: 'invitation.replay_rejected',
        targetType: 'invitation',
        targetId: invitation.id,
        partnerId: invitation.partnerId,
        metadata: { reason: 'revoked' },
      });
      throw new InvitationInvalidError('revoked');
    }
    if (invitation.status === 'ACCEPTED' || invitation.acceptedAt) {
      await recordAuditEvent({
        actor: 'anonymous',
        actorType: 'SYSTEM',
        action: 'invitation.replay_rejected',
        targetType: 'invitation',
        targetId: invitation.id,
        partnerId: invitation.partnerId,
        metadata: { reason: 'already_used' },
      });
      throw new InvitationInvalidError('already_used');
    }
    if (invitation.expiresAt.getTime() <= Date.now()) {
      await tx.update(invitations).set({ status: 'EXPIRED' }).where(eq(invitations.id, invitation.id));
      await recordAuditEvent({
        actor: 'anonymous',
        actorType: 'SYSTEM',
        action: 'invitation.replay_rejected',
        targetType: 'invitation',
        targetId: invitation.id,
        partnerId: invitation.partnerId,
        metadata: { reason: 'expired' },
      });
      throw new InvitationInvalidError('expired');
    }

    // Single-use, race-safe: this UPDATE's WHERE re-asserts status='PENDING'
    // as a compare-and-swap, and - critically - the result is checked. Two
    // concurrent requests for the same raw token both pass the read-side
    // checks above before either commits (READ COMMITTED does not block
    // plain SELECTs), but Postgres serializes the two UPDATEs via row
    // locking: only the first to commit actually matches the WHERE clause,
    // the second updates zero rows. Without checking `updated.length` here,
    // the "losing" racer would silently fall through and still get a
    // session minted for it - not a privilege issue by itself (both
    // requests necessarily held the same valid raw token), but it defeats
    // the single-use guarantee this function exists to provide, so it's
    // treated as a replay and rejected.
    const updated = await tx
      .update(invitations)
      .set({ status: 'ACCEPTED', acceptedAt: new Date() })
      .where(and(eq(invitations.id, invitation.id), eq(invitations.status, 'PENDING')))
      .returning({ id: invitations.id });

    if (updated.length === 0) {
      await recordAuditEvent({
        actor: invitation.email,
        actorType: 'SYSTEM',
        action: 'invitation.replay_rejected',
        targetType: 'invitation',
        targetId: invitation.id,
        partnerId: invitation.partnerId,
        metadata: { reason: 'concurrent_use' },
      });
      throw new InvitationInvalidError('already_used');
    }

    const [contact] = await tx
      .select()
      .from(partnerContacts)
      .where(and(eq(partnerContacts.partnerId, invitation.partnerId), eq(partnerContacts.email, invitation.email)))
      .limit(1);
    if (!contact) throw new InvitationInvalidError('not_found');

    await tx
      .update(partnerContacts)
      .set({ status: 'ACTIVE', verifiedAt: new Date(), updatedAt: new Date() })
      .where(eq(partnerContacts.id, contact.id));

    await recordAuditEvent({
      actor: invitation.email,
      actorType: 'PARTNER_CONTACT',
      action: 'invitation.accepted',
      targetType: 'invitation',
      targetId: invitation.id,
      partnerId: invitation.partnerId,
    });

    const { rawToken: rawSessionToken, expiresAt: sessionExpiresAt } = await createSession('PARTNER_CONTACT', contact.id);

    return { rawSessionToken, sessionExpiresAt, partnerId: invitation.partnerId };
  });
}
