import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { escapeIcsText, foldLine, toIcs } from '../driving-bans/core.mjs';
import { authorizeFeature, isFeatureEnabled, type AccessDecision, type DrivingBansIntelligenceFeature, type IntelligenceEntitlement } from './entitlements';
import { intelligenceSubjectSchema, type IntelligenceSubject } from './subscription-scope';
import { monitoredJurisdictionSchema } from './preferences';
import { evaluateVehicleApplicability, matchRoadScope, vehicleQuerySchema, type PublishedEvent, type RoadScopeMatch } from './driving-bans-relevance';
import type { PublishedView } from './driving-bans-query';

/**
 * Personal Driving Bans calendar for paid DAJC Intelligence (not released, not mounted).
 *
 * Calendar apps (Google, Apple, Outlook) cannot sign in to a subscribed calendar: they only
 * fetch a URL. Access is therefore a secret URL per subscriber:
 * - the token is 256 random bits, shown once at issue; the store keeps only its SHA-256;
 * - every fetch checks the module switch, the calendar feature and the entitlement of the
 *   token's organisation again (vehicle-aware / route-aware when the filter uses them);
 * - a lapsed entitlement gets a valid, empty calendar that says why, so earlier paid events
 *   disappear from the subscriber's calendar; no pseudo-event is ever written;
 * - a revoked or unknown token answers like a missing route, and fetches per token are limited.
 *
 * The calendar is filtered by jurisdictions, restriction type, vehicle (DOES_NOT_APPLY is
 * left out, UNDETERMINED stays in and is marked) and a road corridor without times. It is
 * written by the same toIcs as the public feed. The public page, JSON and ICS stay free and
 * unchanged. Calendar apps refresh slowly (Google about every 12–24 h, Outlook irregularly),
 * so urgent changes need alerts as well.
 */

export const CALENDAR_TOKEN_PREFIX = 'dcal_';
const TOKEN_PATTERN = /^dcal_[A-Za-z0-9_-]{43}$/;
export const MAX_ACTIVE_CALENDARS_PER_USER = 10;
export const DEFAULT_MAX_FETCHES_PER_HOUR = 60;

const corridorSegmentSchema = z.object({
  jurisdiction: monitoredJurisdictionSchema,
  region: z.string().min(1).max(120).optional(),
  roads: z.array(z.string().min(1).max(80)).max(50).default([]),
}).strict();

export const calendarFilterSchema = z.object({
  label: z.string().trim().min(1).max(80),
  jurisdictions: z.array(monitoredJurisdictionSchema).max(50).refine(values => new Set(values).size === values.length, 'Duplicate jurisdiction').default([]),
  type: z.enum(['all', 'general', 'exceptional']).default('all'),
  vehicle: vehicleQuerySchema.optional(),
  corridor: z.array(corridorSegmentSchema).min(1).max(100).optional(),
}).strict();
export type CalendarFilter = z.infer<typeof calendarFilterSchema>;

export type CalendarTokenRecord = {
  token_id: string;
  token_hash: string;
  organizationId: string;
  userId: string;
  filter: CalendarFilter;
  created_at: string;
  revoked_at: string | null;
};

/** Persistence contract; a database adapter implements the same methods. Only hashes are stored. */
export interface CalendarTokenStore {
  insert(record: CalendarTokenRecord): Promise<void>;
  findByHash(tokenHash: string): Promise<CalendarTokenRecord | null>;
  listForSubject(subject: IntelligenceSubject): Promise<CalendarTokenRecord[]>;
  revoke(subject: IntelligenceSubject, tokenId: string, at: string): Promise<boolean>;
  /** Counts one fetch in the given window and returns the count so far. */
  countFetch(tokenHash: string, windowKey: string): Promise<number>;
}

/** Demo/test-only store; it applies the same ownership rules a database adapter must. */
export function createMemoryCalendarTokenStore(): CalendarTokenStore & { records: () => CalendarTokenRecord[] } {
  const records = new Map<string, CalendarTokenRecord>();
  const fetches = new Map<string, number>();
  const own = (record: CalendarTokenRecord, subject: IntelligenceSubject) => record.organizationId === subject.organizationId && record.userId === subject.userId;
  return {
    async insert(record) { records.set(record.token_hash, structuredClone(record)); },
    async findByHash(tokenHash) { const record = records.get(tokenHash); return record ? structuredClone(record) : null; },
    async listForSubject(subject) { return [...records.values()].filter(record => own(record, subject)).map(record => structuredClone(record)); },
    async revoke(subject, tokenId, at) {
      const record = [...records.values()].find(item => item.token_id === tokenId && own(item, subject));
      if (!record || record.revoked_at) return false;
      record.revoked_at = at;
      return true;
    },
    async countFetch(tokenHash, windowKey) { const key = `${tokenHash}:${windowKey}`; const count = (fetches.get(key) ?? 0) + 1; fetches.set(key, count); return count; },
    records: () => [...records.values()].map(record => structuredClone(record)),
  };
}

export const hashCalendarToken = (token: string) => createHash('sha256').update(token).digest('hex');

/** The entitlements a filter needs: the calendar itself, plus vehicle-aware and route-aware when it uses them. */
export function calendarFeatures(filter: CalendarFilter): DrivingBansIntelligenceFeature[] {
  return ['personal-calendar', ...(filter.vehicle ? ['vehicle-aware' as const] : []), ...(filter.corridor ? ['route-aware' as const] : [])];
}

type Access = { now: Date; env?: Record<string, string | undefined>; released?: boolean };

/** Module switch first (nothing is disclosed while it is off), then every feature the filter needs. */
function authorizeCalendar(features: DrivingBansIntelligenceFeature[], subject: IntelligenceSubject | null | undefined, entitlement: IntelligenceEntitlement | null | undefined, access: Access): AccessDecision {
  if (!isFeatureEnabled('driving-bans-query', access.env, access.released) || !isFeatureEnabled('personal-calendar', access.env, access.released)) return { allowed: false, reason: 'FEATURE_DISABLED' };
  let decision: AccessDecision = { allowed: false, reason: 'NOT_ENTITLED' };
  for (const feature of features) {
    decision = authorizeFeature({ feature, subject, entitlement, now: access.now, env: access.env, released: access.released });
    if (decision.allowed === false) return decision;
  }
  return decision;
}

/**
 * Issue a personal calendar for the authenticated subject. The token is returned once and
 * never stored; the URL is for a future route (nothing mounts it yet).
 */
export async function issueCalendarToken(args: Access & {
  subject: IntelligenceSubject | null | undefined;
  entitlement: IntelligenceEntitlement | null | undefined;
  filter: unknown;
  store: CalendarTokenStore;
  baseUrl?: string;
}) {
  const filter = calendarFilterSchema.parse(args.filter);
  const access = authorizeCalendar(calendarFeatures(filter), args.subject, args.entitlement, args);
  if (access.allowed === false) return { status: access.reason } as const;
  const subject = intelligenceSubjectSchema.parse(args.subject);
  const active = (await args.store.listForSubject(subject)).filter(record => !record.revoked_at);
  if (active.length >= MAX_ACTIVE_CALENDARS_PER_USER) return { status: 'TOO_MANY_CALENDARS' } as const;
  const token = `${CALENDAR_TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`;
  const tokenHash = hashCalendarToken(token);
  const record: CalendarTokenRecord = { token_id: tokenHash.slice(0, 12), token_hash: tokenHash, organizationId: subject.organizationId, userId: subject.userId, filter, created_at: args.now.toISOString(), revoked_at: null };
  await args.store.insert(record);
  return { status: 'OK', token, token_id: record.token_id, url: `${args.baseUrl ?? 'https://www.dajc.eu'}/api/intelligence/calendar/${token}.ics`, filter } as const;
}

/** Revoke one of the subject's own calendars; allowed without an entitlement, so a former subscriber can always revoke. */
export async function revokeCalendarToken(args: { subject: IntelligenceSubject; tokenId: string; store: CalendarTokenStore; now: Date }) {
  return args.store.revoke(intelligenceSubjectSchema.parse(args.subject), args.tokenId, args.now.toISOString());
}

type CalendarView = PublishedView & { upcoming_events: PublishedEvent[] };
const MATCH_NOTE: Record<RoadScopeMatch, string> = {
  NETWORK_WIDE: 'Corridor: the rule covers the whole network of the jurisdiction.',
  ROAD_CLASS_SCOPE: 'Corridor: the rule applies to a road class; check that your roads belong to it.',
  ROAD_MATCH: 'Corridor: the rule names a road of your corridor.',
  ROADS_NOT_SPECIFIED_BY_ROUTE: 'Corridor: your corridor names no roads here; check the roads of the rule.',
};

/** One event of the personal calendar, or null when the filter leaves it out. */
function personalEvent(event: PublishedEvent & { notes?: string }, filter: CalendarFilter) {
  if (filter.jurisdictions.length && !filter.jurisdictions.includes(event.jurisdiction)) return null;
  const matches = filter.corridor ? filter.corridor.map(segment => matchRoadScope(event, segment)).filter((match): match is RoadScopeMatch => match !== null) : [];
  if (filter.corridor && !matches.length) return null;
  const vehicle = filter.vehicle ? evaluateVehicleApplicability(event, filter.vehicle) : null;
  if (vehicle?.status === 'DOES_NOT_APPLY') return null;
  const order: RoadScopeMatch[] = ['ROAD_MATCH', 'NETWORK_WIDE', 'ROAD_CLASS_SCOPE', 'ROADS_NOT_SPECIFIED_BY_ROUTE'];
  const best = order.find(match => matches.includes(match));
  const notes = [
    event.notes,
    vehicle?.status === 'UNDETERMINED' ? `Vehicle: it could not be determined whether this ban applies to your vehicle (${vehicle.reasons.join('; ')}). Treat it as applying until checked.` : vehicle ? 'Vehicle: the legal criteria of this ban apply to your vehicle profile.' : null,
    ...(vehicle?.notes ?? []),
    best ? MATCH_NOTE[best] : null,
    'Exceptions are not evaluated automatically.',
  ].filter(Boolean).join('\n');
  return { ...event, title: vehicle?.status === 'UNDETERMINED' ? `${event.title} (check vehicle)` : event.title, notes };
}

/** The published view reduced to the subscriber's calendar. */
export function personalCalendarView(view: CalendarView, filter: CalendarFilter): CalendarView {
  const select = (events: PublishedEvent[]) => events.map(event => personalEvent(event, filter)).filter((event): event is NonNullable<typeof event> => event !== null);
  return { ...view, events: select(view.events), upcoming_events: select(view.upcoming_events) };
}

/** A valid calendar without events that says why; the subscriber's earlier events disappear. */
function inactiveCalendar(reason: string) {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//DAJC//Personal Driving Bans//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:DAJC personal calendar (inactive)',
    `X-WR-CALDESC:${escapeIcsText(`This personal calendar receives no Driving Bans data: ${reason}. The free public calendar is at https://www.dajc.eu/driving-bans.`)}`,
    'REFRESH-INTERVAL;VALUE=DURATION:PT12H', 'X-PUBLISHED-TTL:PT12H', 'END:VCALENDAR'];
  return lines.map(foldLine).join('\r\n') + '\r\n';
}

const INACTIVE_REASON: Record<Exclude<AccessDecision, { allowed: true }>['reason'], string> = {
  FEATURE_DISABLED: 'the service is not available',
  AUTHENTICATION_REQUIRED: 'the subscription could not be verified',
  NOT_ENTITLED: 'the subscription has ended or does not include this calendar',
  TENANT_MISMATCH: 'the subscription could not be verified',
};

const CALENDAR_HEADERS = { 'Content-Type': 'text/calendar; charset=utf-8', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'X-Robots-Tag': 'noindex, nofollow', 'Referrer-Policy': 'no-referrer' };
const notFound = () => new Response('Not found', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });

/**
 * Handler for a future GET /api/intelligence/calendar/{token}.ics route. The organisation
 * comes from the stored token, never from the request; its entitlement is checked per fetch.
 */
export async function handleCalendarFeedRequest(args: Access & {
  request: Request;
  token: string | undefined;
  store: CalendarTokenStore;
  resolveEntitlement: (organizationId: string) => Promise<IntelligenceEntitlement | null>;
  readView: (now: Date) => CalendarView;
  maxFetchesPerHour?: number;
}): Promise<Response> {
  // While the module or the calendar is off, nothing is looked up and nothing is disclosed.
  if (!isFeatureEnabled('driving-bans-query', args.env, args.released) || !isFeatureEnabled('personal-calendar', args.env, args.released)) return notFound();
  if (args.request.method !== 'GET' && args.request.method !== 'HEAD') return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD', 'Cache-Control': 'no-store' } });
  const token = args.token?.replace(/\.ics$/, '');
  if (!token || !TOKEN_PATTERN.test(token)) return notFound();
  const tokenHash = hashCalendarToken(token);
  const record = await args.store.findByHash(tokenHash);
  if (!record || record.revoked_at) return notFound();
  const fetches = await args.store.countFetch(tokenHash, args.now.toISOString().slice(0, 13));
  if (fetches > (args.maxFetchesPerHour ?? DEFAULT_MAX_FETCHES_PER_HOUR)) return new Response('Too many requests', { status: 429, headers: { 'Retry-After': '3600', 'Cache-Control': 'no-store' } });
  const subject = { organizationId: record.organizationId, userId: record.userId };
  const entitlement = await args.resolveEntitlement(record.organizationId);
  const access = authorizeCalendar(calendarFeatures(record.filter), subject, entitlement, args);
  const body = access.allowed === false
    ? inactiveCalendar(INACTIVE_REASON[access.reason])
    : (() => {
      const filter = record.filter;
      const countries = filter.jurisdictions.length ? filter.jurisdictions : filter.corridor ? [...new Set(filter.corridor.map(segment => segment.jurisdiction))] : [];
      return toIcs(personalCalendarView(args.readView(args.now), filter), { countries, type: filter.type, upcoming: true, name: `DAJC Driving Bans – ${filter.label}` });
    })();
  return new Response(args.request.method === 'HEAD' ? null : body, { status: 200, headers: { ...CALENDAR_HEADERS, 'Content-Disposition': 'inline; filename="dajc-personal-driving-bans.ics"' } });
}
