import { describe, expect, it } from 'vitest';
import { OPTIONS, POST } from '../../pages/api/market-research';

function ctx(method: 'OPTIONS' | 'POST', origin: string, body?: string) {
  const headers = new Headers({ Origin: origin });
  if (method === 'POST') headers.set('Content-Type', 'application/json');
  return {
    request: new Request('https://www.dajc.eu/api/market-research', {
      method, headers, ...(body === undefined ? {} : { body }),
    }),
    clientAddress: '198.51.100.57',
  } as unknown as Parameters<NonNullable<typeof OPTIONS>>[0];
}

describe('DAJC market research cross-domain origin boundary', () => {
  for (const origin of ['https://www.dajc.cz', 'https://dajc.cz', 'https://www.dajc.eu', 'https://dajc.eu']) {
    it('preflights explicitly allowed origin ' + origin, async () => {
      const response = await OPTIONS!(ctx('OPTIONS', origin));
      expect(response.status).toBe(204);
      expect(response.headers.get('access-control-allow-origin')).toBe(origin);
      expect(response.headers.get('access-control-allow-methods')).toContain('POST');
      expect(response.headers.get('access-control-allow-headers')).toContain('Content-Type');
      expect(response.headers.get('vary')).toBe('Origin');
    });
  }

  it('rejects an untrusted preflight and does not grant CORS', async () => {
    const response = await OPTIONS!(ctx('OPTIONS', 'https://evil.example'));
    expect(response.status).toBe(403);
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('rejects an untrusted POST before reading user data', async () => {
    const response = await POST!(ctx('POST', 'https://evil.example', '{}'));
    expect(response.status).toBe(403);
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('returns a CORS-visible validation error for Czech submissions without writing to the database', async () => {
    const response = await POST!(ctx('POST', 'https://www.dajc.cz', '{"product":"tar"}'));
    expect(response.status).toBe(400);
    expect(response.headers.get('access-control-allow-origin')).toBe('https://www.dajc.cz');
    expect((await response.json()).ok).toBe(false);
  });
});
