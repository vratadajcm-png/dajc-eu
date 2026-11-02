import { authorizeFeature, type IntelligenceEntitlement } from './entitlements';
import type { IntelligenceSubject } from './subscription-scope';
import { canCreateDerivedIntelligence, dajcMaintainedDrivingBansRights, type IntelligencePersistenceContext, type IntelligenceSourceRights } from './persistence-contract';
import { emptyAnswer, evaluateDrivingBansQuery, queryInputSchemas, type DrivingBansAnswer, type JurisdictionOutcome, type LegalChange, type PublishedView } from './driving-bans-query';

/**
 * Read-only contract between DAJC AI assistants and Driving Bans data.
 * No language model is called here. The assistant may only use these tools; each
 * answer carries the facts, sources, validity, rule versions, completeness and
 * warnings it is allowed to state. When the verified data cannot decide the
 * question the answer is INSUFFICIENT_VERIFIED_DATA, never a guess.
 * The assistant can never approve an exception, issue a permit, change a route
 * or declare a legal authorisation to drive: those tools do not exist.
 *
 * The evaluation itself belongs to the Driving Bans query service
 * (driving-bans-query.ts), which DAJC Intelligence uses too. Two AI entry points
 * share it over the same published snapshot:
 * - answerFreeAskQuery: the free "Ask DAJC AI" (its own gate: DAJC_ASK_ENABLED,
 *   sign-in, daily limit). No paid entitlement, only FREE_ASK_TOOLS, no vehicle.
 * - answerDrivingBansQuery: paid DAJC AI, authorised server-side per call.
 * Research AI (src/lib/driving-bans/research) has no access to these tools and
 * conversational AI has no access to research: tools, rights and writes stay apart.
 */

export const AI_TOOLS = ['search_bans', 'evaluate_vehicle', 'check_route', 'explain_rule', 'list_changes', 'list_exceptions'] as const;
export type AiTool = (typeof AI_TOOLS)[number];
/** Tools the free "Ask DAJC AI" may use without a paid entitlement; vehicle, route and history stay paid. */
export const FREE_ASK_TOOLS = ['search_bans', 'explain_rule', 'list_exceptions'] as const satisfies readonly AiTool[];
export const AI_PROHIBITED_ACTIONS = ['approve_exception', 'issue_permit', 'modify_route', 'modify_dataset', 'declare_authorisation_to_drive'] as const;

export const AI_DISCLAIMER = 'DAJC AI explains published, verified Driving Bans data. It does not grant exceptions or permits and does not confirm that a journey is authorised; check permit conditions and the competent authority.';

export const aiToolInputSchemas = {
  search_bans: queryInputSchemas.search_bans,
  evaluate_vehicle: queryInputSchemas.evaluate_vehicle,
  check_route: queryInputSchemas.check_route,
  explain_rule: queryInputSchemas.explain_rule,
  list_changes: queryInputSchemas.list_changes,
  list_exceptions: queryInputSchemas.list_exceptions,
} as const;

export type { JurisdictionOutcome, PublishedView };
export type AiAnswer = DrivingBansAnswer<AiTool>;

function toolOf(name: string): AiTool {
  if (!(AI_TOOLS as readonly string[]).includes(name)) throw new Error(`Read-only contract: tool ${name} does not exist`);
  return name as AiTool;
}

function rightsDenied(tool: AiTool, view: PublishedView, rights: IntelligenceSourceRights | undefined, context: IntelligencePersistenceContext): AiAnswer | null {
  const decision = canCreateDerivedIntelligence({ rights: rights ?? dajcMaintainedDrivingBansRights, context });
  return decision.allowed ? null : emptyAnswer(tool, 'RIGHTS_DENIED', view, AI_DISCLAIMER, [decision.reason ?? 'Source rights do not allow derived answers.']);
}

/**
 * Free "Ask DAJC AI": no paid entitlement is required or consulted. Only FREE_ASK_TOOLS,
 * without a vehicle; the caller enforces the Ask gate (DAJC_ASK_ENABLED, sign-in, daily limit).
 */
export function answerFreeAskQuery(args: { tool: string; input: unknown; view: PublishedView; rights?: IntelligenceSourceRights }): AiAnswer {
  const tool = toolOf(args.tool);
  if (!(FREE_ASK_TOOLS as readonly string[]).includes(tool)) return emptyAnswer(tool, 'NOT_ENTITLED', args.view, AI_DISCLAIMER, [`${tool} is part of paid DAJC AI and needs a server-side entitlement.`]);
  return rightsDenied(tool, args.view, args.rights, { actorType: 'service', purpose: 'Free Ask DAJC AI answer from published Driving Bans data' })
    ?? evaluateDrivingBansQuery({ tool, input: args.input, view: args.view, freeTier: true, disclaimer: AI_DISCLAIMER });
}

/** Paid DAJC AI: every call is authorised server-side for the subject's own organisation. */
export function answerDrivingBansQuery(args: {
  tool: string;
  input: unknown;
  subject: IntelligenceSubject | null | undefined;
  entitlement: IntelligenceEntitlement | null | undefined;
  now: Date;
  view: PublishedView;
  changes?: LegalChange[];
  rights?: IntelligenceSourceRights;
  env?: Record<string, string | undefined>;
  released?: boolean;
}): AiAnswer {
  const tool = toolOf(args.tool);
  const access = authorizeFeature({ feature: 'ai-assistant', subject: args.subject, entitlement: args.entitlement, now: args.now, env: args.env, released: args.released });
  if (access.allowed === false) return emptyAnswer(tool, access.reason, null, AI_DISCLAIMER);
  return rightsDenied(tool, args.view, args.rights, { organizationId: access.organizationId, actorType: 'service', purpose: 'DAJC AI answer from verified Driving Bans data' })
    ?? evaluateDrivingBansQuery({ tool, input: args.input, view: args.view, changes: args.changes, freeTier: false, disclaimer: AI_DISCLAIMER });
}
