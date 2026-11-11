import { describe, expect, it } from 'vitest';
import { MemoryArchive } from '../archive.mjs';
import { PoliteClient } from '../acquire/polite-fetch.mjs';
import { runStructuredQueue } from '../acquire/queue.mjs';
import { acquireUkDocument, discoverUkCandidates, parseFeed, parseLegislationXml, ukDataUrl } from '../acquire/uk-legislation.mjs';

const ACT = `<Legislation xmlns="http://www.legislation.gov.uk/namespaces/legislation" DocumentURI="http://www.legislation.gov.uk/ukpga/1999/12" RestrictExtent="E+W+S" RestrictStartDate="2004-07-22"><ukm:Metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:ukm="x"><dc:title>Road Traffic (Vehicle Testing) Act 1999</dc:title><dc:date>1999-07-03</dc:date><dc:modified>2015-12-18</dc:modified><ukm:DocumentStatus Value="revised"/></ukm:Metadata><Body><P1group><Title>Tests of satisfactory condition of vehicles.</Title><P1><Pnumber>1</Pnumber><P1para><Text>In subsection (3) of section 45 a goods vehicle over 7.5 t is tested.</Text></P1para></P1></P1group><P1group><Title>Short title.</Title><P1><Pnumber>2</Pnumber><P1para><Text>This Act may be cited as the Road Traffic (Vehicle Testing) Act 1999.</Text></P1para></P1></P1group></Body><Schedules><Schedule><Number>Schedule 1</Number><TitleBlock><Title>Minor amendments</Title></TitleBlock><Para><Text>Amendments of the 1988 Act.</Text></Para></Schedule></Schedules></Legislation>`;
const feed = (n: number, more: number) => `<feed><leg:page>${n}</leg:page><leg:morePages>${more}</leg:morePages><entry><id>http://www.legislation.gov.uk/id/ukpga/1999/12</id><title>Road Traffic (Vehicle Testing) Act 1999</title><ukm:DocumentMainType Value="UnitedKingdomPublicGeneralAct"/><ukm:Year Value="1999"/><ukm:Number Value="12"/></entry><entry><id>x</id><title>Road Traffic (Amendment) Regulations 2020</title><ukm:DocumentMainType Value="UnitedKingdomStatutoryInstrument"/><ukm:Year Value="2020"/><ukm:Number Value="5"/></entry></feed>`;
const resp = (body: string) => ({ ok: true, status: 200, headers: new Headers(), arrayBuffer: async () => new TextEncoder().encode(body).buffer });
const client = (route: (u: URL) => string) => new PoliteClient({ fetchImpl: (async (u: string) => resp(route(new URL(u)))) as never, robots: { admit: async () => undefined } as never, sleep: async () => undefined, minIntervalMs: 0 });

describe('legislation.gov.uk', () => {
  it('parses a feed page and its paging state', () => {
    const f = parseFeed(feed(1, 2));
    expect(f.morePages).toBe(2);
    expect(f.entries[0]).toMatchObject({ type: 'UnitedKingdomPublicGeneralAct', year: '1999', number: '12' });
  });
  it('pages the feed until there are no more pages and drops amendments', async () => {
    const seen: string[] = [];
    const c = client((u) => { seen.push(u.searchParams.get('page') ?? ''); return feed(Number(u.searchParams.get('page')), Number(u.searchParams.get('page')) < 2 ? 1 : 0); });
    const out = await discoverUkCandidates(c, { queries: [{ path: 'ukpga', title: '"road traffic"', topics: ['hgv_traffic_rules'], areas: ['E.checks_sanctions'] }] });
    expect(seen).toEqual(['1', '2']);
    expect(out.map((x: { id: string }) => x.id)).toEqual(['ukpga/1999/12']);
  });
  it('extracts metadata, sections and schedules from the Legislation XML', () => {
    const { meta, provisions } = parseLegislationXml(ACT);
    expect(meta).toMatchObject({ title: 'Road Traffic (Vehicle Testing) Act 1999', validFrom: '2004-07-22', status: 'revised' });
    expect(provisions.map((p: { anchorLabel: string }) => p.anchorLabel)).toEqual(['section 1', 'section 2', 'Schedule 1']);
    expect(provisions[0].text).toContain('7.5 t');
    expect(() => parseLegislationXml('<x/>')).toThrow();
  });
  it('fails closed on feed identifiers that could redirect the data.xml fetch', async () => {
    const hostile = (year: string, number: string) => `<feed><leg:page>1</leg:page><leg:morePages>0</leg:morePages><entry><id>x</id><title>Road Traffic Act</title><ukm:DocumentMainType Value="UnitedKingdomPublicGeneralAct"/><ukm:Year Value="${year}"/><ukm:Number Value="${number}"/></entry></feed>`;
    const q = [{ path: 'ukpga', title: '"road traffic"', topics: ['hgv_traffic_rules'], areas: ['E.checks_sanctions'] }];
    for (const [year, number] of [['1999/../../uksi', '12'], ['1999', '12/data.xml?x='], ['1999', '../12'], ['99', '12'], ['1999', '']]) {
      expect(await discoverUkCandidates(client(() => hostile(year, number)), { queries: q })).toEqual([]);
    }
    expect(() => ukDataUrl('ukpga/1999/../../uksi/2000/1')).toThrow(/invalid/);
    expect(() => ukDataUrl('ukpga/1999/12?x=1')).toThrow(/invalid/);
    expect(() => ukDataUrl('other/1999/12')).toThrow(/invalid/);
    const requested: string[] = [];
    const c = client((u) => { requested.push(u.href); return ACT; });
    await expect(acquireUkDocument(c, { id: 'ukpga/1999/../../uksi/2000/1', title: 'x', path: 'ukpga', year: '1999', number: '12', topics: [], areas: [] })).rejects.toThrow(/invalid/);
    for (const bad of [undefined, null, {}, { id: 42 }, { id: 'https://evil.example/ukpga/1999/12' }]) {
      await expect(acquireUkDocument(c, bad as never)).rejects.toThrow(/invalid/);
    }
    expect(requested).toEqual([]);
  });
  it('refuses a data.xml redirect that leaves legislation.gov.uk without following it', async () => {
    const requested: string[] = [];
    const redirecting = new PoliteClient({
      fetchImpl: (async (u: string) => {
        requested.push(u);
        return { ok: false, status: 302, headers: new Headers({ location: 'https://evil.example/ukpga/1999/12/data.xml' }), arrayBuffer: async () => new ArrayBuffer(0) };
      }) as never,
      robots: { admit: async () => undefined } as never, sleep: async () => undefined, minIntervalMs: 0,
    });
    const cand = { id: 'ukpga/1999/12', title: 'x', path: 'ukpga', year: '1999', number: '12', topics: [], areas: [] };
    await expect(acquireUkDocument(redirecting, cand)).rejects.toThrow(/redirect leaves www\.legislation\.gov\.uk/);
    expect(requested).toEqual(['https://www.legislation.gov.uk/ukpga/1999/12/data.xml']);
  });
  it('acquires, validates and dry-runs a document with SHA-256; skips one that is repealed', async () => {
    const c = client((u) => (u.pathname.endsWith('data.xml') ? ACT : ''));
    const cand = { id: 'ukpga/1999/12', title: 'x', path: 'ukpga', year: '1999', number: '12', topics: ['hgv_traffic_rules'], areas: ['E.checks_sanctions'] };
    const r = await runStructuredQueue({ items: [cand], acquire: (i: typeof cand) => acquireUkDocument(c, i, { today: '2026-11-09' }), archive: new MemoryArchive(), dryRun: true });
    expect(r[0]).toMatchObject({ status: 'DRY_RUN', provenance: 'AUTO_CHECKED', provisions: 3 });
    expect((r[0] as { sha256?: string }).sha256).toMatch(/^[0-9a-f]{64}$/);
    const repealed = client(() => ACT.replace('Vehicle Testing) Act 1999</dc:title>', 'Vehicle Testing) Act 1999 (repealed)</dc:title>'));
    expect((await acquireUkDocument(repealed, cand)).skip).toMatch(/not in force/);
    expect(ukDataUrl('ukpga/1999/12')).toBe('https://www.legislation.gov.uk/ukpga/1999/12/data.xml');
  });
});
