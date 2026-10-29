import { describe, it, expect, vi } from 'vitest';
import { readFileSync, mkdirSync, mkdtempSync, writeFileSync, rmSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { dajcEuropeCoverage, dajcCoverageCodes, resolveCoverageScope } from '../../../config/europe-coverage.mjs';
import { oversizeSources } from '../../../config/oversize-sources/index.mjs';
import { canonicalDrivingBans } from '../../../config/driving-ban-calendars/runtime.mjs';
import { buildDrivingBanVerificationPlan, targetedSourceReview } from '../../../config/driving-ban-calendars/verification.mjs';
import { hydrateCanonical, expandRules, validateCanonical, snapshot, assertSweepRequest, shiftDate, SCOPE_CHECKS } from '../../../src/lib/driving-bans/core.mjs';
import { migrateCanonicalCoverage } from '../geographic-migration.mjs';
import { scopeFinding, scopeMonitoringDocument } from '../geographic-scope.mjs';
import { SEARCH_GROUPS, buildClassifierPrompt, searchGroup, verifySearchItem } from '../web-search.mjs';
import { fetchSourceFindings } from '../fetch-source.mjs';
import { selectCandidates } from '../select-candidates.mjs';
import { checkGeneratedItem } from '../generated-item-filter.mjs';

const expected = 'AD AL AM AT AZ BA BE BG BY CH CY CZ DE DK EE ES FI FR GE GR HR HU IE IS IT KZ LI LT LU LV MC MD ME MK MT NL NO PL PT RO RS RU SE SI SK SM TR UA UK XK'.split(' ');
const originalRoot = new URL('../../../archive/geographic-coverage-20261022/original/', import.meta.url);
const original = JSON.parse(readFileSync(new URL('data/driving-bans/canonical.json', originalRoot), 'utf8'));
const active = JSON.parse(readFileSync(new URL('../../../data/driving-bans/canonical.json', import.meta.url), 'utf8'));
const migrated = migrateCanonicalCoverage(original).data;
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
    // The migration itself must be a pure reorganization of the archived registry.
    expect(migrated.rules).toEqual(original.rules);
    expect(migrated.rule_profiles).toEqual(original.rule_profiles);
    expect(migrated.window).toEqual(original.window);
    for (const code of expected) {
      const prior = structuredClone(original.jurisdiction_reviews[code]);
      if (code === 'FR') prior.notes = prior.notes.replace('Overseas departments are separate DAJC jurisdictions.', 'Overseas territories are outside active monitoring and do not inherit metropolitan rules.');
      if (code === 'ES') prior.scope_checks.regional.note = prior.scope_checks.regional.note.replace('Catalonia and Basque Country run their own calendars (separate DAJC jurisdictions)', 'Catalonia and Basque Country run their own calendars within ES, with separate regional applicability');
      expect(migrated.jurisdiction_reviews[code]).toEqual(prior);
    }
    const old = { ...original, rules: fullRules(original).map(rule => {
      const source = original.sources.find(s => s.source_id === rule.source_id);
      return { ...rule, source_url: source.url, source_authority: source.authority, source_version: rule.source_version || source.version };
    }) };
    expect(expandRules(hydrateCanonical(migrated, dajcEuropeCoverage), original.window)).toEqual(expandRules(old, original.window));
    expect(migrated.rules.length).toBe(182);
  });

  it('never deletes a migrated rule identity in later legal reviews', () => {
    // Later reviews may add, correct, cancel or supersede rules, but every archived identity stays traceable.
    const live = new Set(active.rules.map(rule => rule.ban_id));
    expect(original.rules.map(rule => rule.ban_id).filter(id => !live.has(id))).toEqual([]);
    expect(migrateCanonicalCoverage(active).data).toEqual(active);
  });

  it('verifies all bytes in the pre-migration backup manifest', () => {
    const manifest = JSON.parse(readFileSync(new URL('../manifest.json', originalRoot), 'utf8'));
    for (const [path, digest] of Object.entries(manifest.files)) expect(hash(readFileSync(new URL(path, originalRoot)))).toBe(digest);
  });

  it('is idempotent and removes all non-tracked jurisdiction reviews and unused sources', () => {
    const result = migrateCanonicalCoverage(original);
    expect(result.data).toEqual(migrated);
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
    const search = vi.fn();
    await expect(searchGroup({id:'retired',codes:[code]}, { search })).rejects.toThrow(/Untracked/);
    expect(search).not.toHaveBeenCalled();
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
    // More than a month after the reviewed span ends, no carry-in event can exist.
    const beyond = new Date(`${shiftDate(canonicalDrivingBans.window.to, 32)}T12:00:00Z`);
    const view = snapshot(canonicalDrivingBans,dajcEuropeCoverage,beyond);
    expect(view.jurisdictions.every(row => row.ban_state === 'UNKNOWN')).toBe(true);
  });

  it('keeps KZ/RU/TR discovery limited and requires evidence for corridor assignment', () => {
    const prompt = buildClassifierPrompt(SEARCH_GROUPS.find(group=>group.id==='east'), []);
    expect(prompt).toContain('not their whole territories');
    for (const country of ['KZ','RU','TR']) expect(scopeFinding({country}).reason).toBe('CORRIDOR_SCOPE_REQUIRES_REVIEW');
    const finding = {country:'TR',sourceUrl:'https://example.test/a',corridorEvidence:{corridor:'European international route',reviewedBy:'operator',sourceUrl:'https://example.test/a',excerpt:'source passage',roadClass:'motorway',roadOrSection:'O-3; European freight corridor'}};
    expect(scopeFinding(finding).ok).toBe(true);
    expect(scopeFinding({...finding,corridorEvidence:{...finding.corridorEvidence,roadClass:'main_road'}}).ok).toBe(true);
    for (const roadClass of ['local_road','secondary_road',null]) expect(scopeFinding({...finding,corridorEvidence:{...finding.corridorEvidence,roadClass}}).ok).toBe(false);
    expect(scopeFinding({...finding,corridorEvidence:{...finding.corridorEvidence,roadOrSection:''}}).ok).toBe(false);
    expect(prompt).toContain('Motorways and main roads');
  });

  it('rejects a corridor calendar rule without a tracked road class and precise road scope', () => {
    const input = structuredClone(active);
    const base = {...fullRules(active)[0], ban_id:'tr-scope-test', jurisdiction:'TR', supersedes:[], roads:['O-3; defined section'], corridor_scope:{description:'European freight corridor',reviewed_by:'test fixture',evidence_ids:[fullRules(active)[0].source_id],road_classes:['motorway']}};
    delete base.profile;
    input.rules.push(base);
    expect(validateCanonical(hydrateCanonical(input,dajcEuropeCoverage),dajcEuropeCoverage)).toBe(true);
    base.corridor_scope.road_classes = ['local_road'];
    expect(() => validateCanonical(hydrateCanonical(input,dajcEuropeCoverage),dajcEuropeCoverage)).toThrow(/road class/);
    base.corridor_scope.road_classes = ['main_road']; base.roads = [];
    expect(() => validateCanonical(hydrateCanonical(input,dajcEuropeCoverage),dajcEuropeCoverage)).toThrow(/road class/);
  });

  it('exports official web review tasks for the central registry without claiming a fresh complete sweep', () => {
    const plan = buildDrivingBanVerificationPlan(new Date('2026-12-22T10:00:00Z'));
    expect(plan.window).toMatchObject({from:'2026-12-01',to:'2027-01-31'});
    expect(plan.jurisdictions.map(row=>row.jurisdiction)).toEqual(expected);
    for (const code of ['AT','DE','ES','BE','UK','PT']) expect(plan.jurisdictions.find(row=>row.jurisdiction===code).official_source_seeds.length).toBeGreaterThan(0);
    for (const code of ['KZ','RU','TR']) expect(plan.jurisdictions.find(row=>row.jurisdiction===code).road_classes).toEqual(['motorway','main_road']);
    expect(targetedSourceReview.full_registry_sweep).toBe(false);
    expect(targetedSourceReview.calendar_rules_updated).toBe(false);
    expect(targetedSourceReview.jurisdictions.every(row=>row.remaining.length && row.sources.every(source=>source.role==='PRIMARY'))).toBe(true);
    expect(active.jurisdiction_reviews.UK.last_checked).toBeNull();
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
      // Clock after the latest recorded review, so the run cannot borrow freshness from the future.
      const output = execFileSync(process.execPath, ['scripts/audit-driving-bans.mjs', '--clock', '2026-11-10T10:00:00Z', '--previous', 'archive/geographic-coverage-20261022/original/data/driving-bans/canonical.json', '--output', root], {encoding:'utf8'});
      const summary = JSON.parse(output);
      expect(summary.changes.filter(change => change.kind === 'REMOVED_RECORD_REQUIRES_REVIEW')).toEqual([]);
      expect(summary.changes.every(change => expected.includes(change.jurisdiction))).toBe(true);
      expect(summary.geographic_changes.removed_jurisdictions).toHaveLength(54);
      expect(summary.external_source_review_performed).toBe(false);
      expect(summary.selected_jurisdictions).toEqual(expected);
      expect(summary.sweep_age_days).toBeGreaterThan(8);
      expect(JSON.parse(readFileSync(join(root,'verification-plan.json'),'utf8')).jurisdictions.map(row=>row.jurisdiction)).toEqual(expected);
      expect(JSON.parse(readFileSync(join(root,'targeted-source-review.json'),'utf8')).full_registry_sweep).toBe(false);
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
