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
  it('includes Italy under the general HGV filter', async () => {
    const response = await get('countries=IT&type=general&from=2026-10-01&to=2026-10-31');
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('DTSTART;VALUE=DATE:20261025');
  });
  it('shows a visible warning instead of silently dropping unmaintained years', async () => {
    const response = await get('countries=IT&from=2026-12-01&to=2027-01-31');
    expect(response.status).toBe(200);
    const body = (await response.text()).replaceAll('\r\n ', '');
    expect(body).toContain('SUMMARY:Italy — 2027 ban dates not yet maintained / verify');
    expect(body).toContain('DTSTART;VALUE=DATE:20270101');
  });
  it('keeps the general HGV bans in the exceptional-transport feed (oversize vehicles are HGVs too)', async () => {
    const response = await get('countries=DE&type=exceptional&from=2026-10-01&to=2026-10-31');
    expect(response.status).toBe(200);
    const body = (await response.text()).replaceAll('\r\n ', '');
    expect(body).toContain('Germany — General Sunday driving ban (4 October 2026)');
    expect(body).toContain('Germany — Public-holiday driving ban — Day of German Unity');
  });
  it('leaves oversize-only rules out of the standard HGV feed', async () => {
    const body = await (await get('countries=FR&type=general&from=2026-10-01&to=2026-10-31')).text();
    expect(body).toContain('General HGV weekend driving ban');
    expect(body).not.toContain('Exceptional-transport weekend movement ban');
  });
});
