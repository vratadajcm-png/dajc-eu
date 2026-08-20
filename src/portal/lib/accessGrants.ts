// Admin-only operations on access grants and API client registry metadata
// (docs/PARTNER_PORTAL.md sections 5 and 6). A grant is the only thing
// that turns a scope into actual access; creating one always requires an
// existing, non-revoked api_client and a partner status consistent with
// the requested environment, so a partner cannot be granted PRODUCTION
// access while still SANDBOX.
import { and, eq } from 'drizzle-orm';
import { getPortalDb } from '../db/client';
import { accessGrants, apiClients, partners } from '../db/schema';
import { recordAuditEvent } from './audit';

// A grant is active only while both unrevoked AND (if it has an expiry)
// not yet past it - `revokedAt IS NULL` alone is not the full invariant.
export function isGrantActive(grant: { revokedAt: Date | null; expiresAt: Date | null }): boolean {
  if (grant.revokedAt) return false;
  if (grant.expiresAt && grant.expiresAt.getTime() <= Date.now()) return false;
  return true;
}

export async function listApiClientsForPartner(partnerId: string) {
  const db = getPortalDb();
  return db.select().from(apiClients).where(eq(apiClients.partnerId, partnerId)).orderBy(apiClients.createdAt);
}

export async function listAccessGrantsForPartner(partnerId: string) {
  const db = getPortalDb();
  return db.select().from(accessGrants).where(eq(accessGrants.partnerId, partnerId)).orderBy(accessGrants.grantedAt);
}

export class GrantValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GrantValidationError';
  }
}

export async function createAccessGrant(params: {
  partnerId: string;
  apiClientId: string;
  tenantRef: string;
  scope: string;
  environment: 'SANDBOX' | 'PRODUCTION';
  actorEmail: string;
  expiresAt?: Date;
}): Promise<{ grantId: string }> {
  const db = getPortalDb();
  return db.transaction(async (tx) => {
    const [partner] = await tx.select().from(partners).where(eq(partners.id, params.partnerId)).limit(1);
    if (!partner) throw new GrantValidationError('Partner not found.');

    const [client] = await tx
      .select()
      .from(apiClients)
      .where(and(eq(apiClients.id, params.apiClientId), eq(apiClients.partnerId, params.partnerId)))
      .limit(1);
    if (!client) throw new GrantValidationError('API client not found for this partner.');
    if (client.revokedAt) throw new GrantValidationError('Cannot grant access on a revoked API client.');
    if (client.environment !== params.environment) {
      throw new GrantValidationError('Grant environment must match the API client environment.');
    }
    if (params.environment === 'PRODUCTION' && partner.status !== 'PRODUCTION') {
      throw new GrantValidationError('Partner must be in PRODUCTION status for a production grant.');
    }
    if (params.environment === 'SANDBOX' && !['SANDBOX', 'PRODUCTION'].includes(partner.status)) {
      throw new GrantValidationError('Partner must have sandbox enabled for a sandbox grant.');
    }

    const [created] = await tx
      .insert(accessGrants)
      .values({
        partnerId: params.partnerId,
        apiClientId: params.apiClientId,
        tenantRef: params.tenantRef,
        scope: params.scope,
        environment: params.environment,
        grantedBy: params.actorEmail,
        expiresAt: params.expiresAt ?? null,
      })
      .returning({ id: accessGrants.id });

    await recordAuditEvent({
      actor: params.actorEmail,
      actorType: 'ADMIN',
      action: 'grant.created',
      targetType: 'access_grant',
      targetId: created.id,
      partnerId: params.partnerId,
      metadata: { apiClientId: params.apiClientId, tenantRef: params.tenantRef, scope: params.scope, environment: params.environment },
    });

    return { grantId: created.id };
  });
}

export async function revokeAccessGrant(grantId: string, actorEmail: string): Promise<void> {
  const db = getPortalDb();
  await db.transaction(async (tx) => {
    const [grant] = await tx.select().from(accessGrants).where(eq(accessGrants.id, grantId)).limit(1);
    if (!grant || grant.revokedAt) return;

    await tx.update(accessGrants).set({ revokedAt: new Date() }).where(eq(accessGrants.id, grantId));

    await recordAuditEvent({
      actor: actorEmail,
      actorType: 'ADMIN',
      action: 'grant.revoked',
      targetType: 'access_grant',
      targetId: grantId,
      partnerId: grant.partnerId,
    });
  });
}

export async function rotateApiClient(apiClientId: string, actorEmail: string): Promise<void> {
  const db = getPortalDb();
  await db.transaction(async (tx) => {
    const [client] = await tx.select().from(apiClients).where(eq(apiClients.id, apiClientId)).limit(1);
    if (!client) throw new GrantValidationError('API client not found.');
    if (client.revokedAt) throw new GrantValidationError('Cannot rotate a revoked API client.');

    await tx.update(apiClients).set({ rotatedAt: new Date(), status: 'ACTIVE' }).where(eq(apiClients.id, apiClientId));

    await recordAuditEvent({
      actor: actorEmail,
      actorType: 'ADMIN',
      action: 'api_client.rotated',
      targetType: 'api_client',
      targetId: apiClientId,
      partnerId: client.partnerId,
    });
  });
}

export async function revokeApiClient(apiClientId: string, actorEmail: string): Promise<void> {
  const db = getPortalDb();
  await db.transaction(async (tx) => {
    const [client] = await tx.select().from(apiClients).where(eq(apiClients.id, apiClientId)).limit(1);
    if (!client || client.revokedAt) return;

    await tx.update(apiClients).set({ status: 'REVOKED', revokedAt: new Date() }).where(eq(apiClients.id, apiClientId));

    // Revoking a client implicitly voids every grant attached to it - a
    // grant is meaningless without a live client to exercise it.
    const grants = await tx
      .select({ id: accessGrants.id })
      .from(accessGrants)
      .where(and(eq(accessGrants.apiClientId, apiClientId), eq(accessGrants.partnerId, client.partnerId)));
    for (const grant of grants) {
      await tx.update(accessGrants).set({ revokedAt: new Date() }).where(eq(accessGrants.id, grant.id));
    }

    await recordAuditEvent({
      actor: actorEmail,
      actorType: 'ADMIN',
      action: 'api_client.revoked',
      targetType: 'api_client',
      targetId: apiClientId,
      partnerId: client.partnerId,
      metadata: { grantsRevoked: grants.length },
    });
  });
}
