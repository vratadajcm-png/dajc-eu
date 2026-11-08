import { describe, expect, it } from 'vitest';
import { applicability, inForceOn, KB_TOPICS, massApplies } from '../taxonomy.mjs';
import { legalSourceForUrl, legalSources, legislationCoverageGaps, validateLegalSources } from '../legal-sources.mjs';
import { archiveKey, LocalFsArchive, MemoryArchive, sha256Hex, signV4 } from '../archive.mjs';
import { dajcEuropeCoverage } from '../../../../config/europe-coverage.mjs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('mass thresholds are never carried over between bands', () => {
  const over35 = { minT: 3.5, minInclusive: false, maxT: null, maxInclusive: null };
  const over75 = { minT: 7.5, minInclusive: false, maxT: null, maxInclusive: null };
  const from25to35 = { minT: 2.5, minInclusive: false, maxT: 3.5, maxInclusive: true };
  it.each([
    [over35, 3.5, 'MISMATCH'], [over35, 3.6, 'MATCH'], [over75, 7.5, 'MISMATCH'], [over75, 12, 'MATCH'], [over75, 3.5, 'MISMATCH'],
    [from25to35, 2.5, 'MISMATCH'], [from25to35, 3.0, 'MATCH'], [from25to35, 3.5, 'MATCH'], [from25to35, 7.5, 'MISMATCH'],
  ])('band %o with %s t is %s', (band, mass, expected) => {
    expect(massApplies(band, mass)).toBe(expected);
  });
  it('flags unreviewed thresholds and unknown masses instead of guessing', () => {
    expect(massApplies(null, 40, [7.5])).toBe('UNREVIEWED');
    expect(massApplies(null, 40, [])).toBe('NO_THRESHOLD');
    expect(massApplies(over35, null)).toBe('UNKNOWN_MASS');
  });
});

describe('validity window and applicability', () => {
  it('uses a version only inside its effective window and while in force', () => {
    const v = { validity: 'IN_FORCE', effectiveFrom: '2024-12-31', effectiveTo: null };
    expect(inForceOn(v, '2026-11-08')).toBe(true);
    expect(inForceOn(v, '2024-12-30')).toBe(false);
    expect(inForceOn({ ...v, effectiveTo: '2026-01-01' }, '2026-11-08')).toBe(false);
    expect(inForceOn({ ...v, validity: 'REPEALED' }, '2026-11-08')).toBe(false);
    expect(inForceOn({ ...v, validity: 'SUPERSEDED' }, '2025-06-01')).toBe(false);
  });
  it.each([
    ['CZ', 'CZ', 'NATIONAL_ACT', 'DIRECT'], ['CZ', 'EU', 'EU_REGULATION', 'EU_DIRECT'], ['CZ', 'EU', 'EU_DIRECTIVE', 'TRANSPOSITION_CHECK_REQUIRED'],
    ['NO', 'EU', 'EU_REGULATION', 'EEA_CHECK_REQUIRED'], ['UK', 'EU', 'EU_REGULATION', 'NOT_APPLICABLE'], ['CH', 'EU', 'EU_REGULATION', 'NOT_APPLICABLE'],
    ['RS', 'EU', 'EU_REGULATION', 'NOT_APPLICABLE'], ['DE', 'AT', 'NATIONAL_ACT', 'NOT_APPLICABLE'], ['PL', 'INT', 'INTERNATIONAL_AGREEMENT', 'INTERNATIONAL_CHECK_REQUIRED'],
  ])('%s asked, %s %s -> %s', (asked, doc, category, expected) => {
    expect(applicability(asked, doc, category)).toBe(expected);
  });
});

describe('registry of legal and official sources', () => {
  it('is valid against DAJC coverage and the authority domains', () => {
    expect(validateLegalSources()).toEqual([]);
  });
  it('accepts only HTTPS addresses of registered publishers', () => {
    expect(legalSourceForUrl('https://eur-lex.europa.eu/legal-content/CS/TXT/PDF/?uri=CELEX:02006R0561-20241231')?.id).toBe('eu-eurlex');
    expect(legalSourceForUrl('http://eur-lex.europa.eu/x')).toBeNull();
    expect(legalSourceForUrl('https://eur-lex.europa.eu.evil.example/x')).toBeNull();
    expect(legalSourceForUrl('https://www.truckers-forum.example/eu-561')).toBeNull();
    expect(legalSourceForUrl('https://www.gesetze-im-internet.de/stvo_2013/StVO.pdf')?.id).toBe('de-gesetze');
  });
  it('states honestly what was checked', () => {
    const checked = legalSources.filter((s) => s.check.status !== 'NOT_CHECKED');
    expect(checked.every((s) => s.check.checkedOn === '2026-11-08')).toBe(true);
    expect(legalSources.find((s) => s.id === 'eu-eurlex')?.check.status).toBe('TERMS_VERIFIED');
    expect(legalSources.find((s) => s.id === 'pl-isap')?.check.status).toBe('BLOCKED_FROM_DEV');
  });
  it('lists the jurisdictions still without a legislation source', () => {
    const gaps = legislationCoverageGaps(dajcEuropeCoverage.map(([code]) => code));
    expect(gaps).not.toContain('CZ');
    expect(gaps).toContain('RS');
  });
  it('covers every library topic, oversize first', () => {
    expect(KB_TOPICS[0]).toBe('oversize_heavy_transport');
  });
});

describe('document archive (content-addressed, S3-compatible)', () => {
  const bytes = new TextEncoder().encode('%PDF-1.4 test');
  const sha = sha256Hex(bytes);
  it('builds safe content-addressed keys', () => {
    expect(archiveKey({ jurisdiction: 'EU', officialNumber: 'Regulation (EC) No 561/2006', language: 'cs', sha256: sha })).toBe(`EU/Regulation-EC-No-561-2006/cs/${sha}.pdf`);
    expect(() => archiveKey({ jurisdiction: 'EU', officialNumber: 'x', language: 'cs', sha256: 'abc' })).toThrow();
  });
  it('memory and local archives store once and verify content on read', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'kb-archive-'));
    try {
      for (const archive of [new MemoryArchive(), new LocalFsArchive(dir)]) {
        const key = `EU/doc/cs/${sha}.pdf`;
        await archive.put(key, bytes, { sha256: sha });
        await archive.put(key, bytes, { sha256: sha });
        expect(await archive.has(key)).toBe(true);
        expect(Buffer.from((await archive.get(key))!).toString()).toBe('%PDF-1.4 test');
        await expect(archive.put(`EU/doc/cs/${sha}.pdf`, new TextEncoder().encode('other'), { sha256: sha })).rejects.toThrow(/mismatch/);
        expect(await archive.get(`EU/doc/cs/${'0'.repeat(64)}.pdf`)).toBeNull();
      }
      await expect(new LocalFsArchive(dir).put('../escape.pdf', bytes)).rejects.toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // AWS Signature Version 4 test suite (smithy-lang/smithy-typescript, packages/signature-v4/src/suite.fixture.ts).
  const credentials = { accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY' };
  it.each([
    ['get-vanilla', 'GET', 'https://example.amazonaws.com/', {}, '', 'host;x-amz-date', '5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31'],
    ['get-vanilla-query-order-key-case', 'GET', 'https://example.amazonaws.com/?Param2=value2&Param1=value1', {}, '', 'host;x-amz-date', 'b97d918cfa904a5beff61c982a1b6f458b799221646efd99d3219ec94cdf2500'],
    ['post-x-www-form-urlencoded', 'POST', 'https://example.amazonaws.com/', { 'content-type': 'application/x-www-form-urlencoded' }, 'Param1=value1', 'content-type;host;x-amz-date', 'ff11897932ad3f4e8b18135d722051e5ac45fc38421b1da7b9d196a0fe09473a'],
  ])('signs %s exactly like the AWS SigV4 test suite', (_name, method, url, headers, body, signed, signature) => {
    const out = signV4({ method, url, headers: { ...headers, 'x-amz-date': '20150830T123600Z' }, body, region: 'us-east-1', service: 'service', credentials });
    expect(out.authorization).toBe(`AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, SignedHeaders=${signed}, Signature=${signature}`);
  });
});
