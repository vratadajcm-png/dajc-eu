import { ZodError } from 'zod';
import { authorizeFeature, isFeatureEnabled, type DrivingBansIntelligenceFeature, type IntelligenceEntitlement } from './entitlements';
import type { IntelligenceSubject } from './subscription-scope';
import { canCreateDerivedIntelligence, dajcMaintainedDrivingBansRights, type IntelligenceSourceRights } from './persistence-contract';
import { buildDrivingBansAlerts } from './driving-bans-alerts';
import type { IntelligenceAlertRecipient } from './alerts';
import { emptyAnswer, evaluateDrivingBansQuery, isQueryTool, QUERY_DISCLAIMER, type DrivingBansAnswer, type LegalChange, type PublishedView, type QueryTool } from './driving-bans-query';

/**
 * Paid DAJC Intelligence over the Driving Bans query service. Not released:
 * DRIVING_BANS_INTELLIGENCE_RELEASED is false, the module switch
 * DAJC_INTELLIGENCE_BANS_ENABLED defaults to off, and no page or API route mounts
 * this handler (scripts/lint-driving-bans.mjs keeps unreleased contracts out of
 * src/pages). Mounting it is a separate, reviewed release change.
 *
 * Every paid function has its own entitlement: the module switch plus the feature
 * of the tool (vehicle-aware, route-aware, history). The organisation always comes
 * from the authenticated subject; inputs are strict and cannot carry an organisation.
 */

const TOOL_FEATURES: Record<QueryTool, DrivingBansIntelligenceFeature> = {
  search_bans: 'driving-bans-query',
  explain_rule: 'driving-bans-query',
  list_exceptions: 'driving-bans-query',
  list_sources: 'driving-bans-query',
  evaluate_vehicle: 'vehicle-aware',
  check_route: 'route-aware',
  list_changes: 'history',
};

/** The entitlement a call needs; a search that carries a vehicle is vehicle-aware. */
export function featureForTool(tool: QueryTool, input: unknown): DrivingBansIntelligenceFeature {
  if (tool === 'search_bans' && input && typeof input === 'object' && 'vehicle' in input) return 'vehicle-aware';
  return TOOL_FEATURES[tool];
}

type AccessArgs = {
  subject: IntelligenceSubject | null | undefined;
  entitlement: IntelligenceEntitlement | null | undefined;
  now: Date;
  env?: Record<string, string | undefined>;
  released?: boolean;
};

/** Module switch first (nothing about the caller is disclosed while it is off), then the feature's own entitlement. */
function authorize(feature: DrivingBansIntelligenceFeature, access: AccessArgs) {
  if (!isFeatureEnabled('driving-bans-query', access.env, access.released)) return { allowed: false as const, reason: 'FEATURE_DISABLED' as const };
  return authorizeFeature({ feature, subject: access.subject, entitlement: access.entitlement, now: access.now, env: access.env, released: access.released });
}

export function answerIntelligenceQuery(args: AccessArgs & { tool: string; input: unknown; view: PublishedView; changes?: LegalChange[]; rights?: IntelligenceSourceRights }): DrivingBansAnswer {
  if (!isQueryTool(args.tool)) throw new Error(`Read-only query service: tool ${args.tool} does not exist`);
  const tool = args.tool;
  const access = authorize(featureForTool(tool, args.input), args);
  if (access.allowed === false) return emptyAnswer(tool, access.reason, null, QUERY_DISCLAIMER);
  const rights = canCreateDerivedIntelligence({ rights: args.rights ?? dajcMaintainedDrivingBansRights, context: { organizationId: access.organizationId, actorType: 'service', purpose: 'DAJC Intelligence answer from verified Driving Bans data' } });
  if (!rights.allowed) return emptyAnswer(tool, 'RIGHTS_DENIED', args.view, QUERY_DISCLAIMER, [rights.reason ?? 'Source rights do not allow derived answers.']);
  return evaluateDrivingBansQuery({ tool, input: args.input, view: args.view, changes: args.changes, freeTier: false, disclaimer: QUERY_DISCLAIMER });
}

/**
 * Alert candidates for one organisation only. Recipients of other organisations, and
 * recipients without an organisation, are never considered.
 */
export function prepareOrganisationAlerts(args: AccessArgs & { changes: Parameters<typeof buildDrivingBansAlerts>[0]['changes']; recipients: IntelligenceAlertRecipient[]; createdAt: string }) {
  const access = authorize('alerts', args);
  if (access.allowed === false) return { status: access.reason, candidates: [] };
  const own = args.recipients.filter(recipient => recipient.organizationId === access.organizationId);
  return { status: 'OK' as const, candidates: buildDrivingBansAlerts({ changes: args.changes, recipients: own, createdAt: args.createdAt }) };
}

const HTTP_STATUS: Record<DrivingBansAnswer['status'], number> = {
  OK: 200,
  INSUFFICIENT_VERIFIED_DATA: 200,
  // A disabled feature answers like a missing route, so its existence is not disclosed.
  FEATURE_DISABLED: 404,
  AUTHENTICATION_REQUIRED: 401,
  NOT_ENTITLED: 403,
  TENANT_MISMATCH: 403,
  RIGHTS_DENIED: 403,
};
const MAX_BODY_BYTES = 32_768;
const HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: HEADERS });

/**
 * Request handler for a future POST /api/intelligence/driving-bans/{tool} route.
 * Body: {"input": {...}} (strict). The subject and its entitlement are resolved
 * server-side; nothing in the URL or body can choose the organisation.
 */
export async function handleDrivingBansIntelligenceRequest(args: {
  request: Request;
  tool: string | undefined;
  resolveSubject: (request: Request) => Promise<IntelligenceSubject | null>;
  resolveEntitlement: (organizationId: string) => Promise<IntelligenceEntitlement | null>;
  readView: (now: Date) => PublishedView;
  readChanges?: () => Promise<LegalChange[] | undefined>;
  now?: Date;
  env?: Record<string, string | undefined>;
  released?: boolean;
}): Promise<Response> {
  const now = args.now ?? new Date();
  if (!isFeatureEnabled('driving-bans-query', args.env, args.released) || !isQueryTool(args.tool)) return reply(404, { error: 'Not found' });
  if (args.request.method !== 'POST') return reply(405, { error: 'Method not allowed' });
  const declared = Number(args.request.headers.get('content-length') ?? '0');
  if (declared > MAX_BODY_BYTES) return reply(413, { error: 'Request body too large' });
  const raw = await args.request.text();
  if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) return reply(413, { error: 'Request body too large' });
  let body: unknown;
  try { body = JSON.parse(raw); } catch { return reply(400, { error: 'INVALID_JSON' }); }
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => key !== 'input')) return reply(400, { error: 'INVALID_INPUT', issues: ['Body must be {"input": {...}}'] });
  const input = (body as { input?: unknown }).input;
  const subject = await args.resolveSubject(args.request);
  const entitlement = subject ? await args.resolveEntitlement(subject.organizationId) : null;
  const tool = args.tool;
  try {
    const changes = tool === 'list_changes' && args.readChanges ? await args.readChanges() : undefined;
    const answer = answerIntelligenceQuery({ tool, input, subject, entitlement, now, env: args.env, released: args.released, view: args.readView(now), changes });
    return answer.status === 'OK' || answer.status === 'INSUFFICIENT_VERIFIED_DATA' ? reply(200, answer) : reply(HTTP_STATUS[answer.status], { error: answer.status });
  } catch (error) {
    if (error instanceof ZodError) return reply(400, { error: 'INVALID_INPUT', issues: error.issues.map(issue => `${issue.path.join('.') || '$'}: ${issue.message}`) });
    throw error;
  }
}
