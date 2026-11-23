import type { AstroCookies } from 'astro';
import { and, desc, eq, gte, inArray, isNull, sql } from 'drizzle-orm';
import { getPortalDb } from '../../portal/db/client';
import { rateLimitEvents } from '../../portal/db/schema';
import { intelligenceCalendarTokens, intelligenceEntitlements, intelligenceMembers, intelligenceOrganisations, intelligenceSubscriptionRequests } from '../../portal/db/intelligenceSchema';
import { recordAuditEvent } from '../../portal/lib/audit';
import { CUSTOMER_SESSION_SCOPE, getCurrentSession } from '../../portal/lib/session';
import { DRIVING_BANS_INTELLIGENCE_FEATURES, intelligenceEntitlementSchema, type DrivingBansIntelligenceFeature, type IntelligenceEntitlement } from './entitlements';
import { calendarFilterSchema, type CalendarTokenRecord, type CalendarTokenStore } from './driving-bans-calendar';
import type { IntelligenceSubject } from './subscription-scope';

/**
 * DAJC Intelligence customer accounts over the Partner Portal database and login
 * (principal CUSTOMER). Not released: every page that uses this module checks
 * isIntelligenceAccountsEnabled() first.
 *
 * - DAJC staff (portal admins) create organisations and their members; there is no
 *   public sign-up. A member signs in with a magic link and acts only for its own
 *   organisation, which always comes from the session, never from a request.
 * - Payment happens outside the site (for example a Revolut Pro payment link or an
 *   invoice paid by transfer). An owner requests a subscription; an admin records the
 *   payment, and only then an entitlement exists. No price is stored here.
 * - An organisation has at most one current entitlement; a new grant supersedes it.
 */

/** The features a customer can subscribe to today (the personal calendar and its filters). */
export const SUBSCRIBABLE_FEATURES = ['personal-calendar', 'vehicle-aware', 'route-aware'] as const satisfies readonly DrivingBansIntelligenceFeature[];
export type BillingPeriod = 'MONTH' | 'YEAR';

const normaliseEmail = (email: string) => email.trim().toLowerCase();
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const COUNTRY = /^[A-Z]{2}$/;
const knownFeatures = (features: readonly string[]) => [...new Set(features)].filter((f): f is DrivingBansIntelligenceFeature => (DRIVING_BANS_INTELLIGENCE_FEATURES as readonly string[]).includes(f));

export class AccountInputError extends Error {
  constructor(message: string) { super(message); this.name = 'AccountInputError'; }
}
function ensure(condition: unknown, message: string): asserts condition { if (!condition) throw new AccountInputError(message); }

// --- Organisations and members (DAJC staff) -------------------------------------

export async function createOrganisation(args: { legalName: string; country: string; registrationId: string; vatId?: string | null; billingEmail: string; ownerEmail: string; actor: string }) {
  const legalName = args.legalName.trim(), country = args.country.trim().toUpperCase(), registrationId = args.registrationId.trim();
  const billingEmail = normaliseEmail(args.billingEmail), ownerEmail = normaliseEmail(args.ownerEmail);
  ensure(legalName && legalName.length <= 200, 'Legal name is required');
  ensure(COUNTRY.test(country), 'Country must be an ISO 3166-1 alpha-2 code');
  ensure(registrationId && registrationId.length <= 80, 'Registration ID is required');
  ensure(EMAIL.test(billingEmail) && EMAIL.test(ownerEmail), 'Valid billing and owner emails are required');
  const db = getPortalDb();
  const created = await db.transaction(async (tx) => {
    const [taken] = await tx.select({ id: intelligenceMembers.id }).from(intelligenceMembers).where(eq(intelligenceMembers.email, ownerEmail)).limit(1);
    ensure(!taken, 'This email already belongs to a customer organisation');
    const [organisation] = await tx.insert(intelligenceOrganisations).values({ legalName, country, registrationId, vatId: args.vatId?.trim() || null, billingEmail, createdBy: args.actor }).returning();
    const [owner] = await tx.insert(intelligenceMembers).values({ organisationId: organisation.id, email: ownerEmail, role: 'OWNER', createdBy: args.actor }).returning();
    return { organisation, owner };
  });
  await recordAuditEvent({ actor: args.actor, actorType: 'ADMIN', action: 'intelligence.organisation_created', targetType: 'intelligence_organisation', targetId: created.organisation.id, metadata: { country, owner: ownerEmail } });
  return created;
}

export async function listOrganisations() {
  const db = getPortalDb();
  const organisations = await db.select().from(intelligenceOrganisations).orderBy(desc(intelligenceOrganisations.createdAt)).limit(500);
  const current = organisations.length ? await db.select().from(intelligenceEntitlements).where(and(inArray(intelligenceEntitlements.organisationId, organisations.map(o => o.id)), isNull(intelligenceEntitlements.revokedAt))) : [];
  return organisations.map(organisation => ({ ...organisation, entitlement: current.find(row => row.organisationId === organisation.id) ?? null }));
}

export async function getOrganisationDetail(organisationId: string) {
  const db = getPortalDb();
  const [organisation] = await db.select().from(intelligenceOrganisations).where(eq(intelligenceOrganisations.id, organisationId)).limit(1);
  if (!organisation) return null;
  const [members, entitlements, requests, calendars] = await Promise.all([
    db.select().from(intelligenceMembers).where(eq(intelligenceMembers.organisationId, organisationId)).orderBy(intelligenceMembers.createdAt),
    db.select().from(intelligenceEntitlements).where(eq(intelligenceEntitlements.organisationId, organisationId)).orderBy(desc(intelligenceEntitlements.grantedAt)).limit(20),
    db.select().from(intelligenceSubscriptionRequests).where(eq(intelligenceSubscriptionRequests.organisationId, organisationId)).orderBy(desc(intelligenceSubscriptionRequests.createdAt)).limit(20),
    db.select({ count: sql<number>`count(*)::int` }).from(intelligenceCalendarTokens).where(and(eq(intelligenceCalendarTokens.organisationId, organisationId), isNull(intelligenceCalendarTokens.revokedAt))),
  ]);
  return { organisation, members, entitlements, requests, activeCalendars: calendars[0]?.count ?? 0 };
}

export async function setOrganisationStatus(organisationId: string, status: 'ACTIVE' | 'SUSPENDED' | 'CLOSED', actor: string) {
  ensure(['ACTIVE', 'SUSPENDED', 'CLOSED'].includes(status), 'Unknown status');
  const db = getPortalDb();
  const updated = await db.update(intelligenceOrganisations).set({ status, updatedAt: new Date() }).where(eq(intelligenceOrganisations.id, organisationId)).returning({ id: intelligenceOrganisations.id });
  ensure(updated.length, 'Organisation not found');
  await recordAuditEvent({ actor, actorType: 'ADMIN', action: 'intelligence.organisation_status_changed', targetType: 'intelligence_organisation', targetId: organisationId, metadata: { status } });
}

export async function addMember(args: { organisationId: string; email: string; role: 'OWNER' | 'MEMBER'; actor: string }) {
  const email = normaliseEmail(args.email);
  ensure(EMAIL.test(email), 'Valid email is required');
  ensure(args.role === 'OWNER' || args.role === 'MEMBER', 'Unknown role');
  const db = getPortalDb();
  const [taken] = await db.select({ id: intelligenceMembers.id }).from(intelligenceMembers).where(eq(intelligenceMembers.email, email)).limit(1);
  ensure(!taken, 'This email already belongs to a customer organisation');
  const [member] = await db.insert(intelligenceMembers).values({ organisationId: args.organisationId, email, role: args.role, createdBy: args.actor }).returning();
  await recordAuditEvent({ actor: args.actor, actorType: 'ADMIN', action: 'intelligence.member_added', targetType: 'intelligence_member', targetId: member.id, metadata: { organisation: args.organisationId, role: args.role } });
  return member;
}

export async function setMemberStatus(memberId: string, status: 'ACTIVE' | 'SUSPENDED' | 'REMOVED', actor: string) {
  ensure(['ACTIVE', 'SUSPENDED', 'REMOVED'].includes(status), 'Unknown status');
  const db = getPortalDb();
  const updated = await db.update(intelligenceMembers).set({ status }).where(eq(intelligenceMembers.id, memberId)).returning({ id: intelligenceMembers.id, organisationId: intelligenceMembers.organisationId });
  ensure(updated.length, 'Member not found');
  // A member who leaves takes their calendars along: their URLs stop working.
  if (status !== 'ACTIVE') await db.update(intelligenceCalendarTokens).set({ revokedAt: new Date() }).where(and(eq(intelligenceCalendarTokens.memberId, memberId), isNull(intelligenceCalendarTokens.revokedAt)));
  await recordAuditEvent({ actor, actorType: 'ADMIN', action: 'intelligence.member_status_changed', targetType: 'intelligence_member', targetId: memberId, metadata: { organisation: updated[0].organisationId, status } });
}

// --- Entitlements -----------------------------------------------------------------

const addPeriod = (from: Date, period: BillingPeriod) => { const next = new Date(from); if (period === 'YEAR') next.setUTCFullYear(next.getUTCFullYear() + 1); else next.setUTCMonth(next.getUTCMonth() + 1); return next; };

type Executor = ReturnType<typeof getPortalDb>;

async function writeEntitlement(tx: Executor, args: { organisationId: string; features: string[]; validFrom: Date; validUntil: Date; paymentReference?: string | null; requestId?: string | null; actor: string }) {
  const now = new Date();
  await tx.update(intelligenceEntitlements).set({ revokedAt: now, revokedBy: `${args.actor} (superseded)` }).where(and(eq(intelligenceEntitlements.organisationId, args.organisationId), isNull(intelligenceEntitlements.revokedAt)));
  const [row] = await tx.insert(intelligenceEntitlements).values({ organisationId: args.organisationId, features: knownFeatures(args.features), validFrom: args.validFrom, validUntil: args.validUntil, paymentReference: args.paymentReference?.trim() || null, requestId: args.requestId ?? null, grantedBy: args.actor }).returning();
  return row;
}

/** An admin grants features for a period, e.g. after a payment made outside the site. */
export async function grantEntitlement(args: { organisationId: string; features: string[]; validFrom: Date; validUntil: Date; paymentReference?: string | null; actor: string }) {
  ensure(knownFeatures(args.features).length, 'Choose at least one feature');
  ensure(args.validFrom < args.validUntil, 'The entitlement must end after it starts');
  const db = getPortalDb();
  const row = await db.transaction(tx => writeEntitlement(tx as unknown as Executor, args));
  await recordAuditEvent({ actor: args.actor, actorType: 'ADMIN', action: 'intelligence.entitlement_granted', targetType: 'intelligence_organisation', targetId: args.organisationId, metadata: { features: row.features, valid_until: row.validUntil.toISOString(), payment_reference: row.paymentReference } });
  return row;
}

export async function revokeEntitlement(organisationId: string, actor: string) {
  const db = getPortalDb();
  const revoked = await db.update(intelligenceEntitlements).set({ revokedAt: new Date(), revokedBy: actor }).where(and(eq(intelligenceEntitlements.organisationId, organisationId), isNull(intelligenceEntitlements.revokedAt))).returning({ id: intelligenceEntitlements.id });
  if (revoked.length) await recordAuditEvent({ actor, actorType: 'ADMIN', action: 'intelligence.entitlement_revoked', targetType: 'intelligence_organisation', targetId: organisationId });
  return revoked.length > 0;
}

/**
 * The organisation's entitlement in the shape authorizeFeature checks, or null: only an
 * active organisation, a current (not revoked) row, and from its start date. Expiry is
 * left to authorizeFeature, so a lapsed subscription reads as NOT_ENTITLED.
 */
export async function resolveEntitlement(organisationId: string, now = new Date()): Promise<IntelligenceEntitlement | null> {
  const db = getPortalDb();
  const [row] = await db
    .select({ features: intelligenceEntitlements.features, validFrom: intelligenceEntitlements.validFrom, validUntil: intelligenceEntitlements.validUntil, status: intelligenceOrganisations.status })
    .from(intelligenceEntitlements)
    .innerJoin(intelligenceOrganisations, eq(intelligenceOrganisations.id, intelligenceEntitlements.organisationId))
    .where(and(eq(intelligenceEntitlements.organisationId, organisationId), isNull(intelligenceEntitlements.revokedAt)))
    .limit(1);
  if (!row || row.status !== 'ACTIVE' || row.validFrom.getTime() > now.getTime()) return null;
  const parsed = intelligenceEntitlementSchema.safeParse({ organizationId: organisationId, features: knownFeatures(row.features), validUntil: row.validUntil.toISOString() });
  return parsed.success ? parsed.data : null;
}

// --- Subscription requests and manual payments ------------------------------------------

/** An owner asks for a subscription or a renewal; one open request per organisation. */
export async function requestSubscription(args: { customer: CustomerPrincipal; features: string[]; period: BillingPeriod; note?: string | null }) {
  ensure(args.customer.role === 'OWNER', 'Only an owner of the organisation can request a subscription');
  const features = [...new Set(args.features)].filter(f => (SUBSCRIBABLE_FEATURES as readonly string[]).includes(f));
  ensure(features.length && features.includes('personal-calendar'), 'Choose the calendar and any filters you need');
  ensure(args.period === 'MONTH' || args.period === 'YEAR', 'Choose a billing period');
  const db = getPortalDb();
  const [open] = await db.select({ id: intelligenceSubscriptionRequests.id }).from(intelligenceSubscriptionRequests).where(and(eq(intelligenceSubscriptionRequests.organisationId, args.customer.organisationId), inArray(intelligenceSubscriptionRequests.status, ['REQUESTED', 'INVOICED']))).limit(1);
  ensure(!open, 'A request is already open; DAJC will send the payment details');
  const [row] = await db.insert(intelligenceSubscriptionRequests).values({ organisationId: args.customer.organisationId, requestedBy: args.customer.memberId, features, period: args.period, note: args.note?.trim().slice(0, 500) || null }).returning();
  await recordAuditEvent({ actor: args.customer.email, actorType: 'CUSTOMER', action: 'intelligence.subscription_requested', targetType: 'intelligence_subscription_request', targetId: row.id, metadata: { organisation: args.customer.organisationId, features, period: args.period } });
  return row;
}

export async function listSubscriptionRequests(organisationId: string) {
  const db = getPortalDb();
  return db.select().from(intelligenceSubscriptionRequests).where(eq(intelligenceSubscriptionRequests.organisationId, organisationId)).orderBy(desc(intelligenceSubscriptionRequests.createdAt)).limit(20);
}

export async function listOpenSubscriptionRequests() {
  const db = getPortalDb();
  return db.select({ request: intelligenceSubscriptionRequests, legalName: intelligenceOrganisations.legalName })
    .from(intelligenceSubscriptionRequests)
    .innerJoin(intelligenceOrganisations, eq(intelligenceOrganisations.id, intelligenceSubscriptionRequests.organisationId))
    .where(inArray(intelligenceSubscriptionRequests.status, ['REQUESTED', 'INVOICED']))
    .orderBy(intelligenceSubscriptionRequests.createdAt);
}

/**
 * An admin moves a request on: INVOICED once the payment link or invoice is sent,
 * PAID once the payment arrived (this grants or extends the entitlement), or CANCELLED.
 */
export async function updateSubscriptionRequest(args: { requestId: string; status: 'INVOICED' | 'PAID' | 'CANCELLED'; paymentReference?: string | null; actor: string; now?: Date }) {
  const now = args.now ?? new Date();
  const db = getPortalDb();
  const result = await db.transaction(async (tx) => {
    const [request] = await tx.select().from(intelligenceSubscriptionRequests).where(eq(intelligenceSubscriptionRequests.id, args.requestId)).limit(1);
    ensure(request, 'Request not found');
    ensure(request.status === 'REQUESTED' || request.status === 'INVOICED', `The request is already ${request.status}`);
    ensure(args.status !== 'PAID' || args.paymentReference?.trim() || request.paymentReference, 'Record the payment reference before marking the request paid');
    const paymentReference = args.paymentReference?.trim() || request.paymentReference;
    const updated = await tx.update(intelligenceSubscriptionRequests)
      .set({ status: args.status, paymentReference, decidedBy: args.actor, updatedAt: now })
      .where(and(eq(intelligenceSubscriptionRequests.id, request.id), inArray(intelligenceSubscriptionRequests.status, ['REQUESTED', 'INVOICED'])))
      .returning({ id: intelligenceSubscriptionRequests.id });
    ensure(updated.length, 'The request changed meanwhile');
    if (args.status !== 'PAID') return { request, entitlement: null };
    // A renewal extends a running subscription; otherwise the period starts now.
    const [current] = await tx.select().from(intelligenceEntitlements).where(and(eq(intelligenceEntitlements.organisationId, request.organisationId), isNull(intelligenceEntitlements.revokedAt))).limit(1);
    const running = current && current.validUntil.getTime() > now.getTime() && current.validFrom.getTime() <= now.getTime();
    const entitlement = await writeEntitlement(tx as unknown as Executor, {
      organisationId: request.organisationId,
      features: running ? [...current.features, ...request.features] : request.features,
      validFrom: running ? current.validFrom : now,
      validUntil: addPeriod(running ? current.validUntil : now, request.period),
      paymentReference, requestId: request.id, actor: args.actor,
    });
    return { request, entitlement };
  });
  await recordAuditEvent({ actor: args.actor, actorType: 'ADMIN', action: 'intelligence.subscription_request_updated', targetType: 'intelligence_subscription_request', targetId: args.requestId, metadata: { status: args.status, organisation: result.request.organisationId } });
  if (result.entitlement) await recordAuditEvent({ actor: args.actor, actorType: 'ADMIN', action: 'intelligence.entitlement_granted', targetType: 'intelligence_organisation', targetId: result.request.organisationId, metadata: { features: result.entitlement.features, valid_until: result.entitlement.validUntil.toISOString(), request: args.requestId } });
  return result;
}

// --- Customer principal -----------------------------------------------------------------

export interface CustomerPrincipal {
  type: 'CUSTOMER';
  memberId: string;
  organisationId: string;
  organisationName: string;
  email: string;
  role: 'OWNER' | 'MEMBER';
}

/** The signed-in customer, only while the member and the organisation are active. */
export async function requireCustomerPrincipal(cookies: AstroCookies): Promise<CustomerPrincipal | null> {
  const session = await getCurrentSession(cookies, CUSTOMER_SESSION_SCOPE);
  if (!session || session.principalType !== 'CUSTOMER') return null;
  const db = getPortalDb();
  const [row] = await db
    .select({ member: intelligenceMembers, organisation: intelligenceOrganisations })
    .from(intelligenceMembers)
    .innerJoin(intelligenceOrganisations, eq(intelligenceOrganisations.id, intelligenceMembers.organisationId))
    .where(eq(intelligenceMembers.id, session.principalRef))
    .limit(1);
  if (!row || row.member.status !== 'ACTIVE' || row.organisation.status !== 'ACTIVE') return null;
  return { type: 'CUSTOMER', memberId: row.member.id, organisationId: row.organisation.id, organisationName: row.organisation.legalName, email: row.member.email, role: row.member.role };
}

export const customerSubject = (customer: CustomerPrincipal): IntelligenceSubject => ({ organizationId: customer.organisationId, userId: customer.memberId });

// --- Calendar tokens (CalendarTokenStore in the database) ------------------------------------

const toRecord = (row: typeof intelligenceCalendarTokens.$inferSelect): CalendarTokenRecord => ({
  token_id: row.tokenId, token_hash: row.tokenHash, organizationId: row.organisationId, userId: row.memberId,
  filter: calendarFilterSchema.parse(row.filter), created_at: row.createdAt.toISOString(), revoked_at: row.revokedAt?.toISOString() ?? null,
});

/** The database CalendarTokenStore; ownership is always organisation and member together. */
export function createDbCalendarTokenStore(): CalendarTokenStore {
  return {
    async insert(record) {
      const db = getPortalDb();
      const [member] = await db.select({ id: intelligenceMembers.id }).from(intelligenceMembers).where(and(eq(intelligenceMembers.id, record.userId), eq(intelligenceMembers.organisationId, record.organizationId), eq(intelligenceMembers.status, 'ACTIVE'))).limit(1);
      if (!member) throw new AccountInputError('The member does not belong to this organisation');
      await db.insert(intelligenceCalendarTokens).values({ tokenId: record.token_id, tokenHash: record.token_hash, organisationId: record.organizationId, memberId: record.userId, filter: record.filter, createdAt: new Date(record.created_at) });
      await recordAuditEvent({ actor: record.userId, actorType: 'CUSTOMER', action: 'intelligence.calendar_issued', targetType: 'intelligence_calendar', targetId: record.token_id, metadata: { organisation: record.organizationId, label: record.filter.label } });
    },
    async findByHash(tokenHash) {
      const db = getPortalDb();
      const [row] = await db.select().from(intelligenceCalendarTokens).where(eq(intelligenceCalendarTokens.tokenHash, tokenHash)).limit(1);
      return row ? toRecord(row) : null;
    },
    async listForSubject(subject) {
      const db = getPortalDb();
      const rows = await db.select().from(intelligenceCalendarTokens).where(and(eq(intelligenceCalendarTokens.organisationId, subject.organizationId), eq(intelligenceCalendarTokens.memberId, subject.userId))).orderBy(desc(intelligenceCalendarTokens.createdAt)).limit(100);
      return rows.map(toRecord);
    },
    async revoke(subject, tokenId, at) {
      const db = getPortalDb();
      const revoked = await db.update(intelligenceCalendarTokens).set({ revokedAt: new Date(at) })
        .where(and(eq(intelligenceCalendarTokens.tokenId, tokenId), eq(intelligenceCalendarTokens.organisationId, subject.organizationId), eq(intelligenceCalendarTokens.memberId, subject.userId), isNull(intelligenceCalendarTokens.revokedAt)))
        .returning({ id: intelligenceCalendarTokens.id });
      if (revoked.length) await recordAuditEvent({ actor: subject.userId, actorType: 'CUSTOMER', action: 'intelligence.calendar_revoked', targetType: 'intelligence_calendar', targetId: tokenId, metadata: { organisation: subject.organizationId } });
      return revoked.length > 0;
    },
    // Shared table with the portal's rate limits; the bucket carries a hash prefix, never the token.
    async countFetch(tokenHash, windowKey) {
      const db = getPortalDb();
      const bucketKey = `intelligence_calendar:${tokenHash.slice(0, 16)}:${windowKey}`;
      await db.insert(rateLimitEvents).values({ bucketKey });
      const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(rateLimitEvents).where(and(eq(rateLimitEvents.bucketKey, bucketKey), gte(rateLimitEvents.createdAt, new Date(Date.now() - 2 * 3600_000))));
      return count;
    },
  };
}
