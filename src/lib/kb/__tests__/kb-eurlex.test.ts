import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { consolidatedLabel, entriesFromStatus, localizedActName, parseEurlexDocumentInfo, parseOfficialNumber } from '../eurlex.mjs';
import { validateManifestEntry } from '../importer.mjs';

const manifest = JSON.parse(readFileSync('config/legal-library/manifest.json', 'utf8'));
// Markup of the EUR-Lex "document information" page (shortened, 2026-11-09).
const PAGE = `<p class="forceIndicator"><span><img src="green-on.png"/></span>In force: This act has been changed. <strong>Current consolidated version: <span><a href="x" data-celex="02009R1071-20220221">21/02/2022</a></span></strong></p>
<dl><dt>Date of document: </dt><dd>21/10/2009</dd><dt>Author: </dt><dd>European Parliament , Council of the European Union </dd><dt>Form: </dt><dd>Regulation</dd></dl>`;
const candidate = { celex: '32009R1071', officialNumber: 'Regulation (EC) No 1071/2009', title: 'Regulation (EC) No 1071/2009', legalCategory: 'EU_REGULATION', issuingBody: 'European Parliament and Council', topics: ['cross_border_cabotage'], legalAreas: ['A.operator_licensing'] };

describe('EUR-Lex discovery', () => {
  it('names acts by the Official Journal patterns of each language', () => {
    expect(localizedActName('Regulation (EC) No 1071/2009', 'cs')).toBe('Nařízení (ES) č. 1071/2009');
    expect(localizedActName('Council Directive 96/53/EC', 'de')).toBe('Richtlinie 96/53/EG des Rates');
    expect(localizedActName('Directive (EU) 2015/413', 'pl')).toBe('Dyrektywa (UE) 2015/413');
    expect(localizedActName('Regulation (EU) 2020/1056', 'sk')).toBe('Nariadenie (EÚ) 2020/1056');
    expect(consolidatedLabel('Directive 2006/22/EC', 'cs', '2024-06-20')).toBe('Směrnice 2006/22/ES, konsolidované znění k 20. 6. 2024');
    expect(parseOfficialNumber('StVO 2013')).toBeNull();
  });

  it('reproduces every hand-written label of the first imports', () => {
    for (const e of manifest.entries.filter((x: any) => x.officialNumber.match(/561\/2006|165\/2014|96\/53|1072\/2009/))) {
      const handWritten = e.version.label.replace(/ \([^)]*\)(?=, )/, '').replace(/ (über Fahrtenschreiber|o tachografech|w sprawie tachografów|o tachografoch|on tachographs)(?=, )/, '');
      expect(consolidatedLabel(e.officialNumber, e.version.language, e.version.effectiveFrom)).toBe(handWritten);
    }
  });

  it('builds valid entries only for an act in force with a current consolidation of that act', () => {
    const info = parseEurlexDocumentInfo(PAGE);
    expect(info).toMatchObject({ inForce: true, currentConsolidated: '02009R1071-20220221', dateOfDocument: '2009-10-21', form: 'Regulation' });
    const { entries, reason } = entriesFromStatus(candidate, info, { checkedOn: '2026-11-09' });
    expect(reason).toBeNull();
    expect(entries.map((e: any) => e.version.language)).toEqual(['cs', 'de', 'en', 'pl', 'sk']);
    for (const e of entries) expect(validateManifestEntry(e)).toEqual([]);
    expect(entries[2].version).toMatchObject({ url: 'https://eur-lex.europa.eu/legal-content/EN/TXT/PDF/?uri=CELEX:02009R1071-20220221', issuedOn: '2009-10-21', effectiveFrom: '2022-02-21', validity: 'IN_FORCE' });

    expect(entriesFromStatus(candidate, { ...info, inForce: false, statusText: 'No longer in force' }, { checkedOn: '2026-11-09' }).reason).toMatch(/No longer in force/);
    expect(entriesFromStatus(candidate, { ...info, currentConsolidated: null }, { checkedOn: '2026-11-09' }).reason).toMatch(/no current consolidated version/);
    expect(entriesFromStatus(candidate, { ...info, currentConsolidated: '02009R1072-20220221' }, { checkedOn: '2026-11-09' }).reason).toMatch(/another act/);
    expect(entriesFromStatus(candidate, { ...info, currentConsolidated: '02009R1071-20270101' }, { checkedOn: '2026-11-09' }).reason).toMatch(/not yet applicable/);
  });

  it('keeps every discovered manifest entry valid and traceable to EUR-Lex', () => {
    const discovered = manifest.entries.filter((e: any) => /kb-eurlex-discover/.test(e.version.notes || ''));
    expect(discovered.length).toBeGreaterThanOrEqual(60);
    for (const e of discovered) {
      expect(validateManifestEntry(e), `${e.officialNumber} ${e.version.language}`).toEqual([]);
      expect(e.version.validityEvidenceUrl).toMatch(/^https:\/\/eur-lex\.europa\.eu\/legal-content\/EN\/ALL\/\?uri=CELEX:3\d{4}[A-Z]\d{4}$/);
    }
  });
});
