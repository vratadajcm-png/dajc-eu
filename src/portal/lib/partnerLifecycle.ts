// Server-side governance state machine for partner status transitions
// (docs/PARTNER_PORTAL.md section 7). Every transition here:
//   1. validates the partner's CURRENT status (rejects invalid jumps -
//      e.g. approving production for a partner still PENDING),
//   2. is a distinct admin-triggered action with an explicit actor,
//   3. writes an audit event in the same DB transaction as the state
//      change, so an audited state change and an unaudited one can never
//      diverge.
// No route ever writes partners.status directly - this module is the only
// place allowed to.
import { eq } from 'drizzle-orm';
import { getPortalDb } from '../db/client';
import { partners, apiClients } from '../db/schema';
import { recordAuditEvent } from './audit';

export class InvalidTransitionError extends Error {
  constructor(from: string, to: string) {
    super(`Cannot transition partner from ${from} to ${to}.`);
    this.name = 'InvalidTransitionError';
  }
}

export class PartnerNotFoundError extends Error {
  constructor(partnerId: string) {
    super(`Partner ${partnerId} not found.`);
    this.name = 'PartnerNotFoundError';
  }
}

async function loadPartnerForUpdate(
  tx: Parameters<Parameters<ReturnType<typeof getPortalDb>['transaction']>[0]>[0],
  partnerId: string
) {
  const [partner] = await tx.select().from(partners).where(eq(partners.id, partnerId)).limit(1);
  if (!partner) throw new PartnerNotFoundError(partnerId);
  return partner;
}

export async function verifyPartner(partnerId: string, actorEmail: string): Promise<void> {
  const db = getPortalDb();
  await db.transaction(async (tx) => {
    const partner = await loadPartnerForUpdate(tx, partnerId);
    if (partner.status !== 'PENDING') throw new InvalidTransitionError(partner.status, 'VERIFIED');

    await tx.update(partners).set({ status: 'VERIFIED', updatedAt: new Date() }).where(eq(partners.id, partnerId));
    await recordAuditEvent({
      actor: actorEmail,
      actorType: 'ADMIN',
      action: 'partner.verified',
      targetType: 'partner',
      targetId: partnerId,
      partnerId,
    });
  });
}

// Sandbox enablement provisions a SANDBOX api_client registry entry
// (metadata only - see src/portal/db/schema.ts on why no secret is stored
// here) and moves the partner to SANDBOX status.
export async function enableSandbox(partnerId: string, actorEmail: string): Promise<{ apiClientId: string }> {
  const db = getPortalDb();
  return db.transaction(async (tx) => {
    const partner = await loadPartnerForUpdate(tx, partnerId);
    if (partner.status !== 'VERIFIED') throw new InvalidTransitionError(partner.status, 'SANDBOX');

    const [client] = await tx
      .insert(apiClients)
      .values({ partnerId, environment: 'SANDBOX', status: 'PENDING', allowedScopes: [] })
      .returning({ id: apiClients.id });

    await tx.update(partners).set({ status: 'SANDBOX', updatedAt: new Date() }).where(eq(partners.id, partnerId));

    await recordAuditEvent({
      actor: actorEmail,
      actorType: 'ADMIN',
      action: 'partner.sandbox_enabled',
      targetType: 'partner',
      targetId: partnerId,
      partnerId,
      metadata: { apiClientId: client.id },
    });
    await recordAuditEvent({
      actor: actorEmail,
      actorType: 'ADMIN',
      action: 'api_client.created',
      targetType: 'api_client',
      targetId: client.id,
      partnerId,
      metadata: { environment: 'SANDBOX' },
    });

    return { apiClientId: client.id };
  });
}

// Production is never auto-derived from a working sandbox - this is
// always a distinct, explicit administrator action (docs/PARTNER_PORTAL.md
// section 6/7). No partner can call this on itself; only admin routes may
// invoke it.
export async function approveProduction(partnerId: string, actorEmail: string): Promise<{ apiClientId: string }> {
  const db = getPortalDb();
  return db.transaction(async (tx) => {
    const partner = await loadPartnerForUpdate(tx, partnerId);
    if (partner.status !== 'SANDBOX') throw new InvalidTransitionError(partner.status, 'PRODUCTION');

    const [client] = await tx
      .insert(apiClients)
      .values({ partnerId, environment: 'PRODUCTION', status: 'PENDING', allowedScopes: [] })
      .returning({ id: apiClients.id });

    await tx
      .update(partners)
      .set({ status: 'PRODUCTION', approvedAt: new Date(), updatedAt: new Date() })
      .where(eq(partners.id, partnerId));

    await recordAuditEvent({
      actor: actorEmail,
      actorType: 'ADMIN',
      action: 'partner.production_approved',
      targetType: 'partner',
      targetId: partnerId,
      partnerId,
      metadata: { apiClientId: client.id },
    });
    await recordAuditEvent({
      actor: actorEmail,
      actorType: 'ADMIN',
      action: 'api_client.created',
      targetType: 'api_client',
      targetId: client.id,
      partnerId,
      metadata: { environment: 'PRODUCTION' },
    });

    return { apiClientId: client.id };
  });
}

// Suspension is reversible governance friction, allowed from any active
// status (VERIFIED/SANDBOX/PRODUCTION) - it does not revoke grants or
// clients, it freezes the partner as a whole. Re-verification/support flow
// to lift a suspension is intentionally out of scope for this phase (no
// route un-suspends yet); see docs/PARTNER_PORTAL.md TODO.
export async function suspendPartner(partnerId: string, actorEmail: string, reason: string): Promise<void> {
  const db = getPortalDb();
  await db.transaction(async (tx) => {
    const partner = await loadPartnerForUpdate(tx, partnerId);
    if (!['VERIFIED', 'SANDBOX', 'PRODUCTION'].includes(partner.status)) {
      throw new InvalidTransitionError(partner.status, 'SUSPENDED');
    }

    await tx
      .update(partners)
      .set({ status: 'SUSPENDED', suspendedAt: new Date(), updatedAt: new Date() })
      .where(eq(partners.id, partnerId));

    await recordAuditEvent({
      actor: actorEmail,
      actorType: 'ADMIN',
      action: 'partner.suspended',
      targetType: 'partner',
      targetId: partnerId,
      partnerId,
      metadata: { reason },
    });
  });
}

// Revocation is terminal: also revokes every non-revoked api_client for
// the partner in the same transaction, so a revoked partner can never be
// left with a live client registry entry.
export async function revokePartner(partnerId: string, actorEmail: string, reason: string): Promise<void> {
  const db = getPortalDb();
  await db.transaction(async (tx) => {
    const partner = await loadPartnerForUpdate(tx, partnerId);
    if (partner.status === 'REVOKED') throw new InvalidTransitionError(partner.status, 'REVOKED');

    await tx
      .update(partners)
      .set({ status: 'REVOKED', revokedAt: new Date(), updatedAt: new Date() })
      .where(eq(partners.id, partnerId));

    const clients = await tx
      .select({ id: apiClients.id })
      .from(apiClients)
      .where(eq(apiClients.partnerId, partnerId));
    for (const client of clients) {
      await tx
        .update(apiClients)
        .set({ status: 'REVOKED', revokedAt: new Date() })
        .where(eq(apiClients.id, client.id));
      await recordAuditEvent({
        actor: actorEmail,
        actorType: 'ADMIN',
        action: 'api_client.revoked',
        targetType: 'api_client',
        targetId: client.id,
        partnerId,
        metadata: { reason: 'partner_revoked' },
      });
    }

    await recordAuditEvent({
      actor: actorEmail,
      actorType: 'ADMIN',
      action: 'partner.revoked',
      targetType: 'partner',
      targetId: partnerId,
      partnerId,
      metadata: { reason },
    });
  });
}
