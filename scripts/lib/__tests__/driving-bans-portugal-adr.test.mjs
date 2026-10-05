import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { hydrateCanonical, validateCanonical, snapshot, toIcs } from '../../../src/lib/driving-bans/core.mjs';
import { dajcEuropeCoverage } from '../../../config/europe-coverage.mjs';

const raw = JSON.parse(readFileSync(new URL('../../../data/driving-bans/canonical.json', import.meta.url), 'utf8'));
const data = hydrateCanonical(raw, dajcEuropeCoverage);
const view = snapshot(data, dajcEuropeCoverage, new Date('2026-10-05T06:50:56.000Z'));

describe('Portugal ADR targeted coverage repair', () => {
  it('keeps Portugal jurisdiction fail-closed while publishing verified ADR rules', () => {
    validateCanonical(data, dajcEuropeCoverage);
    const pt = view.jurisdictions.find(j => j.jurisdiction === 'PT');
    expect(pt.verification_state).toBe('UNVERIFIED');
    expect(pt.ban_state).toBe('HAS_BAN');
    expect(pt.coverage_complete).toBe(false);
  });

  it('publishes the Oct 5 Monday morning and holiday-evening ADR restrictions with stable scope', () => {
    const events = view.events.filter(e => e.jurisdiction === 'PT' && e.restriction_types.includes('adr') && e.date === '2026-10-05');
    expect(events.some(e => e.start_time === '07:00' && e.end_time === '10:00')).toBe(true);
    expect(events.some(e => e.start_time === '18:00' && e.end_time === '21:00')).toBe(true);
    expect(events.every(e => e.timezone === 'Europe/Lisbon')).toBe(true);
  });

  it('does not invent an all-day tank holiday event for Monday 5 October', () => {
    const allDay = view.events.filter(e => e.jurisdiction === 'PT' && e.date === '2026-10-05' && e.start_time === '00:00' && e.end_time === '24:00');
    expect(allDay).toHaveLength(0);
  });

  it('ADR ICS filtering includes ADR events while general HGV filtering excludes ADR-only events', () => {
    const adr = toIcs(view, { type: 'adr', upcoming: false });
    const general = toIcs(view, { type: 'general', upcoming: false });
    expect(adr).toContain('PT — ADR heavy vehicles');
    expect(general).not.toContain('PT — ADR heavy vehicles');
  });
});
