import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createConfirmationToken,
  isNewsAlertsReady,
  normalizeEmail,
  readConfirmationToken,
} from './news-alerts';

const ORIGINAL_ENV = { ...process.env };

describe('DAJC News Alerts helpers', () => {
  beforeEach(() => {
    process.env.DAJC_NEWS_ALERTS_SIGNING_SECRET = 'test-secret-long-enough-for-news-alerts';
    process.env.DAJC_NEWS_ALERTS_ENABLED = 'false';
    delete process.env.RESEND_API_KEY;
    delete process.env.DAJC_NEWS_ALERTS_SEGMENT_ID;
    delete process.env.DAJC_NEWS_ALERTS_EMAIL_MODE;
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('normalizes valid email addresses and rejects malformed input', () => {
    expect(normalizeEmail('  DRIVER@Example.EU ')).toBe('driver@example.eu');
    expect(normalizeEmail('not-an-email')).toBeNull();
    expect(normalizeEmail('a@b')).toBeNull();
  });

  it('round-trips an encrypted confirmation token', () => {
    const now = Date.UTC(2026, 8, 2, 10, 0, 0);
    const token = createConfirmationToken('driver@example.eu', now);
    expect(token).not.toContain('driver');
    expect(readConfirmationToken(token, now + 60_000)).toBe('driver@example.eu');
  });

  it('rejects expired or tampered confirmation tokens', () => {
    const now = Date.UTC(2026, 8, 2, 10, 0, 0);
    const token = createConfirmationToken('driver@example.eu', now);

    expect(readConfirmationToken(token, now + 24 * 60 * 60 * 1000 + 1)).toBeNull();

    const replacement = token.endsWith('A') ? 'B' : 'A';
    const tampered = token.slice(0, -1) + replacement;
    expect(readConfirmationToken(tampered, now + 60_000)).toBeNull();
  });

  it('requires every live configuration input before exposing News Alerts', () => {
    process.env.DAJC_NEWS_ALERTS_ENABLED = 'true';
    process.env.DAJC_NEWS_ALERTS_EMAIL_MODE = 'live';
    process.env.RESEND_API_KEY = 're_test';
    process.env.DAJC_NEWS_ALERTS_SEGMENT_ID = 'seg_test';

    expect(isNewsAlertsReady()).toBe(true);

    delete process.env.DAJC_NEWS_ALERTS_SEGMENT_ID;
    expect(isNewsAlertsReady()).toBe(false);
  });
});
