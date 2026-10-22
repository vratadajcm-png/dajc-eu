import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dajcEuropeCoverage, isTrackedJurisdiction, coverageRegions, corridorOnlyJurisdictions, geographicScopePolicy, COVERAGE_VERSION } from '../europe-coverage.mjs';
import { publicationWindow, SCOPE_CHECKS } from '../../src/lib/driving-bans/core.mjs';

// Evidence log for one targeted check, NOT a second jurisdiction registry or
// executable calendar. Reading it does not refresh a legal-review timestamp.
export const targetedSourceReview = JSON.parse(readFileSync(new URL('../../data/driving-bans/source-reviews/2026-10-22.json', import.meta.url), 'utf8'));
assert(targetedSourceReview.full_registry_sweep === false && targetedSourceReview.calendar_rules_updated === false);
const sourceIds = new Set(), reviewedCodes = new Set();
for (const review of targetedSourceReview.jurisdictions) {
  assert(isTrackedJurisdiction(review.jurisdiction) && !reviewedCodes.has(review.jurisdiction), 'Invalid targeted-review jurisdiction');
  reviewedCodes.add(review.jurisdiction);
  assert(review.remaining.length, 'A targeted check must retain its incomplete scope');
  for (const source of review.sources) {
    assert(!sourceIds.has(source.source_id) && source.role === 'PRIMARY' && new URL(source.url).protocol === 'https:' && source.authority && source.scope && source.finding, 'Invalid official source evidence');
    sourceIds.add(source.source_id);
  }
}

export const drivingBanVerificationPolicy = Object.freeze({
  evidence: 'Read official legislation, amendments, road-authority and police web pages. Associations/media are discovery leads, not substitutes for primary verification.',
  preserve: 'Retain precise vehicle/mass/dimension categories, roads, sections, directions, times, region, legal validity, exceptions and permit conditions.',
  incomplete: 'Unavailable or partial evidence stays UNKNOWN/UNVERIFIED. Never infer NO_BAN from an empty search or mark a whole country verified after a targeted source check.',
});

export function buildDrivingBanVerificationPlan(now = new Date()) {
  return {
    coverage_version: COVERAGE_VERSION,
    window: publicationWindow(now),
    policy: drivingBanVerificationPolicy,
    jurisdictions: dajcEuropeCoverage.map(([jurisdiction, name]) => {
      const prior = targetedSourceReview.jurisdictions.find(review => review.jurisdiction === jurisdiction);
      return {
        jurisdiction, name,
        scope_checks: SCOPE_CHECKS,
        regional_scopes: coverageRegions(jurisdiction),
        geographic_scope: corridorOnlyJurisdictions.includes(jurisdiction) ? geographicScopePolicy.corridor_scope : geographicScopePolicy.regional_scope,
        ...(corridorOnlyJurisdictions.includes(jurisdiction) ? { road_classes: geographicScopePolicy.corridor_road_classes, road_evidence: geographicScopePolicy.corridor_evidence } : {}),
        official_source_seeds: prior?.sources.map(source => ({source_id: source.source_id, url: source.url, authority: source.authority, scope: source.scope})) || [],
        open_checks: prior?.remaining || [],
      };
    }),
  };
}
