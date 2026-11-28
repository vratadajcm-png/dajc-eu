// The DAJC Intelligence customer area (/intelligence/account/**) and its API
// (/api/intelligence/**) answer 404 from the real middleware unless the release and
// DAJC_INTELLIGENCE_ACCOUNTS_ENABLED both hold; /intelligence (product page) is untouched.
import { afterEach, describe, expect, it } from 'vitest';
import { onRequest } from '../../middleware';
import { DRIVING_BANS_INTELLIGENCE_RELEASED, isIntelligenceAccountsEnabled } from '../../lib/intelligence/entitlements';
import { notFoundUnlessIntelligenceAccounts } from '../lib/guards';

const call = async (pathname: string) => {
  let reached = false;
  const response = await onRequest({ url: new URL(`https://www.dajc.eu${pathname}`), request: new Request(`https://www.dajc.eu${pathname}`) } as any, async () => { reached = true; return new Response('ok'); });
  return { response: response as Response, reached };
};

afterEach(() => { delete process.env.DAJC_INTELLIGENCE_ACCOUNTS_ENABLED; });

describe('DAJC Intelligence accounts gate', () => {
  it('23: stays off while the product is unreleased, even with the flag set', async () => {
    expect(DRIVING_BANS_INTELLIGENCE_RELEASED).toBe(false);
    process.env.DAJC_INTELLIGENCE_ACCOUNTS_ENABLED = 'true';
    expect(isIntelligenceAccountsEnabled()).toBe(false);
    expect(notFoundUnlessIntelligenceAccounts()?.status).toBe(404);
    for (const path of ['/intelligence/account', '/intelligence/account/login', '/intelligence/account/callback?token=x', '/api/intelligence/calendar/dcal_x.ics']) {
      const { response, reached } = await call(path);
      expect([path, response.status, reached]).toEqual([path, 404, false]);
      expect(response.headers.get('X-Robots-Tag')).toMatch(/noindex/);
    }
    expect((await call('/intelligence')).reached).toBe(true);
    expect((await call('/intelligence-x/account')).reached).toBe(true);
  });

  it('needs the release and the exact flag value', () => {
    expect(isIntelligenceAccountsEnabled({ DAJC_INTELLIGENCE_ACCOUNTS_ENABLED: 'true' }, true)).toBe(true);
    for (const value of ['TRUE', '1', 'yes', ' true', '']) expect(isIntelligenceAccountsEnabled({ DAJC_INTELLIGENCE_ACCOUNTS_ENABLED: value }, true)).toBe(false);
  });
});
