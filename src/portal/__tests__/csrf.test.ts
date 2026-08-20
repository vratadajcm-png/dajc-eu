// Double-submit CSRF cookie check (docs/PARTNER_PORTAL.md security notes).
// Only the pure comparison logic is exercised here - no DB/session needed.
import { describe, expect, it } from 'vitest';
import type { AstroCookies } from 'astro';
import { validateCsrfToken } from '../lib/session';

function cookiesWith(value: string | undefined): AstroCookies {
  return {
    get: (name: string) => (name === 'dajc_portal_csrf' && value !== undefined ? { value } : undefined),
  } as unknown as AstroCookies;
}

describe('validateCsrfToken', () => {
  it('rejects when no CSRF cookie is set', () => {
    expect(validateCsrfToken(cookiesWith(undefined), 'anything')).toBe(false);
  });

  it('rejects when no token was submitted', () => {
    expect(validateCsrfToken(cookiesWith('cookie-value'), null)).toBe(false);
    expect(validateCsrfToken(cookiesWith('cookie-value'), undefined)).toBe(false);
  });

  it('rejects when the submitted token does not match the cookie', () => {
    expect(validateCsrfToken(cookiesWith('cookie-value'), 'forged-value')).toBe(false);
  });

  it('accepts when the submitted token matches the cookie (same-origin form/JS)', () => {
    expect(validateCsrfToken(cookiesWith('matching-value'), 'matching-value')).toBe(true);
  });
});
