import { describe, expect, it } from 'vitest';
import { checkLongRoadClosure } from '../closure-duration.mjs';

describe('checkLongRoadClosure', () => {
  it('does not affect non-closure findings', () => {
    expect(checkLongRoadClosure({ type: 'permit_change' }).ok).toBe(true);
  });

  it('rejects a 30-day closure', () => {
    const result = checkLongRoadClosure({
      type: 'road_closure',
      validFrom: '2026-09-01',
      validTo: '2026-10-01',
    });
    expect(result.ok).toBe(false);
  });

  it('accepts a closure longer than 30 days', () => {
    const result = checkLongRoadClosure({
      type: 'road_closure',
      validFrom: '2026-09-01',
      validTo: '2026-10-15',
    });
    expect(result.ok).toBe(true);
  });

  it('accepts an explicit six-week closure in source text', () => {
    const result = checkLongRoadClosure({
      type: 'road_closure',
      title: 'Motorway closure',
      summary: 'The carriageway will be closed for 6 weeks during reconstruction.',
    });
    expect(result.ok).toBe(true);
  });

  it('rejects an undated closure with unknown duration', () => {
    const result = checkLongRoadClosure({
      type: 'road_closure',
      title: 'Road closed',
      summary: 'Traffic is diverted until further notice.',
    });
    expect(result.ok).toBe(false);
  });
});
