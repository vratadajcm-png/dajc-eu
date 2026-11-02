import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { sep } from 'node:path';
import { z } from 'zod';
import Parser from 'rss-parser';
import { isTrackedJurisdiction } from '../../../config/europe-coverage.mjs';
import { intelligenceSourceRightsSchema, type IntelligenceSourceRights } from './persistence-contract';
import { validateSourceSnapshot, type IntelligenceSourceSnapshot } from './source-adapter';

/**
 * Contract for future Driving Bans data connectors (DATEX II, TN-ITS, OGC API,
 * WFS/WMS, RSS/Atom, JSON/XML, HTML/PDF, provider-specific). A connector returns
 * retrieved records with provenance, timing, licence, territorial scope, a
 * completeness verdict and normalised restriction proposals.
 *
 * Connector output never reaches canonical.json directly: it becomes an evidence
 * submission for the review workflow (unverified, reviewed by a person) and,
 * separately, an Intelligence snapshot. Operational feeds can never propose a
 * LEGAL_DRIVING_BAN. In this phase only local fixture connectors exist: no network
 * polling, no authentication, no API keys.
 */

export const CONNECTOR_PROTOCOLS = ['DATEX_II', 'TN_ITS', 'OGC_API', 'WFS', 'WMS', 'RSS_ATOM', 'JSON', 'XML', 'HTML_PDF', 'PROVIDER_SPECIFIC'] as const;
// Feeds that describe traffic operation or infrastructure, not legislation.
export const OPERATIONAL_PROTOCOLS = new Set<string>(['DATEX_II', 'TN_ITS', 'OGC_API', 'WFS', 'WMS', 'RSS_ATOM']);
const RESTRICTION_CLASSES = ['LEGAL_DRIVING_BAN', 'TEMPORARY_TRAFFIC_RESTRICTION', 'INFRASTRUCTURE_CONSTRAINT', 'PERMIT_CONDITION'] as const;

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const jurisdiction = z.string().refine(isTrackedJurisdiction, 'Untracked jurisdiction');
export const normalizedRestrictionProposalSchema = z.object({
  restriction_class: z.enum(RESTRICTION_CLASSES),
  jurisdiction, region: z.string().min(1).nullable(),
  roads: z.array(z.string().min(1)).max(50), direction: z.string().min(1),
  vehicle_scope: z.string().min(1), weight_threshold: z.record(z.string(), z.unknown()),
  valid_from: date, valid_to: date, start_time: z.string().regex(/^\d{2}:\d{2}$/), end_time: z.string().regex(/^(\d{2}:\d{2})$/), end_day_offset: z.number().int().min(0).max(7),
  timezone: z.string().includes('/'), legal_basis: z.string().nullable(), exceptions: z.array(z.string()), summary: z.string().min(1).max(2000),
}).strict().refine(p => p.valid_from <= p.valid_to, 'valid_from after valid_to');

export const retrievedRecordSchema = z.object({
  record_id: z.string().min(1).max(200), source_id: z.string().min(1).max(160), provider_record_id: z.string().min(1).max(200),
  provenance: z.object({ source_url: z.string().url().startsWith('https://').nullable(), licence: z.string().min(1), distribution_policy: z.enum(['internal-only', 'derived-only', 'redistribution-allowed', 'unknown']) }).strict(),
  published_at: z.string().datetime().nullable(), observed_at: z.string().datetime(),
  territorial_scope: z.object({ jurisdiction, region: z.string().nullable(), roads: z.array(z.string()) }).strict(),
  content_sha256: z.string().regex(/^[0-9a-f]{64}$/), media_type: z.string().min(1),
  proposals: z.array(normalizedRestrictionProposalSchema),
}).strict();

export const connectorResultSchema = z.object({
  connector_id: z.string().min(1).max(120), source_id: z.string().min(1).max(160), protocol: z.enum(CONNECTOR_PROTOCOLS),
  observed_at: z.string().datetime(), status: z.enum(['OK', 'PARTIAL', 'FAILED']), complete: z.boolean(),
  records: z.array(retrievedRecordSchema), warnings: z.array(z.string()),
}).strict().refine(result => result.status === 'OK' || !result.complete, 'Only an OK retrieval can be complete');
export type ConnectorResult = z.infer<typeof connectorResultSchema>;

export interface DrivingBanConnector {
  readonly connectorId: string;
  readonly sourceId: string;
  readonly protocol: (typeof CONNECTOR_PROTOCOLS)[number];
  readonly rights: IntelligenceSourceRights;
  readonly fixtureOnly: boolean;
  retrieve(context: { now: Date }): Promise<ConnectorResult>;
}

/** Validate a connector result and refuse legal-ban proposals from operational feeds. */
export function validateConnectorResult(result: unknown): ConnectorResult {
  const parsed = connectorResultSchema.parse(result);
  if (OPERATIONAL_PROTOCOLS.has(parsed.protocol)) {
    for (const record of parsed.records) for (const proposal of record.proposals) {
      if (proposal.restriction_class === 'LEGAL_DRIVING_BAN') throw new Error(`${parsed.protocol} feed cannot propose a LEGAL_DRIVING_BAN (${record.record_id})`);
    }
  }
  for (const record of parsed.records) if (record.source_id !== parsed.source_id) throw new Error(`Record ${record.record_id} belongs to another source`);
  return parsed;
}

const FIXTURE_ROOT = new URL('../../../tests/fixtures/driving-ban-connectors/', import.meta.url);
/** Fixture connectors read only files inside tests/fixtures/driving-ban-connectors. */
function readFixture(file: string): Buffer {
  const root = realpathSync(FIXTURE_ROOT);
  const real = realpathSync(new URL(file, FIXTURE_ROOT));
  if (!real.startsWith(root + sep)) throw new Error('Fixture connectors read only local fixture files');
  return readFileSync(real);
}
const sha256 = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
const tag = (xml: string, name: string) => xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([^<]*)</${name}>`))?.[1]?.trim() ?? null;
const OPERATORS: Record<string, string> = { greaterThan: '>', greaterThanOrEqualTo: '>=', lessThan: '<', lessThanOrEqualTo: '<=', equalTo: '=' };

/** Minimal, fixture-only DATEX II reader: situation records with validity, road and gross-weight characteristics. */
export function createDatex2FixtureConnector(args: { connectorId: string; sourceId: string; jurisdiction: string; timezone: string; fixture: string; rights: IntelligenceSourceRights; licence: string; sourceUrl: string | null }): DrivingBanConnector {
  const rights = intelligenceSourceRightsSchema.parse(args.rights);
  return {
    connectorId: args.connectorId, sourceId: args.sourceId, protocol: 'DATEX_II', rights, fixtureOnly: true,
    async retrieve({ now }) {
      const bytes = readFixture(args.fixture);
      const xml = bytes.toString('utf8');
      if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('DTDs and entities are not accepted');
      const warnings: string[] = [];
      const records = [...xml.matchAll(/<situationRecord\b[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/situationRecord>/g)].map(([block, id, body]) => {
        const start = tag(body, 'overallStartTime'), end = tag(body, 'overallEndTime'), road = tag(body, 'roadNumber');
        const operator = OPERATORS[tag(body, 'comparisonOperator') ?? ''], tonnes = Number(tag(body, 'grossVehicleWeight'));
        const proposals = [];
        // A DATEX validity is one continuous interval; it is kept as such (start date + day offset), never split into daily windows.
        const spanDays = start && end ? Math.round((Date.parse(`${end.slice(0, 10)}T00:00:00Z`) - Date.parse(`${start.slice(0, 10)}T00:00:00Z`)) / 86_400_000) : NaN;
        if (start && end && operator && Number.isFinite(tonnes) && spanDays >= 0 && spanDays <= 7) {
          proposals.push(normalizedRestrictionProposalSchema.parse({
            restriction_class: 'TEMPORARY_TRAFFIC_RESTRICTION', jurisdiction: args.jurisdiction, region: null,
            roads: road ? [road] : [], direction: 'Both directions unless stated otherwise', vehicle_scope: `Vehicles with gross weight ${operator} ${tonnes} t (DATEX II grossWeightCharacteristic)`,
            weight_threshold: { operator, value: Math.round(tonnes * 1000), unit: 'kg', applies_to: 'gross vehicle weight (DATEX II grossWeightCharacteristic)' },
            valid_from: start.slice(0, 10), valid_to: end.slice(0, 10), start_time: start.slice(11, 16), end_time: end.slice(11, 16), end_day_offset: spanDays,
            timezone: 'Etc/UTC', legal_basis: null, exceptions: [], summary: tag(body, 'value') ?? 'DATEX II situation record',
          }));
        } else warnings.push(`${id}: incomplete validity or vehicle characteristics, or a period longer than 7 days; no proposal`);
        return retrievedRecordSchema.parse({
          record_id: `${args.connectorId}:${id}`, source_id: args.sourceId, provider_record_id: id,
          provenance: { source_url: args.sourceUrl, licence: args.licence, distribution_policy: 'unknown' },
          published_at: tag(xml, 'publicationTime') ? new Date(tag(xml, 'publicationTime')!).toISOString() : null, observed_at: now.toISOString(),
          territorial_scope: { jurisdiction: args.jurisdiction, region: null, roads: road ? [road] : [] },
          content_sha256: sha256(block), media_type: 'application/xml', proposals,
        });
      });
      return validateConnectorResult({ connector_id: args.connectorId, source_id: args.sourceId, protocol: 'DATEX_II', observed_at: now.toISOString(), status: warnings.length ? 'PARTIAL' : 'OK', complete: !warnings.length, records, warnings: [...warnings, `Fixture data (${args.fixture}); not a live feed.`] });
    },
  };
}

/** Fixture-only RSS/Atom reader: notices become discovery records without restriction proposals. */
export function createRssFixtureConnector(args: { connectorId: string; sourceId: string; jurisdiction: string; fixture: string; rights: IntelligenceSourceRights; licence: string }): DrivingBanConnector {
  const rights = intelligenceSourceRightsSchema.parse(args.rights);
  return {
    connectorId: args.connectorId, sourceId: args.sourceId, protocol: 'RSS_ATOM', rights, fixtureOnly: true,
    async retrieve({ now }) {
      const bytes = readFixture(args.fixture);
      const feed = await new Parser().parseString(bytes.toString('utf8'));
      const records = (feed.items || []).map(item => retrievedRecordSchema.parse({
        record_id: `${args.connectorId}:${item.guid ?? item.link}`, source_id: args.sourceId, provider_record_id: String(item.guid ?? item.link),
        provenance: { source_url: item.link?.startsWith('https://') ? item.link : null, licence: args.licence, distribution_policy: 'unknown' },
        published_at: item.isoDate ?? null, observed_at: now.toISOString(),
        territorial_scope: { jurisdiction: args.jurisdiction, region: null, roads: [] },
        content_sha256: sha256(JSON.stringify(item)), media_type: 'application/rss+xml', proposals: [],
      }));
      return validateConnectorResult({ connector_id: args.connectorId, source_id: args.sourceId, protocol: 'RSS_ATOM', observed_at: now.toISOString(), status: 'OK', complete: true, records, warnings: [`Fixture data (${args.fixture}); not a live feed.`] });
    },
  };
}

/**
 * Turn connector output into an evidence submission for the review workflow
 * (src/lib/driving-bans/evidence-store.mjs). Proposed rules are UNVERIFIED and keep
 * their restriction class, so even an approved candidate publishes nothing until a
 * person verifies it against a primary legal source.
 */
export function connectorResultToSubmission(input: ConnectorResult, options: { submittedBy: string; jurisdiction: string; sourceIsCanonical: boolean; source: { url: string; authority: string; version: string }; synthetic: boolean; legalVerifiedAt: string | null }) {
  const result = validateConnectorResult(input);
  const files = result.records.map(record => ({ path: `records/${record.content_sha256}.json`, content: JSON.stringify(record, null, 1) }));
  const operations: Array<Record<string, unknown>> = options.sourceIsCanonical ? [] : [{ op: 'ADD_SOURCE', source: { source_id: result.source_id.replace(/[^a-z0-9_-]/g, '-'), url: options.source.url, authority: options.source.authority, role: 'PRIMARY', version: options.source.version, findings: `Connector ${result.connector_id} (${result.protocol}) observed ${result.records.length} records at ${result.observed_at}.` } }];
  const sourceId = options.sourceIsCanonical ? result.source_id : result.source_id.replace(/[^a-z0-9_-]/g, '-');
  for (const record of result.records) for (const [index, proposal] of record.proposals.entries()) {
    operations.push({ op: 'ADD_RULE', rule: {
      ban_id: `${proposal.jurisdiction.toLowerCase()}-${record.provider_record_id.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${index}`.slice(0, 120),
      jurisdiction: proposal.jurisdiction, title: proposal.summary.slice(0, 200), restriction_class: proposal.restriction_class,
      status: 'ACTIVE', verification_state: 'UNVERIFIED', sequence: 0, supersedes: [], restriction_types: ['general'],
      valid_from: proposal.valid_from, valid_to: proposal.valid_to, timezone: proposal.timezone,
      schedule: { kind: 'dates', start_time: proposal.start_time, end_time: proposal.end_time, end_day_offset: proposal.end_day_offset, dates: [{ date: proposal.valid_from, occurrence_id: proposal.valid_from }] },
      source_id: sourceId, evidence_ids: [sourceId], legal_basis: proposal.legal_basis ?? `Provider record ${record.provider_record_id} (not a legal instrument)`,
      vehicle_scope: proposal.vehicle_scope, weight_threshold: proposal.weight_threshold, roads: proposal.roads, regions: proposal.region ? [proposal.region] : [], direction: proposal.direction,
      exceptions: proposal.exceptions, adr_relevance: 'Not stated by the provider record.', exceptional_relevance: 'Not stated by the provider record.',
      notes: `Imported from connector ${result.connector_id}; operational data, not a legal driving ban.`,
    } });
  }
  return {
    files,
    submission: {
      submission_version: 1, synthetic: options.synthetic, submitted_by: options.submittedBy, jurisdiction: options.jurisdiction,
      summary: `Connector ${result.connector_id}: ${result.records.length} records, ${operations.filter(op => op.op === 'ADD_RULE').length} restriction proposals (${result.status}).`,
      documents: files.map(file => ({ path: file.path, source_id: sourceId, title: `Connector record ${file.path}`, retrieved_from: null, retrieved_at: result.observed_at })),
      links: [], legal_effective: null, legal_verified_at: options.legalVerifiedAt, operations,
    },
  };
}

/** Bridge to the existing Intelligence source-adapter snapshot (alerts and change history). */
export function connectorResultToIntelligenceSnapshot(input: ConnectorResult, provenance: { sourceLabel: string; sourceUrl?: string; licence: string }): IntelligenceSourceSnapshot {
  const result = validateConnectorResult(input);
  const topic = (cls: string) => cls === 'LEGAL_DRIVING_BAN' ? 'driving-ban' : cls === 'PERMIT_CONDITION' ? 'permit' : 'route-restriction';
  return validateSourceSnapshot({
    sourceId: result.source_id, observedAt: result.observed_at, complete: result.complete,
    provenance: { sourceLabel: provenance.sourceLabel, sourceUrl: provenance.sourceUrl, licence: provenance.licence, distributionPolicy: 'unknown' },
    items: result.records.flatMap(record => record.proposals.map((proposal, index) => ({
      key: `${record.record_id}#${index}`, jurisdiction: proposal.jurisdiction, topic: topic(proposal.restriction_class), materiality: 'medium',
      effectiveFrom: `${proposal.valid_from}T${proposal.start_time}:00.000Z`, effectiveTo: `${proposal.valid_to}T${proposal.end_time}:00.000Z`,
      summary: proposal.summary, payload: { restriction_class: proposal.restriction_class, roads: proposal.roads, weight_threshold: proposal.weight_threshold, provider_record_id: record.provider_record_id, content_sha256: record.content_sha256 },
    }))),
    warnings: result.warnings,
  });
}
