import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dajcEuropeCoverage } from '../../../config/europe-coverage.mjs';
import { canonicalDrivingBans } from '../../../config/driving-ban-calendars/runtime.mjs';
import { hydrateCanonical, validateCanonical, invalidateSources, snapshot, expandRules } from './core.mjs';
import { detectChanges, assessEvidence } from './legal-changes.mjs';
import { checkRules, massesInText, newFindings } from './rule-checks.mjs';
import { validateProposal } from './review-workflow.mjs';
import rawCanonical from '../../../data/driving-bans/canonical.json';

const AT = '2026-10-27T12:00:00.000Z';
const base = () => structuredClone(canonicalDrivingBans);
const rule = (data: any, id: string) => data.rules.find((r: any) => r.ban_id === id);
const types = (changes: any[]) => changes.map(c => c.type);
const kind = (changes: any[], type: string) => changes.filter(c => c.type === type);

describe('legal change classification', () => {
  it('is idempotent: the same dataset yields no change, and change ids are stable', () => {
    expect(detectChanges(base(), base(), { detectedAt: AT })).toEqual([]);
    const after = base(); rule(after, 'cz-sunday').schedule.start_time = '12:00';
    expect(detectChanges(base(), after, { detectedAt: AT }).map(c => c.change_id)).toEqual(detectChanges(base(), after, { detectedAt: '2027-01-01T00:00:00.000Z' }).map(c => c.change_id));
  });

  it('classifies new, amended, cancelled and superseded rules with before/after, sources and impact', () => {
    const after = base();
    const added = { ...structuredClone(rule(after, 'cz-holidays-2026-autumn')), ban_id: 'cz-test-new', valid_from: '2026-11-17', valid_to: '2026-11-17', schedule: { ...rule(after, 'cz-holidays-2026-autumn').schedule, dates: [{ date: '2026-11-17', occurrence_id: '2026-11-17' }] } };
    rule(after, 'cz-holidays-2026-autumn').schedule.dates = rule(after, 'cz-holidays-2026-autumn').schedule.dates.filter((d: any) => d.date !== '2026-11-17');
    after.rules.push(added);
    Object.assign(rule(after, 'cz-sunday'), { status: 'CANCELLED', cancellation: { legal_basis: 'Test act', evidence_ids: ['cz-361'], effective_from: '2026-11-01' } });
    rule(after, 'sk-sunday').schedule.end_time = '21:00';
    const changes = detectChanges(base(), after, { detectedAt: AT });
    const created = kind(changes, 'NEW_RULE')[0];
    expect(created).toMatchObject({ ban_id: 'cz-test-new', legal_change: true, legal_effective_from: '2026-11-17', detected_at: AT, review_state: 'REVIEW_REQUIRED' });
    expect(created.sources).toContain('cz-361');
    expect(created.user_impact).toMatch(/New restriction/);
    expect(kind(changes, 'CANCELLED_RULE')[0]).toMatchObject({ ban_id: 'cz-sunday', before: 'ACTIVE', after: 'CANCELLED', legal_effective_from: '2026-11-01', reason: 'Test act' });
    expect(kind(changes, 'AMENDED_RULE').map(c => [c.ban_id, c.field])).toEqual(expect.arrayContaining([['sk-sunday', 'schedule'], ['cz-holidays-2026-autumn', 'schedule']]));
    const replaced = base();
    replaced.rules.push({ ...structuredClone(rule(replaced, 'sk-sunday')), ban_id: 'sk-sunday-v2', supersedes: ['sk-sunday'] });
    rule(replaced, 'sk-sunday').status = 'SUPERSEDED';
    expect(types(detectChanges(base(), replaced, { detectedAt: AT }))).toEqual(expect.arrayContaining(['NEW_RULE', 'SUPERSEDED_RULE']));
  });

  it('separates exceptions, and flags an exception added without new evidence', () => {
    const after = base();
    rule(after, 'hu-weekend').exceptions = [...rule(after, 'hu-weekend').exceptions.slice(1), 'Test exception'];
    const changes = detectChanges(base(), after, { detectedAt: AT });
    expect(kind(changes, 'NEW_EXCEPTION')[0]).toMatchObject({ ban_id: 'hu-weekend', after: 'Test exception' });
    expect(kind(changes, 'REMOVED_EXCEPTION')[0].before).toBe(rule(base(), 'hu-weekend').exceptions[0]);
    expect(kind(changes, 'REVIEW_REQUIRED').some(c => /without new or changed evidence/.test(c.reason))).toBe(true);
  });

  it('never treats web, HTTP or version metadata as a change of law', () => {
    const after = base();
    rule(after, 'cz-sunday').source_version = 'Retrieved again';
    const source = after.sources.find((s: any) => s.source_id === 'cz-361');
    source.checked_at = '2026-10-27T11:00:00.000Z'; source.content_sha256 = 'a'.repeat(64);
    const changes = detectChanges(base(), after, { detectedAt: AT });
    expect(changes.every(c => c.type === 'METADATA_ONLY' && c.legal_change === false)).toBe(true);
    expect(changes.find(c => c.field === 'content_sha256').review_state).toBe('REVIEW_REQUIRED');
    expect(changes.find(c => c.field === 'checked_at').review_state).toBe('INFORMATIONAL');
  });

  it('reports a lost source as SOURCE_UNAVAILABLE and never as a cancellation', () => {
    const after = invalidateSources(base(), ['cz-361'], '2026-10-27T11:00:00.000Z');
    const changes = detectChanges(base(), after, { detectedAt: AT });
    expect(types(changes)).toContain('SOURCE_UNAVAILABLE');
    expect(types(changes)).not.toContain('CANCELLED_RULE');
    expect(kind(changes, 'SOURCE_UNAVAILABLE')[0].user_impact).toMatch(/NOT cancelled/);
    expect(after.rules.filter((r: any) => r.jurisdiction === 'CZ').every((r: any) => r.status === 'ACTIVE')).toBe(true);
  });

  it('turns a disappeared rule record into a review item, not a cancellation', () => {
    const after = base(); after.rules = after.rules.filter((r: any) => r.ban_id !== 'cz-holidays-2026-autumn');
    const changes = detectChanges(base(), after, { detectedAt: AT });
    expect(kind(changes, 'REVIEW_REQUIRED')[0]).toMatchObject({ ban_id: 'cz-holidays-2026-autumn' });
    expect(types(changes)).not.toContain('CANCELLED_RULE');
  });

  it('detects conflicting sources for the same scope and hours', () => {
    const after = base();
    after.rules.push({ ...structuredClone(rule(after, 'cz-sunday')), ban_id: 'cz-sunday-other-source', source_id: 'cz-245', evidence_ids: ['cz-245'], source_url: after.sources.find((s: any) => s.source_id === 'cz-245').url, schedule: { ...rule(after, 'cz-sunday').schedule, start_time: '12:00' } });
    const changes = detectChanges(base(), after, { detectedAt: AT });
    expect(kind(changes, 'SOURCE_CONFLICT')[0].jurisdiction).toBe('CZ');
  });

  it('reports expired evidence at a point in time without diffing', () => {
    const findings = assessEvidence(base(), { now: new Date('2027-01-15T12:00:00Z') });
    expect(findings[0]).toMatchObject({ type: 'EXPIRED_EVIDENCE', field: 'window' });
    expect(assessEvidence(base(), { now: new Date('2026-10-01T12:00:00Z') }).filter(c => c.field === 'window')).toEqual([]);
  });
});

describe('semantic rule checks', () => {
  it('finds nothing to review in the maintained dataset', () => {
    expect(checkRules(base()).filter(f => f.severity !== 'INFO')).toEqual([]);
  });

  it('parses written masses in t and kg', () => {
    expect([...massesInText('Vehicles above 7,500kg; >3.5 t; 12t; 4250 kg')].sort((a, b) => a - b)).toEqual([3500, 4250, 7500, 12000]);
  });

  it('flags wrong time zones, unit errors, mass mismatches, stale supersession and national rules in separate regimes', () => {
    const data = base();
    const sunday = rule(data, 'cz-sunday');
    data.rules.push({ ...structuredClone(sunday), ban_id: 'cz-tz', timezone: 'Europe/London' });
    data.rules.push({ ...structuredClone(sunday), ban_id: 'cz-kg', weight_threshold: { operator: '>', value: 7.5, unit: 'kg', applies_to: 'x' } });
    data.rules.push({ ...structuredClone(sunday), ban_id: 'cz-text', vehicle_scope: 'Lorries above 12 t', weight_threshold: { operator: '>', value: 7500, unit: 'kg', applies_to: 'x' } });
    data.rules.push({ ...structuredClone(sunday), ban_id: 'cz-v2', supersedes: ['cz-sunday'] });
    const spanish = data.rules.find((r: any) => r.jurisdiction === 'ES' && r.status === 'ACTIVE');
    data.rules.push({ ...structuredClone(spanish), ban_id: 'es-national', roads: ['Whole Spanish road network'], regions: [] });
    data.rules.push({ ...structuredClone(spanish), ban_id: 'es-national-ok', roads: ['Whole Spanish road network'], regions: [], excluded_regions: ['Catalonia', 'Basque Country'] });
    const codes = (id: string) => checkRules(data).filter(f => f.ban_id === id).map(f => f.code);
    expect(codes('cz-tz')).toContain('TIMEZONE_NOT_EXPECTED');
    expect(codes('cz-kg')).toContain('WEIGHT_UNIT_SUSPECT');
    expect(codes('cz-text')).toContain('WEIGHT_TEXT_MISMATCH');
    expect(codes('cz-sunday')).toContain('SUPERSEDED_STILL_ACTIVE');
    expect(codes('es-national')).toContain('NATIONAL_RULE_SEPARATE_REGIME');
    expect(codes('es-national-ok')).not.toContain('NATIONAL_RULE_SEPARATE_REGIME');
    expect(newFindings(checkRules(base()), checkRules(data)).length).toBeGreaterThan(0);
    const twin = base(); twin.rules.push({ ...structuredClone(rule(twin, 'cz-sunday')), ban_id: 'cz-twin' });
    expect(checkRules(twin).map(f => f.code)).toContain('DUPLICATE_SEMANTIC_EVENT');
  });
});

describe('restriction classes', () => {
  it('keeps infrastructure constraints out of the public calendar and out of HAS_BAN evidence', () => {
    const data = base();
    const constraint = { ...structuredClone(rule(data, 'cz-sunday')), ban_id: 'cz-bridge-limit', restriction_class: 'INFRASTRUCTURE_CONSTRAINT' };
    data.rules.push(constraint);
    expect(validateCanonical(data, dajcEuropeCoverage)).toBe(true);
    const events = expandRules(data, { from: '2026-10-01', to: '2026-11-30' });
    expect(events.some((e: any) => e.ban_id === 'cz-bridge-limit')).toBe(false);
    const onlyConstraint = base();
    onlyConstraint.rules = onlyConstraint.rules.map((r: any) => r.jurisdiction === 'SK' ? { ...r, restriction_class: 'PERMIT_CONDITION' } : r);
    expect(() => validateCanonical(onlyConstraint, dajcEuropeCoverage)).toThrow(/HAS_BAN without verified rule SK/);
    const invalid = base(); rule(invalid, 'cz-sunday').restriction_class = 'BAN_OR_SOMETHING';
    expect(() => validateCanonical(invalid, dajcEuropeCoverage)).toThrow(/restriction class/);
    expect(snapshot(base(), dajcEuropeCoverage, new Date('2026-10-22T10:00:00Z')).events.length).toBeGreaterThan(300);
  });
});

describe('proposal validation uses the checks', () => {
  const documents = [{ path: 'd.txt', source_id: 'cz-361', title: 't', kind: 'TEXT_EXCERPT', bytes: 1, sha256: 'b'.repeat(64), retrieved_from: null, retrieved_at: null }];
  const submission = (operations: any[]) => ({ submission_version: 1, synthetic: true, submitted_by: 't', jurisdiction: 'CZ', region: null, summary: 's', documents, links: [], legal_effective: null, legal_verified_at: '2026-10-27T10:00:00Z', operations, supersedes_submission: null });
  it('puts a proposal that introduces a source conflict into CONFLICT and a unit error into INSUFFICIENT_EVIDENCE', () => {
    const conflicting = { ban_id: 'cz-sunday-alt', profile: 'cz-standing', source_id: 'cz-245', evidence_ids: ['cz-245', 'cz-361'], title: 'x', valid_from: '2026-01-01', valid_to: '2026-12-31', schedule: { kind: 'weekly', start_time: '12:00', end_time: '22:00', end_day_offset: 0, weekdays: [0] } };
    expect(validateProposal({ submission: submission([{ op: 'ADD_RULE', rule: conflicting }]), documents, rawCanonical, detectedAt: AT }).findings.map((f: any) => f.code)).toContain('SOURCE_CONFLICT');
    const unit = { ...conflicting, ban_id: 'cz-unit', source_id: 'cz-361', evidence_ids: ['cz-361'], valid_from: '2026-11-17', valid_to: '2026-11-17', schedule: { kind: 'dates', start_time: '13:00', end_time: '22:00', end_day_offset: 0, dates: [{ date: '2026-11-17', occurrence_id: 'x' }] }, weight_threshold: { operator: '>', value: 7.5, unit: 'kg', applies_to: 'x' } };
    expect(validateProposal({ submission: submission([{ op: 'ADD_RULE', rule: unit }]), documents, rawCanonical, detectedAt: AT }).state).toBe('INSUFFICIENT_EVIDENCE');
  });
});

describe('changes CLI', () => {
  it('compares a candidate dataset with canonical.json', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dajc-changes-'));
    try {
      const after = structuredClone(rawCanonical as any);
      after.rules.find((r: any) => r.ban_id === 'sk-sunday').schedule.end_time = '21:00';
      writeFileSync(join(dir, 'after.json'), JSON.stringify(after));
      const out = JSON.parse(execFileSync(process.execPath, ['scripts/driving-bans-changes.mjs', '--after', join(dir, 'after.json'), '--json', '--clock', AT], { encoding: 'utf8' }));
      expect(out.map((c: any) => [c.type, c.ban_id, c.field])).toEqual([['AMENDED_RULE', 'sk-sunday', 'schedule']]);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
