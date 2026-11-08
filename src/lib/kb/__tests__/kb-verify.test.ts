import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LIBRARY_MAX_SOURCES } from '../../ask/library';
import { legalSourceForUrl } from '../legal-sources.mjs';
import { ASK_TOPIC_TO_KB } from '../taxonomy.mjs';
import {
  baseActCelex, celexOf, checkStoredVersion, consolidationDate, daysBetween, digestRows, eurlexStatusUrl, normalizeForMatch, parseEurlexStatus, textOnPages,
} from '../verify.mjs';

const manifest = JSON.parse(readFileSync('config/legal-library/manifest.json', 'utf8'));
const verification = JSON.parse(readFileSync('config/legal-library/verification.json', 'utf8'));

// Markup of the EUR-Lex "document information" page as served on 2026-11-08 (shortened).
const IN_FORCE_HTML = `<p xmlns="http://www.w3.org/1999/xhtml" class="forceIndicator"> <span> <img class="forceIndicatorBullet" src="./../../../images/green-on.png" alt="Legal status of the document"/> </span>In force: This act has been changed. <strong>Current consolidated version: <span class="defaultUnderlined"> <a href="./../../../legal-content/EN/AUTO/?uri=CELEX:02006R0561-20241231" class="" title="" data-celex="02006R0561-20241231">31/12/2024</a> </span> </strong> </p>`;

describe('EUR-Lex identifiers and status page', () => {
  it('reads CELEX numbers and dates from official URLs', () => {
    expect(celexOf('https://eur-lex.europa.eu/legal-content/EN/TXT/PDF/?uri=CELEX:02006R0561-20241231')).toBe('02006R0561-20241231');
    expect(celexOf('https://eur-lex.europa.eu/legal-content/CS/TXT/PDF/?uri=CELEX%3A01996L0053-20190814')).toBe('01996L0053-20190814');
    expect(celexOf('https://www.gesetze-im-internet.de/stvo_2013/StVO.pdf')).toBeNull();
    expect(baseActCelex('02006R0561-20241231')).toBe('32006R0561');
    expect(baseActCelex('01996L0053-20190814')).toBe('31996L0053');
    expect(consolidationDate('02009R1072-20220221')).toBe('2022-02-21');
    expect(eurlexStatusUrl('32006R0561')).toBe('https://eur-lex.europa.eu/legal-content/EN/ALL/?uri=CELEX:32006R0561');
    expect(legalSourceForUrl(eurlexStatusUrl('32006R0561'))?.id).toBe('eu-eurlex');
  });

  it('parses the legal status and the current consolidated version, never guessing', () => {
    expect(parseEurlexStatus(IN_FORCE_HTML)).toEqual({ inForce: true, statusText: expect.stringMatching(/^In force/), currentConsolidated: '02006R0561-20241231' });
    const repealed = '<p class="forceIndicator"><span><img src="red-on.png"/></span>No longer in force, Date of end of validity: 01/03/2014</p>';
    expect(parseEurlexStatus(repealed)).toMatchObject({ inForce: false, currentConsolidated: null });
    expect(parseEurlexStatus('<html><body>Service unavailable</body></html>')).toEqual({ inForce: null, statusText: null, currentConsolidated: null });
  });
});

describe('quoted text on the cited pages', () => {
  it('ignores EUR-Lex amendment markers and running headers, nothing else', () => {
    const page = '02014R0165 — EN — 31.12.2024 — 003.001 — 27 Article 34 Use of driver cards and record sheets ▼M1 1. Drivers shall use record sheets';
    expect(normalizeForMatch(page)).toBe('article 34 use of driver cards and record sheets 1 drivers shall use record sheets');
    expect(textOnPages('Use of driver cards and record sheets 1. Drivers shall use record sheets', page)).toBe(true);
    expect(textOnPages('Use of tachograph cards and record sheets 1. Drivers shall use', page)).toBe(false);
    expect(textOnPages('', page)).toBe(false);
  });

  it('digests rows by the listed fields only and in order', () => {
    const a = [{ ordinal: 1, text: 'x', extra: 1 }];
    expect(digestRows(a, ['ordinal', 'text'])).toBe(digestRows([{ ordinal: 1, text: 'x', extra: 2 }], ['ordinal', 'text']));
    expect(digestRows(a, ['ordinal', 'text'])).not.toBe(digestRows([{ ordinal: 1, text: 'y' }], ['ordinal', 'text']));
    expect(daysBetween('2026-10-01', '2026-11-08')).toBe(38);
  });
});

describe('stored version against its manifest entry', () => {
  const entry = manifest.entries.find((e: any) => e.officialNumber === 'Regulation (EC) No 561/2006' && e.version.language === 'cs');
  const v = entry.version;
  const good = {
    provenance: 'AUTO_CHECKED', text_extraction: 'TEXT', page_count: 26, version_label: v.label, reuse_status: 'PERMITTED', official_url: v.url,
    validity: v.validity, effective_from: v.effectiveFrom, effective_to: null, issued_on: v.issuedOn, validity_checked_on: v.validityCheckedOn, superseded_by: null,
  };
  const ranges = { count: 39, citable: 37, outside: 0 };
  const run = (row: any, onDate = '2026-11-08', provisionRanges = ranges) =>
    checkStoredVersion({ entry, row, provisionRanges, onDate, source: legalSourceForUrl(row.official_url) });

  it('passes a faithful import', () => {
    expect(run(good)).toEqual({ catalogue: [], source: [], validity: [] });
  });

  it('fails on every tampered or outdated field', () => {
    expect(run({ ...good, provenance: 'UNVERIFIED' }).catalogue).toContain('provenance UNVERIFIED');
    expect(run(good, '2026-11-08', { count: 3, citable: 3, outside: 1 }).catalogue[0]).toMatch(/outside the document's pages/);
    expect(run({ ...good, official_url: 'https://eur-lex.europa.eu/other.pdf' }).source).toContain('URL differs from the manifest');
    expect(run({ ...good, official_url: 'https://example.com/561.pdf' }).source[0]).toMatch(/not on a registered official source/);
    expect(run({ ...good, reuse_status: 'RESTRICTED' }).source).toContain('reuse status RESTRICTED');
    expect(run({ ...good, effective_from: '2020-08-20' }).validity[0]).toMatch(/effective_from is 2020-08-20, manifest 2024-12-31/);
    expect(run({ ...good, superseded_by: 'x' }).validity).toContain('superseded by a newer version');
    expect(run(good, '2027-01-15').validity[0]).toMatch(/more than 31 days ago/);
  });
});

describe('verification plan', () => {
  it('asks a question in every imported EUR-Lex language and mirrors what DAJC AI sends', () => {
    expect(verification.modelSources).toBe(LIBRARY_MAX_SOURCES);
    for (const entry of manifest.entries.filter((e: any) => e.sourceId === 'eu-eurlex')) {
      const check = verification.checks.find((c: any) => c.officialNumber === entry.officialNumber);
      expect(check, entry.officialNumber).toBeTruthy();
      expect(ASK_TOPIC_TO_KB[check.askTopic as keyof typeof ASK_TOPIC_TO_KB], check.askTopic).toBeTruthy();
      const asked = check.questions[entry.version.language];
      expect(asked?.question?.length, `${entry.officialNumber} ${entry.version.language}`).toBeGreaterThan(10);
      expect(asked.terms.length).toBeGreaterThan(0);
    }
  });
});
