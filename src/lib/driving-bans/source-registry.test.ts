import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dajcEuropeCoverage } from '../../../config/europe-coverage.mjs';
import { canonicalDrivingBans, getDrivingBansSnapshot } from '../../../config/driving-ban-calendars/runtime.mjs';
import { drivingBanSourceCatalog, buildDrivingBanSourceCatalog } from '../../../config/driving-ban-sources/index.mjs';
import { providerCandidates } from '../../../config/driving-ban-sources/provider-candidates.mjs';
import {
  buildSourceCatalog, deriveIntegrationStatus, validateSourceCatalog, catalogToCsv,
  IMPLEMENTED_CONNECTORS, INTEGRATION_STATUSES, SOURCE_CATEGORIES,
} from './source-registry.mjs';

const catalog = drivingBanSourceCatalog;
const entry = (id: string) => catalog.entries.find((row: any) => row.source_id === id);
const clone = () => structuredClone(catalog);
const documented = (overrides: any = {}) => ({
  ...structuredClone(entry('provider:hu-magyar-kozut-utinform-datex2')),
  ...overrides,
});

describe('Driving Bans Source Registry', () => {
  it('covers exactly the central registry and every canonical source once, with the same identity', () => {
    expect(validateSourceCatalog(catalog, dajcEuropeCoverage)).toBe(true);
    expect(catalog.jurisdictions.map((row: any) => row.jurisdiction)).toEqual(dajcEuropeCoverage.map(([code]) => code));
    for (const source of canonicalDrivingBans.sources) {
      const matches = catalog.entries.filter((row: any) => row.source_id === source.source_id);
      expect(matches, source.source_id).toHaveLength(1);
      expect(matches[0].url).toBe(source.url);
      expect(matches[0].role).toBe(source.role);
      expect(matches[0].last_verified_at).toBe(source.checked_at ?? null);
    }
    expect(catalog.summary.unmapped).toEqual([]);
  });

  it('is metadata only: no rules, and building it leaves the canonical dataset and its verification untouched', () => {
    const before = JSON.stringify(canonicalDrivingBans);
    const view = JSON.stringify(getDrivingBansSnapshot(new Date('2026-10-22T10:00:00Z')));
    buildDrivingBanSourceCatalog('2026-10-27T00:00:00.000Z');
    expect(JSON.stringify(canonicalDrivingBans)).toBe(before);
    expect(JSON.stringify(getDrivingBansSnapshot(new Date('2026-10-22T10:00:00Z')))).toBe(view);
    for (const row of catalog.entries) for (const key of ['ban_id', 'schedule', 'verification_state', 'ban_state']) expect(row).not.toHaveProperty(key);
    const code = readFileSync(new URL('./source-registry.mjs', import.meta.url), 'utf8');
    expect(code).not.toMatch(/\bfetch\(|node:https?|XMLHttpRequest/);
  });

  it('never reports ACTIVE without an implemented connector, and none exists in this phase', () => {
    expect(IMPLEMENTED_CONNECTORS).toEqual([]);
    expect(catalog.entries.some((row: any) => row.integration_status === 'ACTIVE')).toBe(false);
    for (const row of catalog.entries) expect(INTEGRATION_STATUSES).toContain(row.integration_status);
  });

  it('derives status from the first unmet gate', () => {
    const verifiedRights = { storage: 'allowed', history: 'allowed', derived_intelligence: 'allowed', redistribution: 'denied', commercial_use: 'allowed', attribution_required: true };
    const gates = (technical: string, access: string) => ({ technical_documentation: { state: technical, basis: 'PUBLIC_DOCUMENTATION' }, access: { state: access, basis: 'PUBLIC_DOCUMENTATION' } });
    expect(deriveIntegrationStatus(documented({ gates: gates('NOT_DOCUMENTED', 'OPEN') }))).toBe('SOURCE_IDENTIFIED');
    expect(deriveIntegrationStatus(documented({ gates: gates('MANUAL_ONLY', 'OPEN') }))).toBe('SOURCE_IDENTIFIED');
    expect(deriveIntegrationStatus(documented({ gates: gates('DOCUMENTED', 'UNKNOWN') }))).toBe('TECHNICALLY_DOCUMENTED');
    expect(deriveIntegrationStatus(documented({ gates: gates('DOCUMENTED', 'REGISTRATION_REQUIRED') }))).toBe('ACCESS_PENDING');
    expect(deriveIntegrationStatus(documented({ gates: gates('DOCUMENTED', 'GRANTED') }))).toBe('LICENCE_PENDING');
    // A provider's statement about its licence is not a verified licence.
    expect(deriveIntegrationStatus(documented({ gates: gates('DOCUMENTED', 'GRANTED'), licence: { name: 'CC BY 4.0', basis: 'PROVIDER_STATEMENT', attribution: 'x' }, rights: verifiedRights }))).toBe('LICENCE_PENDING');
    const ready = documented({ gates: gates('DOCUMENTED', 'GRANTED'), licence: { name: 'CC BY 4.0', basis: 'PUBLISHED_TERMS_VERIFIED', attribution: 'x' }, rights: verifiedRights, connector_id: 'hu-utinform' });
    expect(deriveIntegrationStatus(ready)).toBe('INTEGRATION_READY');
    expect(deriveIntegrationStatus(ready, ['hu-utinform'])).toBe('ACTIVE');
  });

  it('records the provider contacts as candidates only, with regional competence kept apart', () => {
    expect(entry('provider:hu-magyar-kozut-utinform-datex2').integration_status).toBe('ACCESS_PENDING');
    expect(entry('provider:hu-magyar-kozut-bridge-conditions-wfs').restriction_classes).toEqual(['INFRASTRUCTURE_CONSTRAINT']);
    expect(entry('provider:de-mobilithek').integration_status).toBe('SOURCE_IDENTIFIED');
    expect(entry('provider:it-open-data-hub-datex2').region).toBe('South Tyrol (Alto Adige)');
    expect(['Brussels-Capital Region', 'Flanders', 'Wallonia'].every(region => catalog.entries.some((row: any) => row.jurisdiction === 'BE' && row.region === region))).toBe(true);
    for (const candidate of providerCandidates) {
      const row = entry(candidate.source_id);
      expect(row.licence.basis).not.toBe('PUBLISHED_TERMS_VERIFIED');
      expect(row.integration_status).not.toBe('ACTIVE');
      if (row.url) expect(candidate.url_reachability).not.toBeNull();
    }
    expect(catalog.interoperability_references.map((row: any) => row.id)).toEqual(['napcore', 'ertico']);
  });

  it('keeps legal evidence apart from discovery leads and cross-checks', () => {
    expect(entry('trafficban-li').evidence_use).toBe('CROSS_CHECK_ONLY');
    expect(entry('oversize:hu-kozut').evidence_use).toBe('DISCOVERY_LEAD');
    expect(entry('at-stvo42').evidence_use).toBe('LEGAL_EVIDENCE');
    expect(entry('at-stvo42').machine_interface_id).toBe('interface:at-ris-ogd');
    for (const row of catalog.entries.filter((item: any) => item.evidence_use !== 'LEGAL_EVIDENCE')) expect(row.restriction_classes.length === 0 || !row.origin.includes('CANONICAL')).toBe(true);
    for (const row of catalog.jurisdictions) expect([...row.categories_covered, ...row.categories_missing].sort()).toEqual([...SOURCE_CATEGORIES].sort());
  });

  it('rejects hand-set statuses, untracked or insecure records, unverified rights, extra fields and personal data', () => {
    const mutate = (change: (copy: any) => void) => { const copy = clone(); change(copy); return () => validateSourceCatalog(copy, dajcEuropeCoverage); };
    expect(mutate(c => { c.entries[0].integration_status = 'ACTIVE'; })).toThrow(/not derived/);
    expect(mutate(c => { c.entries[0].jurisdiction = 'JE'; })).toThrow(/Untracked/);
    expect(mutate(c => { c.entries[0].url = 'http://example.test/'; })).toThrow();
    expect(mutate(c => { c.entries[0].rights.commercial_use = 'allowed'; })).toThrow(/verified published terms/);
    expect(mutate(c => { c.entries.push(structuredClone(c.entries[0])); })).toThrow(/Duplicate/);
    expect(mutate(c => { entryIn(c, 'provider:de-mobilithek').contact_email = 'x'; })).toThrow();
    expect(mutate(c => { entryIn(c, 'provider:de-mobilithek').blockers.push('Ask jane.doe@example.org'); })).toThrow(/personal data/);
    expect(mutate(c => { entryIn(c, 'provider:de-mobilithek').blockers.push('Call +49 30 1234567'); })).toThrow(/personal data/);
    expect(mutate(c => { c.jurisdictions.pop(); })).toThrow(/central registry/);
  });

  it('merges a review record that points at an existing document instead of duplicating it', () => {
    const source = canonicalDrivingBans.sources.find((row: any) => row.source_id === 'cz-361');
    const review = { reviewed_on: '2026-10-22', jurisdictions: [{ jurisdiction: 'CZ', sources: [{ source_id: 'cz-361-web', url: source.url, authority: 'x', role: 'PRIMARY', version: 'v', scope: 's', finding: 'f' }], remaining: ['x'] }] };
    const merged = buildSourceCatalog({ canonical: canonicalDrivingBans, identities: dajcEuropeCoverage, targetedReview: review });
    const row = merged.entries.find((item: any) => item.source_id === 'cz-361');
    expect(row.origin).toEqual(['CANONICAL', 'TARGETED_REVIEW']);
    expect(row.provenance_refs).toContain('alias:cz-361-web');
    expect(merged.entries.some((item: any) => item.source_id === 'cz-361-web')).toBe(false);
  });

  it('exports JSON and CSV through the CLI', () => {
    const root = mkdtempSync(join(tmpdir(), 'dajc-sources-'));
    try {
      execFileSync(process.execPath, ['scripts/export-driving-ban-sources.mjs', '--output', root, '--clock', '2026-10-27T12:00:00Z'], { stdio: 'pipe' });
      const json = JSON.parse(readFileSync(join(root, 'source-catalog.json'), 'utf8'));
      expect(json.generated_at).toBe('2026-10-27T12:00:00.000Z');
      expect(json.entries).toHaveLength(catalog.entries.length);
      const csv = readFileSync(join(root, 'source-catalog.csv'), 'utf8');
      expect(csv).toBe(catalogToCsv(json));
      expect(csv.trim().split('\r\n')).toHaveLength(catalog.entries.length + 1);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});

function entryIn(copy: any, id: string) { return copy.entries.find((row: any) => row.source_id === id); }
