import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MemoryArchive, sha256Hex } from '../archive.mjs';
import { fetchOfficialBytes, prepareVersion, validateManifestEntry } from '../importer.mjs';
import { extractPdfText, isPdf } from '../pdf-text.mjs';
import { massMentions, splitProvisions } from '../provisions.mjs';
import { makePdf, regulationPdf } from './pdf-fixture';

const manifest = JSON.parse(readFileSync(new URL('../../../../config/legal-library/manifest.json', import.meta.url), 'utf8'));

function entry(overrides: Record<string, unknown> = {}, version: Record<string, unknown> = {}) {
  return {
    sourceId: 'eu-eurlex', jurisdiction: 'EU', officialNumber: 'Regulation (XX) No 1/2099', title: 'Test regulation', legalCategory: 'EU_REGULATION',
    issuingBody: 'European Parliament and Council', topics: ['driving_rest_times'],
    version: {
      label: 'Regulation (XX) No 1/2099, consolidated text of 1.1.2026', language: 'en', url: 'https://eur-lex.europa.eu/legal-content/EN/TXT/PDF/?uri=CELEX:32099R0001',
      authenticity: 'CONSOLIDATED_DOCUMENTATION', issuedOn: '2099-01-01', effectiveFrom: '2026-01-01', effectiveTo: null, validity: 'IN_FORCE',
      validityCheckedOn: '2026-11-08', validityEvidenceUrl: 'https://eur-lex.europa.eu/legal-content/EN/ALL/?uri=CELEX:32099R0001', ...version,
    },
    ...overrides,
  };
}

describe('PDF text with page numbers', () => {
  it('reads every page of a text PDF', async () => {
    const result = await extractPdfText(regulationPdf());
    expect(result.pageCount).toBe(3);
    expect(result.needsOcr).toBe(false);
    expect(result.pages[1].text).toContain('After a driving period of four and a half hours');
  });
  it('sends a scanned document to the approved OCR path instead of indexing it', async () => {
    const result = await extractPdfText(makePdf([[], [], ['Page 3 with a short caption that is long enough to count as text.']]));
    expect(result.needsOcr).toBe(true);
    expect(result.scannedPages).toEqual([1, 2]);
  });
  it('rejects content that is not a PDF', async () => {
    expect(isPdf(new TextEncoder().encode('<html>'))).toBe(false);
    await expect(extractPdfText(new TextEncoder().encode('<html>not a pdf</html>'))).rejects.toThrow(/not a PDF/);
  });
});

describe('provisions with article and page', () => {
  it('splits by anchors on their own line, keeps pages and drops running headers', async () => {
    const { pages } = await extractPdfText(regulationPdf());
    const provisions = splitProvisions(pages);
    expect(provisions.map((p) => `${p.anchorType}:${p.anchorLabel}:${p.pageFrom}-${p.pageTo}`)).toEqual([
      'PREAMBLE:Preamble:1-1', 'ARTICLE:Article 1:1-1', 'ARTICLE:Article 2:2-2', 'ARTICLE:Article 3:2-2', 'ANNEX:ANNEX I:3-3',
    ]);
    // "Article 1 of this Regulation." inside Article 2 is a reference, not a new provision.
    expect(provisions[2].text).toContain('Article 1 of this Regulation.');
    expect(provisions.every((p) => !p.text.includes('32099R0001'))).toBe(true);
    expect(provisions.find((p) => p.anchorLabel === 'Article 3')?.massMentions).toEqual([7.5]);
  });
  it.each([
    ['cs', ['Článek 7', 'Po čtyřech a půl hodinách řízení musí mít řidič přestávku.'], 'Článek 7'],
    ['sk', ['Článok 7', 'Po štyri a pol hodinách vedenia vozidla musí mať vodič prestávku.'], 'Článok 7'],
    ['pl', ['Artykuł 7', 'Po upływie czterech i pół godziny prowadzenia pojazdu kierowca ma przerwę.'], 'Artykuł 7'],
    ['de', ['§ 30 Umweltschutz, Sonn- und Feiertagsfahrverbot', '(3) An Sonntagen dürfen Lastkraftwagen über 7,5 t nicht fahren.'], '§ 30'],
  ])('recognises %s anchors', (_lang, lines, label) => {
    const provisions = splitProvisions([{ pageNo: 4, text: lines.join('\n') }]);
    expect(provisions.map((p) => p.anchorLabel)).toEqual([label]);
    expect(provisions[0].pageFrom).toBe(4);
  });
  it('never starts a provision at a reference such as "§ 30 Absatz 3"', () => {
    const provisions = splitProvisions([{ pageNo: 1, text: '§ 31 Sport und Spiel\nText.\n§ 30 Absatz 3 gilt entsprechend.\n§ 32 Verkehrshindernisse\nText.' }]);
    expect(provisions.map((p) => p.anchorLabel)).toEqual(['§ 31', '§ 32']);
    expect(provisions[0].text).toContain('§ 30 Absatz 3 gilt entsprechend.');
  });
  it('records tonnage mentions only as hints', () => {
    expect(massMentions('vozidly nad 3,5 tuny a 7,5 t, Lkw über 12 Tonnen, 2.5 tonnes, 40 ton')).toEqual([2.5, 3.5, 7.5, 12, 40]);
    expect(massMentions('Artikel 7 Absatz 2, 45 Minuten')).toEqual([]);
  });
});

describe('import: provenance, reuse and validity are checked, never assumed', () => {
  it('the committed manifest is valid', () => {
    expect(manifest.entries.length).toBeGreaterThan(0);
    for (const e of manifest.entries) expect(validateManifestEntry(e), `${e.officialNumber} ${e.version.language}`).toEqual([]);
  });
  it.each([
    [{ sourceId: 'nowhere' }, {}, /unknown source/],
    [{ jurisdiction: 'CZ' }, {}, /differs from source/],
    [{}, { url: 'https://www.truck-blog.example/561.pdf' }, /not an HTTPS address of the source/],
    [{}, { url: 'http://eur-lex.europa.eu/x.pdf' }, /not an HTTPS address of the source/],
    [{}, { validityCheckedOn: null }, /needs effectiveFrom and validityCheckedOn/],
    [{ legalCategory: 'NATIONAL_ACT' }, {}, /does not publish NATIONAL_ACT/],
  ])('refuses an invalid entry %#', (over, version, problem) => {
    expect(validateManifestEntry(entry(over, version)).join('; ')).toMatch(problem);
  });
  it('archives, extracts and marks a complete entry AUTO_CHECKED (a person must still verify it)', async () => {
    const bytes = regulationPdf();
    const archive = new MemoryArchive();
    const prepared = await prepareVersion(entry(), { bytes, finalUrl: entry().version.url }, { archive, now: new Date('2026-11-08T10:00:00Z') });
    expect(prepared.version.provenance).toBe('AUTO_CHECKED');
    expect(prepared.version.sha256).toBe(sha256Hex(bytes));
    expect(await archive.has(prepared.version.storageKey)).toBe(true);
    expect(prepared.version.textExtraction).toBe('TEXT');
    expect(prepared.provisions.find((p: any) => p.anchorLabel === 'Article 2')?.pageFrom).toBe(2);
  });
  it('keeps an entry without validity evidence UNVERIFIED', async () => {
    const e = entry({}, { validityEvidenceUrl: null });
    const prepared = await prepareVersion(e, { bytes: regulationPdf(), finalUrl: e.version.url }, {});
    expect(prepared.version.provenance).toBe('UNVERIFIED');
    expect(prepared.checks).toContain('no validity evidence URL');
  });
  it('does not import from a source whose reuse terms are unknown', async () => {
    const e = entry({ sourceId: 'fr-legislation', jurisdiction: 'FR', legalCategory: 'NATIONAL_ACT' },
      { language: 'fr', url: 'https://legifrance.gouv.fr/x.pdf', validityEvidenceUrl: 'https://legifrance.gouv.fr/x' });
    await expect(prepareVersion(e, { bytes: regulationPdf(), finalUrl: e.version.url }, {})).rejects.toThrow(/reuse terms of fr-legislation are UNKNOWN/);
  });
  it('stores a scanned PDF for OCR approval without indexing any text', async () => {
    const prepared = await prepareVersion(entry(), { bytes: makePdf([[], []]), finalUrl: entry().version.url }, {});
    expect(prepared.version.textExtraction).toBe('NEEDS_OCR');
    expect(prepared.provisions).toEqual([]);
    expect(prepared.version.provenance).toBe('UNVERIFIED');
  });
  it('downloads only from the registered source, also across redirects, with a size cap', async () => {
    const redirectAway = async () => new Response(null, { status: 302, headers: { location: 'https://mirror.example.com/561.pdf' } });
    await expect(fetchOfficialBytes('https://eur-lex.europa.eu/x.pdf', { fetchImpl: redirectAway as any })).rejects.toThrow(/left the registered source/);
    await expect(fetchOfficialBytes('https://www.truck-blog.example/x.pdf')).rejects.toThrow(/not a registered official source/);
    const huge = async () => new Response(new Uint8Array(2048), { status: 200 });
    await expect(fetchOfficialBytes('https://eur-lex.europa.eu/x.pdf', { fetchImpl: huge as any, maxBytes: 1024 })).rejects.toThrow(/larger than the import limit/);
    const ok = async () => new Response(regulationPdf() as unknown as BodyInit, { status: 200, headers: { 'content-type': 'application/pdf' } });
    const result = await fetchOfficialBytes('https://eur-lex.europa.eu/x.pdf', { fetchImpl: ok as any });
    expect(isPdf(result.bytes)).toBe(true);
  });
});
