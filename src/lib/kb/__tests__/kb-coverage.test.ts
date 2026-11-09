import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { dajcCoverageCount, dajcEuropeCoverage } from '../../../../config/europe-coverage.mjs';
import { buildCoverage } from '../coverage.mjs';
import { LEGAL_AREA_LIST, validateLegalAreas } from '../legal-areas.mjs';
import { legalSources, legislationCoverageGaps, validateLegalSources } from '../legal-sources.mjs';

const manifest = JSON.parse(readFileSync('config/legal-library/manifest.json', 'utf8'));
const doc = (officialNumber: string, legalCategory: string, legalAreas: string[], jurisdiction = 'EU') =>
  ({ sourceId: jurisdiction === 'EU' ? 'eu-eurlex' : 'cz-esbirka', jurisdiction, officialNumber, title: officialNumber, legalCategory, legalAreas, version: { language: 'en' } });
const row = (officialNumber: string, provenance = 'AUTO_CHECKED', extra: Record<string, unknown> = {}, jurisdiction = 'EU') =>
  ({ jurisdiction, official_number: officialNumber, language: 'en', validity: 'IN_FORCE', provenance, effective_from: '2024-12-31', effective_to: null, ai_verified_at: provenance === 'AI_VERIFIED' ? '2026-11-09T10:00:00Z' : null, ...extra });
const plan = { entries: [doc('Regulation R', 'EU_REGULATION', ['A.driving_rest_times']), doc('Directive D', 'EU_DIRECTIVE', ['B.weights'])] };
const cell = (report: any, code: string, area: string) => report.jurisdictions.find((j: any) => j.code === code).cells.find((c: any) => c.area === area);
const build = (over: Record<string, any> = {}) => buildCoverage({ manifest: plan, inventory: [row('Regulation R'), row('Directive D')], sourceChecks: { environment: 'GitHub Actions runner', results: [] }, audits: [], onDate: '2026-11-09', ...over });

describe('the coverage frame', () => {
  it('uses exactly the 50 jurisdictions of config/europe-coverage.mjs and a valid area taxonomy', () => {
    const report = build();
    expect(dajcCoverageCount).toBe(50);
    expect(report.jurisdictions.map((j: any) => j.code)).toEqual(dajcEuropeCoverage.map(([c]) => c));
    expect(report.areaCount).toBe(LEGAL_AREA_LIST.length);
    expect(report.cellCount).toBe(50 * LEGAL_AREA_LIST.length);
    expect(validateLegalAreas()).toEqual([]);
  });

  it('has an official legislation source for every jurisdiction and a valid registry', () => {
    expect(validateLegalSources()).toEqual([]);
    expect(legislationCoverageGaps(dajcEuropeCoverage.map(([c]) => c))).toEqual([]);
    expect(legalSources.filter((s) => s.region).map((s) => `${s.jurisdiction}/${s.region}`)).toEqual(expect.arrayContaining(['BA/FBIH', 'BA/RS', 'BA/BD', 'BE/VLG', 'BE/WAL']));
  });

  it('gives every manifest entry at least one known legal area', () => {
    const ids = new Set(LEGAL_AREA_LIST.map((a) => a.id));
    for (const e of manifest.entries) {
      expect(e.legalAreas?.length, e.officialNumber).toBeGreaterThan(0);
      for (const a of e.legalAreas) expect(ids.has(a), a).toBe(true);
    }
  });
});

describe('coverage statuses are never optimistic', () => {
  it('makes an EU act at most PARTIAL where it applies, with the reasons, and nothing where it does not', () => {
    const report = build();
    const cz = cell(report, 'CZ', 'A.driving_rest_times');
    expect(cz.status).toBe('PARTIAL');
    expect(cz.reasons.join(' ')).toMatch(/no national act/);
    expect(cz.reasons.join(' ')).toMatch(/not yet AI- or person-verified/);
    expect(cell(report, 'CZ', 'B.weights').reasons.join(' ')).toMatch(/national transposition/);
    expect(cell(report, 'NO', 'A.driving_rest_times').reasons.join(' ')).toMatch(/EEA Agreement/);
    for (const code of ['CH', 'UK', 'RS', 'TR', 'UA']) expect(cell(report, code, 'A.driving_rest_times').status).toBe('NOT_YET_RESEARCHED');
    expect(report.completeJurisdictions).toEqual([]);
  });

  it('counts only versions in force, and separates verified from machine-checked', () => {
    const report = build({ inventory: [row('Regulation R', 'AI_VERIFIED'), row('Directive D', 'AUTO_CHECKED', { validity: 'SUPERSEDED' })] });
    expect(cell(report, 'CZ', 'A.driving_rest_times')).toMatchObject({ status: 'PARTIAL', verifiedVersions: 1, lastVerifiedOn: '2026-11-09' });
    expect(cell(report, 'CZ', 'B.weights').status).toBe('NOT_YET_RESEARCHED');
    expect(cell(report, 'CZ', 'B.weights').plannedNotImported).toEqual([]);
  });

  it('marks a conflicted version as CONFLICTED', () => {
    expect(cell(build({ inventory: [row('Regulation R', 'CONFLICTED')] }), 'DE', 'A.driving_rest_times').status).toBe('CONFLICTED');
  });

  it('accepts NOT_APPLICABLE and COVERED only from an audit with official evidence and verified documents', () => {
    const evidence = [{ url: 'https://eur-lex.europa.eu/legal-content/EN/ALL/?uri=CELEX:32006R0561', explanation: 'Article 2 limits the scope to carriage by road within the Community.' }];
    const blog = [{ url: 'https://truck-blog.example/rules', explanation: 'A blog says this does not apply anywhere at all.' }];
    const report = build({
      inventory: [row('Regulation R', 'AI_VERIFIED'), row('Directive D')],
      audits: [
        { jurisdiction: 'MC', area: 'C.escorts', status: 'NOT_APPLICABLE', assessedOn: '2026-11-09', evidence: blog },
        { jurisdiction: 'SM', area: 'C.escorts', status: 'NOT_APPLICABLE', assessedOn: '2026-11-09', evidence },
        { jurisdiction: 'CZ', area: 'A.driving_rest_times', status: 'COVERED', assessedOn: '2026-11-09', evidence, documents: ['Regulation R'] },
        { jurisdiction: 'SK', area: 'B.weights', status: 'COVERED', assessedOn: '2026-11-09', evidence, documents: ['Directive D'] },
      ],
    });
    expect(cell(report, 'MC', 'C.escorts').status).toBe('NOT_YET_RESEARCHED');
    expect(report.auditIssues[0]).toMatchObject({ jurisdiction: 'MC', problems: [expect.stringMatching(/official legal evidence/)] });
    expect(cell(report, 'SM', 'C.escorts').status).toBe('NOT_APPLICABLE');
    expect(cell(report, 'CZ', 'A.driving_rest_times').status).toBe('COVERED');
    expect(cell(report, 'SK', 'B.weights')).toMatchObject({ status: 'PARTIAL', reasons: expect.arrayContaining([expect.stringMatching(/not all stored, in force and verified/)]) });
  });

  it('calls a source unavailable on robots.txt evidence, but not for a refusal seen only from the sandbox', () => {
    const results = (outcome: string) => [{ domain: 'isap.sejm.gov.pl', outcome }, { domain: 'dziennikustaw.gov.pl', outcome }];
    expect(cell(build({ sourceChecks: { environment: 'DAJC development sandbox', results: results('ROBOTS_RESTRICTED') } }), 'PL', 'C.escorts').status).toBe('SOURCE_UNAVAILABLE');
    const sandbox = cell(build({ sourceChecks: { environment: 'DAJC development sandbox', results: results('BLOCKED_FROM_DEV') } }), 'PL', 'C.escorts');
    expect(sandbox.status).toBe('NOT_YET_RESEARCHED');
    expect(sandbox.reasons.join(' ')).toMatch(/re-check from the GitHub runner/);
    expect(cell(build({ sourceChecks: { environment: 'GitHub Actions runner', results: results('BLOCKED_FROM_DEV') } }), 'PL', 'C.escorts').status).toBe('SOURCE_UNAVAILABLE');
  });
});
