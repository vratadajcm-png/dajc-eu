// DAJC's own verified data, read-only (§47.2 step 2).
//
// Driving bans come only from the published Driving Bans snapshot, read through
// driving-bans-adapter.ts (readPublishedDrivingBans: the same data as
// /driving-bans, JSON and ICS) and evaluated by the shared contract of Driving
// Bans 2.0 (answerFreeAskQuery). There is no second registry, no own expansion
// and no cache here. The free Ask never needs a paid Intelligence entitlement
// and uses only the free tools.
//
// Per country and asked day the contract answers BAN_FOUND, NO_CONFIRMED_BAN
// (the country is verified in full for the published period and no verified
// ban applies) or INSUFFICIENT_VERIFIED_DATA. Missing data are never presented
// as "no ban"; official websites may then be searched, but their content stays
// an unverified lead for the Driving Bans review layer.
//
// The facts of an event (country, date, local time, weight, roads, legal
// basis, source) are rendered by template (facts.ts); the model only writes
// digit-free wording around them.
//
// EU Oversize Weekly findings are all `confidence: "unverified"`, so they
// are never facts here - only official-tier finding URLs serve as leads for
// the other topics, re-fetched and checked like any search result. Driving
// bans take no Weekly leads: the registry and its own primary sources are the
// only DAJC source, official-domain search the only web path.
//
// Future extension, not implemented: alternative departure times or routes
// around a ban. Any such suggestion must always be labelled as a
// recommendation ("doporučení"), never as an authorisation to drive, a
// decision on an exception or a change of an approved route.

import { coverageName } from '../../../config/europe-coverage.mjs';
import { localToUtc, shiftDate } from '../driving-bans/core.mjs';
import { JURISDICTION_TIMEZONES } from '../driving-bans/rule-checks.mjs';
import { answerFreeAskQuery, type JurisdictionOutcome, type PublishedView } from '../intelligence/driving-bans-ai-contract';
import { readPublishedDrivingBans } from '../intelligence/driving-bans-adapter';
import type { PublishedEvent } from '../intelligence/driving-bans-relevance';
import { isAllowedSourceUrl } from './official-sources';

export type Topic = 'driving_ban' | 'oversize_permit' | 'dimensions_weights' | 'escort' | 'road_restriction' | 'toll' | 'other';
export type { JurisdictionOutcome };

/** The published snapshot plus its sources (getDrivingBansSnapshot). */
export type DrivingBansView = PublishedView & { sources: Array<{ source_id: string; url: string; role: string }> };

export interface WeightThreshold {
  operator?: string;
  value?: number;
  unit?: string;
  applies_to?: string;
  any_of?: WeightThreshold[];
  all_of?: WeightThreshold[];
}

/** Template input for one verified driving-ban record. Values stay in the dataset's wording. */
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

/** Verification state of one asked country, shown with every driving-ban answer. */
export interface JurisdictionVerification {
  jurisdiction: string;
  /** INSUFFICIENT_VERIFIED_DATA when any asked day is not decided by the registry. */
  outcome: JurisdictionOutcome;
  days: Array<{ date: string; outcome: JurisdictionOutcome }>;
  coverageComplete: boolean;
  verificationState: string;
  lastVerified: string | null;
  period: { from: string; to: string };
  /** The contract asks for a check with the official source (incomplete coverage, exceptions, undecided days). */
  authorityCheckRequired: boolean;
}

export interface OwnLookup {
  records: OwnRecord[];
  verification: Record<string, JurisdictionVerification>;
  /** Official URLs worth reading when the registry cannot decide. */
  leads: string[];
}

const MAX_RECORDS = 12;
const MAX_LEADS_PER_JURISDICTION = 2;
export const MAX_RECORD_CHARS = 3000;
export const REGISTRY_URL = 'https://www.dajc.eu/driving-bans';

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

type ExpandedEvent = PublishedEvent & { end_date: string };

export function eventFacts(event: ExpandedEvent): DrivingBanFacts {
  return {
    jurisdiction: event.jurisdiction,
    country: `${coverageName(event.jurisdiction)} (${event.jurisdiction})`,
    restriction: event.title,
    localTime: `${event.date} ${event.start_time} – ${event.end_date} ${event.end_time} (${event.timezone})`,
    vehicles: event.vehicle_scope,
    weight: formatWeight(event.weight_threshold as WeightThreshold),
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
    f.exceptions && `Exceptions (listed, not assessed for any transport): ${f.exceptions.slice(0, 1200)}`,
    `Legal basis: ${f.legalBasis}.`,
    `Authority: ${f.authority}.`,
    `Verified by DAJC: ${f.verified}.`,
  ].filter(Boolean).join('\n').slice(0, MAX_RECORD_CHARS);
}

export const NO_CONFIRMED_BAN_FINDING = 'The DAJC registry contains no verified legal driving ban for the days listed.';

/** A registry statement for a fully verified country without a verified ban on the asked days. */
export function noConfirmedBanRecord(code: string, days: string[], timezone: string, lastVerified: string | null): OwnRecord {
  const facts: DrivingBanFacts = {
    jurisdiction: code,
    country: `${coverageName(code)} (${code})`,
    restriction: 'No verified legal driving ban in the DAJC registry',
    localTime: `${days.join('; ')} (${timezone})`,
    vehicles: '', weight: '', roads: '', regions: '', direction: '', exceptions: '', legalBasis: '',
    authority: 'DAJC Driving Bans registry',
    sourceUrl: REGISTRY_URL,
    verified: String(lastVerified || '').slice(0, 10),
  };
  const text = [
    `DAJC verified registry statement. Country: ${facts.country}.`,
    `Finding: ${NO_CONFIRMED_BAN_FINDING}`,
    `Days: ${facts.localTime}.`,
    'Scope: The country is verified in full for the published period. Temporary traffic restrictions, roadworks and permit conditions are not part of the registry.',
    `Authority: ${facts.authority}.`,
    `Verified by DAJC: ${facts.verified}.`,
  ].join('\n');
  return { id: `dajc:no-confirmed-ban:${code.toLowerCase()}`, jurisdiction: code, facts, text };
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

export function timezoneOf(code: string): string {
  return (JURISDICTION_TIMEZONES as Record<string, string[]>)[code]?.[0] ?? 'Europe/Prague';
}

/** The published snapshot through the Driving Bans adapter: the only source of verified driving-ban facts. */
export function publishedView(now: Date): DrivingBansView {
  return readPublishedDrivingBans(now) as unknown as DrivingBansView;
}

export function lookupDrivingBans(
  { jurisdictions, dates }: { jurisdictions: string[]; dates: string[] },
  { view, now = new Date() }: { view?: DrivingBansView; now?: Date } = {},
): OwnLookup {
  const published = view ?? publishedView(now);
  const days = datesToCheck(dates, now);
  const records: OwnRecord[] = [];
  const verification: Record<string, JurisdictionVerification> = {};
  const leads: string[] = [];
  const byUid = new Map(published.events.map((event) => [event.uid, event as ExpandedEvent]));

  for (const code of jurisdictions) {
    const row = published.jurisdictions.find((j) => j.jurisdiction === code);
    const timezone = timezoneOf(code);
    const perDay = days.map((date) => {
      const answer = answerFreeAskQuery({
        tool: 'search_bans',
        input: { jurisdictions: [code], from: localToUtc(date, '00:00', timezone), to: localToUtc(shiftDate(date, 1), '00:00', timezone) },
        view: published,
      });
      const outcome = (answer.completeness.find((c) => c.jurisdiction === code)?.outcome ?? 'INSUFFICIENT_VERIFIED_DATA') as JurisdictionOutcome;
      return { date, outcome, authority: answer.authority_check_required, uids: answer.facts.map((fact) => String(fact.uid)) };
    });
    const outcomes = perDay.map((d) => d.outcome);
    const outcome: JurisdictionOutcome = outcomes.includes('INSUFFICIENT_VERIFIED_DATA') ? 'INSUFFICIENT_VERIFIED_DATA'
      : outcomes.includes('BAN_FOUND') ? 'BAN_FOUND' : 'NO_CONFIRMED_BAN';
    verification[code] = {
      jurisdiction: code,
      outcome,
      days: perDay.map(({ date, outcome: o }) => ({ date, outcome: o })),
      coverageComplete: Boolean(row?.coverage_complete),
      verificationState: row?.verification_state ?? 'UNVERIFIED',
      lastVerified: row?.last_verified ?? null,
      period: { from: published.window.from, to: published.window.to },
      authorityCheckRequired: perDay.some((d) => d.authority),
    };

    for (const uid of [...new Set(perDay.flatMap((d) => d.uids))]) {
      const event = byUid.get(uid);
      if (!event || records.length >= MAX_RECORDS) continue;
      const facts = eventFacts(event);
      records.push({ id: `dajc:${uid.replace(/@.*$/, '')}`, jurisdiction: code, facts, text: recordText(facts) });
    }
    const quiet = perDay.filter((d) => d.outcome === 'NO_CONFIRMED_BAN').map((d) => d.date);
    if (quiet.length > 0 && records.length < MAX_RECORDS) records.push(noConfirmedBanRecord(code, quiet, timezone, row?.last_verified ?? null));

    if (outcome === 'INSUFFICIENT_VERIFIED_DATA') {
      const ids = new Set((row as { source_ids?: string[] } | undefined)?.source_ids || []);
      const urls = published.sources
        .filter((s) => ids.has(s.source_id) && s.role === 'PRIMARY' && isAllowedSourceUrl(s.url))
        .map((s) => s.url);
      leads.push(...[...new Set(urls)].slice(0, MAX_LEADS_PER_JURISDICTION));
    }
  }
  return { records, verification, leads };
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
  // Driving bans: the registry is the only DAJC source (see the header).
  driving_ban: [],
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

/**
 * URLs DAJC already holds - not "new" for the review queue. For driving bans only the
 * registry's own sources count: a page known only from the Weekly is still new to the
 * Driving Bans review layer.
 */
export function knownSourceUrls(view: Pick<DrivingBansView, 'sources'>, findings: FindingLike[] = loadFindings(), topic?: Topic): Set<string> {
  const registry = view.sources.map((s) => s.url);
  if (topic === 'driving_ban') return new Set(registry);
  return new Set([...registry, ...findings.map((f) => f.sourceUrl).filter((u): u is string => Boolean(u))]);
}
