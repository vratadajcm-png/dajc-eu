import { z } from 'zod';
import { isTrackedJurisdiction } from '../../../config/europe-coverage.mjs';
import { localToUtc, shiftDate } from '../driving-bans/core.mjs';
import { readPublishedDrivingBans } from './driving-bans-adapter';
import { evaluateVehicleApplicability, findRouteConflicts, routeQuerySchema, vehicleQuerySchema, type PublishedEvent } from './driving-bans-relevance';

/**
 * The one Driving Bans query service (owner: the Driving Bans module). Deterministic,
 * server-side, read-only over the published snapshot (driving-bans-adapter →
 * getDrivingBansSnapshot, the same data as /driving-bans, JSON and ICS). It never
 * calls a model or an external API and never decides an exception or a permit.
 *
 * Consumers:
 * - driving-bans-ai-contract.ts: free "Ask DAJC AI" and paid DAJC AI;
 * - driving-bans-intelligence-api.ts: paid DAJC Intelligence (not released).
 * There is no second evaluation and no second state enum anywhere in the repository.
 */

/**
 * Per-jurisdiction result of a time-bound question:
 * - BAN_FOUND: at least one verified legal driving ban applies. Allowed for a jurisdiction
 *   that is not verified in full; the answer then always warns that coverage is not confirmed;
 * - NO_CONFIRMED_BAN: the jurisdiction is verified in full for the published period and
 *   no verified ban applies (a statement about the registry, not about temporary restrictions);
 * - INSUFFICIENT_VERIFIED_DATA: anything else. Missing data never means there is no ban.
 */
export type JurisdictionOutcome = 'BAN_FOUND' | 'NO_CONFIRMED_BAN' | 'INSUFFICIENT_VERIFIED_DATA';

export const QUERY_TOOLS = ['search_bans', 'evaluate_vehicle', 'check_route', 'explain_rule', 'list_changes', 'list_exceptions', 'list_sources'] as const;
export type QueryTool = (typeof QUERY_TOOLS)[number];

const instant = z.string().datetime();
const jurisdiction = z.string().refine(isTrackedJurisdiction, 'Untracked jurisdiction');
export const queryInputSchemas = {
  search_bans: z.object({ jurisdictions: z.array(jurisdiction).min(1).max(50), from: instant, to: instant, vehicle: vehicleQuerySchema.optional() }).strict(),
  evaluate_vehicle: z.object({ jurisdiction, at: instant, vehicle: vehicleQuerySchema }).strict(),
  check_route: z.object({ route: routeQuerySchema, vehicle: vehicleQuerySchema.optional() }).strict(),
  explain_rule: z.object({ ban_id: z.string().regex(/^[a-z0-9][a-z0-9_-]+$/) }).strict(),
  list_changes: z.object({ since: instant.optional(), jurisdictions: z.array(jurisdiction).max(50).optional() }).strict(),
  list_exceptions: z.object({ jurisdiction }).strict(),
  list_sources: z.object({ jurisdiction }).strict(),
} as const;
const freeSearchSchema = queryInputSchemas.search_bans.omit({ vehicle: true });

type JurisdictionRow = { jurisdiction: string; name: string; coverage_complete: boolean; verification_state: string; ban_state: string; coverage_failures: string[]; last_verified?: string | null; source_ids?: string[] };
type SourceRow = { source_id: string; url: string; authority: string; role: string; version: string; checked_at?: string | null; content_sha256?: string | null };
/** The published snapshot (getDrivingBansSnapshot): window is the published period in Europe/Prague. */
export type PublishedView = { events: PublishedEvent[]; jurisdictions: JurisdictionRow[]; window: { from: string; to: string }; dataset_version: string; sources?: SourceRow[] };
export type LegalChange = { change_id: string; type: string; legal_change: boolean; jurisdiction: string | null; ban_id: string | null; detected_at: string; user_impact: string; legal_effective_from: string | null; sources: string[] };

export type QueryStatus = 'OK' | 'INSUFFICIENT_VERIFIED_DATA' | 'FEATURE_DISABLED' | 'AUTHENTICATION_REQUIRED' | 'NOT_ENTITLED' | 'TENANT_MISMATCH' | 'RIGHTS_DENIED';
export type DrivingBansAnswer<Tool extends string = QueryTool> = {
  status: QueryStatus;
  tool: Tool;
  dataset_version: string | null;
  facts: Array<Record<string, unknown>>;
  sources: Array<{ source_id: string; url: string; authority: string; version: string }>;
  validity: { from: string; to: string } | null;
  rule_versions: Array<{ ban_id: string; sequence: number; verified_at: string }>;
  completeness: Array<{ jurisdiction: string; coverage_complete: boolean; verification_state: string; ban_state: string; last_verified: string | null; outcome?: JurisdictionOutcome }>;
  warnings: string[];
  authority_check_required: boolean;
  next_step: string;
  disclaimer: string;
};

export const QUERY_DISCLAIMER = 'DAJC lists published, verified Driving Bans data. It does not grant exceptions or permits and does not confirm that a journey is authorised; check permit conditions and the competent authority.';

/** The published snapshot through the Driving Bans adapter: the only read path. */
export function readPublishedView(now: Date = new Date()): PublishedView {
  return readPublishedDrivingBans(now) as unknown as PublishedView;
}

export function emptyAnswer<Tool extends string>(tool: Tool, status: QueryStatus, view: PublishedView | null, disclaimer: string, warnings: string[] = []): DrivingBansAnswer<Tool> {
  return {
    status, tool, dataset_version: view?.dataset_version ?? null, facts: [], sources: [], validity: null, rule_versions: [], completeness: [], warnings,
    authority_check_required: true, next_step: status === 'INSUFFICIENT_VERIFIED_DATA' ? 'Check the competent authority or official source before travelling.' : 'No data returned.', disclaimer,
  };
}

function envelope<Tool extends string>(tool: Tool, view: PublishedView, events: PublishedEvent[], facts: Array<Record<string, unknown>>, codes: string[], warnings: string[], disclaimer: string, status: QueryStatus = 'OK', undetermined = false, outcomes: Record<string, JurisdictionOutcome> = {}): DrivingBansAnswer<Tool> {
  const completeness = view.jurisdictions.filter(row => codes.includes(row.jurisdiction)).map(row => ({ jurisdiction: row.jurisdiction, coverage_complete: row.coverage_complete, verification_state: row.verification_state, ban_state: row.ban_state, last_verified: row.last_verified ?? null, ...(outcomes[row.jurisdiction] ? { outcome: outcomes[row.jurisdiction] } : {}) }));
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
    disclaimer,
  };
}

const factOf = (e: PublishedEvent) => ({ classification: 'LEGAL_DRIVING_BAN', uid: e.uid, ban_id: e.ban_id, jurisdiction: e.jurisdiction, title: e.title, starts_at: e.starts_at, ends_at: e.ends_at, local_time: `${e.date} ${e.start_time}-${e.end_time} (${e.timezone})`, roads: e.roads, regions: e.regions, direction: e.direction, vehicle_scope: e.vehicle_scope, legal_basis: e.legal_basis });

/** True when [from, to) lies inside the published period, measured in Europe/Prague. */
function insidePublishedPeriod(view: PublishedView, from: string, to: string): boolean {
  return from >= localToUtc(view.window.from, '00:00', 'Europe/Prague') && to <= localToUtc(shiftDate(view.window.to, 1), '00:00', 'Europe/Prague');
}

/** Outcome for one jurisdiction and period, given the verified events that apply to the question. */
function outcomeOf(row: JurisdictionRow | undefined, applying: number, inside: boolean): JurisdictionOutcome {
  if (applying > 0) return 'BAN_FOUND';
  return row?.coverage_complete && inside ? 'NO_CONFIRMED_BAN' : 'INSUFFICIENT_VERIFIED_DATA';
}

/**
 * The answer as a whole is decided only when every asked jurisdiction is decided, verified
 * in full for the period, and no applying rule is UNDETERMINED for the vehicle. A BAN_FOUND
 * in a partially verified jurisdiction keeps its outcome, but the answer stays
 * INSUFFICIENT_VERIFIED_DATA because further restrictions may exist there. The free Ask
 * pipeline (PR #78, registryDecides) applies the same rule.
 */
function overallStatus(outcomes: Record<string, JurisdictionOutcome>, rows: (code: string) => JurisdictionRow | undefined, undetermined: boolean): QueryStatus {
  const decided = Object.entries(outcomes).every(([code, outcome]) => outcome !== 'INSUFFICIENT_VERIFIED_DATA' && rows(code)?.coverage_complete === true);
  return decided && !undetermined ? 'OK' : 'INSUFFICIENT_VERIFIED_DATA';
}

const NO_CONFIRMED_BAN_WARNING = 'No verified legal driving ban applies in the DAJC registry, which is verified in full for this period. Temporary traffic restrictions, roadworks and permit conditions are not part of the registry.';
const UNDETERMINED_WARNING = 'For at least one listed rule it could not be determined whether it applies to this vehicle (missing or ambiguous vehicle data or legal criterion); treat it as applying until checked.';
const partialBanWarning = (code: string) => `${code}: a verified ban applies, but the coverage of the whole jurisdiction is not confirmed; this list may be incomplete.`;

/**
 * Shared, entitlement-free evaluation. Callers authorise access and source rights first.
 * freeTier: no vehicle in search_bans (the free tier never evaluates a vehicle).
 */
export function evaluateDrivingBansQuery<Tool extends string>(args: { tool: Tool & QueryTool; input: unknown; view: PublishedView; changes?: LegalChange[]; freeTier?: boolean; disclaimer?: string }): DrivingBansAnswer<Tool> {
  const { tool, view, changes } = args;
  const disclaimer = args.disclaimer ?? QUERY_DISCLAIMER;
  const row = (code: string) => view.jurisdictions.find(item => item.jurisdiction === code);
  const rawInput = args.input;

  if (tool === 'search_bans') {
    const input = (args.freeTier ? freeSearchSchema : queryInputSchemas.search_bans).parse(rawInput) as z.infer<typeof queryInputSchemas.search_bans>;
    const events = view.events.filter(e => input.jurisdictions.includes(e.jurisdiction) && e.ends_at > input.from && e.starts_at < input.to);
    const evaluated = events.map(e => ({ event: e, vehicle: input.vehicle ? evaluateVehicleApplicability(e, input.vehicle) : null })).filter(item => item.vehicle?.status !== 'DOES_NOT_APPLY');
    const inside = insidePublishedPeriod(view, input.from, input.to);
    const outcomes = Object.fromEntries(input.jurisdictions.map(code => [code, outcomeOf(row(code), evaluated.filter(item => item.event.jurisdiction === code).length, inside)])) as Record<string, JurisdictionOutcome>;
    const undecided = input.jurisdictions.filter(code => outcomes[code] === 'INSUFFICIENT_VERIFIED_DATA');
    const undetermined = evaluated.some(item => item.vehicle?.status === 'UNDETERMINED');
    const warnings = [
      ...undecided.map(code => `${code}: insufficient verified data for this period; this is not evidence that there is no ban.`),
      ...input.jurisdictions.filter(code => outcomes[code] === 'BAN_FOUND' && !row(code)?.coverage_complete).map(partialBanWarning),
      ...(Object.values(outcomes).includes('NO_CONFIRMED_BAN') ? [NO_CONFIRMED_BAN_WARNING] : []),
      ...(undetermined ? [UNDETERMINED_WARNING] : []),
    ];
    return envelope(tool, view, evaluated.map(item => item.event), evaluated.map(item => ({ ...factOf(item.event), vehicle: item.vehicle })), input.jurisdictions, warnings, disclaimer, overallStatus(outcomes, row, undetermined), undetermined, outcomes);
  }
  if (tool === 'evaluate_vehicle') {
    const input = queryInputSchemas.evaluate_vehicle.parse(rawInput);
    const events = view.events.filter(e => e.jurisdiction === input.jurisdiction && e.starts_at <= input.at && e.ends_at > input.at);
    const evaluated = events.map(e => ({ event: e, vehicle: evaluateVehicleApplicability(e, input.vehicle) }));
    const applies = evaluated.filter(item => item.vehicle.status !== 'DOES_NOT_APPLY');
    const outcome = outcomeOf(row(input.jurisdiction), applies.length, insidePublishedPeriod(view, input.at, input.at));
    const undetermined = applies.some(item => item.vehicle.status === 'UNDETERMINED');
    const warnings = [
      ...(outcome === 'INSUFFICIENT_VERIFIED_DATA' ? [`${input.jurisdiction}: no verified ban applies at ${input.at} for this vehicle, but coverage does not prove that none exists.`] : []),
      ...(outcome === 'NO_CONFIRMED_BAN' ? [NO_CONFIRMED_BAN_WARNING] : []),
      ...(outcome === 'BAN_FOUND' && !row(input.jurisdiction)?.coverage_complete ? [partialBanWarning(input.jurisdiction)] : []),
      ...(undetermined ? [UNDETERMINED_WARNING] : []),
    ];
    const outcomes = { [input.jurisdiction]: outcome };
    return envelope(tool, view, applies.map(item => item.event), applies.map(item => ({ ...factOf(item.event), vehicle: item.vehicle })), [input.jurisdiction], warnings, disclaimer, overallStatus(outcomes, row, undetermined), undetermined, outcomes);
  }
  if (tool === 'check_route') {
    const input = queryInputSchemas.check_route.parse(rawInput);
    const result = findRouteConflicts(view, input.route, input.vehicle);
    const uids = new Set(result.conflicts.map(conflict => conflict.uid));
    const events = view.events.filter(e => uids.has(e.uid));
    const possible = result.conflicts.some(conflict => conflict.certainty === 'POSSIBLE');
    const warnings = [
      ...result.gaps.map(gap => `Segment ${gap.segment} (${gap.jurisdiction}): ${gap.reason}`),
      ...(possible ? ['Some conflicts are POSSIBLE only: the route roads or the rule scope (road class, region, vehicle data) cannot be matched exactly.'] : []),
    ];
    return envelope(tool, view, events, result.conflicts, [...new Set(input.route.segments.map(segment => segment.jurisdiction))], warnings, disclaimer, result.status as QueryStatus, possible);
  }
  if (tool === 'explain_rule') {
    const input = queryInputSchemas.explain_rule.parse(rawInput);
    const events = view.events.filter(e => e.ban_id === input.ban_id);
    if (!events.length) return emptyAnswer(tool, 'INSUFFICIENT_VERIFIED_DATA', view, disclaimer, [`${input.ban_id} has no verified event in the published period.`]);
    const e = events[0];
    return envelope(tool, view, events, [{ ...factOf(e), occurrences: events.map(item => `${item.date} ${item.start_time}-${item.end_time} (${item.timezone})`), exceptions: e.exceptions, weight_threshold: e.weight_threshold, adr: e.adr_relevance, exceptional_transport: e.exceptional_relevance }], [e.jurisdiction], [], disclaimer);
  }
  if (tool === 'list_changes') {
    const input = queryInputSchemas.list_changes.parse(rawInput);
    if (!changes) return emptyAnswer(tool, 'INSUFFICIENT_VERIFIED_DATA', view, disclaimer, ['No reviewed change log is available.']);
    const selected = changes.filter(change => (change.legal_change || change.type === 'SOURCE_UNAVAILABLE') && (!input.since || change.detected_at >= input.since) && (!input.jurisdictions || (change.jurisdiction && input.jurisdictions.includes(change.jurisdiction))));
    return envelope(tool, view, [], selected.map(change => ({ change_id: change.change_id, type: change.type, jurisdiction: change.jurisdiction, ban_id: change.ban_id, legal_effective_from: change.legal_effective_from, impact: change.user_impact, detected_at: change.detected_at })), input.jurisdictions ?? [], [], disclaimer);
  }
  if (tool === 'list_sources') {
    const input = queryInputSchemas.list_sources.parse(rawInput);
    const events = view.events.filter(e => e.jurisdiction === input.jurisdiction);
    const reviewed = new Set(row(input.jurisdiction)?.source_ids ?? []);
    const used = new Set(events.map(e => e.source_id));
    const listed = (view.sources ?? []).filter(source => used.has(source.source_id) || reviewed.has(source.source_id));
    if (!listed.length) return emptyAnswer(tool, 'INSUFFICIENT_VERIFIED_DATA', view, disclaimer, [`${input.jurisdiction}: no reviewed source is recorded for the published period.`]);
    const facts = listed.map(source => ({ source_id: source.source_id, url: source.url, authority: source.authority, role: source.role, version: source.version, checked_at: source.checked_at ?? null, content_sha256: source.content_sha256 ?? null, backs_published_rules: used.has(source.source_id) }));
    return envelope(tool, view, events, facts, [input.jurisdiction], [], disclaimer);
  }
  const input = queryInputSchemas.list_exceptions.parse(rawInput);
  const events = view.events.filter(e => e.jurisdiction === input.jurisdiction);
  if (!events.length) return emptyAnswer(tool, 'INSUFFICIENT_VERIFIED_DATA', view, disclaimer, [`${input.jurisdiction}: no verified rule in the published period.`]);
  const byRule = [...new Map(events.map(e => [e.ban_id, e])).values()];
  return envelope(tool, view, byRule, byRule.map(e => ({ ban_id: e.ban_id, title: e.title, exceptions: e.exceptions, legal_basis: e.legal_basis })), [input.jurisdiction], [], disclaimer);
}

export function isQueryTool(name: unknown): name is QueryTool {
  return typeof name === 'string' && (QUERY_TOOLS as readonly string[]).includes(name);
}
