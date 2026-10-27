import { z } from 'zod';
import { intelligenceSubjectSchema, type IntelligenceSubject } from './subscription-scope';

/**
 * Server-side access control for paid DAJC Intelligence and DAJC AI features built
 * on Driving Bans. Deny by default, like the Partner Portal gate:
 * 1. the product is not released (a reviewed code change is needed to release it);
 * 2. each feature also needs its environment flag set to the EXACT string "true";
 * 3. the caller needs an authenticated subject and an entitlement of the same
 *    organisation that lists the feature and has not expired.
 * Organisation identity always comes from the authenticated subject, never from
 * URL, query or body parameters. The public Driving Bans page, JSON and ICS stay
 * free and never call this module.
 */

export const DRIVING_BANS_INTELLIGENCE_FEATURES = [
  'vehicle-aware',
  'route-aware',
  'alerts',
  'history',
  'organisation-preferences',
  'ai-assistant',
] as const;
export type DrivingBansIntelligenceFeature = (typeof DRIVING_BANS_INTELLIGENCE_FEATURES)[number];

export const FEATURE_FLAG_ENV: Record<DrivingBansIntelligenceFeature, string> = {
  'vehicle-aware': 'DAJC_INTELLIGENCE_VEHICLE_AWARE_ENABLED',
  'route-aware': 'DAJC_INTELLIGENCE_ROUTE_AWARE_ENABLED',
  alerts: 'DAJC_INTELLIGENCE_ALERTS_ENABLED',
  history: 'DAJC_INTELLIGENCE_HISTORY_ENABLED',
  'organisation-preferences': 'DAJC_INTELLIGENCE_PREFERENCES_ENABLED',
  'ai-assistant': 'DAJC_AI_DRIVING_BANS_ENABLED',
};

/**
 * Intelligence Pro is not on sale. The product precondition (reliable automatic
 * article creation, editing and social distribution) comes first; flip this only
 * in a reviewed release change.
 */
export const DRIVING_BANS_INTELLIGENCE_RELEASED = false;

export function isFeatureEnabled(
  feature: DrivingBansIntelligenceFeature,
  env: Record<string, string | undefined> = process.env,
  released: boolean = DRIVING_BANS_INTELLIGENCE_RELEASED,
): boolean {
  return released === true && env[FEATURE_FLAG_ENV[feature]] === 'true';
}

export const intelligenceEntitlementSchema = z.object({
  organizationId: z.string().min(1).max(120),
  features: z.array(z.enum(DRIVING_BANS_INTELLIGENCE_FEATURES)).max(DRIVING_BANS_INTELLIGENCE_FEATURES.length),
  validUntil: z.string().datetime(),
}).strict();
export type IntelligenceEntitlement = z.infer<typeof intelligenceEntitlementSchema>;

export type AccessDecision =
  | { allowed: true; organizationId: string }
  | { allowed: false; reason: 'FEATURE_DISABLED' | 'AUTHENTICATION_REQUIRED' | 'NOT_ENTITLED' | 'TENANT_MISMATCH' };

export function authorizeFeature(args: {
  feature: DrivingBansIntelligenceFeature;
  subject: IntelligenceSubject | null | undefined;
  entitlement: IntelligenceEntitlement | null | undefined;
  now: Date;
  env?: Record<string, string | undefined>;
  released?: boolean;
}): AccessDecision {
  if (!isFeatureEnabled(args.feature, args.env, args.released)) return { allowed: false, reason: 'FEATURE_DISABLED' };
  const subject = intelligenceSubjectSchema.safeParse(args.subject);
  if (!subject.success) return { allowed: false, reason: 'AUTHENTICATION_REQUIRED' };
  const entitlement = intelligenceEntitlementSchema.safeParse(args.entitlement);
  if (!entitlement.success) return { allowed: false, reason: 'NOT_ENTITLED' };
  if (entitlement.data.organizationId !== subject.data.organizationId) return { allowed: false, reason: 'TENANT_MISMATCH' };
  if (!entitlement.data.features.includes(args.feature) || Date.parse(entitlement.data.validUntil) <= args.now.getTime()) return { allowed: false, reason: 'NOT_ENTITLED' };
  return { allowed: true, organizationId: subject.data.organizationId };
}

/** Tenant-owned data (vehicles, routes, preferences, alerts) is only returned to its own organisation. */
export function requireSameTenant<T extends { organizationId: string }>(resource: T, organizationId: string): T {
  if (resource.organizationId !== organizationId) throw new Error('Cross-tenant access denied');
  return resource;
}
export function tenantRecords<T extends { organizationId: string }>(records: T[], organizationId: string): T[] {
  return records.filter(record => record.organizationId === organizationId);
}

const STATUS: Record<Exclude<AccessDecision, { allowed: true }>['reason'], number> = {
  // A disabled feature answers like a missing route, so its existence is not disclosed.
  FEATURE_DISABLED: 404,
  AUTHENTICATION_REQUIRED: 401,
  NOT_ENTITLED: 403,
  TENANT_MISMATCH: 403,
};

/**
 * The only way a future paid endpoint may serve Driving Bans Intelligence data:
 * resolve the subject server-side, authorise, then call the handler with the
 * organisation from the subject. Query or body parameters cannot change it.
 */
export async function handleEntitledRequest(args: {
  feature: DrivingBansIntelligenceFeature;
  request: Request;
  resolveSubject: (request: Request) => Promise<IntelligenceSubject | null>;
  resolveEntitlement: (organizationId: string) => Promise<IntelligenceEntitlement | null>;
  handler: (context: { organizationId: string; subject: IntelligenceSubject; request: Request }) => Promise<unknown>;
  now?: Date;
  env?: Record<string, string | undefined>;
  released?: boolean;
}): Promise<Response> {
  const now = args.now ?? new Date();
  const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
  if (!isFeatureEnabled(args.feature, args.env, args.released)) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers });
  const subject = await args.resolveSubject(args.request);
  const entitlement = subject ? await args.resolveEntitlement(subject.organizationId) : null;
  const decision = authorizeFeature({ feature: args.feature, subject, entitlement, now, env: args.env, released: args.released });
  if (decision.allowed === false) return new Response(JSON.stringify({ error: decision.reason }), { status: STATUS[decision.reason], headers });
  const body = await args.handler({ organizationId: decision.organizationId, subject: subject!, request: args.request });
  return new Response(JSON.stringify(body), { status: 200, headers });
}
