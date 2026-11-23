// DAJC Intelligence customer accounts - database schema.
//
// Customers of paid DAJC Intelligence (transport companies and their users) sign in
// through the same magic-link mechanism as the Partner Portal (principal type
// CUSTOMER in partner_portal_login_tokens / partner_portal_sessions), so there is one
// login mechanism to secure. Their organisations, members, entitlements, subscription
// requests and calendar tokens live here, apart from partner identity and grants: a
// partner never gains Intelligence access and a customer never gains partner access.
//
// Deny by default: an organisation without an active entitlement row has no paid
// feature, and no row is ever created without an admin or a recorded payment step.
// Calendar tokens follow the portal rule: only the SHA-256 of the token is stored.
import { sql } from 'drizzle-orm';
import { pgTable, uuid, text, timestamp, pgEnum, uniqueIndex, index, jsonb } from 'drizzle-orm/pg-core';

export const intelligenceOrganisationStatusEnum = pgEnum('intelligence_organisation_status', ['ACTIVE', 'SUSPENDED', 'CLOSED']);
export const intelligenceMemberRoleEnum = pgEnum('intelligence_member_role', ['OWNER', 'MEMBER']);
export const intelligenceMemberStatusEnum = pgEnum('intelligence_member_status', ['ACTIVE', 'SUSPENDED', 'REMOVED']);
export const intelligenceBillingPeriodEnum = pgEnum('intelligence_billing_period', ['MONTH', 'YEAR']);
export const intelligenceRequestStatusEnum = pgEnum('intelligence_subscription_request_status', ['REQUESTED', 'INVOICED', 'PAID', 'CANCELLED']);

export const intelligenceOrganisations = pgTable('intelligence_organisations', {
  id: uuid('id').primaryKey().defaultRandom(),
  legalName: text('legal_name').notNull(),
  country: text('country').notNull(), // ISO 3166-1 alpha-2
  registrationId: text('registration_id').notNull(),
  vatId: text('vat_id'),
  billingEmail: text('billing_email').notNull(),
  status: intelligenceOrganisationStatusEnum('status').notNull().default('ACTIVE'),
  createdBy: text('created_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// One organisation per email address, so a sign-in link always resolves to one tenant.
export const intelligenceMembers = pgTable(
  'intelligence_members',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organisationId: uuid('organisation_id').notNull().references(() => intelligenceOrganisations.id),
    email: text('email').notNull(),
    role: intelligenceMemberRoleEnum('role').notNull().default('MEMBER'),
    status: intelligenceMemberStatusEnum('status').notNull().default('ACTIVE'),
    createdBy: text('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  },
  (t) => [uniqueIndex('intelligence_members_email_uq').on(t.email), index('intelligence_members_organisation_idx').on(t.organisationId)]
);

// The paid features an organisation holds. At most one row per organisation is not
// revoked; a new grant revokes (supersedes) the previous one in the same transaction.
export const intelligenceEntitlements = pgTable(
  'intelligence_entitlements',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organisationId: uuid('organisation_id').notNull().references(() => intelligenceOrganisations.id),
    features: text('features').array().notNull().default(sql`'{}'::text[]`),
    validFrom: timestamp('valid_from', { withTimezone: true }).notNull(),
    validUntil: timestamp('valid_until', { withTimezone: true }).notNull(),
    // MANUAL: an admin recorded a payment made outside the site (e.g. a Revolut Pro
    // payment link or an invoice paid by transfer).
    source: text('source').notNull().default('MANUAL'),
    paymentReference: text('payment_reference'),
    requestId: uuid('request_id'),
    grantedBy: text('granted_by').notNull(),
    grantedAt: timestamp('granted_at', { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokedBy: text('revoked_by'),
  },
  (t) => [uniqueIndex('intelligence_entitlements_one_current_uq').on(t.organisationId).where(sql`${t.revokedAt} IS NULL`)]
);

// A customer's request to subscribe or renew; payment happens outside the site and an
// admin records it. Prices are not stored here: the payment link or invoice carries them.
export const intelligenceSubscriptionRequests = pgTable(
  'intelligence_subscription_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organisationId: uuid('organisation_id').notNull().references(() => intelligenceOrganisations.id),
    requestedBy: uuid('requested_by').notNull().references(() => intelligenceMembers.id),
    features: text('features').array().notNull(),
    period: intelligenceBillingPeriodEnum('period').notNull(),
    status: intelligenceRequestStatusEnum('status').notNull().default('REQUESTED'),
    paymentReference: text('payment_reference'),
    note: text('note'),
    decidedBy: text('decided_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('intelligence_requests_organisation_idx').on(t.organisationId, t.createdAt)]
);

// Personal calendar feeds (src/lib/intelligence/driving-bans-calendar.ts). The raw token
// exists only in the subscriber's calendar URL; only its SHA-256 is stored.
export const intelligenceCalendarTokens = pgTable(
  'intelligence_calendar_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tokenId: text('token_id').notNull(),
    tokenHash: text('token_hash').notNull(),
    organisationId: uuid('organisation_id').notNull().references(() => intelligenceOrganisations.id),
    memberId: uuid('member_id').notNull().references(() => intelligenceMembers.id),
    filter: jsonb('filter').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('intelligence_calendar_tokens_hash_uq').on(t.tokenHash),
    uniqueIndex('intelligence_calendar_tokens_id_uq').on(t.tokenId),
    index('intelligence_calendar_tokens_member_idx').on(t.organisationId, t.memberId),
  ]
);
