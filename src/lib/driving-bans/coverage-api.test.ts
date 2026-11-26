import { afterEach, describe, expect, it, vi } from 'vitest';
import { GET as jsonGet } from '../../pages/api/driving-bans.json';
import { GET as icsGet } from '../../pages/api/driving-bans.ics';
import { dajcEuropeCoverage } from '../../../config/europe-coverage.mjs';
import { getDrivingBansSnapshot } from '../../../config/driving-ban-calendars/runtime.mjs';
import { officialDrivingBansView } from './public-view.mjs';

afterEach(() => vi.useRealTimers());
describe('actual JSON and ICS route contract', () => {
  it('exports only officially verified scopes for the rolling 12-month window, with unchanged UTC event times', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-22T10:00:00Z'));
    const response = await jsonGet({} as any);
    const json = await response.json();
    const canonical = getDrivingBansSnapshot();
    expect(canonical.jurisdictions.map(row => row.jurisdiction)).toEqual(dajcEuropeCoverage.map(([code]) => code));
    expect(json).toEqual(officialDrivingBansView(canonical));
    expect(json.tracked_jurisdictions).toBe(50);
    expect(json.jurisdictions.length).toBeLessThan(50);
    expect(json.jurisdictions.every((row: any) => json.events.some((event: any) => event.jurisdiction === row.jurisdiction) || (row.ban_state === 'NO_BAN' && row.coverage_complete))).toBe(true);
    expect(json.window).toMatchObject({from:'2026-10-22',to:'2027-10-22'});
    for (const history of [false,true]) {
      const response = await icsGet({request:new Request(`https://example.test/api/driving-bans.ics${history?'?history=1':''}`)} as any);
      const ics = (await response.text()).replace(/\r\n[ \t]/g,'');
      const wanted = history ? json.events : json.upcoming_events;
      const blocks = [...ics.matchAll(/BEGIN:VEVENT\r\n([\s\S]*?)END:VEVENT/g)].map(match => Object.fromEntries(match[1].split('\r\n').filter(Boolean).map(line => {
        const at=line.indexOf(':'); return [line.slice(0,at),line.slice(at+1)];
      })));
      expect(blocks.map(event=>event.UID)).toEqual(wanted.map((event: any)=>event.uid));
      for(const [index,event] of blocks.entries()) {
        const stamp=(value:string)=>value.replaceAll('-','').replaceAll(':','').replace(/\.\d{3}Z$/,'Z');
        expect(event.DTSTART).toBe(stamp(wanted[index].starts_at));
        expect(event.DTEND).toBe(stamp(wanted[index].ends_at));
      }
      expect(ics).toContain('X-DAJC-JURISDICTIONS:'+json.jurisdictions.map((row: any) => row.jurisdiction).join('\\,'));
      expect(ics).toContain('X-DAJC-COVERAGE-VERSION:'+json.coverage_version);
      expect(response.headers.get('Cache-Control')).toBe('no-store');
    }
  });

  it.each(['JE','GI','VA','ENG','FLA','CAT','AZO','RSM'])('rejects retired standalone ICS subscription %s', async code => {
    const response = await icsGet({request:new Request(`https://example.test/api/driving-bans.ics?countries=${code}`)} as any);
    expect(response.status).toBe(400);
    expect(await response.text()).toContain('Unknown jurisdiction');
  });
});
