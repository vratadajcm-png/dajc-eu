import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { getDrivingBansSnapshot } from '../../../config/driving-ban-calendars/runtime.mjs';
import { evaluateDrivingBansQuery, readPublishedView, QUERY_TOOLS, type PublishedView } from './driving-bans-query';
import { answerIntelligenceQuery, featureForTool, handleDrivingBansIntelligenceRequest, prepareOrganisationAlerts } from './driving-bans-intelligence-api';
import { answerFreeAskQuery } from './driving-bans-ai-contract';
import { FEATURE_FLAG_ENV, type IntelligenceEntitlement } from './entitlements';
import { detectChanges } from '../driving-bans/legal-changes.mjs';
import { canonicalDrivingBans } from '../../../config/driving-ban-calendars/runtime.mjs';
import { intelligencePreferenceSchema } from './preferences';

const ALL_FLAGS = Object.fromEntries(Object.values(FEATURE_FLAG_ENV).map(name => [name, 'true']));
const ON = { released: true, env: ALL_FLAGS };
const NOW = new Date('2026-11-02T10:00:00Z');
const november = readPublishedView(NOW);
const subjectA = { organizationId: 'org-a', userId: 'user-1' };
const entitled = (features: IntelligenceEntitlement['features'], organizationId = 'org-a'): IntelligenceEntitlement => ({ organizationId, features, validUntil: '2027-12-31T00:00:00.000Z' });
const ALL: IntelligenceEntitlement['features'] = ['driving-bans-query', 'vehicle-aware', 'route-aware', 'history', 'alerts'];
const local = (date: string, tz = 'Europe/Prague') => {
  // Prague-local whole day as UTC instants (CET in November/December).
  void tz;
  const start = new Date(`${date}T00:00:00+01:00`).toISOString();
  const end = new Date(new Date(`${date}T00:00:00+01:00`).getTime() + 86_400_000).toISOString();
  return { from: start, to: end };
};
const outcome = (answer: any, code: string) => answer.completeness.find((row: any) => row.jurisdiction === code)?.outcome;
const query = (tool: any, input: unknown, view: PublishedView = november) => evaluateDrivingBansQuery({ tool, input, view });
const solo18t = { configuration: 'SOLO' as const, motorVehicleMassKg: 18_000 };

describe('one query service, one state enum', () => {
  it('reads only the published snapshot through the adapter', () => {
    expect(JSON.stringify(readPublishedView(NOW))).toBe(JSON.stringify(getDrivingBansSnapshot(NOW)));
    const code = readFileSync(new URL('./driving-bans-query.ts', import.meta.url), 'utf8');
    expect(code).toMatch(/from '\.\/driving-bans-adapter'/);
    expect(code).not.toMatch(/canonical\.json|driving-ban-calendars|\bfetch\(|node:https?|api[_-]?key/i);
    // The AI contract delegates; it has no evaluation of its own.
    const contract = readFileSync(new URL('./driving-bans-ai-contract.ts', import.meta.url), 'utf8');
    expect(contract).not.toMatch(/function outcomeOf|insidePublishedPeriod|evaluateVehicleApplicability/);
    expect(contract).toMatch(/evaluateDrivingBansQuery/);
  });

  it('keeps BAN_FOUND, NO_CONFIRMED_BAN and INSUFFICIENT_VERIFIED_DATA as the only outcomes', () => {
    const outcomes = new Set<string>();
    for (const code of november.jurisdictions.map(row => row.jurisdiction)) {
      for (const date of ['2026-11-01', '2026-11-03']) outcomes.add(outcome(query('search_bans', { jurisdictions: [code], ...local(date) }), code));
    }
    expect([...outcomes].sort()).toEqual(['BAN_FOUND', 'INSUFFICIENT_VERIFIED_DATA', 'NO_CONFIRMED_BAN']);
    // ban_state (HAS_BAN/NO_BAN/UNKNOWN) is the snapshot's own registry field; the answer outcome never takes those values.
    expect(JSON.stringify(query('search_bans', { jurisdictions: ['NL'], ...local('2026-11-03') }))).not.toMatch(/"(?:outcome|status)":"(?:UNKNOWN|NO_BAN|HAS_BAN)"/);
  });
});

describe('verification states (scenarios 10-15)', () => {
  it('10: answers incompletely verified AT and DE with BAN_FOUND only where a verified ban applies, never as decided', () => {
    const sunday = query('search_bans', { jurisdictions: ['AT', 'DE'], ...local('2026-11-01') });
    expect(outcome(sunday, 'AT')).toBe('BAN_FOUND');
    expect(outcome(sunday, 'DE')).toBe('BAN_FOUND');
    expect(sunday.status).toBe('INSUFFICIENT_VERIFIED_DATA');
    expect(sunday.warnings.join(' ')).toMatch(/AT: a verified ban applies, but the coverage of the whole jurisdiction is not confirmed/);
    expect(sunday.warnings.join(' ')).toMatch(/DE: verification of the whole jurisdiction is incomplete/);
    expect(sunday.authority_check_required).toBe(true);
    // A weekday without a verified event in a partially verified jurisdiction is never "no ban".
    const tuesday = query('search_bans', { jurisdictions: ['DE'], from: '2026-11-03T08:00:00.000Z', to: '2026-11-03T12:00:00.000Z' });
    expect(outcome(tuesday, 'DE')).toBe('INSUFFICIENT_VERIFIED_DATA');
    expect(tuesday.warnings.join(' ')).toMatch(/not evidence that there is no ban/);
  });

  it('a multi-jurisdiction answer is INSUFFICIENT_VERIFIED_DATA when any asked part is not decided', () => {
    const mixed = query('search_bans', { jurisdictions: ['CZ', 'NL'], ...local('2026-11-03') });
    expect(outcome(mixed, 'CZ')).toBe('NO_CONFIRMED_BAN');
    expect(outcome(mixed, 'NL')).toBe('INSUFFICIENT_VERIFIED_DATA');
    expect(mixed.status).toBe('INSUFFICIENT_VERIFIED_DATA');
    const decided = query('search_bans', { jurisdictions: ['CZ', 'SK'], ...local('2026-11-01') });
    expect([outcome(decided, 'CZ'), outcome(decided, 'SK'), decided.status]).toEqual(['BAN_FOUND', 'BAN_FOUND', 'OK']);
    const quiet = query('search_bans', { jurisdictions: ['CZ'], from: '2026-11-03T08:00:00.000Z', to: '2026-11-03T12:00:00.000Z' });
    expect([outcome(quiet, 'CZ'), quiet.status]).toEqual(['NO_CONFIRMED_BAN', 'OK']);
  });

  it('11: a date outside the published period is INSUFFICIENT_VERIFIED_DATA, even in a fully verified jurisdiction', () => {
    const january = query('search_bans', { jurisdictions: ['CZ'], from: '2027-01-12T08:00:00.000Z', to: '2027-01-12T12:00:00.000Z' });
    expect([outcome(january, 'CZ'), january.status]).toEqual(['INSUFFICIENT_VERIFIED_DATA', 'INSUFFICIENT_VERIFIED_DATA']);
    const vehicle = query('evaluate_vehicle', { jurisdiction: 'CZ', at: '2027-01-12T10:00:00.000Z', vehicle: solo18t });
    expect([outcome(vehicle, 'CZ'), vehicle.status]).toEqual(['INSUFFICIENT_VERIFIED_DATA', 'INSUFFICIENT_VERIFIED_DATA']);
  });

  it('12: rolls over from October to November and December 2026 without stale verification', () => {
    const october = readPublishedView(new Date('2026-10-29T10:00:00Z'));
    const decemberView = readPublishedView(new Date('2026-12-02T10:00:00Z'));
    const complete = (view: PublishedView) => view.jurisdictions.filter(row => row.coverage_complete).map(row => row.jurisdiction).sort();
    expect(october.window).toMatchObject({ from: '2026-10-01', to: '2026-11-30' });
    expect(november.window).toMatchObject({ from: '2026-11-01', to: '2026-12-31' });
    expect(decemberView.window).toMatchObject({ from: '2026-12-01', to: '2027-01-31' });
    const verified = ['CH', 'CZ', 'FR', 'HR', 'HU', 'IT', 'LI', 'LU', 'PL', 'SI', 'SK'];
    expect(complete(october)).toEqual(verified);
    expect(complete(november)).toEqual(verified);
    // The reviewed span ends on 31 December: from 1 December nothing may stay "verified in full".
    expect(complete(decemberView)).toEqual([]);
    const tuesday = { jurisdictions: ['CZ'], from: '2026-12-08T08:00:00.000Z', to: '2026-12-08T12:00:00.000Z' };
    expect(outcome(query('search_bans', tuesday, november), 'CZ')).toBe('NO_CONFIRMED_BAN');
    expect(outcome(query('search_bans', tuesday, decemberView), 'CZ')).toBe('INSUFFICIENT_VERIFIED_DATA');
    // 25 December is a verified CZ ban day (PR #80) inside the November-December period.
    const christmas = query('search_bans', { jurisdictions: ['CZ'], ...local('2026-12-25') }, november);
    expect(outcome(christmas, 'CZ')).toBe('BAN_FOUND');
  });

  it('13: checks a combined route through several jurisdictions and reports every gap', () => {
    const route = { segments: [
      { jurisdiction: 'CZ', roads: ['D1'], enterAt: '2026-11-01T12:30:00.000Z', exitAt: '2026-11-01T15:00:00.000Z' },
      { jurisdiction: 'AT', roads: ['A1'], enterAt: '2026-11-01T15:30:00.000Z', exitAt: '2026-11-01T18:00:00.000Z' },
      { jurisdiction: 'DE', roads: ['A8'], enterAt: '2026-11-01T18:30:00.000Z', exitAt: '2026-11-01T20:00:00.000Z' },
    ] };
    const answer = query('check_route', { route, vehicle: solo18t });
    expect(answer.status).toBe('INSUFFICIENT_VERIFIED_DATA');
    expect(new Set(answer.facts.map((f: any) => f.jurisdiction))).toEqual(new Set(['CZ', 'AT', 'DE']));
    expect(answer.warnings.filter(w => /coverage is not completely verified/.test(w)).map(w => w.match(/\((\w\w)\)/)?.[1]).sort()).toEqual(['AT', 'DE']);
    for (const fact of answer.facts as any[]) expect(['LIKELY', 'POSSIBLE']).toContain(fact.certainty);
    const czOnly = query('check_route', { route: { segments: [route.segments[0]] }, vehicle: solo18t });
    expect(czOnly.status).toBe('OK');
    expect(czOnly.facts.length).toBeGreaterThan(0);
  });

  it('14: a vehicle the ban applies to gets BAN_FOUND with its legal criterion', () => {
    const answer = query('evaluate_vehicle', { jurisdiction: 'CZ', at: '2026-11-01T14:00:00.000Z', vehicle: solo18t });
    expect([outcome(answer, 'CZ'), answer.status]).toEqual(['BAN_FOUND', 'OK']);
    expect((answer.facts[0] as any).vehicle.status).toBe('APPLIES');
    const light = query('evaluate_vehicle', { jurisdiction: 'CZ', at: '2026-11-01T14:00:00.000Z', vehicle: { configuration: 'SOLO', motorVehicleMassKg: 3_000 } });
    expect([outcome(light, 'CZ'), light.status]).toEqual(['NO_CONFIRMED_BAN', 'OK']);
  });

  it('15: ambiguous vehicle data is never DOES_NOT_APPLY and never decides the answer', () => {
    const answer = query('evaluate_vehicle', { jurisdiction: 'CZ', at: '2026-11-01T14:00:00.000Z', vehicle: { configuration: 'ARTICULATED' } });
    expect(outcome(answer, 'CZ')).toBe('BAN_FOUND');
    expect(answer.status).toBe('INSUFFICIENT_VERIFIED_DATA');
    expect((answer.facts as any[]).every(f => f.vehicle.status === 'UNDETERMINED')).toBe(true);
    expect(answer.warnings.join(' ')).toMatch(/could not be determined whether it applies to this vehicle/);
    expect(answer.authority_check_required).toBe(true);
    const search = query('search_bans', { jurisdictions: ['CZ'], ...local('2026-11-01'), vehicle: { configuration: 'ARTICULATED' } });
    expect(search.status).toBe('INSUFFICIENT_VERIFIED_DATA');
  });

  it('lists the verified legal sources of a jurisdiction', () => {
    const answer = query('list_sources', { jurisdiction: 'CZ' });
    expect(answer.facts.length).toBeGreaterThan(0);
    expect((answer.facts as any[]).every(f => f.url.startsWith('https://'))).toBe(true);
    expect((answer.facts as any[]).some(f => f.backs_published_rules && f.role === 'PRIMARY')).toBe(true);
    expect(query('list_sources', { jurisdiction: 'NL' }).status).toBe('INSUFFICIENT_VERIFIED_DATA');
  });
});

describe('DAJC Intelligence over the query service (not released)', () => {
  const ask = (tool: string, input: unknown, extra: any = {}) => answerIntelligenceQuery({ tool, input, subject: subjectA, entitlement: entitled(ALL), now: NOW, view: november, ...ON, ...extra });

  it('is off by default: unreleased product and DAJC_INTELLIGENCE_BANS_ENABLED not set', () => {
    expect(answerIntelligenceQuery({ tool: 'search_bans', input: {}, subject: subjectA, entitlement: entitled(ALL), now: NOW, view: november }).status).toBe('FEATURE_DISABLED');
    expect(ask('search_bans', {}, { released: false }).status).toBe('FEATURE_DISABLED');
    const withoutModule = { ...ALL_FLAGS, DAJC_INTELLIGENCE_BANS_ENABLED: 'false' };
    expect(ask('evaluate_vehicle', {}, { env: withoutModule }).status).toBe('FEATURE_DISABLED');
  });

  it('gives every paid function its own entitlement', () => {
    expect(featureForTool('search_bans', { jurisdictions: ['CZ'] })).toBe('driving-bans-query');
    expect(featureForTool('search_bans', { jurisdictions: ['CZ'], vehicle: solo18t })).toBe('vehicle-aware');
    expect([featureForTool('evaluate_vehicle', {}), featureForTool('check_route', {}), featureForTool('list_changes', {})]).toEqual(['vehicle-aware', 'route-aware', 'history']);
    const searchOnly = { entitlement: entitled(['driving-bans-query']) };
    expect(ask('search_bans', { jurisdictions: ['CZ'], ...local('2026-11-01') }, searchOnly).status).toBe('OK');
    expect(ask('search_bans', { jurisdictions: ['CZ'], ...local('2026-11-01'), vehicle: solo18t }, searchOnly).status).toBe('NOT_ENTITLED');
    expect(ask('evaluate_vehicle', { jurisdiction: 'CZ', at: '2026-11-01T14:00:00.000Z', vehicle: solo18t }, searchOnly).status).toBe('NOT_ENTITLED');
    expect(ask('list_changes', {}, searchOnly).status).toBe('NOT_ENTITLED');
    expect(ask('evaluate_vehicle', { jurisdiction: 'CZ', at: '2026-11-01T14:00:00.000Z', vehicle: solo18t }).status).toBe('OK');
  });

  it('19: isolates tenants; the organisation never comes from the input', () => {
    expect(ask('search_bans', { jurisdictions: ['CZ'], ...local('2026-11-01') }, { entitlement: entitled(ALL, 'org-b') }).status).toBe('TENANT_MISMATCH');
    expect(() => ask('search_bans', { jurisdictions: ['CZ'], ...local('2026-11-01'), organizationId: 'org-b' })).toThrow();
    expect(ask('search_bans', { jurisdictions: ['CZ'], ...local('2026-11-01') }, { subject: null }).status).toBe('AUTHENTICATION_REQUIRED');
    const after = structuredClone(canonicalDrivingBans); after.rules.find((r: any) => r.ban_id === 'sk-sunday').schedule.end_time = '21:00';
    const changes = detectChanges(canonicalDrivingBans, after, { detectedAt: NOW.toISOString() });
    const preferences = intelligencePreferenceSchema.parse({ jurisdictions: ['SK'] });
    const recipients = [
      { id: 'a-1', organizationId: 'org-a', preferences, channels: ['in-app'] },
      { id: 'b-1', organizationId: 'org-b', preferences, channels: ['in-app'] },
      { id: 'nobody', preferences, channels: ['in-app'] },
    ] as any;
    const alerts = prepareOrganisationAlerts({ changes, recipients, createdAt: NOW.toISOString(), subject: subjectA, entitlement: entitled(ALL), now: NOW, ...ON });
    expect(alerts.status).toBe('OK');
    expect(alerts.candidates.length).toBeGreaterThan(0);
    expect(new Set(alerts.candidates.map(c => c.recipientId))).toEqual(new Set(['a-1']));
    expect(prepareOrganisationAlerts({ changes, recipients, createdAt: NOW.toISOString(), subject: subjectA, entitlement: entitled(['driving-bans-query']), now: NOW, ...ON }).status).toBe('NOT_ENTITLED');
  });

  it('shares the evaluation with free Ask DAJC AI', () => {
    const input = { jurisdictions: ['CZ', 'AT'], ...local('2026-11-01') };
    const paid = ask('search_bans', input);
    const free = answerFreeAskQuery({ tool: 'search_bans', input, view: november });
    expect({ status: paid.status, facts: paid.facts, completeness: paid.completeness, warnings: paid.warnings }).toEqual({ status: free.status, facts: free.facts, completeness: free.completeness, warnings: free.warnings });
    expect(QUERY_TOOLS).toContain('list_sources');
  });
});

describe('Intelligence request handler (not mounted on any route)', () => {
  const post = (tool: string | undefined, body: unknown, extra: any = {}) => handleDrivingBansIntelligenceRequest({
    request: new Request(`https://www.dajc.eu/api/intelligence/driving-bans/${tool}?organizationId=org-b`, { method: extra.method ?? 'POST', body: extra.method === 'GET' ? undefined : typeof body === 'string' ? body : JSON.stringify(body), headers: { 'content-type': 'application/json' } }),
    tool,
    resolveSubject: async () => extra.subject === undefined ? subjectA : extra.subject,
    resolveEntitlement: async organizationId => extra.entitlement === undefined ? entitled(ALL, organizationId) : extra.entitlement,
    readView: () => november,
    now: NOW,
    ...('released' in extra ? { released: extra.released, env: ALL_FLAGS } : ON),
  });
  const input = { input: { jurisdictions: ['CZ'], ...local('2026-11-01') } };

  it('answers 404 while unreleased or for an unknown tool, without touching the subject', async () => {
    expect((await post('search_bans', input, { released: false })).status).toBe(404);
    expect((await post('approve_exception', input)).status).toBe(404);
    expect((await post(undefined, input)).status).toBe(404);
  });

  it('authorises server-side and maps refusals to HTTP status codes', async () => {
    expect((await post('search_bans', input, { subject: null })).status).toBe(401);
    expect((await post('search_bans', input, { entitlement: null })).status).toBe(403);
    expect((await post('search_bans', input, { entitlement: entitled(ALL, 'org-b') })).status).toBe(403);
    const ok = await post('search_bans', input);
    expect(ok.status).toBe(200);
    const body = await ok.json();
    expect(body.completeness[0]).toMatchObject({ jurisdiction: 'CZ', outcome: 'BAN_FOUND' });
    expect(JSON.stringify(body)).not.toMatch(/org-a|org-b/);
  });

  it('rejects invalid, oversized and non-POST requests', async () => {
    expect((await post('search_bans', '{not json')).status).toBe(400);
    expect((await post('search_bans', { input: input.input, organizationId: 'org-b' })).status).toBe(400);
    expect((await post('search_bans', { input: { ...input.input, organizationId: 'org-b' } })).status).toBe(400);
    expect((await post('search_bans', { input: { jurisdictions: ['XX'], ...local('2026-11-01') } })).status).toBe(400);
    expect((await post('search_bans', { input: { ...input.input, padding: 'x'.repeat(40_000) } })).status).toBe(413);
    expect((await post('search_bans', input, { method: 'GET' })).status).toBe(405);
  });
});
