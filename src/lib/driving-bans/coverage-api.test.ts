import { afterEach, describe, expect, it, vi } from 'vitest';
import { GET as jsonGet } from '../../pages/api/driving-bans.json';
import { GET as icsGet } from '../../pages/api/driving-bans.ics';
import { dajcEuropeCoverage } from '../../../config/europe-coverage.mjs';
import { getDrivingBansSnapshot } from '../../../config/driving-ban-calendars/runtime.mjs';

afterEach(() => vi.useRealTimers());
describe('actual JSON and ICS route contract', () => {
  it('exports the same current+next-month registry, verified events and UTC times', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-22T10:00:00Z'));
    const response = await jsonGet({} as any);
    const json = await response.json();
    expect(json).toEqual(getDrivingBansSnapshot());
    expect(json.jurisdictions.map((row: any) => row.jurisdiction)).toEqual(dajcEuropeCoverage.map(([code])=>code));
    expect(json.window).toMatchObject({from:'2026-10-01',to:'2026-11-30'});
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
      expect(ics).toContain('X-DAJC-JURISDICTIONS:'+dajcEuropeCoverage.map(([code])=>code).join('\\,'));
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
