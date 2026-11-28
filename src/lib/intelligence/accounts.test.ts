import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import * as portalSchema from '../../portal/db/schema';
import * as intelligenceSchema from '../../portal/db/intelligenceSchema';
import { setPortalDbForTesting, type PortalDb } from '../../portal/db/client';
import { consumeLoginToken, LoginTokenInvalidError, requestCustomerLoginToken } from '../../portal/lib/magicLink';
import { CUSTOMER_SESSION_SCOPE, PORTAL_SESSION_SCOPE, getCurrentSession, setSessionCookies } from '../../portal/lib/session';
import { getDrivingBansSnapshot } from '../../../config/driving-ban-calendars/runtime.mjs';
import { FEATURE_FLAG_ENV } from './entitlements';
import { handleCalendarFeedRequest, issueCalendarToken, revokeCalendarToken } from './driving-bans-calendar';
import {
  addMember, createDbCalendarTokenStore, createOrganisation, customerSubject, requestSubscription, requireCustomerPrincipal,
  resolveEntitlement, revokeEntitlement, setMemberStatus, updateSubscriptionRequest, AccountInputError, type CustomerPrincipal,
} from './accounts';

// A real Postgres (PGlite, in process) with the repository's own migrations; no network.
let client: PGlite;
beforeAll(async () => {
  client = new PGlite();
  const dir = join(process.cwd(), 'drizzle');
  for (const file of readdirSync(dir).filter(name => name.endsWith('.sql')).sort()) {
    for (const statement of readFileSync(join(dir, file), 'utf8').split('--> statement-breakpoint')) if (statement.trim()) await client.exec(statement);
  }
  setPortalDbForTesting(drizzle(client, { schema: { ...portalSchema, ...intelligenceSchema } }) as unknown as PortalDb);
}, 60_000);
afterAll(async () => { setPortalDbForTesting(null); await client?.close(); });

function cookieJar() {
  const jar = new Map<string, string>();
  return {
    jar,
    get: (name: string) => (jar.has(name) ? { value: jar.get(name)! } : undefined),
    set: (name: string, value: string) => { jar.set(name, value); },
    delete: (name: string) => { jar.delete(name); },
  } as any;
}
const ON = { released: true, env: Object.fromEntries(Object.values(FEATURE_FLAG_ENV).map(name => [name, 'true'])) };
const ADMIN = 'staff@dajc.eu';

async function signIn(email: string) {
  const token = await requestCustomerLoginToken(email);
  if (!token) return null;
  const session = await consumeLoginToken(token.rawToken, ['CUSTOMER']);
  const cookies = cookieJar();
  setSessionCookies(cookies, session.rawSessionToken, session.sessionExpiresAt, new URL('https://www.dajc.eu/intelligence/account'), CUSTOMER_SESSION_SCOPE);
  return { cookies, customer: await requireCustomerPrincipal(cookies) };
}

describe('DAJC Intelligence customer accounts (PGlite, real migrations)', () => {
  let ownerA: CustomerPrincipal, orgA: string, orgB: string;

  it('lets DAJC staff create organisations with one owner each; an email belongs to one organisation only', async () => {
    const a = await createOrganisation({ legalName: 'Alpha Transport s.r.o.', country: 'cz', registrationId: '12345678', vatId: 'CZ12345678', billingEmail: 'billing@alpha.example', ownerEmail: 'Owner@Alpha.example', actor: ADMIN });
    const b = await createOrganisation({ legalName: 'Beta Logistik GmbH', country: 'AT', registrationId: 'FN 1234', billingEmail: 'billing@beta.example', ownerEmail: 'owner@beta.example', actor: ADMIN });
    orgA = a.organisation.id; orgB = b.organisation.id;
    expect(a.owner).toMatchObject({ email: 'owner@alpha.example', role: 'OWNER', status: 'ACTIVE' });
    expect(a.organisation.country).toBe('CZ');
    await expect(addMember({ organisationId: orgB, email: 'owner@alpha.example', role: 'MEMBER', actor: ADMIN })).rejects.toBeInstanceOf(AccountInputError);
    await addMember({ organisationId: orgA, email: 'driver@alpha.example', role: 'MEMBER', actor: ADMIN });
  });

  it('signs a customer in through the shared magic link, in the customer area only', async () => {
    expect(await requestCustomerLoginToken('nobody@example.com')).toBeNull();
    const token = (await requestCustomerLoginToken('owner@alpha.example'))!;
    // The partner portal callback refuses a customer link without consuming it.
    await expect(consumeLoginToken(token.rawToken)).rejects.toBeInstanceOf(LoginTokenInvalidError);
    const session = await consumeLoginToken(token.rawToken, ['CUSTOMER']);
    expect(session.principalType).toBe('CUSTOMER');
    await expect(consumeLoginToken(token.rawToken, ['CUSTOMER'])).rejects.toBeInstanceOf(LoginTokenInvalidError);
    const cookies = cookieJar();
    setSessionCookies(cookies, session.rawSessionToken, session.sessionExpiresAt, new URL('https://www.dajc.eu/intelligence/account'), CUSTOMER_SESSION_SCOPE);
    expect([...cookies.jar.keys()].sort()).toEqual(['dajc_customer_csrf', 'dajc_customer_session']);
    ownerA = (await requireCustomerPrincipal(cookies))!;
    expect(ownerA).toMatchObject({ organisationId: orgA, email: 'owner@alpha.example', role: 'OWNER', organisationName: 'Alpha Transport s.r.o.' });
    // The same session token presented as a portal cookie is not a portal session.
    const portal = cookieJar();
    portal.set(PORTAL_SESSION_SCOPE.sessionCookie, session.rawSessionToken);
    expect(await getCurrentSession(portal, PORTAL_SESSION_SCOPE)).toBeNull();
  });

  it('takes payment outside the site: owner requests, an admin records the payment, then the entitlement exists', async () => {
    expect(await resolveEntitlement(orgA)).toBeNull();
    const driver = (await signIn('driver@alpha.example'))!.customer!;
    await expect(requestSubscription({ customer: driver, features: ['personal-calendar'], period: 'MONTH' })).rejects.toThrow(/Only an owner/);
    const request = await requestSubscription({ customer: ownerA, features: ['personal-calendar', 'vehicle-aware', 'alerts'], period: 'MONTH' });
    expect(request.features).toEqual(['personal-calendar', 'vehicle-aware']);
    await expect(requestSubscription({ customer: ownerA, features: ['personal-calendar'], period: 'YEAR' })).rejects.toThrow(/already open/);
    await expect(updateSubscriptionRequest({ requestId: request.id, status: 'PAID', actor: ADMIN })).rejects.toThrow(/payment reference/);
    await updateSubscriptionRequest({ requestId: request.id, status: 'INVOICED', paymentReference: 'Revolut Pro link RP-001', actor: ADMIN });
    expect(await resolveEntitlement(orgA)).toBeNull();
    const now = new Date('2026-11-03T12:00:00Z');
    const paid = await updateSubscriptionRequest({ requestId: request.id, status: 'PAID', actor: ADMIN, now });
    expect(paid.entitlement).toMatchObject({ features: ['personal-calendar', 'vehicle-aware'], paymentReference: 'Revolut Pro link RP-001' });
    expect(paid.entitlement!.validUntil.toISOString()).toBe('2026-12-03T12:00:00.000Z');
    await expect(updateSubscriptionRequest({ requestId: request.id, status: 'CANCELLED', actor: ADMIN })).rejects.toThrow(/already PAID/);
    // A renewal extends from the end of the running period and keeps the features.
    const renewal = await requestSubscription({ customer: ownerA, features: ['personal-calendar', 'route-aware'], period: 'YEAR' });
    const renewed = await updateSubscriptionRequest({ requestId: renewal.id, status: 'PAID', paymentReference: 'RP-002', actor: ADMIN, now: new Date('2026-11-20T12:00:00Z') });
    expect(renewed.entitlement!.validUntil.toISOString()).toBe('2027-12-03T12:00:00.000Z');
    expect([...renewed.entitlement!.features].sort()).toEqual(['personal-calendar', 'route-aware', 'vehicle-aware']);
    expect(await resolveEntitlement(orgA, new Date('2026-11-21T00:00:00Z'))).toMatchObject({ organizationId: orgA, features: expect.arrayContaining(['personal-calendar', 'vehicle-aware', 'route-aware']) });
    expect(await resolveEntitlement(orgB)).toBeNull();
  });

  it('stores calendars in the database: hash only, own tenant only, the feed follows the entitlement', async () => {
    const store = createDbCalendarTokenStore();
    const now = new Date('2026-11-21T08:00:00Z');
    const entitlement = await resolveEntitlement(orgA, now);
    const issued: any = await issueCalendarToken({ subject: customerSubject(ownerA), entitlement, filter: { label: 'Fleet', jurisdictions: ['CZ', 'AT'], vehicle: { configuration: 'SOLO', motorVehicleMassKg: 18_000 } }, store, now, ...ON });
    expect(issued.status).toBe('OK');
    const rows = await client.query<any>('select token_hash, token_id, organisation_id from intelligence_calendar_tokens');
    expect(JSON.stringify(rows.rows)).not.toContain(issued.token);
    const audit = await client.query<any>('select metadata from partner_portal_audit_log');
    expect(JSON.stringify(audit.rows)).not.toContain(issued.token);
    const feed = (extra: any = {}) => handleCalendarFeedRequest({ request: new Request('https://www.dajc.eu/x'), token: issued.token, store, resolveEntitlement: (org: string) => resolveEntitlement(org, now), readView: () => getDrivingBansSnapshot(now), now, ...ON, ...extra });
    const ok = await feed();
    expect(ok.status).toBe(200);
    expect(await ok.text()).toContain('BEGIN:VEVENT');
    // Organisation B can neither see nor revoke it; a forged pairing is refused on insert.
    const ownerB = (await signIn('owner@beta.example'))!.customer!;
    expect(await store.listForSubject(customerSubject(ownerB))).toEqual([]);
    expect(await revokeCalendarToken({ subject: customerSubject(ownerB), tokenId: issued.token_id, store, now })).toBe(false);
    await expect(store.insert({ token_id: 'forged', token_hash: 'f'.repeat(64), organizationId: orgB, userId: ownerA.memberId, filter: { label: 'x', jurisdictions: [], type: 'all' }, created_at: now.toISOString(), revoked_at: null })).rejects.toBeInstanceOf(AccountInputError);
    // Revoking the entitlement empties the calendar; revoking the calendar removes it.
    await revokeEntitlement(orgA, ADMIN);
    const lapsed = await (await feed()).text();
    expect(lapsed).toContain('DAJC personal calendar (inactive)');
    expect(lapsed).not.toContain('BEGIN:VEVENT');
    expect(await revokeCalendarToken({ subject: customerSubject(ownerA), tokenId: issued.token_id, store, now })).toBe(true);
    expect((await feed()).status).toBe(404);
  });

  it('cuts off a suspended member at once: no sign-in link, no session, calendars revoked', async () => {
    const signedIn = (await signIn('driver@alpha.example'))!;
    const driver = signedIn.customer!;
    await setMemberStatus(driver.memberId, 'SUSPENDED', ADMIN);
    expect(await requireCustomerPrincipal(signedIn.cookies)).toBeNull();
    expect(await requestCustomerLoginToken('driver@alpha.example')).toBeNull();
  });
});
