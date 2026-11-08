import { describe, expect, it } from 'vitest';
import { getDrivingBansSnapshot } from '../../../config/driving-ban-calendars/runtime.mjs';
import { toIcs } from '../driving-bans/core.mjs';
import { FEATURE_FLAG_ENV, isFeatureEnabled, type IntelligenceEntitlement } from './entitlements';
import { createMemoryCalendarTokenStore, handleCalendarFeedRequest, hashCalendarToken, issueCalendarToken, MAX_ACTIVE_CALENDARS_PER_USER, personalCalendarView, revokeCalendarToken, calendarFilterSchema } from './driving-bans-calendar';

// SYNTHETIC events built from one published event: no network, no live data dependency.
const NOW = new Date('2026-11-10T10:00:00Z');
const snapshot: any = getDrivingBansSnapshot(NOW);
const template = snapshot.upcoming_events.find((e: any) => e.jurisdiction === 'CZ');
const event = (uid: string, overrides: any) => ({ ...template, uid, ...overrides });
const czBan = event('cal-test-cz@dajc.eu', { ban_id: 'cal-cz', title: 'CZ Sunday ban', roads: ['Motorways', 'Class I roads'], weight_threshold: { operator: '>', value: 7500, unit: 'kg', applies_to: 'MAM of lorry' } });
const atA12 = event('cal-test-at-a12@dajc.eu', { ban_id: 'cal-at-a12', jurisdiction: 'AT', title: 'A12 night ban', roads: ['A12 Inntal km 6.35 - km 90.00'], regions: [], weight_threshold: { operator: '>', value: 7500, unit: 'kg', applies_to: 'MAM of lorry' } });
const atNetwork = event('cal-test-at-net@dajc.eu', { ban_id: 'cal-at-net', jurisdiction: 'AT', title: 'Austrian weekend ban', roads: ['Austrian road network'], regions: [], weight_threshold: { operator: '>', value: 7500, unit: 'kg', applies_to: 'MAM of lorry' } });
const view = { ...snapshot, events: [czBan, atA12, atNetwork], upcoming_events: [czBan, atA12, atNetwork] };
const readView = () => view;

const ON = { released: true, env: Object.fromEntries(Object.values(FEATURE_FLAG_ENV).map(name => [name, 'true'])) };
const subjectA = { organizationId: 'org-a-4410', userId: 'user-a-1' };
const all: IntelligenceEntitlement = { organizationId: 'org-a-4410', features: ['personal-calendar', 'vehicle-aware', 'route-aware'], validUntil: '2027-12-31T00:00:00.000Z' };
const resolveA = async (org: string) => (org === 'org-a-4410' ? all : null);
const filter = { label: 'Fleet CZ/AT', jurisdictions: ['CZ', 'AT'], vehicle: { configuration: 'SOLO', motorVehicleMassKg: 18_000 } };
const get = (url = 'https://www.dajc.eu/x') => new Request(url);
const uids = (ics: string) => [...ics.matchAll(/^UID:(.+)$/gm)].map(match => match[1].trim());
const unfold = (ics: string) => ics.replace(/\r\n[ \t]/g, '');

async function issued(store = createMemoryCalendarTokenStore(), f: any = filter, extra: any = {}) {
  const result: any = await issueCalendarToken({ subject: subjectA, entitlement: all, filter: f, store, now: NOW, ...ON, ...extra });
  return { store, result };
}
const feed = (store: any, token: string, extra: any = {}) => handleCalendarFeedRequest({ request: get(), token: `${token}.ics`, store, resolveEntitlement: resolveA, readView, now: NOW, ...ON, ...extra });

describe('personal Driving Bans calendar (paid, not released, not mounted)', () => {
  it('23: is off by default: nothing is issued, nothing is looked up, the route does not disclose itself', async () => {
    expect(isFeatureEnabled('personal-calendar', { DAJC_INTELLIGENCE_CALENDAR_ENABLED: 'true' })).toBe(false);
    const store = createMemoryCalendarTokenStore();
    expect(await issueCalendarToken({ subject: subjectA, entitlement: all, filter, store, now: NOW })).toEqual({ status: 'FEATURE_DISABLED' });
    const { result } = await issued(store);
    let lookups = 0;
    const spy = { ...store, findByHash: async (hash: string) => { lookups += 1; return store.findByHash(hash); } };
    const response = await handleCalendarFeedRequest({ request: get(), token: result.token, store: spy, resolveEntitlement: resolveA, readView, now: NOW });
    expect(response.status).toBe(404);
    expect(lookups).toBe(0);
    // Each switch counts: the module switch and the calendar's own flag.
    expect((await feed(store, result.token, { env: { ...ON.env, DAJC_INTELLIGENCE_CALENDAR_ENABLED: 'false' } })).status).toBe(404);
    expect((await feed(store, result.token, { env: { ...ON.env, DAJC_INTELLIGENCE_BANS_ENABLED: 'false' } })).status).toBe(404);
  });

  it('issues a secret URL once and stores only its hash; each filter feature needs its own entitlement', async () => {
    const { store, result } = await issued();
    expect(result).toMatchObject({ status: 'OK', url: expect.stringMatching(/^https:\/\/www\.dajc\.eu\/api\/intelligence\/calendar\/dcal_[A-Za-z0-9_-]{43}\.ics$/) });
    const stored = JSON.stringify(store.records());
    expect(stored).not.toContain(result.token);
    expect(stored).toContain(hashCalendarToken(result.token));
    const only = (features: any[]) => ({ ...all, features });
    expect(await issueCalendarToken({ subject: subjectA, entitlement: only(['personal-calendar']), filter, store, now: NOW, ...ON })).toEqual({ status: 'NOT_ENTITLED' });
    expect(await issueCalendarToken({ subject: subjectA, entitlement: only(['personal-calendar', 'vehicle-aware']), filter: { ...filter, corridor: [{ jurisdiction: 'AT', roads: ['A1'] }] }, store, now: NOW, ...ON })).toEqual({ status: 'NOT_ENTITLED' });
    expect((await issueCalendarToken({ subject: subjectA, entitlement: only(['personal-calendar']), filter: { label: 'All' }, store, now: NOW, ...ON })).status).toBe('OK');
    expect(await issueCalendarToken({ subject: null, entitlement: all, filter, store, now: NOW, ...ON })).toEqual({ status: 'AUTHENTICATION_REQUIRED' });
    expect(() => calendarFilterSchema.parse({ label: 'x', jurisdictions: ['XX'] })).toThrow();
    expect(() => calendarFilterSchema.parse({ label: 'x', organizationId: 'org-b' })).toThrow();
    for (let i = store.records().filter(r => !r.revoked_at).length; i < MAX_ACTIVE_CALENDARS_PER_USER; i++) await issued(store);
    expect((await issued(store)).result).toEqual({ status: 'TOO_MANY_CALENDARS' });
  });

  it('serves the filtered calendar through the public ICS writer, without the token in the body', async () => {
    const { store, result } = await issued();
    const response = await feed(store, result.token);
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(response.headers.get('X-Robots-Tag')).toMatch(/noindex/);
    expect(response.headers.get('Referrer-Policy')).toBe('no-referrer');
    const ics = await response.text();
    expect(ics.startsWith('BEGIN:VCALENDAR')).toBe(true);
    expect(ics.split('\r\n').every(line => Buffer.byteLength(line) <= 75)).toBe(true);
    expect(unfold(ics)).toContain('X-WR-CALNAME:DAJC Driving Bans – Fleet CZ/AT');
    expect(uids(ics).sort()).toEqual([atA12.uid, atNetwork.uid, czBan.uid].sort());
    expect(ics).not.toContain(result.token);
    expect(ics).not.toContain('org-a-4410');
    expect(unfold(ics)).toContain('Exceptions are not evaluated automatically.');
    // The public calendar is unchanged: same writer, same default name.
    expect(toIcs(view)).toContain('X-WR-CALNAME:DAJC HGV Driving Bans');
  });

  it('leaves out bans that clearly do not apply to the vehicle and marks undetermined ones', () => {
    const parsed = (f: any) => calendarFilterSchema.parse({ label: 'v', ...f });
    const light = personalCalendarView(view, parsed({ vehicle: { configuration: 'SOLO', motorVehicleMassKg: 3_000 } }));
    expect(light.upcoming_events).toHaveLength(0);
    const unknown = personalCalendarView(view, parsed({ vehicle: { configuration: 'SOLO' } }));
    expect(unknown.upcoming_events).toHaveLength(3);
    expect(unknown.upcoming_events.every((e: any) => e.title.endsWith('(check vehicle)') && /could not be determined/.test(e.notes))).toBe(true);
    const heavy = personalCalendarView(view, parsed({ vehicle: { configuration: 'SOLO', motorVehicleMassKg: 18_000 } }));
    expect(heavy.upcoming_events.map((e: any) => e.title)).toEqual([czBan.title, atA12.title, atNetwork.title]);
  });

  it('keeps a corridor to the rules on its roads: network-wide and road-class rules stay, other named roads go', () => {
    const corridor = (segments: any[]) => personalCalendarView(view, calendarFilterSchema.parse({ label: 'c', corridor: segments })).upcoming_events.map((e: any) => e.uid);
    expect(corridor([{ jurisdiction: 'AT', roads: ['A1'] }])).toEqual([atNetwork.uid]);
    expect(corridor([{ jurisdiction: 'AT', roads: ['A12'] }]).sort()).toEqual([atA12.uid, atNetwork.uid].sort());
    expect(corridor([{ jurisdiction: 'CZ', roads: ['D1'] }])).toEqual([czBan.uid]);
    const notes = personalCalendarView(view, calendarFilterSchema.parse({ label: 'c', corridor: [{ jurisdiction: 'AT', roads: ['A12'] }] })).upcoming_events.map((e: any) => e.notes);
    expect(notes.join('\n')).toMatch(/names a road of your corridor/);
  });

  it('empties the calendar when the subscription lapses, without a pseudo-event', async () => {
    const { store, result } = await issued();
    const lapsed = async (entitlement: any) => (await handleCalendarFeedRequest({ request: get(), token: result.token, store, resolveEntitlement: async () => entitlement, readView, now: NOW, ...ON })).text();
    for (const entitlement of [{ ...all, validUntil: '2026-11-01T00:00:00.000Z' }, { ...all, features: ['personal-calendar'] }, null]) {
      const ics = await lapsed(entitlement);
      expect(ics).toContain('X-WR-CALNAME:DAJC personal calendar (inactive)');
      expect(ics).not.toContain('BEGIN:VEVENT');
      expect(uids(ics)).toHaveLength(0);
    }
  });

  it('17: isolates tenants: the organisation comes from the stored token, never from the request or another entitlement', async () => {
    const { store, result } = await issued();
    const otherOrg = { ...all, organizationId: 'org-b' };
    const crossed = await handleCalendarFeedRequest({ request: get(`https://www.dajc.eu/x?organizationId=org-b`), token: result.token, store, resolveEntitlement: async () => otherOrg, readView, now: NOW, ...ON });
    expect(await crossed.text()).not.toContain('BEGIN:VEVENT');
    // Another user or organisation can neither list nor revoke the calendar.
    expect(await store.listForSubject({ organizationId: 'org-b', userId: 'user-a-1' })).toEqual([]);
    expect(await revokeCalendarToken({ subject: { organizationId: 'org-b', userId: 'user-a-1' }, tokenId: result.token_id, store, now: NOW })).toBe(false);
    expect(await revokeCalendarToken({ subject: { organizationId: 'org-a-4410', userId: 'user-a-2' }, tokenId: result.token_id, store, now: NOW })).toBe(false);
    expect((await feed(store, result.token)).status).toBe(200);
    // The owner revokes it; from then on it answers like a missing route.
    expect(await revokeCalendarToken({ subject: subjectA, tokenId: result.token_id, store, now: NOW })).toBe(true);
    expect((await feed(store, result.token)).status).toBe(404);
  });

  it('answers unknown and malformed tokens like a missing route and limits fetches per token', async () => {
    const { store, result } = await issued();
    expect((await feed(store, `dcal_${'A'.repeat(43)}`)).status).toBe(404);
    expect((await feed(store, '../driving-bans')).status).toBe(404);
    expect((await handleCalendarFeedRequest({ request: new Request('https://www.dajc.eu/x', { method: 'POST' }), token: result.token, store, resolveEntitlement: resolveA, readView, now: NOW, ...ON })).status).toBe(405);
    const head = await handleCalendarFeedRequest({ request: new Request('https://www.dajc.eu/x', { method: 'HEAD' }), token: result.token, store, resolveEntitlement: resolveA, readView, now: NOW, ...ON });
    expect([head.status, await head.text()]).toEqual([200, '']);
    for (let i = 0; i < 2; i++) expect((await feed(store, result.token, { maxFetchesPerHour: 3 })).status).toBe(200);
    const limited = await feed(store, result.token, { maxFetchesPerHour: 3 });
    expect([limited.status, limited.headers.get('Retry-After')]).toEqual([429, '3600']);
  });
});
