import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { accessConfiguration, hasAccessSession, issueAccessSession, verifyAccessCode, isSameOriginPost, allowAccessAttempt } from '../access';
import { GET } from '../../pages/investor/pitch-deck/[file]';

const now = Date.UTC(2026, 9, 7, 21, 0);
beforeEach(() => {
  vi.stubEnv('DAJC_INVESTOR_ACCESS_CODE', 'test-only-code-do-not-deploy');
  vi.stubEnv('DAJC_INVESTOR_DOCUMENT_KEY', 'ab'.repeat(32));
});
afterEach(() => vi.unstubAllEnvs());

describe('Investor document access', () => {
  it('fails closed without both runtime secrets', () => {
    vi.stubEnv('DAJC_INVESTOR_DOCUMENT_KEY', '');
    expect(accessConfiguration()).toBeNull();
    expect(verifyAccessCode('test-only-code-do-not-deploy')).toBe(false);
    expect(hasAccessSession('anything')).toBe(false);
  });
  it('rejects incorrect and oversized codes', () => {
    expect(verifyAccessCode('wrong')).toBe(false);
    expect(verifyAccessCode('x'.repeat(257))).toBe(false);
    expect(verifyAccessCode('test-only-code-do-not-deploy')).toBe(true);
  });
  it('allows a valid session and expires it after eight hours', () => {
    const token = issueAccessSession(now);
    expect(hasAccessSession(token, now)).toBe(true);
    expect(hasAccessSession(token, now + 8 * 60 * 60 * 1000)).toBe(false);
  });
  it('rejects a modified signature or payload', () => {
    const token = issueAccessSession(now);
    const [payload, signature] = token.split('.');
    const modified = (signature[0] === 'A' ? 'B' : 'A') + signature.slice(1);
    expect(hasAccessSession(`${payload}.${modified}`, now)).toBe(false);
    expect(hasAccessSession(`e30.${signature}`, now)).toBe(false);
    expect(hasAccessSession(`${token}.extra`, now)).toBe(false);
  });
  it('revokes existing sessions when the access code changes', () => {
    const token = issueAccessSession(now);
    vi.stubEnv('DAJC_INVESTOR_ACCESS_CODE', 'new-test-code-do-not-deploy');
    expect(hasAccessSession(token, now)).toBe(false);
  });
  it('rejects cross-origin and originless form submissions', () => {
    const request = (origin?: string) => new Request('https://www.dajc.eu/investor/pitch-deck', { method: 'POST', headers: origin ? { origin } : {} });
    expect(isSameOriginPost(request('https://www.dajc.eu'))).toBe(true);
    expect(isSameOriginPost(request('https://example.com'))).toBe(false);
    expect(isSameOriginPost(request())).toBe(false);
  });
  it('throttles repeated attempts and resets after the window', () => {
    const ip = 'test-investor-throttle';
    for (let i = 0; i < 10; i++) expect(allowAccessAttempt(ip, now)).toBe(true);
    expect(allowAccessAttempt(ip, now)).toBe(false);
    expect(allowAccessAttempt(ip, now + 10 * 60 * 1000)).toBe(true);
  });
  it('never serves either document to an unauthenticated request', async () => {
    for (const file of ['pitch-deck.pdf', 'pitch-deck.pptx']) {
      const response = await GET({ params: { file }, cookies: { get: () => undefined }, request: new Request(`https://www.dajc.eu/investor/pitch-deck/${file}`) } as any);
      expect(response.status).toBe(401);
      expect(response.headers.get('Cache-Control')).toContain('no-store');
      expect(response.headers.get('X-Robots-Tag')).toContain('noindex');
      expect(response.headers.get('Content-Disposition')).toBeNull();
    }
  });
});
