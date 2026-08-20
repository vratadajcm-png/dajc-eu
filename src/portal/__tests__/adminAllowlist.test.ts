import { afterEach, describe, expect, it } from 'vitest';
import { isAllowlistedAdmin } from '../config/adminAllowlist';

const ENV_KEY = 'DAJC_PARTNER_ADMIN_ALLOWLIST';

afterEach(() => {
  delete process.env[ENV_KEY];
});

describe('isAllowlistedAdmin', () => {
  it('denies everyone when the allowlist is missing or empty', () => {
    delete process.env[ENV_KEY];
    expect(isAllowlistedAdmin('anyone@dajc.eu')).toBe(false);

    process.env[ENV_KEY] = '';
    expect(isAllowlistedAdmin('anyone@dajc.eu')).toBe(false);
  });

  it('matches listed emails case-insensitively and trims whitespace', () => {
    process.env[ENV_KEY] = ' Alice@dajc.eu, bob@dajc.eu ';
    expect(isAllowlistedAdmin('alice@dajc.eu')).toBe(true);
    expect(isAllowlistedAdmin('ALICE@DAJC.EU')).toBe(true);
    expect(isAllowlistedAdmin('  bob@dajc.eu  ')).toBe(true);
  });

  it('denies emails not on the list', () => {
    process.env[ENV_KEY] = 'alice@dajc.eu';
    expect(isAllowlistedAdmin('mallory@evil.example')).toBe(false);
  });
});
