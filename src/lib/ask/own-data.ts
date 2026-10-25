// DAJC's own verified data, read-only (§47.2 step 2).
//
// Driving bans come from the canonical dataset through the same pure engine
// as /driving-bans (src/lib/driving-bans/core.mjs). Only ACTIVE,
// PRIMARY_VERIFIED rules expand into events, and an event is used only for
// a date inside the reviewed window. The facts of an event (country, date,
// local time, weight, roads, legal basis, source) are rendered by template
// (facts.ts); the model only writes digit-free wording around them.
//
// Missing events are never presented as "no ban" (the same rule as the ICS
// feed: "Missing events are NOT evidence of no ban"); a jurisdiction without
// a verified event, or a date outside the window, is answered from official
// websites instead.
//
// EU Oversize Weekly findings are all `confidence: "unverified"`, so they
// are never facts here - only official-tier finding URLs serve as leads,
// re-fetched and checked like any search result.

import { canonicalDrivingBans } from '../../../config/driving-ban-calendars/canonical.mjs';
import { coverageName } from '../../../config/europe-coverage.mjs';
import { expandRules } from '../driving-bans/core.mjs';
import { isAllowedSourceUrl } from './official-sources';

export type Topic = 'driving_ban' | 'oversize_permit' | 'dimensions_weights' | 'escort' | 'road_restriction' | 'toll' | 'other';
export type Coverage = 'complete' | 'partial' | 'missing' | 'stale';

export interface WeightThreshold {
  operator?: string;
  value?: number;
  unit?: string;
  applies_to?: string;
  any_of?: WeightThreshold[];
  all_of?: WeightThreshold[];
}

/** Template input for one verified driving-ban event. Values stay in the dataset's wording. */
export interface DrivingBanFacts {
  jurisdiction: string;
  country: string;
  restriction: string;
  localTime: string;
  vehicles: string;
  weight: string;
  roads: string;
  regions: string;
  direction: string;
  exceptions: string;
  legalBasis: string;
  authority: string;
  sourceUrl: string;
  verified: string;
}

export interface OwnRecord {
  id: string;
  jurisdiction: string;
  facts: DrivingBanFacts;
  /** The record exactly as the models see it; statements must quote it verbatim. */
  text: string;
}

export interface CanonicalLike {
  window: { from: string; to: string };
  sources: Array<{ source_id: string; url: string; role: string }>;
  rules: unknown[];
  jurisdictions: Array<{
    jurisdiction: string;
    verification_state: string;
    coverage_complete: boolean;
    ban_state: string;
    source_ids: string[];
  }>;
}

export interface OwnLookup {
  records: OwnRecord[];
  coverage: Record<string, Coverage>;
  /** Official URLs worth reading when own data are missing or stale. */
  leads: string[];
}

const MAX_RECORDS = 12;
const MAX_LEADS_PER_JURISDICTION = 2;
export const MAX_RECORD_CHARS = 3000;

function formatNumber(value: number): string {
  return String(Math.round(value * 100) / 100);
}

export function formatWeight(w: WeightThreshold | undefined): string {
  if (!w) return '';
  if (Array.isArray(w.any_of)) return w.any_of.map(formatWeight).join('; or ');
  if (Array.isArray(w.all_of)) return w.all_of.map(formatWeight).join('; and ');
  const scope = w.applies_to ? ` (${w.applies_to})` : '';
  if (w.operator === 'any') return `any mass${scope}`;
  if (typeof w.value !== 'number') return w.applies_to || '';
  if (w.unit === 'kg') return `${w.operator} ${formatNumber(w.value / 1000)} t${scope}`;
  if (w.unit === 'm') return `${w.operator} ${formatNumber(w.value)} m${scope}`;
  return `${w.operator} ${formatNumber(w.value)} ${w.unit || ''}${scope}`.trim();
}

interface ExpandedEvent {
  uid: string;
  jurisdiction: string;
  title: string;
  date: string;
  end_date: string;
  start_time: string;
  end_time: string;
  timezone: string;
  vehicle_scope: string;
  weight_threshold: WeightThreshold;
  roads: string[];
  regions: string[];
  direction?: string;
  exceptions: string[];
  legal_basis: string;
  source_authority: string;
  source_url: string;
  verified_at: string;
}

export function eventFacts(event: ExpandedEvent): DrivingBanFacts {
  return {
    jurisdiction: event.jurisdiction,
    country: `${coverageName(event.jurisdiction)} (${event.jurisdiction})`,
    restriction: event.title,
    localTime: `${event.date} ${event.start_time} – ${event.end_date} ${event.end_time} (${event.timezone})`,
    vehicles: event.vehicle_scope,
    weight: formatWeight(event.weight_threshold),
    roads: (event.roads || []).join('; '),
    regions: (event.regions || []).join('; '),
    direction: event.direction || '',
    exceptions: (event.exceptions || []).join(' '),
    legalBasis: event.legal_basis,
    authority: event.source_authority,
    sourceUrl: event.source_url,
    verified: String(event.verified_at || '').slice(0, 10),
  };
}

/** Plain English record for the models. Statements about it quote it verbatim. */
export function recordText(f: DrivingBanFacts): string {
  return [
    `DAJC verified driving-ban record. Country: ${f.country}.`,
    `Restriction: ${f.restriction}.`,
    `Local time: ${f.localTime}.`,
    `Vehicles: ${f.vehicles}`,
    f.weight && `Weight condition: ${f.weight}.`,
    f.roads && `Roads: ${f.roads}.`,
    f.regions && `Regions: ${f.regions}.`,
    f.direction && `Direction: ${f.direction}.`,
    f.exceptions && `Exceptions: ${f.exceptions.slice(0, 1200)}`,
    `Legal basis: ${f.legalBasis}.`,
    `Authority: ${f.authority}.`,
    `Verified by DAJC: ${f.verified}.`,
  ].filter(Boolean).join('\n').slice(0, MAX_RECORD_CHARS);
}

export function isoDay(date: Date, timeZone = 'Europe/Prague'): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

function shift(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/** Dates asked about, or the next seven days when the question names none. */
export function datesToCheck(dates: string[], now: Date): string[] {
  if (dates.length > 0) return [...new Set(dates)].sort();
  const today = isoDay(now);
  return Array.from({ length: 7 }, (_, i) => shift(today, i));
}

export function lookupDrivingBans(
  { jurisdictions, dates }: { jurisdictions: string[]; dates: string[] },
  { data = canonicalDrivingBans as unknown as CanonicalLike, now = new Date() }: { data?: CanonicalLike; now?: Date } = {},
): OwnLookup {
  const days = datesToCheck(dates, now);
  const records: OwnRecord[] = [];
  const coverage: Record<string, Coverage> = {};
  const leads: string[] = [];
  // Days outside the reviewed window have no verified data at all.
  const inside = days.filter((day) => day >= data.window.from && day <= data.window.to);
  const someOutside = inside.length < days.length;
  const eventsByDay = new Map(inside.map((day) => [day, expandRules(data, { from: day, to: day }) as ExpandedEvent[]]));

  for (const code of jurisdictions) {
    const row = data.jurisdictions.find((j) => j.jurisdiction === code);
    const events = inside.flatMap((day) => eventsByDay.get(day)!.filter((e) => e.jurisdiction === code));
    const unique = [...new Map(events.map((e) => [e.uid, e])).values()];
    if (unique.length === 0) coverage[code] = someOutside ? 'stale' : 'missing';
    else if (someOutside) coverage[code] = 'partial';
    else coverage[code] = row?.verification_state === 'PRIMARY_VERIFIED' && row.coverage_complete ? 'complete' : 'partial';

    for (const event of unique) {
      if (records.length >= MAX_RECORDS) break;
      const facts = eventFacts(event);
      records.push({ id: `dajc:${event.uid.replace(/@.*$/, '')}`, jurisdiction: code, facts, text: recordText(facts) });
    }

    if (coverage[code] !== 'complete') {
      const ids = new Set(row?.source_ids || []);
      const urls = data.sources
        .filter((s) => ids.has(s.source_id) && s.role === 'PRIMARY' && isAllowedSourceUrl(s.url))
        .map((s) => s.url);
      leads.push(...[...new Set(urls)].slice(0, MAX_LEADS_PER_JURISDICTION));
    }
  }
  return { records, coverage, leads };
}

// --- EU Oversize Weekly findings as leads only --------------------------------

export interface FindingLike {
  jurisdiction?: string;
  type?: string;
  sourceUrl?: string;
  sourceTier?: string | null;
  publishedAt?: string | null;
}

const TOPIC_TYPES: Record<Topic, string[]> = {
  driving_ban: ['driving_ban'],
  oversize_permit: ['permit_change', 'permit_system'],
  dimensions_weights: ['bridge_restriction', 'tunnel_restriction', 'operational_change', 'equipment'],
  escort: ['escort_requirement', 'police_escort'],
  road_restriction: ['road_closure', 'roadworks', 'route_restriction', 'bridge_restriction', 'tunnel_restriction', 'border_restriction'],
  toll: ['operational_change'],
  other: [],
};

let findingCache: FindingLike[] | null = null;

function loadFindings(): FindingLike[] {
  if (findingCache) return findingCache;
  const modules = import.meta.glob('../../../data/oversize/*/findings.json', { eager: true, import: 'default' }) as Record<string, { findings?: FindingLike[] }>;
  findingCache = Object.keys(modules).sort().reverse().flatMap((key) => modules[key]?.findings || []);
  return findingCache;
}

export function findingLeads(
  { jurisdictions, topic }: { jurisdictions: string[]; topic: Topic },
  { findings = loadFindings(), max = 2 }: { findings?: FindingLike[]; max?: number } = {},
): string[] {
  const types = new Set(TOPIC_TYPES[topic] || []);
  if (types.size === 0) return [];
  const urls = findings
    .filter((f) => f.jurisdiction && jurisdictions.includes(f.jurisdiction) && f.type && types.has(f.type))
    .filter((f) => f.sourceUrl && f.sourceTier === 'official' && isAllowedSourceUrl(f.sourceUrl))
    .sort((a, b) => String(b.publishedAt || '').localeCompare(String(a.publishedAt || '')))
    .map((f) => f.sourceUrl as string);
  return [...new Set(urls)].slice(0, max);
}

/** URLs DAJC already holds (canonical sources and findings) - not "new" for the review queue. */
export function knownSourceUrls(data: CanonicalLike = canonicalDrivingBans as unknown as CanonicalLike, findings: FindingLike[] = loadFindings()): Set<string> {
  return new Set([...data.sources.map((s) => s.url), ...findings.map((f) => f.sourceUrl).filter((u): u is string => Boolean(u))]);
}
