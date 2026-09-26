import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from '../../pages/api/driving-bans.ics';

// Immutable historical evidence fixture keeps endpoint tests independent of
// later data releases. The real canonical engine is still used.
vi.mock('../../../config/driving-ban-calendars/runtime.mjs', async () => {
  const { readFileSync } = await import('node:fs');
  const { hydrateCanonical, snapshot } = await import('../../lib/driving-bans/core.mjs');
  const { dajcEuropeCoverage } = await import('../../../config/europe-coverage.mjs');
  const raw = JSON.parse(readFileSync(new URL('../../../tests/fixtures/driving-bans-sep-oct-2026.json', import.meta.url), 'utf8'));
  const data = hydrateCanonical(raw, dajcEuropeCoverage);
  return { getDrivingBansSnapshot: () => snapshot(data, dajcEuropeCoverage, new Date()) };
});
const get = (query: string) => GET({ request: new Request(`https://www.dajc.eu/api/driving-bans.ics?${query}`) } as Parameters<typeof GET>[0]);
const unfold = (s: string) => s.replace(/\r\n[ \t]/g,'');
beforeEach(()=>{vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-09-26T13:50:05Z'));});
afterEach(()=>vi.useRealTimers());

describe('canonical public Driving Bans feed',()=>{
  it.each(['NO','DE,NO'])('returns an explicit incomplete calendar, without false events, for %s',async countries=>{const response=await get(`countries=${countries}`);expect(response.status).toBe(200);expect(response.headers.get('cache-control')).toBe('no-store');const body=unfold(await response.text());expect(body).toContain('X-DAJC-COVERAGE-COMPLETE:FALSE');expect(body).not.toContain('BEGIN:VEVENT');});
  it('rejects an unknown identity rather than inventing coverage',async()=>{expect((await get('countries=unknown')).status).toBe(400);});
  it.each(['from=bad','from=2026-10-31&to=2026-09-01','from=2020-01-01&to=2030-01-01','type=unknown'])('rejects invalid or out-of-window input: %s',async query=>{expect((await get(query)).status).toBe(400);});
  it('exposes exactly the two-calendar-month window, never 13 months',async()=>{const body=unfold(await (await get('countries=LI&rolling=1')).text());expect(body).toContain('X-DAJC-WINDOW:2026-09-01/2026-10-31');expect(body).not.toContain('2027');});
  it('contains actual timed bans and never a warning VEVENT',async()=>{const body=unfold(await (await get('countries=LI')).text());expect(body).toContain('BEGIN:VEVENT');expect(body).toContain('Night driving restriction');expect(body).not.toContain('UID:coverage-warning');expect(body).not.toContain('DTSTART;VALUE=DATE');});
  it('retains general HGV bans in the exceptional feed',async()=>{const a=await (await get('countries=LI&type=general')).text();const b=await (await get('countries=LI&type=exceptional')).text();expect(a).toBe(b);});
  it('removes expired events by default while permitting whole-window history',async()=>{const a=await (await get('countries=BG')).text();const b=await (await get('countries=BG&history=1')).text();expect(a).not.toContain('BEGIN:VEVENT');expect(b.match(/BEGIN:VEVENT/g)).toHaveLength(3);expect(unfold(b)).toContain('12000');});
  it('rolls the period at Prague midnight and never extends unsupported events',async()=>{vi.setSystemTime(new Date('2026-11-30T23:01:00Z'));const body=unfold(await (await get('countries=LI')).text());expect(body).toContain('X-DAJC-WINDOW:2026-12-01/2027-01-31');expect(body).not.toContain('BEGIN:VEVENT');expect(body).toContain('X-DAJC-COVERAGE-COMPLETE:FALSE');});
  it('uses valid CRLF and physical lines within 75 UTF-8 octets',async()=>{const body=await (await get('countries=ES')).text();expect(body.endsWith('\r\n')).toBe(true);expect(body.split('\r\n').every(line=>new TextEncoder().encode(line).length<=75)).toBe(true);});
  it('normalizes repeated country query values without duplicate events',async()=>{const body=unfold(await (await get('countries=li,LI')).text());const ids=[...body.matchAll(/^UID:(.+)$/gm)].map(m=>m[1]);expect(new Set(ids).size).toBe(ids.length);});
});
