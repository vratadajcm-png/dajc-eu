import { describe, expect, it } from 'vitest';
import { allowRegistrationAttempt } from '../throttle';

describe('allowRegistrationAttempt', () => {
  it('allows five registrations per address per hour, then blocks', () => {
    const now = Date.UTC(2026, 9, 8, 12);
    const results = Array.from({ length: 6 }, () => allowRegistrationAttempt('198.51.100.1', now));
    expect(results).toEqual([true, true, true, true, true, false]);
    expect(allowRegistrationAttempt('198.51.100.1', now + 60 * 60 * 1000 + 1)).toBe(true);
  });

  it('caps the whole instance per day regardless of address', () => {
    const now = Date.UTC(2026, 9, 9, 12);
    let allowed = 0;
    for (let i = 0; i < 300; i++) if (allowRegistrationAttempt(`203.0.113.${i}`, now)) allowed++;
    expect(allowed).toBe(200);
    expect(allowRegistrationAttempt('192.0.2.1', Date.UTC(2026, 9, 10, 0, 1))).toBe(true);
  });
});
