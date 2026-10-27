import { describe, expect, it } from 'vitest';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { canonicalDrivingBans, getDrivingBansSnapshot } from '../../../config/driving-ban-calendars/runtime.mjs';
import { authorizeFeature, handleEntitledRequest, isFeatureEnabled, requireSameTenant, tenantRecords, FEATURE_FLAG_ENV, DRIVING_BANS_INTELLIGENCE_RELEASED, type IntelligenceEntitlement } from './entitlements';
import { evaluateVehicleApplicability, findRouteConflicts } from './driving-bans-relevance';
import { legalChangeToIntelligenceChange, buildDrivingBansAlerts, buildRuleHistory, expiringRuleNotices } from './driving-bans-alerts';
import { answerDrivingBansQuery, AI_TOOLS, AI_PROHIBITED_ACTIONS } from './driving-bans-ai-contract';
import { createDatex2FixtureConnector, createRssFixtureConnector, validateConnectorResult, connectorResultToSubmission, connectorResultToIntelligenceSnapshot } from './driving-ban-connectors';
import { dajcMaintainedDrivingBansRights, intelligenceSourceRightsSchema } from './persistence-contract';
import { intelligencePreferenceSchema } from './preferences';
import { detectChanges } from '../driving-bans/legal-changes.mjs';
import { invalidateSources } from '../driving-bans/core.mjs';
import { importSubmission, validateStoredProposal } from '../driving-bans/evidence-store.mjs';
import rawCanonical from '../../../data/driving-bans/canonical.json';

const NOW = new Date('2026-10-22T10:00:00Z');
const view = getDrivingBansSnapshot(NOW);
const ON = { released: true, env: Object.fromEntries(Object.values(FEATURE_FLAG_ENV).map(name => [name, 'true'])) };
const subjectA = { organizationId: 'org-a', userId: 'user-1' };
const entitlementA: IntelligenceEntitlement = { organizationId: 'org-a', features: ['vehicle-aware', 'route-aware', 'alerts', 'history', 'organisation-preferences', 'ai-assistant'], validUntil: '2027-12-31T00:00:00.000Z' };
const event = (id: string, date?: string) => view.events.find((e: any) => e.ban_id === id && (!date || e.date === date));

describe('feature flags and entitlements', () => {
  it('keeps every paid feature off by default, even with the environment flag set', () => {
    expect(DRIVING_BANS_INTELLIGENCE_RELEASED).toBe(false);
    for (const feature of Object.keys(FEATURE_FLAG_ENV) as Array<keyof typeof FEATURE_FLAG_ENV>) {
      expect(isFeatureEnabled(feature, {})).toBe(false);
      expect(isFeatureEnabled(feature, { [FEATURE_FLAG_ENV[feature]]: 'true' })).toBe(false);
      expect(isFeatureEnabled(feature, { [FEATURE_FLAG_ENV[feature]]: 'true' }, true)).toBe(true);
      for (const value of ['TRUE', '1', 'yes', ' true']) expect(isFeatureEnabled(feature, { [FEATURE_FLAG_ENV[feature]]: value }, true)).toBe(false);
    }
  });

  it('authorises only an authenticated subject with a current entitlement of the same organisation', () => {
    const base = { feature: 'vehicle-aware' as const, now: NOW, ...ON };
    expect(authorizeFeature({ ...base, subject: subjectA, entitlement: entitlementA })).toEqual({ allowed: true, organizationId: 'org-a' });
    expect(authorizeFeature({ ...base, released: false, subject: subjectA, entitlement: entitlementA })).toMatchObject({ reason: 'FEATURE_DISABLED' });
    expect(authorizeFeature({ ...base, subject: null, entitlement: entitlementA })).toMatchObject({ reason: 'AUTHENTICATION_REQUIRED' });
    expect(authorizeFeature({ ...base, subject: subjectA, entitlement: { ...entitlementA, organizationId: 'org-b' } })).toMatchObject({ reason: 'TENANT_MISMATCH' });
    expect(authorizeFeature({ ...base, subject: subjectA, entitlement: { ...entitlementA, features: ['alerts'] } })).toMatchObject({ reason: 'NOT_ENTITLED' });
    expect(authorizeFeature({ ...base, subject: subjectA, entitlement: { ...entitlementA, validUntil: '2026-01-01T00:00:00.000Z' } })).toMatchObject({ reason: 'NOT_ENTITLED' });
  });

  it('serves paid results only through the server-side guard; URL or body parameters cannot change the organisation', async () => {
    const seen: string[] = [];
    const call = (url: string, options: any = {}) => handleEntitledRequest({
      feature: 'route-aware', request: new Request(url), now: NOW,
      resolveSubject: async request => (request.headers.get('x-test-session') === 'a' ? subjectA : null),
      resolveEntitlement: async org => (org === 'org-a' ? entitlementA : null),
      handler: async ({ organizationId }) => { seen.push(organizationId); return { organizationId }; },
      ...options,
    });
    expect((await call('https://www.dajc.eu/api/x?organizationId=org-b')).status).toBe(404);
    expect((await call('https://www.dajc.eu/api/x?organizationId=org-b', ON)).status).toBe(401);
    const response = await handleEntitledRequest({ feature: 'route-aware', request: new Request('https://www.dajc.eu/api/x?organizationId=org-b', { headers: { 'x-test-session': 'a' } }), now: NOW, resolveSubject: async () => subjectA, resolveEntitlement: async org => (org === 'org-a' ? entitlementA : null), handler: async ({ organizationId }) => ({ organizationId }), ...ON });
    expect(await response.json()).toEqual({ organizationId: 'org-a' });
    const other = await handleEntitledRequest({ feature: 'route-aware', request: new Request('https://www.dajc.eu/api/x'), now: NOW, resolveSubject: async () => ({ organizationId: 'org-b', userId: 'u' }), resolveEntitlement: async () => entitlementA, handler: async () => ({ leaked: true }), ...ON });
    expect(other.status).toBe(403);
    expect(seen).toEqual([]);
  });

  it('isolates tenant data and keeps the public Driving Bans endpoints free of paid gates', () => {
    const records = [{ organizationId: 'org-a', id: 1 }, { organizationId: 'org-b', id: 2 }];
    expect(tenantRecords(records, 'org-a')).toEqual([{ organizationId: 'org-a', id: 1 }]);
    expect(() => requireSameTenant(records[1], 'org-a')).toThrow(/Cross-tenant/);
    for (const file of ['src/pages/api/driving-bans.json.ts', 'src/pages/api/driving-bans.ics.ts', 'src/pages/driving-bans.astro']) expect(readFileSync(file, 'utf8')).not.toMatch(/entitlement|authorizeFeature/);
    // Any future paid Driving Bans endpoint must go through the shared guard.
    const apiDir = 'src/pages/api';
    for (const file of readdirSync(apiDir, { recursive: true }).map(String).filter(name => /intelligence|ai/i.test(name) && /\.(ts|js|mjs)$/.test(name))) expect(readFileSync(join(apiDir, file), 'utf8')).toContain('handleEntitledRequest');
  });
});

describe('vehicle-aware and route-aware evaluation', () => {
  it('evaluates real legal criteria and stays UNDETERMINED when data is missing', () => {
    const cz = event('cz-sunday');
    expect(evaluateVehicleApplicability(cz, { configuration: 'SOLO', motorVehicleMassKg: 12000 }).status).toBe('APPLIES');
    expect(evaluateVehicleApplicability(cz, { configuration: 'SOLO', motorVehicleMassKg: 7000 }).status).toBe('DOES_NOT_APPLY');
    expect(evaluateVehicleApplicability(cz, { configuration: 'TRUCK_TRAILER', motorVehicleMassKg: 5000, trailerMassKg: 3000 }).status).toBe('APPLIES');
    expect(evaluateVehicleApplicability(cz, { configuration: 'ARTICULATED' }).status).toBe('UNDETERMINED');
    const de = event('de-sunday');
    expect(evaluateVehicleApplicability(de, { configuration: 'TRUCK_TRAILER', motorVehicleMassKg: 7000, trailerMassKg: 2000 }).status).toBe('APPLIES');
    expect(evaluateVehicleApplicability(de, { configuration: 'SOLO', motorVehicleMassKg: 7000 }).status).toBe('DOES_NOT_APPLY');
    const pl = event('pl-holidays-2026-11');
    expect(evaluateVehicleApplicability(pl, { configuration: 'ARTICULATED', combinationMassKg: 40000 }).status).toBe('APPLIES');
    expect(evaluateVehicleApplicability(pl, { configuration: 'SOLO', motorVehicleMassKg: 11990 }).status).toBe('DOES_NOT_APPLY');
    const result = evaluateVehicleApplicability(cz, { configuration: 'SOLO', motorVehicleMassKg: 12000, adr: true, exceptionalTransport: true });
    expect(result.exceptions_not_evaluated.length).toBeGreaterThan(0);
    expect(result.notes.length).toBe(2);
  });

  it('finds route conflicts, keeps road-class scopes as possible conflicts and flags unverified jurisdictions', () => {
    const route = { segments: [
      { jurisdiction: 'CZ', roads: ['D1'], enterAt: '2026-10-25T12:00:00.000Z', exitAt: '2026-10-25T15:00:00.000Z' },
      { jurisdiction: 'NL', roads: ['A2'], enterAt: '2026-10-25T15:00:00.000Z', exitAt: '2026-10-25T18:00:00.000Z' },
    ] };
    const result = findRouteConflicts(view, route, { configuration: 'ARTICULATED', combinationMassKg: 40000, motorVehicleMassKg: 18000, trailerMassKg: 34000 });
    expect(result.status).toBe('INSUFFICIENT_VERIFIED_DATA');
    const cz = result.conflicts.find((c: any) => c.ban_id === 'cz-sunday');
    expect(cz).toMatchObject({ match: 'ROAD_CLASS_SCOPE', certainty: 'POSSIBLE' });
    expect(result.gaps.some((g: any) => g.jurisdiction === 'NL')).toBe(true);
    const light = findRouteConflicts(view, { segments: [route.segments[0]] }, { configuration: 'SOLO', motorVehicleMassKg: 3000 });
    expect(light.conflicts).toEqual([]);
  });
});

describe('alerts and history bridge', () => {
  it('alerts on legal changes and lost sources, never on metadata', () => {
    const after = structuredClone(canonicalDrivingBans);
    after.rules.find((r: any) => r.ban_id === 'sk-sunday').schedule.end_time = '21:00';
    after.rules.find((r: any) => r.ban_id === 'cz-sunday').source_version = 'metadata only';
    const changes = detectChanges(canonicalDrivingBans, after, { detectedAt: NOW.toISOString() });
    const mapped = changes.map(change => legalChangeToIntelligenceChange(change, NOW.toISOString())).filter(Boolean);
    expect(mapped.map((c: any) => [c.jurisdiction, c.changeType])).toEqual([['SK', 'changed']]);
    const lost = detectChanges(canonicalDrivingBans, invalidateSources(canonicalDrivingBans, ['cz-361'], NOW.toISOString()), { detectedAt: NOW.toISOString() });
    const alert = lost.map(change => legalChangeToIntelligenceChange(change, NOW.toISOString())).find(Boolean);
    expect(alert.summary).toMatch(/NOT cancelled/);
    const recipients = [
      { id: 'r-sk', organizationId: 'org-a', preferences: intelligencePreferenceSchema.parse({ jurisdictions: ['SK'] }), channels: ['in-app' as const] },
      { id: 'r-fr', organizationId: 'org-b', preferences: intelligencePreferenceSchema.parse({ jurisdictions: ['FR'] }), channels: ['in-app' as const] },
    ];
    expect(buildDrivingBansAlerts({ changes, recipients, createdAt: NOW.toISOString() }).map(a => a.recipientId)).toEqual(['r-sk']);
    expect(expiringRuleNotices(view, NOW, 14).every(c => c.topic === 'driving-ban')).toBe(true);
  });

  it('builds rule history across dataset versions', () => {
    const v2 = structuredClone(rawCanonical as any);
    v2.dataset_version = 'v2';
    v2.rules.find((r: any) => r.ban_id === 'sk-sunday').schedule.end_time = '21:00';
    const history = buildRuleHistory([{ dataset_version: 'v1', data: rawCanonical }, { dataset_version: 'v2', data: v2 }], 'sk-sunday');
    expect(history.map(h => h.dataset_version)).toEqual(['v1', 'v2']);
    expect(history[1].changes.map(c => c.type)).toEqual(['AMENDED_RULE']);
  });
});

describe('DAJC AI read-only contract (offline, no model)', () => {
  const ask = (tool: string, input: unknown, extra: any = {}) => answerDrivingBansQuery({ tool, input, subject: subjectA, entitlement: entitlementA, now: NOW, view, ...ON, ...extra });
  const truck = { configuration: 'ARTICULATED', combinationMassKg: 40000, motorVehicleMassKg: 18000, trailerMassKg: 34000 };

  it('exposes only read tools; prohibited actions do not exist', () => {
    expect([...AI_TOOLS]).toEqual(['search_bans', 'evaluate_vehicle', 'check_route', 'explain_rule', 'list_changes', 'list_exceptions']);
    for (const action of AI_PROHIBITED_ACTIONS) expect(() => ask(action, {})).toThrow(/Read-only contract/);
  });

  it('refuses without the flag, entitlement or derived-intelligence right', () => {
    expect(answerDrivingBansQuery({ tool: 'search_bans', input: {}, subject: subjectA, entitlement: entitlementA, now: NOW, view }).status).toBe('FEATURE_DISABLED');
    expect(ask('search_bans', {}, { entitlement: { ...entitlementA, organizationId: 'org-b' } }).status).toBe('TENANT_MISMATCH');
    const rights = intelligenceSourceRightsSchema.parse({ ...dajcMaintainedDrivingBansRights, derivedIntelligence: 'unknown' });
    expect(ask('explain_rule', { ban_id: 'cz-sunday' }, { rights }).status).toBe('RIGHTS_DENIED');
  });

  it('answers the example questions with facts, sources, validity, versions, completeness and warnings', () => {
    // "Mohu s touto soupravou projet Rakouskem v neděli?"
    const austria = ask('evaluate_vehicle', { jurisdiction: 'AT', at: '2026-10-25T10:00:00.000Z', vehicle: truck });
    expect(austria.status).toBe('OK');
    expect(austria.facts.some((f: any) => f.ban_id === 'at-sunday')).toBe(true);
    expect(austria.sources.length).toBeGreaterThan(0);
    expect(austria.validity).toEqual(view.window);
    expect(austria.rule_versions.length).toBeGreaterThan(0);
    expect(austria.completeness[0]).toMatchObject({ jurisdiction: 'AT', coverage_complete: false });
    expect(austria.authority_check_required).toBe(true);
    // "Kde se moje plánovaná trasa střetává se zákazem?"
    const route = ask('check_route', { route: { segments: [{ jurisdiction: 'DE', roads: ['A9'], enterAt: '2026-10-25T08:00:00.000Z', exitAt: '2026-10-25T12:00:00.000Z' }] }, vehicle: truck });
    expect(route.facts.some((f: any) => f.ban_id === 'de-sunday')).toBe(true);
    // "Jaké zákazy jsou relevantní pro moji soupravu nad 40 tun?"
    const relevant = ask('search_bans', { jurisdictions: ['PL', 'FR'], from: '2026-11-01T00:00:00.000Z', to: '2026-11-12T00:00:00.000Z', vehicle: truck });
    expect(new Set(relevant.facts.map((f: any) => f.jurisdiction))).toEqual(new Set(['PL', 'FR']));
    // "Co se změnilo oproti minulému týdnu?"
    const after = structuredClone(canonicalDrivingBans); after.rules.find((r: any) => r.ban_id === 'sk-sunday').schedule.end_time = '21:00';
    const changes = ask('list_changes', { since: '2026-10-15T00:00:00.000Z' }, { changes: detectChanges(canonicalDrivingBans, after, { detectedAt: NOW.toISOString() }) });
    expect(changes.facts.map((f: any) => f.type)).toEqual(['AMENDED_RULE']);
    // "Jaké výjimky jsou v daném státě uvedeny?"
    const exceptions = ask('list_exceptions', { jurisdiction: 'HU' });
    expect(exceptions.facts.every((f: any) => Array.isArray(f.exceptions))).toBe(true);
    expect(exceptions.warnings.some(w => /not evaluated/.test(w))).toBe(true);
    for (const answer of [austria, route, relevant, changes, exceptions]) {
      expect(answer.disclaimer).toMatch(/does not grant exceptions or permits/);
      expect(JSON.stringify(answer)).not.toMatch(/allowed_to_drive|permit_granted|authorised_to_drive/);
    }
  });

  it('returns INSUFFICIENT_VERIFIED_DATA instead of guessing', () => {
    expect(ask('search_bans', { jurisdictions: ['NL'], from: '2026-10-24T00:00:00.000Z', to: '2026-10-26T00:00:00.000Z' }).status).toBe('INSUFFICIENT_VERIFIED_DATA');
    expect(ask('evaluate_vehicle', { jurisdiction: 'NO', at: '2026-10-25T10:00:00.000Z', vehicle: truck }).status).toBe('INSUFFICIENT_VERIFIED_DATA');
    expect(ask('explain_rule', { ban_id: 'xx-unknown-rule' }).status).toBe('INSUFFICIENT_VERIFIED_DATA');
    expect(ask('list_changes', {}).status).toBe('INSUFFICIENT_VERIFIED_DATA');
  });
});

describe('future connector contract (fixtures only)', () => {
  const rights = intelligenceSourceRightsSchema.parse({ ...dajcMaintainedDrivingBansRights, sourceId: 'provider:hu-magyar-kozut-utinform-datex2', derivedIntelligence: 'unknown', redistribution: 'unknown' });
  const datex = createDatex2FixtureConnector({ connectorId: 'fixture-hu-datex', sourceId: 'provider:hu-magyar-kozut-utinform-datex2', jurisdiction: 'HU', timezone: 'Europe/Budapest', fixture: 'datex2-situation.xml', rights, licence: 'CC BY 4.0 (provider statement, unverified)', sourceUrl: 'https://www.utinform.hu/' });

  it('reads DATEX II into a continuous temporary restriction and refuses legal-ban claims from operational feeds', async () => {
    const result = await datex.retrieve({ now: NOW });
    expect(result.records).toHaveLength(1);
    const [proposal] = result.records[0].proposals;
    expect(proposal).toMatchObject({ restriction_class: 'TEMPORARY_TRAFFIC_RESTRICTION', valid_from: '2026-11-02', valid_to: '2026-11-06', start_time: '06:00', end_time: '18:00', end_day_offset: 4 });
    expect(proposal.weight_threshold).toMatchObject({ operator: '>', value: 12000, unit: 'kg' });
    const forged = structuredClone(result); forged.records[0].proposals[0].restriction_class = 'LEGAL_DRIVING_BAN';
    expect(() => validateConnectorResult(forged)).toThrow(/cannot propose a LEGAL_DRIVING_BAN/);
    expect(datex.fixtureOnly).toBe(true);
  });

  it('reads RSS notices as discovery records and never outside the fixture directory', async () => {
    const rss = createRssFixtureConnector({ connectorId: 'fixture-rss', sourceId: 'oversize:hu-kozut', jurisdiction: 'HU', fixture: 'rss-notices.xml', rights: { ...rights, sourceId: 'oversize:hu-kozut' }, licence: 'unknown' });
    const result = await rss.retrieve({ now: NOW });
    expect(result.records[0].proposals).toEqual([]);
    const escape = createRssFixtureConnector({ connectorId: 'x', sourceId: 'x', jurisdiction: 'HU', fixture: '../../../package.json', rights: { ...rights, sourceId: 'x' }, licence: 'unknown' });
    await expect(escape.retrieve({ now: NOW })).rejects.toThrow(/local fixture files/);
  });

  it('feeds the review workflow as unverified evidence and the Intelligence snapshot, never canonical.json', async () => {
    const result = await datex.retrieve({ now: NOW });
    const { submission, files } = connectorResultToSubmission(result, { submittedBy: 'fixture connector', jurisdiction: 'HU', sourceIsCanonical: false, source: { url: 'https://www.utinform.hu/', authority: 'Magyar Közút (fixture)', version: 'fixture' }, synthetic: true, legalVerifiedAt: null });
    const root = mkdtempSync(join(tmpdir(), 'dajc-connector-root-')), store = mkdtempSync(join(tmpdir(), 'dajc-connector-store-'));
    try {
      for (const file of files) { mkdirSync(join(root, 'records'), { recursive: true }); writeFileSync(join(root, file.path), file.content); }
      writeFileSync(join(root, 'submission.json'), JSON.stringify(submission));
      const before = readFileSync('data/driving-bans/canonical.json', 'utf8');
      const imported = importSubmission({ submissionFile: join(root, 'submission.json'), root, store, now: NOW });
      const validated = validateStoredProposal({ store, proposalId: imported.proposal_id, rawCanonical, now: NOW });
      expect(validated.state).toBe('INSUFFICIENT_EVIDENCE');
      expect(validated.findings.map((f: any) => f.code)).toContain('NO_LEGAL_VERIFICATION_DATE');
      expect(submission.operations.filter((op: any) => op.op === 'ADD_RULE').every((op: any) => op.rule.verification_state === 'UNVERIFIED' && op.rule.restriction_class === 'TEMPORARY_TRAFFIC_RESTRICTION')).toBe(true);
      expect(readFileSync('data/driving-bans/canonical.json', 'utf8')).toBe(before);
    } finally { rmSync(root, { recursive: true, force: true }); rmSync(store, { recursive: true, force: true }); }
    const snapshot = connectorResultToIntelligenceSnapshot(result, { sourceLabel: 'Magyar Közút (fixture)', sourceUrl: 'https://www.utinform.hu/', licence: 'CC BY 4.0 (unverified)' });
    expect(snapshot.items.map(item => item.topic)).toEqual(['route-restriction']);
  });

  it('contains no network, authentication or API-key code', () => {
    for (const file of ['driving-ban-connectors.ts', 'driving-bans-ai-contract.ts', 'driving-bans-relevance.ts', 'driving-bans-alerts.ts', 'entitlements.ts']) {
      const code = readFileSync(new URL(`./${file}`, import.meta.url), 'utf8');
      expect(code, file).not.toMatch(/\bfetch\(|node:https?|XMLHttpRequest|api[_-]?key|Authorization:/i);
    }
  });
});
