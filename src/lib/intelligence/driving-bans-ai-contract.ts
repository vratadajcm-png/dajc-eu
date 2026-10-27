import { z } from 'zod';
import { isTrackedJurisdiction } from '../../../config/europe-coverage.mjs';
import { authorizeFeature, type IntelligenceEntitlement } from './entitlements';
import type { IntelligenceSubject } from './subscription-scope';
import { canCreateDerivedIntelligence, dajcMaintainedDrivingBansRights, type IntelligenceSourceRights } from './persistence-contract';
import { evaluateVehicleApplicability, findRouteConflicts, routeQuerySchema, vehicleQuerySchema, type PublishedEvent } from './driving-bans-relevance';

/**
 * Read-only contract between a future DAJC AI assistant and Driving Bans data.
 * No language model is called here. The assistant may only use these tools; each
 * answer carries the facts, sources, validity, rule versions, completeness and
 * warnings it is allowed to state. When the verified data cannot decide the
 * question the answer is INSUFFICIENT_VERIFIED_DATA, never a guess.
 * The assistant can never approve an exception, issue a permit, change a route
 * or declare a legal authorisation to drive: those tools do not exist.
 */

export const AI_TOOLS = ['search_bans', 'evaluate_vehicle', 'check_route', 'explain_rule', 'list_changes', 'list_exceptions'] as const;
export type AiTool = (typeof AI_TOOLS)[number];
export const AI_PROHIBITED_ACTIONS = ['approve_exception', 'issue_permit', 'modify_route', 'modify_dataset', 'declare_authorisation_to_drive'] as const;

export const AI_DISCLAIMER = 'DAJC AI explains published, verified Driving Bans data. It does not grant exceptions or permits and does not confirm that a journey is authorised; check permit conditions and the competent authority.';

const instant = z.string().datetime();
const jurisdiction = z.string().refine(isTrackedJurisdiction, 'Untracked jurisdiction');
export const aiToolInputSchemas = {
  search_bans: z.object({ jurisdictions: z.array(jurisdiction).min(1).max(50), from: instant, to: instant, vehicle: vehicleQuerySchema.optional() }).strict(),
  evaluate_vehicle: z.object({ jurisdiction, at: instant, vehicle: vehicleQuerySchema }).strict(),
  check_route: z.object({ route: routeQuerySchema, vehicle: vehicleQuerySchema.optional() }).strict(),
  explain_rule: z.object({ ban_id: z.string().regex(/^[a-z0-9][a-z0-9_-]+$/) }).strict(),
  list_changes: z.object({ since: instant.optional(), jurisdictions: z.array(jurisdiction).max(50).optional() }).strict(),
  list_exceptions: z.object({ jurisdiction }).strict(),
} as const;

type JurisdictionRow = { jurisdiction: string; name: string; coverage_complete: boolean; verification_state: string; ban_state: string; coverage_failures: string[] };
type View = { events: PublishedEvent[]; jurisdictions: JurisdictionRow[]; window: { from: string; to: string }; dataset_version: string };
type LegalChange = { change_id: string; type: string; legal_change: boolean; jurisdiction: string | null; ban_id: string | null; detected_at: string; user_impact: string; legal_effective_from: string | null; sources: string[] };

export type AiAnswer = {
  status: 'OK' | 'INSUFFICIENT_VERIFIED_DATA' | 'FEATURE_DISABLED' | 'AUTHENTICATION_REQUIRED' | 'NOT_ENTITLED' | 'TENANT_MISMATCH' | 'RIGHTS_DENIED';
  tool: AiTool;
  dataset_version: string | null;
  facts: Array<Record<string, unknown>>;
  sources: Array<{ source_id: string; url: string; authority: string; version: string }>;
  validity: { from: string; to: string } | null;
  rule_versions: Array<{ ban_id: string; sequence: number; verified_at: string }>;
  completeness: Array<{ jurisdiction: string; coverage_complete: boolean; verification_state: string; ban_state: string }>;
  warnings: string[];
  authority_check_required: boolean;
  next_step: string;
  disclaimer: string;
};

const empty = (tool: AiTool, status: AiAnswer['status'], view: View | null, warnings: string[] = []): AiAnswer => ({
  status, tool, dataset_version: view?.dataset_version ?? null, facts: [], sources: [], validity: null, rule_versions: [], completeness: [], warnings,
  authority_check_required: true, next_step: status === 'INSUFFICIENT_VERIFIED_DATA' ? 'Check the competent authority or official source before travelling.' : 'No data returned.', disclaimer: AI_DISCLAIMER,
});

function envelope(tool: AiTool, view: View, events: PublishedEvent[], facts: Array<Record<string, unknown>>, codes: string[], warnings: string[], status: AiAnswer['status'] = 'OK', undetermined = false): AiAnswer {
  const completeness = view.jurisdictions.filter(row => codes.includes(row.jurisdiction)).map(row => ({ jurisdiction: row.jurisdiction, coverage_complete: row.coverage_complete, verification_state: row.verification_state, ban_state: row.ban_state }));
  for (const row of completeness) if (!row.coverage_complete) warnings.push(`${row.jurisdiction}: verification of the whole jurisdiction is incomplete; further restrictions may exist.`);
  const sources = [...new Map(events.map(e => [e.source_id, { source_id: e.source_id, url: e.source_url, authority: e.source_authority, version: e.source_version }])).values()];
  const versions = [...new Map(events.map(e => [e.ban_id, { ban_id: e.ban_id, sequence: e.sequence, verified_at: e.verified_at }])).values()];
  const exceptions = events.some(e => e.exceptions.length);
  if (exceptions) warnings.push('Exceptions are listed but not evaluated; their conditions must be checked for the actual vehicle and load.');
  const authority = status !== 'OK' || undetermined || completeness.some(row => !row.coverage_complete) || exceptions;
  return {
    status, tool, dataset_version: view.dataset_version, facts, sources, validity: view.window, rule_versions: versions, completeness, warnings: [...new Set(warnings)],
    authority_check_required: authority,
    next_step: status === 'INSUFFICIENT_VERIFIED_DATA' ? 'Check the competent authority or official source before travelling.' : authority ? 'Confirm the listed restriction, exceptions and permit conditions with the official source.' : 'Re-check before departure; data is refreshed after each review.',
    disclaimer: AI_DISCLAIMER,
  };
}

const factOf = (e: PublishedEvent) => ({ classification: 'LEGAL_DRIVING_BAN', ban_id: e.ban_id, jurisdiction: e.jurisdiction, title: e.title, starts_at: e.starts_at, ends_at: e.ends_at, local_time: `${e.date} ${e.start_time}-${e.end_time} (${e.timezone})`, roads: e.roads, regions: e.regions, direction: e.direction, vehicle_scope: e.vehicle_scope, legal_basis: e.legal_basis });

export function answerDrivingBansQuery(args: {
  tool: string;
  input: unknown;
  subject: IntelligenceSubject | null | undefined;
  entitlement: IntelligenceEntitlement | null | undefined;
  now: Date;
  view: View;
  changes?: LegalChange[];
  rights?: IntelligenceSourceRights;
  env?: Record<string, string | undefined>;
  released?: boolean;
}): AiAnswer {
  if (!(AI_TOOLS as readonly string[]).includes(args.tool)) throw new Error(`Read-only contract: tool ${args.tool} does not exist`);
  const tool = args.tool as AiTool;
  const access = authorizeFeature({ feature: 'ai-assistant', subject: args.subject, entitlement: args.entitlement, now: args.now, env: args.env, released: args.released });
  if (access.allowed === false) return empty(tool, access.reason, null);
  const rights = canCreateDerivedIntelligence({ rights: args.rights ?? dajcMaintainedDrivingBansRights, context: { organizationId: access.organizationId, actorType: 'service', purpose: 'DAJC AI answer from verified Driving Bans data' } });
  if (!rights.allowed) return empty(tool, 'RIGHTS_DENIED', args.view, [rights.reason ?? 'Source rights do not allow derived answers.']);
  const view = args.view;
  const row = (code: string) => view.jurisdictions.find(item => item.jurisdiction === code);

  if (tool === 'search_bans') {
    const input = aiToolInputSchemas.search_bans.parse(args.input);
    const events = view.events.filter(e => input.jurisdictions.includes(e.jurisdiction) && e.ends_at > input.from && e.starts_at < input.to);
    const evaluated = events.map(e => ({ event: e, vehicle: input.vehicle ? evaluateVehicleApplicability(e, input.vehicle) : null })).filter(item => item.vehicle?.status !== 'DOES_NOT_APPLY');
    const undecided = input.jurisdictions.filter(code => !evaluated.some(item => item.event.jurisdiction === code) && row(code)?.ban_state !== 'NO_BAN');
    const warnings = undecided.map(code => `${code}: no verified ban event found, which is not evidence that there is no ban.`);
    const status = evaluated.length || !undecided.length ? 'OK' : 'INSUFFICIENT_VERIFIED_DATA';
    return envelope(tool, view, evaluated.map(item => item.event), evaluated.map(item => ({ ...factOf(item.event), vehicle: item.vehicle })), input.jurisdictions, warnings, status, evaluated.some(item => item.vehicle?.status === 'UNDETERMINED'));
  }
  if (tool === 'evaluate_vehicle') {
    const input = aiToolInputSchemas.evaluate_vehicle.parse(args.input);
    const events = view.events.filter(e => e.jurisdiction === input.jurisdiction && e.starts_at <= input.at && e.ends_at > input.at);
    const evaluated = events.map(e => ({ event: e, vehicle: evaluateVehicleApplicability(e, input.vehicle) }));
    const applies = evaluated.filter(item => item.vehicle.status !== 'DOES_NOT_APPLY');
    const known = applies.length > 0 || row(input.jurisdiction)?.ban_state === 'NO_BAN';
    const status = known ? 'OK' : 'INSUFFICIENT_VERIFIED_DATA';
    const warnings = known ? [] : [`${input.jurisdiction}: no verified ban applies at ${input.at} for this vehicle, but coverage does not prove that none exists.`];
    return envelope(tool, view, applies.map(item => item.event), applies.map(item => ({ ...factOf(item.event), vehicle: item.vehicle })), [input.jurisdiction], warnings, status, applies.some(item => item.vehicle.status === 'UNDETERMINED'));
  }
  if (tool === 'check_route') {
    const input = aiToolInputSchemas.check_route.parse(args.input);
    const result = findRouteConflicts(view, input.route, input.vehicle);
    const uids = new Set(result.conflicts.map(conflict => conflict.uid));
    const events = view.events.filter(e => uids.has(e.uid));
    const warnings = result.gaps.map(gap => `Segment ${gap.segment} (${gap.jurisdiction}): ${gap.reason}`);
    return envelope(tool, view, events, result.conflicts, [...new Set(input.route.segments.map(segment => segment.jurisdiction))], warnings, result.status as AiAnswer['status'], result.conflicts.some(conflict => conflict.certainty === 'POSSIBLE'));
  }
  if (tool === 'explain_rule') {
    const input = aiToolInputSchemas.explain_rule.parse(args.input);
    const events = view.events.filter(e => e.ban_id === input.ban_id);
    if (!events.length) return empty(tool, 'INSUFFICIENT_VERIFIED_DATA', view, [`${input.ban_id} has no verified event in the published period.`]);
    const e = events[0];
    return envelope(tool, view, events, [{ ...factOf(e), occurrences: events.map(item => `${item.date} ${item.start_time}-${item.end_time} (${item.timezone})`), exceptions: e.exceptions, weight_threshold: e.weight_threshold, adr: e.adr_relevance, exceptional_transport: e.exceptional_relevance }], [e.jurisdiction], []);
  }
  if (tool === 'list_changes') {
    const input = aiToolInputSchemas.list_changes.parse(args.input);
    const changes = (args.changes ?? []).filter(change => (change.legal_change || change.type === 'SOURCE_UNAVAILABLE') && (!input.since || change.detected_at >= input.since) && (!input.jurisdictions || (change.jurisdiction && input.jurisdictions.includes(change.jurisdiction))));
    if (!args.changes) return empty(tool, 'INSUFFICIENT_VERIFIED_DATA', view, ['No reviewed change log is available.']);
    return envelope(tool, view, [], changes.map(change => ({ change_id: change.change_id, type: change.type, jurisdiction: change.jurisdiction, ban_id: change.ban_id, legal_effective_from: change.legal_effective_from, impact: change.user_impact, detected_at: change.detected_at })), input.jurisdictions ?? [], []);
  }
  const input = aiToolInputSchemas.list_exceptions.parse(args.input);
  const events = view.events.filter(e => e.jurisdiction === input.jurisdiction);
  if (!events.length) return empty(tool, 'INSUFFICIENT_VERIFIED_DATA', view, [`${input.jurisdiction}: no verified rule in the published period.`]);
  const byRule = [...new Map(events.map(e => [e.ban_id, e])).values()];
  return envelope(tool, view, byRule, byRule.map(e => ({ ban_id: e.ban_id, title: e.title, exceptions: e.exceptions, legal_basis: e.legal_basis })), [input.jurisdiction], []);
}
