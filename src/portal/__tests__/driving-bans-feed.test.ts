import { describe, expect, it } from 'vitest';
import { GET } from '../../pages/api/driving-bans.ics';

const get = (query: string) => GET({ request: new Request(`https://www.dajc.eu/api/driving-bans.ics?${query}`) } as Parameters<typeof GET>[0]);

describe('driving-ban feed coverage boundary', () => {
  it.each(['NO', 'DE,NO', 'unknown'])('rejects missing coverage for %s without publishing an empty calendar', async (countries) => {
    const response = await get(`countries=${countries}`);
    expect(response.status).toBe(422);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.text()).toContain('Missing data does not mean no restrictions');
  });
  it.each(['from=bad', 'from=2026-10-31&to=2026-09-01', 'from=2020-01-01&to=2030-01-01', 'type=unknown'])('rejects invalid or unbounded input: %s', async (query) => {
    expect((await get(`countries=DE&${query}`)).status).toBe(400);
  });
  it('includes visible partial-coverage warning alongside maintained events', async () => {
    const response = await get('countries=DE&from=2026-09-01&to=2026-10-31');
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain('SUMMARY:DAJC — partial coverage / verify restrictions');
    expect(body).toContain('Germany');
    expect(body).toContain('END:VCALENDAR');
    expect(body.split('\r\n').every((line) => new TextEncoder().encode(line).length <= 75)).toBe(true);
  });
});
