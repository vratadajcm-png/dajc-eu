import { describe, expect, it } from 'vitest';
import { MemoryArchive } from '../archive.mjs';
import { PoliteClient } from '../acquire/polite-fetch.mjs';
import { actDetails, actPdfUrl, actReferences, changedActs, discoverPlCandidates, latestConsolidation, planPlEntry, searchActs } from '../acquire/pl-eli.mjs';
import { runImportQueue } from '../acquire/queue.mjs';
import { splitProvisions } from '../provisions.mjs';
import { makePdf } from './pdf-fixture';

const ok = (body: unknown, type = 'application/json') => ({ ok: true, status: 200, headers: new Headers({ 'content-type': type }), arrayBuffer: async () => (typeof body === 'string' || body instanceof Uint8Array ? (typeof body === 'string' ? new TextEncoder().encode(body) : body) : new TextEncoder().encode(JSON.stringify(body))).buffer });
const open = { admit: async () => undefined };
const mk = (routes: (url: URL) => unknown) => new PoliteClient({ fetchImpl: (async (u: string) => routes(new URL(u))) as never, robots: open as never, sleep: async () => undefined, minIntervalMs: 0 });

const BASE = { ELI: 'DU/1997/602', title: 'Ustawa z dnia 20 czerwca 1997 r. - Prawo o ruchu drogowym.', type: 'Ustawa', status: 'akt posiada tekst jednolity', displayAddress: 'Dz.U. 1997 nr 98 poz. 602', textPDF: true };
const NOTICE_OLD = { ELI: 'DU/2023/1047', announcementDate: '2023-05-10', displayAddress: 'Dz.U. 2023 poz. 1047', status: 'obowiązujący', textPDF: true };
const NOTICE_NEW = { ELI: 'DU/2024/1251', announcementDate: '2024-06-21', displayAddress: 'Dz.U. 2024 poz. 1251', status: 'obowiązujący', textPDF: true };
const api = (url: URL) => {
  const p = url.pathname.replace('/eli', '');
  if (p === '/acts/search') {
    const offset = Number(url.searchParams.get('offset') || 0);
    const all = [BASE, { ELI: 'DU/2024/1855', title: 'Ustawa o zmianie ustawy o transporcie drogowym', type: 'Ustawa' }, { ELI: 'DU/2024/9', title: 'Obwieszczenie w sprawie ruchu drogowym', type: 'Obwieszczenie' }];
    return ok({ items: all.slice(offset, offset + 2), totalCount: all.length, count: 2, offset });
  }
  if (p === '/acts/DU/1997/602') return ok({ ...BASE, inForce: 'IN_FORCE', validFrom: '1998-01-01', releasedBy: ['SEJM'], announcementDate: '1997-06-20' });
  if (p === '/acts/DU/1997/602/references') return ok({ 'Inf. o tekście jednolitym': [{ act: NOTICE_OLD }, { act: NOTICE_NEW }], 'Akty zmieniające': [] });
  if (p === '/changes/acts') return ok({ items: [{ ELI: 'DU/1997/602' }], totalCount: 1 });
  if (p.endsWith('/text.pdf')) return ok(makePdf([['Art. 1. 1. Ustawa okresla zasady ruchu.', 'Art. 2. Pojazd to srodek transportu. Pojazd to srodek transportu i przewozu osob oraz rzeczy po drogach publicznych kraju.', 'Art. 3. Kierowca to osoba kierujaca pojazdem po drogach publicznych kraju bez wzgledu na kategorie.']]), 'application/pdf');
  return { ok: false, status: 404, headers: new Headers(), arrayBuffer: async () => new ArrayBuffer(0) };
};

describe('Polish ELI API client', () => {
  it('pages through search results with offset/limit until totalCount', async () => {
    const got: string[] = [];
    for await (const a of searchActs(mk(api), { title: 'x' }, { pageSize: 2 })) got.push(a.ELI);
    expect(got).toEqual(['DU/1997/602', 'DU/2024/1855', 'DU/2024/9']);
  });
  it('lists changed acts since a date', async () => {
    const got: string[] = [];
    for await (const a of changedActs(mk(api), '2026-11-01T00:00:00')) got.push(a.ELI);
    expect(got).toEqual(['DU/1997/602']);
  });
  it('discovers base acts only (no amending acts, no notices) and merges taxonomy', async () => {
    const c = await discoverPlCandidates(mk(api), { queries: [{ q: 'ruchu drogowym', topics: ['hgv_traffic_rules'], areas: ['D.urban_restrictions'] }, { q: 'ruchu', topics: ['driving_bans'], areas: ['D.weekend_holiday_bans'] }] });
    expect(c.map((x: { eli: string }) => x.eli)).toEqual(['DU/1997/602']);
    expect(c[0].topics).toEqual(['hgv_traffic_rules', 'driving_bans']);
  });
  it('selects the latest consolidated text from the references', async () => {
    expect((await latestConsolidation(mk(api), 'DU/1997/602')).notice?.ELI).toBe('DU/2024/1251');
  });
  it('plans a validated entry: consolidation PDF, effective date of the notice, validity evidence', async () => {
    const plan = await planPlEntry(mk(api), { eli: 'DU/1997/602', topics: ['hgv_traffic_rules'], areas: ['D.urban_restrictions'] }, { today: '2026-11-09' });
    expect(plan.entry.version.url).toBe(actPdfUrl('DU/2024/1251'));
    expect(plan.entry.version.effectiveFrom).toBe('2024-06-21');
    expect(plan.entry.version.validity).toBe('IN_FORCE');
    expect(plan.entry.version.validityEvidenceUrl).toBe('https://api.sejm.gov.pl/eli/acts/DU/1997/602');
  });
  it.each(['../../changes/acts', 'DU/1997/602/../../../../acts/search', 'DU/1997/602?x=1', 'DU/1997/602#f', 'DU/1997/0', 'DU/97/602', 'du/1997/602', 'DU/1997/602/', '/DU/1997/602', 'DU\\1997\\602', 'DU/1997/602%2f..', '', undefined, 42])(
    'fails closed on an unsafe ELI %j before any request',
    async (eli) => {
      let requests = 0;
      const client = mk((u) => { requests++; return api(u); });
      expect(() => actPdfUrl(eli as never)).toThrow(/invalid ELI/);
      await expect(actDetails(client, eli as never)).rejects.toThrow(/invalid ELI/);
      await expect(actReferences(client, eli as never)).rejects.toThrow(/invalid ELI/);
      await expect(latestConsolidation(client, eli as never)).rejects.toThrow(/invalid ELI/);
      await expect(planPlEntry(client, { eli, topics: [], areas: [] } as never)).rejects.toThrow(/invalid ELI/);
      expect(requests).toBe(0);
    },
  );
  it('refuses a consolidated-text notice whose ELI is unsafe instead of building a PDF URL from it', async () => {
    const evil = { ...NOTICE_NEW, ELI: 'DU/2024/1251/../../../../changes/acts' };
    const client = mk((u) => (u.pathname.endsWith('/602/references') ? ok({ 'Inf. o tekście jednolitym': [{ act: evil }] }) : api(u)));
    await expect(planPlEntry(client, { eli: 'DU/1997/602', topics: ['hgv_traffic_rules'], areas: [] })).rejects.toThrow(/invalid ELI/);
  });
  it('does not discover candidates with an unsafe ELI', async () => {
    const bad = { ...BASE, ELI: 'DU/1997/602/../../../x' };
    const c = await discoverPlCandidates(mk((u) => (u.pathname.endsWith('/acts/search') ? ok({ items: [bad, BASE], totalCount: 2 }) : api(u))), { queries: [{ q: 'ruchu drogowym', topics: ['hgv_traffic_rules'], areas: [] }] });
    expect(c.map((x: { eli: string }) => x.eli)).toEqual(['DU/1997/602']);
  });
  it('does not import an act that is not in force', async () => {
    const plan = await planPlEntry(mk((u) => (u.pathname.endsWith('/602') ? ok({ ...BASE, inForce: 'REPEALED' }) : api(u))), { eli: 'DU/1997/602', topics: ['hgv_traffic_rules'], areas: [] });
    expect(plan.skip).toBe('inForce=REPEALED');
  });
});

describe('Polish provision numbering', () => {
  it('splits "Art. N." and "§ N." lines, but not a cross-reference that does not grow', () => {
    const p = splitProvisions([{ pageNo: 1, text: 'Art. 1. 1. Ustawa określa zasady.\nArt. 2. Pojazd to środek.\nzgodnie z\nArt. 1. ust. 2 tej ustawy\nArt. 3. Kierowca to osoba.' }]);
    expect(p.map((x) => x.anchorLabel)).toEqual(['Art. 1', 'Art. 2', 'Art. 3']);
    expect(p[1].text).toContain('Pojazd');
  });
});

describe('validated import queue', () => {
  const plan = async () => (await planPlEntry(mk(api), { eli: 'DU/1997/602', topics: ['hgv_traffic_rules'], areas: ['D.urban_restrictions'] }, { today: '2026-11-09' })).entry;

  it('rejects an invalid entry, deduplicates, and dry-runs a real PDF with SHA-256 and provisions', async () => {
    const entry = await plan();
    const results = await runImportQueue({ entries: [{ ...entry, topics: [] }, entry, entry], client: mk(api), archive: new MemoryArchive(), dryRun: true });
    expect(results.map((r: { status: string }) => r.status)).toEqual(['REJECTED_INVALID', 'DRY_RUN', 'DUPLICATE_IN_QUEUE']);
    expect(results[1].sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(results[1].provisions).toBeGreaterThan(0);
  });
  it('skips already stored official URLs (resume) without downloading', async () => {
    const entry = await plan();
    let downloads = 0;
    const client = mk((u) => { if (u.pathname.endsWith('.pdf')) downloads++; return api(u); });
    const sql: any = async () => [{ id: 'v1' }];
    const results = await runImportQueue({ entries: [entry], client, archive: new MemoryArchive(), sql });
    expect(results[0]).toMatchObject({ status: 'STORED', versionId: 'v1' });
    expect(downloads).toBe(0);
  });
  it('stops the host after a WAF block and classifies the rest', async () => {
    const entry = await plan();
    const waf = new PoliteClient({ fetchImpl: (async () => ({ ok: false, status: 202, headers: new Headers({ 'x-amzn-waf-action': 'challenge' }), arrayBuffer: async () => new ArrayBuffer(0) })) as never, robots: open as never, sleep: async () => undefined, minIntervalMs: 0 });
    const results = await runImportQueue({ entries: [entry, { ...entry, officialNumber: 'Dz.U. 2000 poz. 1' }], client: waf, archive: new MemoryArchive(), dryRun: true });
    expect(results[0]).toMatchObject({ status: 'WAF_BLOCKED', classification: 'WAF_BLOCKED' });
    expect(results[1].status).toBe('SKIPPED_HOST_BLOCKED');
  });
});

import { readFileSync } from 'node:fs';
import { dajcEuropeCoverage } from '../../../../config/europe-coverage.mjs';
describe('progress register', () => {
  it('lists all 50 jurisdictions once and never claims imports it did not make', () => {
    const { jurisdictions } = JSON.parse(readFileSync('config/legal-library/api-progress.json', 'utf8'));
    expect(jurisdictions.map((j: { jurisdiction: string }) => j.jurisdiction).sort()).toEqual(dajcEuropeCoverage.map(([c]: string[]) => c).sort());
    expect(jurisdictions.every((j: { importedDocuments: number; aiVerifiedVersions: number }) => j.importedDocuments === 0 && j.aiVerifiedVersions === 0)).toBe(true);
  });
});
