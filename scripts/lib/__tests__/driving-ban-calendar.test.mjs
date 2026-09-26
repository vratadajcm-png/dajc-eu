import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolveDrivingBanFindings } from '../driving-ban-calendar.mjs';
import { hydrateCanonical, calendarRules, snapshot } from '../../../src/lib/driving-bans/core.mjs';
import { dajcEuropeCoverage } from '../../../config/europe-coverage.mjs';

// Historical fixture is explicit; retired assertions that extrapolated future
// law, produced exception-only ban events or treated missing countries as banned
// are replaced by the new fail-closed publication contract.
const data = hydrateCanonical(JSON.parse(readFileSync(new URL('../../../tests/fixtures/driving-bans-sep-oct-2026.json', import.meta.url), 'utf8')), dajcEuropeCoverage);
const rules = calendarRules(data);
const week = (date, selected = rules) => {
  const start = new Date(`${date}T00:00:00Z`);
  return resolveDrivingBanFindings({weekStart:start, weekEnd:new Date(start.getTime()+6*86400000), year:start.getUTCFullYear(), rules:selected});
};
const resolve = (id, date) => {
  const start = new Date(`${date}T00:00:00Z`);
  return rules.find(r=>r.id===id).resolve(start,new Date(start.getTime()+6*86400000),start.getUTCFullYear());
};

describe('weekly-news/canonical Driving Bans boundary',()=>{
  it('does not let incomplete country review crash unrelated news publication',()=>{expect(week('2026-09-28').maintenanceErrors).toEqual([]);});
  it('reports incomplete primary coverage explicitly',()=>{const r=week('2026-09-28');expect(r.complete).toBe(false);expect(r.coverageWarnings.length).toBeGreaterThan(0);});
  it('does not repeat the standalone Driving Bans reference as weekly news',()=>{expect(week('2026-09-28').findings).toEqual([]);});
  it('does not invent historical W35 findings outside the verified window',()=>{expect(week('2026-08-24').findings).toEqual([]);});
  it('does not extrapolate an annual calendar to an unreviewed future year',()=>{expect(week('2031-08-25').findings).toEqual([]);expect(week('2031-08-25').complete).toBe(false);});
  it('reserves hard maintenance errors for broken resolver data',()=>{const broken={id:'broken-test',country:'AT',resolve(){throw Error('invalid rule');}};expect(week('2026-09-28',[broken]).maintenanceErrors[0]).toContain('invalid rule');});
  it('retains legacy annual-maintenance failure semantics for explicit fixtures',()=>{const broken={id:'annual-test',country:'IT',resolve(){return{maintenanceError:'unseeded year',occurrences:[]};}};expect(week('2031-08-25',[broken]).maintenanceErrors[0]).toContain('unseeded year');});
  it('rejects an invalid requested window',()=>{expect(()=>week('not-a-date')).toThrow();});
});

describe('canonical resolver regression coverage',()=>{
  it('keeps Germany-bound Austria October 3 as a real timed holiday restriction',()=>{const o=resolve('at-calendar-germany-oct03-2026','2026-09-28').occurrences;expect(o).toHaveLength(1);expect(o[0].validFrom).toBe('2026-10-03');expect(o[0].timeWindow).toContain('00:00');});
  it('keeps Austrian northern and southern A10 schedules separate',()=>{expect(resolve('at-a10-north-september-2026','2026-09-14').occurrences).toHaveLength(1);expect(resolve('at-a10-south-september-2026','2026-09-14').occurrences).toHaveLength(0);});
  it('retains the Luxembourg holiday eve rather than an all-day warning',()=>{const o=resolve('lu-germany-unity-2026','2026-09-28').occurrences[0];expect(o.validFrom).toBe('2026-10-02');expect(o.timeWindow).toContain('23:30');expect(o.startsAt).toBe('2026-10-02T21:30:00.000Z');});
  it('preserves the 25-hour Liechtenstein DST Sunday',()=>{const o=resolve('li-sunday','2026-10-19').occurrences[0];expect((Date.parse(o.endsAt)-Date.parse(o.startsAt))/3600000).toBe(25);});
  it('does not extend Montenegro seasonal restrictions beyond October 15',()=>{const o=resolve('me-r1-season-2026','2026-10-12').occurrences;expect(o).toHaveLength(4);expect(o.at(-1).validTo).toBe('2026-10-15');});
  it('preserves the Bulgarian 12t threshold in the config projection',()=>{expect(rules.find(r=>r.id==='bg-holiday-2026-09-07').weight_threshold.value).toBe(12000);});
  it('retains Spain route direction, exact times and special-transport relevance',()=>{const rule=rules.find(r=>r.id==='es-annex2-oct-2026-08');expect(rule.routeScope).toContain('Santander');expect(rule.restrictionTypes).toEqual(['general','exceptional']);expect(resolve(rule.id,'2026-10-26').occurrences[0].timeWindow).toContain('11:00');});
  it('assigns only stable real-event identifiers',()=>{const a=resolve('li-sunday','2026-10-19').occurrences[0];const b=resolve('li-sunday','2026-10-19').occurrences[0];expect(a.uid).toBe(b.uid);expect(a.uid).toContain('@dajc.eu');});
  it('every emitted rule has an authoritative source URL',()=>{for(const r of rules){expect(r.sourceUrl).toMatch(/^https:\/\//);expect(r.verification_state).toBe('PRIMARY_VERIFIED');}});
  it('compatibility config does not count partial countries as fully reviewed',()=>{expect(snapshot(data,dajcEuropeCoverage,new Date('2026-09-26')).complete).toBe(false);});
  it.each(['DE','CZ','HU','SI','FR','SK','IT'])('keeps unreviewed %s UNKNOWN instead of accepting a retired seed as new evidence',code=>{const j=snapshot(data,dajcEuropeCoverage,new Date('2026-09-26')).jurisdictions.find(j=>j.jurisdiction===code);expect(j.ban_state).toBe('UNKNOWN');expect(j.verification_state).toBe('UNVERIFIED');});
});
