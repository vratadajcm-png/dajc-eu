import { describe, it, expect, vi } from 'vitest';
import { readFileSync, mkdirSync, mkdtempSync, writeFileSync, rmSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { dajcEuropeCoverage, dajcCoverageCodes, resolveCoverageScope } from '../../../config/europe-coverage.mjs';
import { oversizeSources } from '../../../config/oversize-sources/index.mjs';
import { canonicalDrivingBans } from '../../../config/driving-ban-calendars/runtime.mjs';
import { hydrateCanonical, expandRules, validateCanonical, snapshot, assertSweepRequest, SCOPE_CHECKS } from '../../../src/lib/driving-bans/core.mjs';
import { migrateCanonicalCoverage } from '../geographic-migration.mjs';
import { scopeFinding, scopeMonitoringDocument } from '../geographic-scope.mjs';
import { SEARCH_GROUPS, buildSearchPrompt, searchGroup, verifySearchItem } from '../web-search.mjs';
import { fetchSourceFindings } from '../fetch-source.mjs';
import { selectCandidates } from '../select-candidates.mjs';
import { checkGeneratedItem } from '../generated-item-filter.mjs';

const expected = 'AD AL AM AT AZ BA BE BG BY CH CY CZ DE DK EE ES FI FR GE GR HR HU IE IS IT KZ LI LT LU LV MC MD ME MK MT NL NO PL PT RO RS RU SE SI SK SM TR UA UK XK'.split(' ');
const originalRoot = new URL('../../../archive/geographic-coverage-20261022/original/', import.meta.url);
const original = JSON.parse(readFileSync(new URL('data/driving-bans/canonical.json', originalRoot), 'utf8'));
const active = JSON.parse(readFileSync(new URL('../../../data/driving-bans/canonical.json', import.meta.url), 'utf8'));
const fullRules = data => data.rules.map(rule => ({ ...data.rule_profiles[rule.profile], ...rule }));
const hash = value => createHash('sha256').update(value).digest('hex');

describe('approved geographic scope and data preservation', () => {
  it('has exactly the 50 approved unique codes, not just any 50', () => {
    expect(dajcEuropeCoverage.map(([code]) => code)).toEqual(expected);
    expect(dajcCoverageCodes.size).toBe(50);
    expect(dajcCoverageCodes.add).toBeUndefined();
    expect(() => dajcEuropeCoverage.push(['VA','Vatican City'])).toThrow();
    const impostor = dajcEuropeCoverage.map(row => [...row]); impostor[0] = ['VA','Vatican City'];
    expect(() => validateCanonical(canonicalDrivingBans, impostor)).toThrow(/central registry/);
  });

  it('preserves every original rule, legal field, verification date and event UID', () => {
    expect(active.rules).toEqual(original.rules);
    expect(active.rule_profiles).toEqual(original.rule_profiles);
    expect(active.window).toEqual(original.window);
    for (const code of expected) {
      const prior = structuredClone(original.jurisdiction_reviews[code]);
      if (code === 'FR') prior.notes = prior.notes.replace('Overseas departments are separate DAJC jurisdictions.', 'Overseas territories are outside active monitoring and do not inherit metropolitan rules.');
      expect(active.jurisdiction_reviews[code]).toEqual(prior);
    }
    const old = { ...original, rules: fullRules(original).map(rule => {
      const source = original.sources.find(s => s.source_id === rule.source_id);
      return { ...rule, source_url: source.url, source_authority: source.authority, source_version: rule.source_version || source.version };
    }) };
    expect(expandRules(canonicalDrivingBans, original.window)).toEqual(expandRules(old, original.window));
    expect(active.rules.length).toBe(182);
  });

  it('verifies all bytes in the pre-migration backup manifest', () => {
    const manifest = JSON.parse(readFileSync(new URL('../manifest.json', originalRoot), 'utf8'));
    for (const [path, digest] of Object.entries(manifest.files)) expect(hash(readFileSync(new URL(path, originalRoot)))).toBe(digest);
  });

  it('is idempotent and removes all non-tracked jurisdiction reviews and unused sources', () => {
    const result = migrateCanonicalCoverage(original);
    expect(result.data).toEqual(active);
    expect(migrateCanonicalCoverage(result.data).data).toEqual(result.data);
    expect(Object.keys(result.removedReviews)).toHaveLength(54);
    expect(result.removedRules).toEqual([]);
    expect(Object.keys(result.data.jurisdiction_reviews).sort()).toEqual(expected);
  });

  it.each(['FLA','WAL','BRU','CAT','BAS','GAL','ENG','SCT','WLS','NIR','AZO','MAD'])('moves %s rules under the country without making a regional review country-wide', code => {
    const input = structuredClone(active), scope = resolveCoverageScope(code);
    const base = fullRules(active)[0]; delete base.profile;
    input.rules.push({ ...base, ban_id: `region-${code.toLowerCase()}`, jurisdiction: code, regions: ['specific local area'], supersedes: [] });
    input.jurisdiction_reviews[code] = { ...structuredClone(active.jurisdiction_reviews.CZ), ban_state:'NO_BAN' };
    const result = migrateCanonicalCoverage(input).data;
    const moved = result.rules.find(r => r.ban_id === `region-${code.toLowerCase()}`);
    expect(moved.jurisdiction).toBe(scope.jurisdiction);
    expect(moved.regions).toContain(scope.region);
    expect(moved.weight_threshold).toEqual(base.weight_threshold);
    expect(moved.schedule).toEqual(base.schedule);
    expect(result.jurisdiction_reviews[scope.jurisdiction]).toEqual(active.jurisdiction_reviews[scope.jurisdiction]);
    expect(result.regional_reviews[0].region).toBe(scope.region);
  });

  it.each(['JE','GG','GI','AX','FO','GL','VA','PF','NCY','AB','SO','TRN'])('does not inherit any rules or searches for %s', async code => {
    expect(resolveCoverageScope(code)).toBeNull();
    const fetchPage = vi.fn();
    expect((await verifySearchItem({ country:code, url:'https://example.test/outside' }, {fetchPage})).ok).toBe(false);
    expect(fetchPage).not.toHaveBeenCalled();
    const client = {responses:{create:vi.fn()}};
    await expect(searchGroup(client, {id:'retired',codes:[code]})).rejects.toThrow(/Untracked/);
    expect(client.responses.create).not.toHaveBeenCalled();
    await expect(fetchSourceFindings({country:code,url:'https://example.test'})).rejects.toThrow(/Out-of-scope/);
  });

  it('archives an unsafe rule assignment and rejects dangling supersession before mutation', () => {
    const input = structuredClone(active), base = fullRules(active)[0]; delete base.profile;
    input.rules.push({...base,ban_id:'jersey-rule',jurisdiction:'JE',supersedes:[]});
    const result = migrateCanonicalCoverage(input);
    expect(result.manualReview).toEqual([{ban_id:'jersey-rule',original_jurisdiction:'JE',reason:'NO_SAFE_COUNTRY_ASSIGNMENT'}]);
    expect(result.removedRules).toHaveLength(1);
    input.rules[0].supersedes = ['jersey-rule'];
    expect(() => migrateCanonicalCoverage(input)).toThrow(/dangling supersession/);
  });

  it('normalizes regional findings idempotently, and never treats empty coverage as NO_BAN', () => {
    const result = scopeFinding({country:'Madeira', region:'Funchal',sourceName:'Madeira Regional Government',sourceUrl:'https://example.test/a'});
    expect(result.finding).toMatchObject({country:'Portugal',jurisdiction:'PT',region:'Madeira; Funchal'});
    expect(scopeFinding(result.finding)).toEqual(result);
    expect(scopeFinding({country:'United Kingdom',jurisdictionId:'JE'}).ok).toBe(false);
    expect(scopeFinding({country:'United Kingdom',region:'Jersey'}).ok).toBe(false);
    const view = snapshot(canonicalDrivingBans,dajcEuropeCoverage,new Date('2027-01-01T12:00:00Z'));
    expect(view.jurisdictions.every(row => row.ban_state === 'UNKNOWN')).toBe(true);
  });

  it('keeps KZ/RU/TR discovery limited and requires evidence for corridor assignment', () => {
    const prompt = buildSearchPrompt(SEARCH_GROUPS.find(group=>group.id==='east'));
    expect(prompt).toContain('not their whole territories');
    for (const country of ['KZ','RU','TR']) expect(scopeFinding({country}).reason).toBe('CORRIDOR_SCOPE_REQUIRES_REVIEW');
    expect(scopeFinding({country:'TR',sourceUrl:'https://example.test/a',corridorEvidence:{corridor:'European international route',reviewedBy:'operator',sourceUrl:'https://example.test/a',excerpt:'source passage'}}).ok).toBe(true);
  });

  it('partitions discovery into the approved registry exactly once and scopes official sources', () => {
    expect(SEARCH_GROUPS.flatMap(g=>g.codes).sort()).toEqual(expected);
    expect(oversizeSources.every(s=>dajcCoverageCodes.has(s.country) && !s.jurisdictionId)).toBe(true);
    expect(oversizeSources.find(s=>s.id==='madeira-gov')).toMatchObject({country:'PT',region:'Madeira'});
    expect(oversizeSources.some(s=>s.id==='je-roadclosures')).toBe(false);
    expect(new Set(oversizeSources.map(s=>s.url)).size).toBe(oversizeSources.length);
  });

  it('filters old automation data before reuse and blocks retired weekly AI candidates', () => {
    const value = scopeMonitoringDocument({ findings:[{country:'Jersey',id:'retired'},{country:'Germany',id:'retained'}] }).value;
    expect(value.findings.map(f=>f.jurisdiction)).toEqual(['DE']);
    const selected = selectCandidates([{country:'Jersey',id:'old',sourceUrl:'https://example.test/a'}],{now:new Date()});
    expect(selected.selected).toEqual([]);
    expect(checkGeneratedItem({country:'Jersey',sourceUrl:'https://example.test/a'}).ok).toBe(false);
  });

  it('Thursday manifest contains exactly the approved codes and refuses retired urgent rechecks', () => {
    expect(assertSweepRequest({mode:'full'},canonicalDrivingBans,new Date('2026-10-22T08:00:00Z'))).toEqual(expected);
    expect(()=>assertSweepRequest({mode:'urgent',jurisdiction:'JE',urgentSource:'https://example.test/a',publishedBanId:active.rules[0].ban_id},canonicalDrivingBans)).toThrow();
    expect(SCOPE_CHECKS).toHaveLength(12);
  });

  it('compares the archived registry without losing rule history or pretending freshness', () => {
    const root = mkdtempSync(join(tmpdir(),'dajc-geo-audit-'));
    try {
      const output = execFileSync(process.execPath, ['scripts/audit-driving-bans.mjs', '--clock', '2026-10-22T10:00:00Z', '--previous', 'archive/geographic-coverage-20261022/original/data/driving-bans/canonical.json', '--output', root], {encoding:'utf8'});
      const summary = JSON.parse(output);
      expect(summary.changes).toEqual([]);
      expect(summary.geographic_changes.removed_jurisdictions).toHaveLength(54);
      expect(summary.external_source_review_performed).toBe(false);
      expect(summary.selected_jurisdictions).toEqual(expected);
      expect(summary.sweep_age_days).toBeGreaterThan(8);
      const summaryPath = join(root,'summary.json');
      const statusPath = join(root,'status.json');
      execFileSync(process.execPath,['scripts/driving-bans-technical-status.mjs',summaryPath,statusPath],{stdio:'pipe'});
      expect(JSON.parse(readFileSync(statusPath,'utf8')).operational_state).toBe('NOT_CURRENTLY_VERIFIED');
      summary.selected_jurisdictions[0]='JE';
      writeFileSync(summaryPath,JSON.stringify(summary));
      expect(()=>execFileSync(process.execPath,['scripts/driving-bans-technical-status.mjs',summaryPath,statusPath],{stdio:'pipe'})).toThrow();
    } finally { rmSync(root,{recursive:true,force:true}); }
  });

  it('backs up before CLI writes, and a second application changes no bytes or backup batches', () => {
    const root = mkdtempSync(join(tmpdir(),'dajc-geo-migration-'));
    try {
      mkdirSync(join(root,'data/driving-bans'),{recursive:true});
      const before = JSON.stringify(original);
      writeFileSync(join(root,'data/driving-bans/canonical.json'),before);
      const command = ['scripts/migrate-geographic-coverage.mjs','--apply','--root',root];
      const first = JSON.parse(execFileSync(process.execPath,command,{encoding:'utf8'}));
      expect(first.changed_files).toEqual(['data/driving-bans/canonical.json']);
      const batches = join(root,'archive/geographic-coverage-20261022/batches');
      expect(readFileSync(join(batches,readdirSync(batches)[0],'original/data/driving-bans/canonical.json'),'utf8')).toBe(before);
      const after = readFileSync(join(root,'data/driving-bans/canonical.json'),'utf8');
      const second = JSON.parse(execFileSync(process.execPath,command,{encoding:'utf8'}));
      expect(second.changed_files).toEqual([]);
      expect(readFileSync(join(root,'data/driving-bans/canonical.json'),'utf8')).toBe(after);
      expect(readdirSync(batches)).toHaveLength(1);
    } finally { rmSync(root,{recursive:true,force:true}); }
  });
});
