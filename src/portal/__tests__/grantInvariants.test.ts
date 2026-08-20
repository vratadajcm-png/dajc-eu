// A grant is active only while unrevoked AND (if it has an expiry) not yet
// past it - docs/PARTNER_PORTAL.md "Data model" expiry/revocation
// invariants, spec item 6.
import { describe, expect, it } from 'vitest';
import { isGrantActive } from '../lib/accessGrants';

describe('isGrantActive', () => {
  it('is active with no revocation and no expiry', () => {
    expect(isGrantActive({ revokedAt: null, expiresAt: null })).toBe(true);
  });

  it('is active with a future expiry', () => {
    expect(isGrantActive({ revokedAt: null, expiresAt: new Date(Date.now() + 60_000) })).toBe(true);
  });

  it('is inactive once revoked, regardless of expiry', () => {
    expect(isGrantActive({ revokedAt: new Date(), expiresAt: new Date(Date.now() + 60_000) })).toBe(false);
    expect(isGrantActive({ revokedAt: new Date(), expiresAt: null })).toBe(false);
  });

  it('is inactive once past its expiry even without an explicit revocation', () => {
    expect(isGrantActive({ revokedAt: null, expiresAt: new Date(Date.now() - 1000) })).toBe(false);
  });
});
