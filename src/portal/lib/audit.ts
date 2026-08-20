// Append-only audit trail for the Partner Portal. This is the only helper
// in the codebase allowed to write to partner_portal_audit_log, and it
// never exposes an update/delete - see docs/PARTNER_PORTAL.md section 9.
import { desc, eq } from 'drizzle-orm';
import { getPortalDb } from '../db/client';
import { auditLog } from '../db/schema';

export type ActorType = 'ADMIN' | 'PARTNER_CONTACT' | 'SYSTEM';

// Every audit action recognized by the portal (section 9 of the spec).
// Keeping this a closed union catches typos at compile time and gives a
// single place to see everything the system can audit.
export type AuditAction =
  | 'partner.created'
  | 'partner.updated'
  | 'partner.verified'
  | 'partner.status_changed'
  | 'partner.sandbox_enabled'
  | 'partner.production_approved'
  | 'partner.suspended'
  | 'partner.revoked'
  | 'invitation.generated'
  | 'invitation.sent'
  | 'invitation.accepted'
  | 'invitation.revoked'
  | 'invitation.replay_rejected'
  | 'login.magic_link_requested'
  | 'login.succeeded'
  | 'login.failed'
  | 'access.denied'
  | 'grant.created'
  | 'grant.revoked'
  | 'api_client.created'
  | 'api_client.rotated'
  | 'api_client.revoked';

// Defense-in-depth: even if a caller accidentally passes a secret-shaped
// field, strip it before it ever reaches the database. Callers must still
// never intentionally include tokens/secrets in metadata.
const FORBIDDEN_METADATA_KEYS = new Set([
  'token',
  'rawtoken',
  'token_hash',
  'tokenhash',
  'secret',
  'clientsecret',
  'password',
  'apikey',
  'authorization',
  'cookie',
]);

export function redactMetadata(metadata: Record<string, unknown> | undefined): Record<string, unknown> | null {
  if (!metadata) return null;
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (FORBIDDEN_METADATA_KEYS.has(key.toLowerCase().replace(/[_-]/g, ''))) {
      clean[key] = '[redacted]';
      continue;
    }
    clean[key] = value;
  }
  return clean;
}

export interface AuditEventInput {
  actor: string;
  actorType: ActorType;
  action: AuditAction;
  targetType?: string;
  targetId?: string;
  partnerId?: string;
  metadata?: Record<string, unknown>;
  correlationId?: string;
}

const AUDIT_LOG_PAGE_SIZE = 100;

export async function listRecentAuditEvents(partnerId?: string) {
  const db = getPortalDb();
  if (partnerId) {
    return db
      .select()
      .from(auditLog)
      .where(eq(auditLog.partnerId, partnerId))
      .orderBy(desc(auditLog.createdAt))
      .limit(AUDIT_LOG_PAGE_SIZE);
  }
  return db.select().from(auditLog).orderBy(desc(auditLog.createdAt)).limit(AUDIT_LOG_PAGE_SIZE);
}

export async function recordAuditEvent(event: AuditEventInput): Promise<void> {
  const db = getPortalDb();
  await db.insert(auditLog).values({
    actor: event.actor,
    actorType: event.actorType,
    action: event.action,
    targetType: event.targetType ?? null,
    targetId: event.targetId ?? null,
    partnerId: event.partnerId ?? null,
    metadata: redactMetadata(event.metadata),
    correlationId: event.correlationId ?? null,
  });
}
