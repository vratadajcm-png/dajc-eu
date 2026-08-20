// Mandatory feature-gate tests (docs/PARTNER_PORTAL.md section 13 / spec
// item 13): the portal must be deny-by-default and fail closed for every
// value of DAJC_PARTNER_PORTAL_ENABLED except the exact string "true".
import { afterEach, describe, expect, it } from 'vitest';
import { isPartnerPortalEnabled, isPartnerPortalPath, PARTNER_PORTAL_BASE_PATH } from '../config/gate';

const ENV_KEY = 'DAJC_PARTNER_PORTAL_ENABLED';

afterEach(() => {
  delete process.env[ENV_KEY];
});

describe('isPartnerPortalEnabled', () => {
  it('is disabled when the env var is missing entirely', () => {
    delete process.env[ENV_KEY];
    expect(isPartnerPortalEnabled()).toBe(false);
  });

  it('is disabled when the env var is an empty string', () => {
    process.env[ENV_KEY] = '';
    expect(isPartnerPortalEnabled()).toBe(false);
  });

  it.each(['TRUE', 'True', '1', 'yes', 'on', ' true', 'true ', 'false'])(
    'is disabled for non-exact value %j',
    (value) => {
      process.env[ENV_KEY] = value;
      expect(isPartnerPortalEnabled()).toBe(false);
    }
  );

  it('is enabled only for the exact string "true"', () => {
    process.env[ENV_KEY] = 'true';
    expect(isPartnerPortalEnabled()).toBe(true);
  });
});

describe('isPartnerPortalPath', () => {
  it('matches the base path and every nested route', () => {
    expect(isPartnerPortalPath(PARTNER_PORTAL_BASE_PATH)).toBe(true);
    expect(isPartnerPortalPath('/partner-portal/admin')).toBe(true);
    expect(isPartnerPortalPath('/partner-portal/admin/partners/123')).toBe(true);
    expect(isPartnerPortalPath('/partner-portal/activate/some-token')).toBe(true);
    expect(isPartnerPortalPath('/partner-portal/api/whatever')).toBe(true);
  });

  it('does not match unrelated or merely-prefixed paths', () => {
    expect(isPartnerPortalPath('/')).toBe(false);
    expect(isPartnerPortalPath('/partners')).toBe(false);
    expect(isPartnerPortalPath('/partner-portal-marketing')).toBe(false);
    expect(isPartnerPortalPath('/news')).toBe(false);
  });
});
