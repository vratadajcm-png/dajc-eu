import assert from 'node:assert/strict';
import { dajcEuropeCoverage, isTrackedJurisdiction, resolveCoverageScope, COVERAGE_VERSION } from '../../config/europe-coverage.mjs';
import { hydrateCanonical, validateCanonical } from '../../src/lib/driving-bans/core.mjs';

/** Pure, repeatable migration. It changes organization, never legal evidence. */
export function migrateCanonicalCoverage(input) {
  const data = structuredClone(input);
  const removedReviews = {}, removedRules = [], manualReview = [];
  const migratedRules = [];
  const regionalReviews = [...(data.regional_reviews || [])];
  for (const [code, review] of Object.entries(data.jurisdiction_reviews || {})) {
    if (isTrackedJurisdiction(code)) continue;
    removedReviews[code] = review;
    delete data.jurisdiction_reviews[code];
    const scope = resolveCoverageScope(code);
    // A child's NO_BAN/full review cannot become a country-wide decision.
    if (scope?.region && (review.source_ids?.length || review.last_verified || review.coverage_complete)) regionalReviews.push({ jurisdiction: scope.jurisdiction, region: scope.region, original_code: code, review });
  }
  data.rules = data.rules.flatMap(rule => {
    const full = { ...(data.rule_profiles?.[rule.profile] || {}), ...rule };
    if (isTrackedJurisdiction(full.jurisdiction)) return [rule];
    const scope = resolveCoverageScope(full.jurisdiction);
    if (!scope) {
      removedRules.push(rule);
      manualReview.push({ ban_id: rule.ban_id, original_jurisdiction: full.jurisdiction, reason: 'NO_SAFE_COUNTRY_ASSIGNMENT' });
      return [];
    }
    migratedRules.push(rule.ban_id);
    return [{ ...rule, jurisdiction: scope.jurisdiction, ...(scope.region ? {
      regions: [...new Set([scope.region, ...(full.regions || [])])],
      geographic_migration: { original_jurisdiction: full.jurisdiction, region: scope.region },
    } : {}) }];
  });
  const usedProfiles = new Set(data.rules.map(r => r.profile).filter(Boolean));
  data.rule_profiles = Object.fromEntries(Object.entries(data.rule_profiles || {}).filter(([id]) => usedProfiles.has(id)));
  // A profile may still carry the retired regional code. Materialize only
  // that profile's rules, then remove it to avoid an inactive registry edge.
  for (const [id, profile] of Object.entries(data.rule_profiles)) {
    if (profile.jurisdiction && !isTrackedJurisdiction(profile.jurisdiction)) {
      data.rules = data.rules.map(rule => {
        if (rule.profile !== id) return rule;
        const full = { ...profile, ...rule }; delete full.profile; return full;
      });
      delete data.rule_profiles[id];
    }
  }
  if (regionalReviews.length) data.regional_reviews = regionalReviews;
  const ids = new Set(data.rules.map(r => r.ban_id));
  for (const r of data.rules) {
    const full = { ...(data.rule_profiles[r.profile] || {}), ...r };
    assert((full.supersedes || []).every(id => ids.has(id)), `Manual review required: dangling supersession in ${r.ban_id}`);
  }
  // Keep only evidence referenced by retained rules, reviews or profiles.
  const sourceIds = new Set();
  const collect = value => {
    if (!value || typeof value !== 'object') return;
    for (const [key, item] of Object.entries(value)) {
      if (key === 'source_id') sourceIds.add(item);
      else if (['source_ids', 'evidence_ids'].includes(key)) for (const id of item) sourceIds.add(id);
      else collect(item);
    }
  };
  collect([data.rules, data.rule_profiles, data.jurisdiction_reviews, data.regional_reviews]);
  const removedSources = data.sources.filter(s => !sourceIds.has(s.source_id));
  data.sources = data.sources.filter(s => sourceIds.has(s.source_id));
  if (data.jurisdiction_reviews.FR?.notes) data.jurisdiction_reviews.FR.notes = data.jurisdiction_reviews.FR.notes.replace('Overseas departments are separate DAJC jurisdictions.', 'Overseas territories are outside active monitoring and do not inherit metropolitan rules.');
  const esRegional = data.jurisdiction_reviews.ES?.scope_checks?.regional;
  if (esRegional?.note) esRegional.note = esRegional.note.replace('Catalonia and Basque Country run their own calendars (separate DAJC jurisdictions)', 'Catalonia and Basque Country run their own calendars within ES, with separate regional applicability');
  data.coverage_authority = 'config/europe-coverage.mjs';
  data.coverage_version = COVERAGE_VERSION;
  if (!data.dataset_version.endsWith('.geo50')) data.dataset_version += '.geo50';
  validateCanonical(hydrateCanonical(data, dajcEuropeCoverage), dajcEuropeCoverage);
  return { data, removedReviews, removedRules, removedSources, migratedRules, manualReview };
}
