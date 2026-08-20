// Partner registry CRUD (docs/PARTNER_PORTAL.md section 1). Status is
// deliberately absent from both schemas below - every status change goes
// through src/portal/lib/partnerLifecycle.ts, never a plain field update,
// so a transition is always validated and audited.
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { getPortalDb } from '../db/client';
import { partners } from '../db/schema';
import { recordAuditEvent } from './audit';

export const createPartnerSchema = z.object({
  legalName: z.string().trim().min(1).max(300),
  country: z.string().trim().length(2).toUpperCase(),
  registrationId: z.string().trim().min(1).max(100),
  vatId: z.string().trim().max(50).optional().or(z.literal('')),
  website: z.string().trim().url().optional().or(z.literal('')),
  primaryContactName: z.string().trim().min(1).max(200),
  primaryContactEmail: z.string().trim().email(),
  useCaseDescription: z.string().trim().min(1).max(4000),
  requestedIntegrationType: z.string().trim().min(1).max(200),
});

export type CreatePartnerInput = z.infer<typeof createPartnerSchema>;

export const updatePartnerSchema = createPartnerSchema.partial();
export type UpdatePartnerInput = z.infer<typeof updatePartnerSchema>;

export async function createPartner(input: CreatePartnerInput, actorEmail: string): Promise<{ partnerId: string }> {
  const db = getPortalDb();
  const [created] = await db
    .insert(partners)
    .values({
      legalName: input.legalName,
      country: input.country,
      registrationId: input.registrationId,
      vatId: input.vatId || null,
      website: input.website || null,
      primaryContactName: input.primaryContactName,
      primaryContactEmail: input.primaryContactEmail,
      useCaseDescription: input.useCaseDescription,
      requestedIntegrationType: input.requestedIntegrationType,
    })
    .returning({ id: partners.id });

  await recordAuditEvent({
    actor: actorEmail,
    actorType: 'ADMIN',
    action: 'partner.created',
    targetType: 'partner',
    targetId: created.id,
    partnerId: created.id,
  });

  return { partnerId: created.id };
}

export async function updatePartnerMetadata(
  partnerId: string,
  input: UpdatePartnerInput,
  actorEmail: string
): Promise<void> {
  const db = getPortalDb();
  const patch: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) patch[key] = value === '' ? null : value;
  }
  if (Object.keys(patch).length === 0) return;

  await db
    .update(partners)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(partners.id, partnerId));

  await recordAuditEvent({
    actor: actorEmail,
    actorType: 'ADMIN',
    action: 'partner.updated',
    targetType: 'partner',
    targetId: partnerId,
    partnerId,
    metadata: { fields: Object.keys(patch) },
  });
}

export async function getPartnerById(partnerId: string) {
  const db = getPortalDb();
  const [partner] = await db.select().from(partners).where(eq(partners.id, partnerId)).limit(1);
  return partner ?? null;
}

export async function listPartners() {
  const db = getPortalDb();
  return db.select().from(partners).orderBy(partners.createdAt);
}
