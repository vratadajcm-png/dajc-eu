import { z } from 'zod';
import { isTrackedJurisdiction } from '../../../config/europe-coverage.mjs';

/**
 * Vehicle-aware and route-aware evaluation of published Driving Bans events for
 * DAJC Intelligence (paid, not released). Deterministic and fail-closed:
 * - a rule is DOES_NOT_APPLY only when every legal criterion is clearly not met;
 * - missing vehicle data or an ambiguous legal criterion gives UNDETERMINED;
 * - exceptions are never evaluated automatically (they depend on the load and
 *   documents) and are always returned for the user to check;
 * - a route through a jurisdiction without complete verified coverage returns
 *   INSUFFICIENT_VERIFIED_DATA for that segment, never "no ban".
 */

export const vehicleQuerySchema = z.object({
  configuration: z.enum(['SOLO', 'TRUCK_TRAILER', 'ARTICULATED', 'TRACTOR_ONLY', 'OTHER']),
  vehicleType: z.enum(['GOODS', 'TRACTOR', 'WORK_VEHICLE', 'SPECIAL', 'OTHER']).optional(),
  motorVehicleMassKg: z.number().positive().max(250_000).optional(),
  trailerMassKg: z.number().positive().max(250_000).optional(),
  combinationMassKg: z.number().positive().max(250_000).optional(),
  actualMassKg: z.number().positive().max(250_000).optional(),
  axleCount: z.number().int().positive().max(40).optional(),
  heightM: z.number().positive().max(20).optional(),
  lengthM: z.number().positive().max(100).optional(),
  widthM: z.number().positive().max(20).optional(),
  adr: z.boolean().default(false),
  exceptionalTransport: z.boolean().default(false),
}).strict();
export type VehicleQuery = z.infer<typeof vehicleQuerySchema>;

export type Applicability = 'APPLIES' | 'DOES_NOT_APPLY' | 'UNDETERMINED';
type Leaf = { operator: string; value?: number; unit?: string; applies_to: string };
type Weight = Leaf | { any_of?: Weight[]; all_of?: Weight[] };

const hasTrailer = (v: VehicleQuery) => v.configuration === 'TRUCK_TRAILER' || v.configuration === 'ARTICULATED';
const combination = (v: VehicleQuery) => v.combinationMassKg ?? (v.configuration === 'SOLO' || v.configuration === 'TRACTOR_ONLY' ? v.motorVehicleMassKg : v.motorVehicleMassKg && v.trailerMassKg ? v.motorVehicleMassKg + v.trailerMassKg : undefined);
const compare = (actual: number, operator: string, value: number) => ({ '>': actual > value, '>=': actual >= value, '<': actual < value, '<=': actual <= value, '=': actual === value } as Record<string, boolean>)[operator];

/** Resolve the vehicle measure a legal criterion speaks about; null = not applicable to this vehicle, undefined = unknown. */
function measureFor(leaf: Leaf, v: VehicleQuery): { value: number | null | undefined; basis: string } {
  const text = leaf.applies_to.toLowerCase();
  if (leaf.unit === 'axles') return { value: v.axleCount, basis: 'axle count' };
  if (leaf.unit === 'm') {
    if (text.includes('length')) return { value: v.lengthM, basis: 'length' };
    if (text.includes('height')) return { value: v.heightM, basis: 'height' };
    if (text.includes('width')) return { value: v.widthM, basis: 'width' };
    return { value: undefined, basis: 'unrecognised dimension' };
  }
  if (text.includes('actual')) return { value: v.actualMassKg, basis: 'actual mass' };
  if (text.includes('truck or trailer mam')) {
    if (!hasTrailer(v)) return { value: null, basis: 'no trailer' };
    return { value: v.motorVehicleMassKg && v.trailerMassKg ? Math.max(v.motorVehicleMassKg, v.trailerMassKg) : undefined, basis: 'heavier of truck and trailer MAM' };
  }
  if (text.startsWith('towed trailer')) return hasTrailer(v) ? { value: v.trailerMassKg, basis: 'trailer MAM' } : { value: null, basis: 'no trailer' };
  if (text.includes('towing a trailer')) {
    if (v.configuration === 'SOLO' || v.configuration === 'TRACTOR_ONLY') return { value: null, basis: 'no trailer' };
    if (v.configuration === 'ARTICULATED') return { value: undefined, basis: 'semi-trailer vs. trailer not resolved' };
    return { value: v.motorVehicleMassKg, basis: 'motor vehicle MAM (towing)' };
  }
  if (text.startsWith('articulated vehicle combination')) return v.configuration === 'ARTICULATED' ? { value: combination(v), basis: 'articulated combination MAM' } : { value: null, basis: 'not articulated' };
  if (/combination|with or without trailer|sum of truck|gross weight|permitted weight of goods vehicle/.test(text)) return { value: combination(v), basis: 'vehicle or combination MAM' };
  if (/goods\/articulated/.test(text)) return { value: v.configuration === 'ARTICULATED' ? combination(v) : v.motorVehicleMassKg, basis: 'goods/articulated vehicle MAM' };
  if (/motor vehicle mam|lorry|truck \(lkw\) mam|heavy motor vehicle/.test(text)) return { value: v.motorVehicleMassKg, basis: 'motor vehicle MAM' };
  return { value: undefined, basis: 'unrecognised criterion' };
}

function evaluateLeaf(leaf: Leaf, v: VehicleQuery): { result: Applicability; reason: string } {
  const text = leaf.applies_to.toLowerCase();
  if (leaf.operator === 'any') {
    if (text.includes('trailer drawn by a truck')) {
      if (v.configuration === 'TRUCK_TRAILER') return { result: 'APPLIES', reason: 'truck with trailer' };
      if (v.configuration === 'SOLO' || v.configuration === 'TRACTOR_ONLY') return { result: 'DOES_NOT_APPLY', reason: 'no trailer behind a truck' };
      return { result: 'UNDETERMINED', reason: 'articulated combination vs. truck-trailer not resolved' };
    }
    if (text.includes('tractors') || text.includes('work motor vehicles')) {
      if (v.vehicleType === 'TRACTOR' || v.vehicleType === 'WORK_VEHICLE') return { result: 'APPLIES', reason: leaf.applies_to };
      if (v.vehicleType === 'GOODS') return { result: 'DOES_NOT_APPLY', reason: 'goods vehicle, not a commercial tractor/work vehicle' };
    }
    return { result: 'UNDETERMINED', reason: `category criterion "${leaf.applies_to}" needs the vehicle category` };
  }
  const measure = measureFor(leaf, v);
  if (measure.value === null) return { result: 'DOES_NOT_APPLY', reason: `${leaf.applies_to}: ${measure.basis}` };
  if (measure.value === undefined || leaf.value === undefined) return { result: 'UNDETERMINED', reason: `${leaf.applies_to}: ${measure.basis} unknown` };
  return compare(measure.value, leaf.operator, leaf.value)
    ? { result: 'APPLIES', reason: `${measure.basis} ${measure.value} ${leaf.operator} ${leaf.value} ${leaf.unit}` }
    : { result: 'DOES_NOT_APPLY', reason: `${measure.basis} ${measure.value} not ${leaf.operator} ${leaf.value} ${leaf.unit}` };
}

function evaluateWeight(weight: Weight, v: VehicleQuery): { result: Applicability; reasons: string[] } {
  if ('any_of' in weight && weight.any_of || 'all_of' in weight && weight.all_of) {
    const any = 'any_of' in weight && weight.any_of;
    const parts = ((any || (weight as { all_of: Weight[] }).all_of) as Weight[]).map(part => evaluateWeight(part, v));
    const reasons = parts.flatMap(part => part.reasons);
    if (any) return { result: parts.some(p => p.result === 'APPLIES') ? 'APPLIES' : parts.every(p => p.result === 'DOES_NOT_APPLY') ? 'DOES_NOT_APPLY' : 'UNDETERMINED', reasons };
    return { result: parts.some(p => p.result === 'DOES_NOT_APPLY') ? 'DOES_NOT_APPLY' : parts.every(p => p.result === 'APPLIES') ? 'APPLIES' : 'UNDETERMINED', reasons };
  }
  const leaf = evaluateLeaf(weight as Leaf, v);
  return { result: leaf.result, reasons: [leaf.reason] };
}

export type PublishedEvent = {
  uid: string; ban_id: string; jurisdiction: string; title: string; starts_at: string; ends_at: string; timezone: string;
  date: string; start_time: string; end_time: string; roads: string[]; regions: string[]; direction: string;
  weight_threshold: Weight; vehicle_scope: string; exceptions: string[]; restriction_types: string[];
  source_id: string; source_url: string; source_authority: string; source_version: string; legal_basis: string;
  verified_at: string; sequence: number; adr_relevance?: string; exceptional_relevance?: string;
};

export function evaluateVehicleApplicability(event: Pick<PublishedEvent, 'weight_threshold' | 'exceptions' | 'restriction_types' | 'adr_relevance' | 'exceptional_relevance'>, input: VehicleQuery) {
  const vehicle = vehicleQuerySchema.parse(input);
  const evaluation = evaluateWeight(event.weight_threshold, vehicle);
  const notes: string[] = [];
  if (vehicle.exceptionalTransport) notes.push(event.restriction_types.includes('exceptional') ? `Exceptional transport: ${event.exceptional_relevance ?? 'permit conditions apply'}` : 'Rule is not marked for exceptional transport; the permit may still restrict times.');
  if (vehicle.adr) notes.push(event.adr_relevance ?? 'Check the national ADR regime separately.');
  return { status: evaluation.result, reasons: evaluation.reasons, exceptions_not_evaluated: event.exceptions, notes };
}

export const routeSegmentSchema = z.object({
  jurisdiction: z.string().refine(isTrackedJurisdiction, 'Untracked jurisdiction'),
  region: z.string().min(1).optional(),
  roads: z.array(z.string().min(1).max(80)).max(50).default([]),
  enterAt: z.string().datetime(),
  exitAt: z.string().datetime(),
}).strict().refine(segment => segment.enterAt < segment.exitAt, 'Segment must end after it starts');
export const routeQuerySchema = z.object({ segments: z.array(routeSegmentSchema).min(1).max(100) }).strict();
export type RouteQuery = z.infer<typeof routeQuerySchema>;

const GENERIC = /\b(network|whole|entire|all public roads|all roads)\b/i;
const roadToken = (value: string) => value.toUpperCase().replace(/[\s-]/g, '');
const roadIds = (text: string) => (text.match(/\b(?:[A-Z]{1,3}[- ]?\d{1,4}[A-Z]?)\b/g) || []).map(roadToken);

type JurisdictionView = { jurisdiction: string; coverage_complete: boolean; verification_state: string; ban_state: string };
export function findRouteConflicts(view: { events: PublishedEvent[]; jurisdictions: JurisdictionView[]; window: { from: string; to: string } }, input: RouteQuery, vehicleInput?: VehicleQuery) {
  const route = routeQuerySchema.parse(input);
  const conflicts: Array<Record<string, unknown>> = [];
  const gaps: Array<Record<string, unknown>> = [];
  route.segments.forEach((segment, index) => {
    const coverage = view.jurisdictions.find(row => row.jurisdiction === segment.jurisdiction);
    if (!coverage?.coverage_complete) gaps.push({ segment: index, jurisdiction: segment.jurisdiction, verification_state: coverage?.verification_state ?? 'UNVERIFIED', reason: 'Jurisdiction coverage is not completely verified; missing events are not evidence of no ban.' });
    if (segment.enterAt.slice(0, 10) < view.window.from || segment.exitAt.slice(0, 10) > view.window.to) gaps.push({ segment: index, jurisdiction: segment.jurisdiction, reason: `Segment time is outside the published window ${view.window.from}-${view.window.to}.` });
    const wanted = new Set(segment.roads.flatMap(roadIds));
    for (const event of view.events) {
      if (event.jurisdiction !== segment.jurisdiction || event.ends_at <= segment.enterAt || event.starts_at >= segment.exitAt) continue;
      if (segment.region && event.regions.length && !event.regions.includes(segment.region)) continue;
      const network = !event.roads.length || event.roads.some(road => GENERIC.test(road));
      const eventRoads = new Set(event.roads.flatMap(roadIds));
      // Only a rule that names specific roads can be excluded by road numbers; a road-class scope
      // ("Motorways", "Class I roads") cannot be matched against numbers and stays a possible conflict.
      const specific = !network && eventRoads.size > 0;
      const roadMatch = [...wanted].some(id => eventRoads.has(id));
      if (specific && wanted.size && !roadMatch) continue;
      const vehicle = vehicleInput ? evaluateVehicleApplicability(event, vehicleInput) : null;
      if (vehicle?.status === 'DOES_NOT_APPLY') continue;
      const match = network ? 'NETWORK_WIDE' : !specific ? 'ROAD_CLASS_SCOPE' : roadMatch ? 'ROAD_MATCH' : 'ROADS_NOT_SPECIFIED_BY_ROUTE';
      conflicts.push({
        segment: index, uid: event.uid, ban_id: event.ban_id, jurisdiction: event.jurisdiction, title: event.title,
        starts_at: event.starts_at, ends_at: event.ends_at, local_time: `${event.date} ${event.start_time}-${event.end_time} (${event.timezone})`,
        match,
        certainty: (match === 'NETWORK_WIDE' || match === 'ROAD_MATCH') && vehicle?.status !== 'UNDETERMINED' ? 'LIKELY' : 'POSSIBLE',
        direction: event.direction, vehicle, source: { source_id: event.source_id, url: event.source_url, authority: event.source_authority, version: event.source_version },
      });
    }
  });
  return { status: gaps.length ? 'INSUFFICIENT_VERIFIED_DATA' : 'OK', conflicts, gaps };
}
