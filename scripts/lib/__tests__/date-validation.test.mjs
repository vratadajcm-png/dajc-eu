import { describe, expect, it } from 'vitest';
import { isValidIsoDate, validateDevelopmentDateRange } from '../date-validation.mjs';

// W35 2026 is 24-30 August (Monday-Sunday).
const weekStart = new Date('2026-08-24T00:00:00Z');
const weekEnd = new Date('2026-08-30T00:00:00Z');

describe('isValidIsoDate', () => {
  it('accepts a real calendar date', () => {
    expect(isValidIsoDate('2026-08-29')).toBe(true);
  });
  it('rejects an impossible calendar date', () => {
    expect(isValidIsoDate('2026-02-30')).toBe(false);
  });
  it('rejects a malformed string', () => {
    expect(isValidIsoDate('29 August 2026')).toBe(false);
    expect(isValidIsoDate('')).toBe(false);
    expect(isValidIsoDate(null)).toBe(false);
  });
});

describe('validateDevelopmentDateRange', () => {
  it('passes when both dates are unknown', () => {
    expect(validateDevelopmentDateRange({}, { weekStart, weekEnd }).ok).toBe(true);
  });

  it('passes a development that is fully inside the target week', () => {
    const result = validateDevelopmentDateRange({ validFrom: '2026-08-29', validTo: '2026-08-30' }, { weekStart, weekEnd });
    expect(result.ok).toBe(true);
  });

  // Regression: an event ending on 23 August (the day before W35 starts)
  // must never be allowed into a 24-30 August article - this is exactly
  // the class of bug that let the Monaco/La Vuelta item (valid 21-23
  // August) into the first published W35 article.
  it('rejects a development whose validTo is before the target week starts', () => {
    const result = validateDevelopmentDateRange({ validFrom: '2026-08-21', validTo: '2026-08-23' }, { weekStart, weekEnd });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/already ended/);
  });

  it('rejects a development whose validFrom is after the target week ends', () => {
    const result = validateDevelopmentDateRange({ validFrom: '2026-09-05' }, { weekStart, weekEnd });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/not started yet/);
  });

  it('allows a development that starts inside the week and legitimately extends past it (France exceptional-transport window)', () => {
    // Saturday 29 Aug 12:00 to Monday 31 Aug 06:00 - validTo is one day
    // after W35 ends, which is correct, not a bug.
    const result = validateDevelopmentDateRange({ validFrom: '2026-08-29', validTo: '2026-08-31' }, { weekStart, weekEnd });
    expect(result.ok).toBe(true);
  });

  it('rejects an invalid ISO date', () => {
    expect(validateDevelopmentDateRange({ validFrom: 'not-a-date' }, { weekStart, weekEnd }).ok).toBe(false);
  });

  it('rejects a reversed date range', () => {
    const result = validateDevelopmentDateRange({ validFrom: '2026-08-30', validTo: '2026-08-24' }, { weekStart, weekEnd });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/reversed/);
  });
});
