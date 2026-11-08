import { describe, expect, it } from 'vitest';
import { dajcEuropeCoverage } from '../../../config/europe-coverage.mjs';
import { canonicalDrivingBans } from '../../../config/driving-ban-calendars/runtime.mjs';
import { snapshot, validateCanonical, MONTH_STATES } from './core.mjs';

const CLOCK = new Date('2026-11-03T08:00:00Z');
const at = (edit?: (data: any) => void) => {
  const data = structuredClone(canonicalDrivingBans);
  edit?.(data);
  return snapshot(data, dajcEuropeCoverage, CLOCK);
};
const row = (view: any, code: string) => view.jurisdictions.find((j: any) => j.jurisdiction === code);
const month = (view: any, code: string, from: string) => row(view, code).monthly_coverage.find((m: any) => m.from.startsWith(from));
const reviews = (data: any, code: string) => data.jurisdictions.find((j: any) => j.jurisdiction === code);

describe('monthly coverage inside the rolling year', () => {
  it('gives every month portion a public status and an event count', () => {
    const view = at();
    for (const j of view.jurisdictions) for (const m of j.monthly_coverage) {
      expect(MONTH_STATES).toContain(m.status);
      expect(m.status === 'VERIFIED').toBe(m.coverage_complete);
      expect(m.event_count).toBe(view.events.filter((e: any) => e.jurisdiction === j.jurisdiction && e.date <= m.to && (e.end_date > m.from || (e.end_date === m.from && e.end_time > '00:00'))).length);
    }
  });

  it('never verifies a month outside the jurisdiction own reviewed span when the dataset window grows', () => {
    // Simulate a January 2027 review for CZ only: the dataset window grows, the others keep their own end.
    const view = at(data => {
      const previousEnd = data.window.to;
      data.window.to = '2027-01-31';
      for (const j of data.jurisdictions) { j.period = { ...data.window }; if (j.jurisdiction !== 'CZ') j.reviewed_through = previousEnd; }
    });
    expect(month(view, 'CZ', '2027-01').status).toBe('VERIFIED');
    for (const code of ['IT', 'FR', 'CH', 'PL']) {
      expect(month(view, code, '2026-12').status).toBe('VERIFIED');
      expect(month(view, code, '2027-01').coverage_complete).toBe(false);
    }
  });

  it('marks months awaiting an annual instrument, never as verified or no ban', () => {
    const view = at(data => { reviews(data, 'IT').awaiting_publication = [{ from: '2027-01-01', to: '2027-12-31', instrument: 'MIT heavy-vehicle calendar decree 2027' }]; });
    expect(month(view, 'IT', '2027-01')).toMatchObject({ status: 'AWAITING_OFFICIAL_PUBLICATION', coverage_complete: false, awaiting_publication: 'MIT heavy-vehicle calendar decree 2027' });
    expect(month(view, 'IT', '2026-12').status).toBe('VERIFIED');
    expect(row(view, 'IT').ban_state).not.toBe('NO_BAN');
  });

  it('a shorter reviewed_through only affects its own jurisdiction', () => {
    const view = at(data => { reviews(data, 'CZ').reviewed_through = '2026-11-30'; });
    expect(month(view, 'CZ', '2026-11').status).toBe('VERIFIED');
    expect(month(view, 'CZ', '2026-12').status).not.toBe('VERIFIED');
    expect(month(view, 'SK', '2026-12').status).toBe('VERIFIED');
  });

  it('rejects an invalid reviewed span or awaited publication', () => {
    const bad = (edit: (j: any) => void) => {
      const data = structuredClone(canonicalDrivingBans);
      edit(reviews(data, 'CZ'));
      return () => validateCanonical(data, dajcEuropeCoverage);
    };
    expect(bad(j => { j.reviewed_through = '2031-01-01'; })).toThrow(/reviewed_through/);
    expect(bad(j => { j.reviewed_through = 'soon'; })).toThrow(/reviewed_through/);
    expect(bad(j => { j.awaiting_publication = [{ from: '2027-02-01', to: '2027-01-01', instrument: 'x' }]; })).toThrow(/awaiting_publication/);
  });
});
