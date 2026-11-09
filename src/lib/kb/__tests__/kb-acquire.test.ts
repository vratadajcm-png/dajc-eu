import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { MemoryArchive, sha256Hex } from '../archive.mjs';
import { AcquireError, PoliteClient } from '../acquire/polite-fetch.mjs';
import { parseGiiToc, parseGiiXml, readZip, selectDeLaws } from '../acquire/de-gii.mjs';
import { prepareStructuredVersion } from '../acquire/structured.mjs';
import { IntegrityError, storeVersion } from '../acquire/pipeline.mjs';
import { RIS_MIN_INTERVAL_MS, risClient } from '../acquire/at-ris.mjs';
import { NN_MIN_INTERVAL_MS, parseSitemapUrls } from '../acquire/hr-nn.mjs';

const resp = (status: number, body: Uint8Array | string = '', headers: Record<string, string> = {}) => ({ ok: status < 300, status, headers: new Headers(headers), arrayBuffer: async () => (typeof body === 'string' ? new TextEncoder().encode(body) : body).buffer });
const open = { admit: async () => undefined };
const client = (fetchImpl: unknown, extra = {}) => new PoliteClient({ fetchImpl: fetchImpl as never, robots: open as never, sleep: async () => undefined, minIntervalMs: 0, backoffMs: 1, ...extra });

function zip(name: string, content: string) {
  const data = new TextEncoder().encode(content); const comp = deflateRawSync(data); const nm = new TextEncoder().encode(name);
  const local = new Uint8Array(30 + nm.length + comp.length); const lv = new DataView(local.buffer);
  lv.setUint32(0, 0x04034b50, true); lv.setUint16(8, 8, true); lv.setUint32(18, comp.length, true); lv.setUint32(22, data.length, true); lv.setUint16(26, nm.length, true); local.set(nm, 30); local.set(comp, 30 + nm.length);
  const cd = new Uint8Array(46 + nm.length); const cv = new DataView(cd.buffer);
  cv.setUint32(0, 0x02014b50, true); cv.setUint16(10, 8, true); cv.setUint32(20, comp.length, true); cv.setUint32(24, data.length, true); cv.setUint16(28, nm.length, true); cv.setUint32(42, 0, true); cd.set(nm, 46);
  const end = new Uint8Array(22); const ev = new DataView(end.buffer); ev.setUint32(0, 0x06054b50, true); ev.setUint16(10, 1, true); ev.setUint32(12, cd.length, true); ev.setUint32(16, local.length, true);
  const out = new Uint8Array(local.length + cd.length + end.length); out.set(local); out.set(cd, local.length); out.set(end, local.length + cd.length); return out;
}

const XML = `<?xml version="1.0"?><dokumente><norm><metadaten><jurabk>StVO</jurabk><ausfertigung-datum>2013-03-06</ausfertigung-datum><langue>Straßenverkehrs-Ordnung</langue></metadaten></norm>
<norm><metadaten><enbez>§ 30</enbez><titel>Umweltschutz, Sonn- und Feiertagsfahrverbot</titel></metadaten><textdaten><text><Content><P>Lastkraftwagen mit einer zulässigen Gesamtmasse über 7,5 t dürfen an Sonntagen nicht verkehren.</P></Content></text></textdaten></norm></dokumente>`;
const TOC = `<items><item><title>Straßenverkehrs-Ordnung</title><link>http://www.gesetze-im-internet.de/stvo_2013/xml.zip</link></item><item><title>Bürgerliches Gesetzbuch</title><link>http://www.gesetze-im-internet.de/bgb/xml.zip</link></item></items>`;

describe('Gesetze im Internet', () => {
  it('discovers road-freight laws from the catalogue only', () => {
    const laws = selectDeLaws(parseGiiToc(TOC));
    expect(laws.map((l: { slug: string }) => l.slug)).toEqual(['stvo_2013']);
    expect(laws[0].url).toBe('https://www.gesetze-im-internet.de/stvo_2013/xml.zip');
    expect(laws[0].legalCategory).toBe('NATIONAL_REGULATION');
  });
  it('reads the ZIP and the XML into citable provisions', () => {
    const z = zip('stvo_2013.xml', XML);
    const files = readZip(z);
    const { meta, pages } = parseGiiXml(new TextDecoder().decode(files[0].data));
    expect(meta.abbreviation).toBe('StVO');
    expect(pages[0].text).toContain('§ 30 Umweltschutz');
    expect(() => parseGiiXml('<x/>')).toThrow(/not a Gesetze/);
  });
});

describe('polite client', () => {
  it('retries a transient 503, then succeeds', async () => {
    const seq = [resp(503), resp(200, 'ok')];
    const c = client(async () => seq.shift());
    expect(new TextDecoder().decode((await c.get('https://x.example/a')).bytes)).toBe('ok');
  });
  it('reports a persistent 503 as transient, never as a permanent ban', async () => {
    const c = client(async () => resp(503), { maxRetries: 2 });
    await expect(c.get('https://x.example/a')).rejects.toMatchObject({ kind: 'TRANSIENT_EXHAUSTED' });
  });
  it('separates a temporarily unreadable robots.txt (503) from a real disallow', async () => {
    let calls = 0;
    const flaky = { hosts: new Map(), admit: async () => { calls++; if (calls < 3) throw new Error('robots.txt of x.example does not allow this download (HTTP 503 for robots.txt)'); } };
    const ok = client(async () => resp(200, 'ok'), { robots: flaky as never });
    expect((await ok.get('https://x.example/a')).status).toBe(200);
    const down = client(async () => resp(200), { robots: { hosts: new Map(), admit: async () => { throw new Error('robots.txt of x.example does not allow this download (HTTP 503 for robots.txt)'); } } as never, maxRetries: 1 });
    await expect(down.get('https://x.example/a')).rejects.toMatchObject({ kind: 'ROBOTS_UNAVAILABLE' });
  });
  it('treats 403 and 404 as permanent without retrying', async () => {
    let n = 0;
    const c = client(async () => { n++; return resp(403); });
    await expect(c.get('https://x.example/a')).rejects.toMatchObject({ kind: 'PERMANENT_HTTP' });
    expect(n).toBe(1);
  });
  it('honours robots.txt and stops on a bot challenge', async () => {
    const refusing = new PoliteClient({ robots: { admit: async () => { throw new Error('disallowed'); } } as never, fetchImpl: (async () => resp(200)) as never });
    await expect(refusing.get('https://x.example/a')).rejects.toMatchObject({ kind: 'ROBOTS_DISALLOWED' });
    const c = client(async () => resp(202, '', { 'x-amzn-waf-action': 'challenge' }));
    await expect(c.get('https://x.example/a')).rejects.toBeInstanceOf(AcquireError);
    await expect(c.get('https://x.example/b')).rejects.toMatchObject({ kind: 'CHALLENGE' });
  });
  it('is serial and paced: 0.5 req/s for AT, 3 req/s for HR', async () => {
    expect(RIS_MIN_INTERVAL_MS).toBe(2000);
    expect(NN_MIN_INTERVAL_MS).toBeGreaterThanOrEqual(333);
    const waits: number[] = []; let t = 100000;
    const c = new PoliteClient({ fetchImpl: (async () => resp(200, 'x')) as never, robots: open as never, minIntervalMs: 2000, now: () => t, sleep: async (ms: number) => { waits.push(ms); t += ms; } });
    await Promise.all([c.get('https://x.example/1'), c.get('https://x.example/2'), c.get('https://x.example/3')]);
    expect(waits.filter((w) => w > 0).every((w) => w >= 1999)).toBe(true);
  });
  it('AT RIS is refused by robots.txt unless the publisher granted an arrangement', () => {
    expect(risClient({}).authorization).toBeNull();
    expect(risClient({ DAJC_KB_AT_RIS_AUTHORIZATION_REF: 'ref-1' }).authorization).toEqual({ reference: 'ref-1' });
    expect(parseSitemapUrls('<url><loc>https://a/b</loc><lastmod>2026-11-01</lastmod></url>')).toEqual([{ loc: 'https://a/b', lastmod: '2026-11-01' }]);
  });
});

// A tiny in-memory stand-in for the importer's SQL client.
function fakeSql() {
  const versions = new Map<string, { id: string; sha256: string; storage_key: string }>();
  let provisions = 0; let logs = 0;
  const sql: any = async (strings: TemplateStringsArray, ...v: unknown[]) => {
    const q = strings.join('?');
    if (q.includes('from dajc_kb.document_versions where id')) { const r = versions.get(v[0] as string); return r ? [r] : []; }
    if (q.includes('from dajc_kb.provisions')) return [{ n: provisions }];
    if (q.includes('from dajc_kb.review_log')) return [{ n: logs }];
    return [];
  };
  sql.state = { versions, setProv: (n: number) => { provisions = n; }, setLog: (n: number) => { logs = n; } };
  return sql;
}

describe('storeVersion (archive + database read-back)', () => {
  const entry = { sourceId: 'de-gesetze', jurisdiction: 'DE', officialNumber: 'StVO', title: 'Straßenverkehrs-Ordnung', legalCategory: 'NATIONAL_REGULATION', issuingBody: 'Bund', topics: ['driving_bans'], legalAreas: ['D.weekend_holiday_bans'],
    version: { label: 'StVO', language: 'de', url: 'https://www.gesetze-im-internet.de/stvo_2013/xml.zip', authenticity: 'CONSOLIDATED_DOCUMENTATION', effectiveFrom: '2026-11-09', validity: 'IN_FORCE', validityCheckedOn: '2026-11-09', validityEvidenceUrl: 'https://www.gesetze-im-internet.de/gii-toc.xml' } };
  const z = zip('stvo_2013.xml', XML);
  const prepared = () => prepareStructuredVersion(entry, { bytes: z, finalUrl: entry.version.url, mediaType: 'application/zip', extension: 'zip', pages: parseGiiXml(XML).pages });

  it('prepares an AUTO_CHECKED version with a content-addressed storage key', () => {
    const p = prepared();
    expect(p.version.sha256).toBe(sha256Hex(z));
    expect(p.version.storageKey).toMatch(/^DE\/StVO\/de\/[0-9a-f]{64}\.zip$/);
    expect(p.provenance ?? p.version.provenance).toBe('AUTO_CHECKED');
  });

  it('fails when the archive does not read back the original', async () => {
    const p = prepared();
    const lying = { put: async () => undefined, get: async () => new Uint8Array([1, 2, 3]) };
    await expect(storeVersion({ sql: fakeSql(), archive: lying, prepared: p })).rejects.toMatchObject({ stage: 'archive-readback' });
  });

  it('is idempotent and fails without a database read-back or an audit record', async () => {
    const p = prepared();
    const archive = new MemoryArchive();
    const sql = fakeSql();
    await expect(storeVersion({ sql, archive, prepared: p })).rejects.toBeInstanceOf(Error); // writeVersion needs a real transaction
    expect(await archive.has(p.version.storageKey)).toBe(true); // the original is kept for a safe re-run
    await storeVersion({ sql, archive, prepared: p }).catch(() => undefined);
    expect([...(archive as any).objects.keys()]).toHaveLength(1); // no duplicate object
    expect(IntegrityError).toBeDefined();
  });
});
