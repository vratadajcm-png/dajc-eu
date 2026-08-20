// DAJC Partner Access Governance/Portal - database schema.
//
// This schema belongs ONLY to the Partner Portal (partner identity, access
// grants, invitations, admin governance, audit trail). It is a separate
// governance layer, NOT the DAJC Platform / D-ID transport core, and it
// never stores DAJC Outbound API secrets - see docs/PARTNER_PORTAL.md for
// the architectural boundary.
//
// Deny-by-default is the schema's organizing principle: every table that
// can grant something defaults to the least-privileged state (PENDING,
// SANDBOX, no rows at all for access_grants) and every privilege-widening
// transition (verify, sandbox, production, grant) is a distinct row with
// a `granted_by`/`issued_by` actor, so nothing is ever silently implied.

import { relations, sql } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  text,
  timestamp,
  pgEnum,
  uniqueIndex,
  index,
  jsonb,
  bigserial,
} from 'drizzle-orm/pg-core';

// --- Enums -----------------------------------------------------------------

export const partnerStatusEnum = pgEnum('partner_status', [
  'PENDING',
  'VERIFIED',
  'SANDBOX',
  'PRODUCTION',
  'SUSPENDED',
  'REVOKED',
]);

export const partnerContactRoleEnum = pgEnum('partner_contact_role', [
  'PARTNER_ADMIN',
  'DEVELOPER',
  'READ_ONLY',
]);

export const partnerContactStatusEnum = pgEnum('partner_contact_status', [
  'INVITED',
  'ACTIVE',
  'SUSPENDED',
  'REVOKED',
]);

export const invitationStatusEnum = pgEnum('invitation_status', [
  'PENDING',
  'ACCEPTED',
  'EXPIRED',
  'REVOKED',
]);

export const environmentEnum = pgEnum('portal_environment', ['SANDBOX', 'PRODUCTION']);

// Rotation is represented by the `rotatedAt` timestamp below, not a status
// value - rotating credentials elsewhere doesn't change whether a client
// is active, it just refreshes when it was last rotated.
export const apiClientStatusEnum = pgEnum('api_client_status', ['PENDING', 'ACTIVE', 'REVOKED']);

export const principalTypeEnum = pgEnum('portal_principal_type', ['ADMIN', 'PARTNER_CONTACT']);

export const actorTypeEnum = pgEnum('portal_actor_type', ['ADMIN', 'PARTNER_CONTACT', 'SYSTEM']);

// --- Partner registry --------------------------------------------------------

export const partners = pgTable('partner_portal_partners', {
  id: uuid('id').primaryKey().defaultRandom(),
  legalName: text('legal_name').notNull(),
  country: text('country').notNull(), // ISO 3166-1 alpha-2
  registrationId: text('registration_id').notNull(),
  vatId: text('vat_id'),
  website: text('website'),
  primaryContactName: text('primary_contact_name').notNull(),
  // Verified business email of the primary contact. Distinct from
  // partner_portal_contacts rows, which are the actual login-capable
  // people DAJC invites once the partner is approved - see section 2 of
  // docs/PARTNER_PORTAL.md for why these are kept separate.
  primaryContactEmail: text('primary_contact_email').notNull(),
  useCaseDescription: text('use_case_description').notNull(),
  requestedIntegrationType: text('requested_integration_type').notNull(),
  status: partnerStatusEnum('status').notNull().default('PENDING'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  approvedAt: timestamp('approved_at', { withTimezone: true }),
  suspendedAt: timestamp('suspended_at', { withTimezone: true }),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
});

export const partnerContacts = pgTable(
  'partner_portal_contacts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    partnerId: uuid('partner_id')
      .notNull()
      .references(() => partners.id),
    email: text('email').notNull(),
    role: partnerContactRoleEnum('role').notNull().default('DEVELOPER'),
    status: partnerContactStatusEnum('status').notNull().default('INVITED'),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('partner_contacts_partner_email_uq').on(t.partnerId, t.email)]
);

// --- Invitations --------------------------------------------------------------
//
// The raw invitation token is NEVER stored. Only a SHA-256 digest
// (`tokenHash`) is persisted; the raw token exists solely inside the email
// link and the requester's memory of it. See src/portal/lib/tokens.ts.

export const invitations = pgTable(
  'partner_portal_invitations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    partnerId: uuid('partner_id')
      .notNull()
      .references(() => partners.id),
    email: text('email').notNull(),
    tokenHash: text('token_hash').notNull(),
    issuedBy: text('issued_by').notNull(),
    issuedAt: timestamp('issued_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    status: invitationStatusEnum('status').notNull().default('PENDING'),
  },
  (t) => [uniqueIndex('partner_invitations_token_hash_uq').on(t.tokenHash)]
);

// --- Access grants --------------------------------------------------------------
//
// A grant is the ONLY thing that turns a scope into actual data access, and
// it is always scoped to one tenant/organization reference. `orders.read`
// alone never means "all DAJC data" - see section 5 of
// docs/PARTNER_PORTAL.md. Default = zero rows = zero access.

export const apiClients = pgTable('partner_portal_api_clients', {
  id: uuid('id').primaryKey().defaultRandom(),
  partnerId: uuid('partner_id')
    .notNull()
    .references(() => partners.id),
  environment: environmentEnum('environment').notNull(),
  status: apiClientStatusEnum('status').notNull().default('PENDING'),
  // Metadata registry only - this phase does not implement an OAuth
  // authorization server and never stores a client secret here. See
  // section 6 of docs/PARTNER_PORTAL.md.
  allowedScopes: text('allowed_scopes').array().notNull().default(sql`'{}'::text[]`),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  rotatedAt: timestamp('rotated_at', { withTimezone: true }),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
});

export const accessGrants = pgTable('partner_portal_access_grants', {
  id: uuid('id').primaryKey().defaultRandom(),
  partnerId: uuid('partner_id')
    .notNull()
    .references(() => partners.id),
  apiClientId: uuid('api_client_id')
    .notNull()
    .references(() => apiClients.id),
  // Opaque reference to a DAJC Platform organization/tenant. The Partner
  // Portal does not own or resolve this identifier - the DAJC Outbound API
  // Gateway is the sole authority on what it actually maps to.
  tenantRef: text('tenant_ref').notNull(),
  scope: text('scope').notNull(),
  environment: environmentEnum('environment').notNull(),
  grantedBy: text('granted_by').notNull(),
  grantedAt: timestamp('granted_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
});

// --- Auth: magic-link login tokens + sessions ------------------------------------
//
// Unified across ADMIN (allowlisted DAJC staff) and PARTNER_CONTACT
// principals so there is exactly one auth mechanism to secure, not two.
// Both login tokens and session tokens follow the same never-store-the-raw-
// value rule as invitations.

export const loginTokens = pgTable(
  'partner_portal_login_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    principalType: principalTypeEnum('principal_type').notNull(),
    // ADMIN: the allowlisted staff email. PARTNER_CONTACT: partner_portal_contacts.id.
    principalRef: text('principal_ref').notNull(),
    email: text('email').notNull(),
    tokenHash: text('token_hash').notNull(),
    issuedAt: timestamp('issued_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
  },
  (t) => [uniqueIndex('partner_login_tokens_token_hash_uq').on(t.tokenHash)]
);

export const sessions = pgTable(
  'partner_portal_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    principalType: principalTypeEnum('principal_type').notNull(),
    principalRef: text('principal_ref').notNull(),
    tokenHash: text('token_hash').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => [uniqueIndex('partner_sessions_token_hash_uq').on(t.tokenHash)]
);

// --- Rate limiting ------------------------------------------------------------
//
// DB-backed (not in-memory) because portal routes run as independent
// on-demand serverless invocations with no shared process memory - see
// src/portal/lib/rateLimit.ts.

export const rateLimitEvents = pgTable(
  'partner_portal_rate_limit_events',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    bucketKey: text('bucket_key').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('partner_rate_limit_bucket_created_idx').on(t.bucketKey, t.createdAt)]
);

// --- Audit log ------------------------------------------------------------------
//
// Append-only by convention: no update/delete helper is exposed anywhere
// in src/portal/lib/audit.ts. Hardening the DB role to REVOKE UPDATE,
// DELETE on this table is a deployment-time step tracked in
// docs/PARTNER_PORTAL.md (TODO - requires access to the Supabase project).

export const auditLog = pgTable(
  'partner_portal_audit_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    actor: text('actor').notNull(),
    actorType: actorTypeEnum('actor_type').notNull(),
    action: text('action').notNull(),
    targetType: text('target_type'),
    targetId: text('target_id'),
    partnerId: uuid('partner_id').references(() => partners.id),
    // Never put secrets or raw tokens in here - src/portal/lib/audit.ts
    // enforces a metadata key denylist as a second line of defense.
    metadata: jsonb('metadata'),
    correlationId: text('correlation_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('partner_audit_log_partner_created_idx').on(t.partnerId, t.createdAt)]
);

// --- Relations (for typed query convenience only, not authorization) --------------

export const partnersRelations = relations(partners, ({ many }) => ({
  contacts: many(partnerContacts),
  invitations: many(invitations),
  apiClients: many(apiClients),
  accessGrants: many(accessGrants),
}));

export const partnerContactsRelations = relations(partnerContacts, ({ one }) => ({
  partner: one(partners, { fields: [partnerContacts.partnerId], references: [partners.id] }),
}));

export const apiClientsRelations = relations(apiClients, ({ one, many }) => ({
  partner: one(partners, { fields: [apiClients.partnerId], references: [partners.id] }),
  accessGrants: many(accessGrants),
}));

export const accessGrantsRelations = relations(accessGrants, ({ one }) => ({
  partner: one(partners, { fields: [accessGrants.partnerId], references: [partners.id] }),
  apiClient: one(apiClients, { fields: [accessGrants.apiClientId], references: [apiClients.id] }),
}));
