import { oversizeSources } from '../../config/oversize-sources/index.mjs';
import { coverageName, resolveCoverageScope, isTrackedJurisdiction, corridorOnlyJurisdictions, isTrackedCorridorRoadClass, isExcludedTerritory, COVERAGE_VERSION } from '../../config/europe-coverage.mjs';

/** Resolve identity before any page fetch, AI request or active-store write.
 * Explicit territory identity wins over an administering-country label.
 * A region is a restriction of applicability, never a country-wide rule.
 */
export function scopeFinding(finding) {
  if (!finding || typeof finding !== 'object') return { ok: false, reason: 'INVALID_FINDING' };
  if (isExcludedTerritory(finding.region)) return { ok: false, reason: 'EXCLUDED_TERRITORY_NO_PARENT_INHERITANCE' };
  const scope = resolveCoverageScope(finding.jurisdictionId || finding.jurisdiction || finding.country);
  if (!scope) return { ok: false, reason: 'OUTSIDE_MONITORING_SCOPE_OR_MANUAL_ASSIGNMENT_REQUIRED' };
  const countryScope = resolveCoverageScope(finding.country);
  if (finding.country && (!countryScope || countryScope.jurisdiction !== scope.jurisdiction)) {
    return { ok: false, reason: 'CONFLICTING_GEOGRAPHIC_IDENTITY' };
  }
  if (corridorOnlyJurisdictions.includes(scope.jurisdiction)) {
    const evidence = finding.corridorEvidence;
    // Geographic approval is separate from legal verification. Without a
    // sourced, reviewed corridor assignment, keep the item out of active use.
    if (!evidence?.corridor || !evidence?.reviewedBy || evidence.sourceUrl !== finding.sourceUrl || !evidence.excerpt) {
      return { ok: false, reason: 'CORRIDOR_SCOPE_REQUIRES_REVIEW' };
    }
    if (!isTrackedCorridorRoadClass(evidence.roadClass) || !String(evidence.roadOrSection || '').trim()) {
      return { ok: false, reason: 'CORRIDOR_ROAD_CLASS_OR_SECTION_REQUIRES_REVIEW' };
    }
  }
  const source = oversizeSources.find(source => source.country === scope.jurisdiction && source.name === finding.sourceName);
  const region = scope.region || countryScope?.region || source?.region;
  const value = { ...finding, jurisdiction: scope.jurisdiction, country: coverageName(scope.jurisdiction) };
  if (region) {
    // Preserve narrower pre-existing text as well as the parent region.
    value.region = finding.region === region || String(finding.region || '').startsWith(`${region}; `) ? finding.region : finding.region ? `${region}; ${finding.region}` : region;
  }
  delete value.jurisdictionId;
  return { ok: true, finding: value };
}

export function scopeFindings(findings) {
  const kept = [], excluded = [];
  for (const finding of findings) {
    const result = scopeFinding(finding);
    if (result.ok) kept.push(result.finding);
    else excluded.push({ finding, reason: result.reason });
  }
  return { kept, excluded };
}

/** Used at the automation data-branch boundary as well as by the migration.
 * Original branch commits remain immutable evidence; obsolete coverage is
 * never imported as new work and no check timestamp is refreshed here.
 */
export function scopeMonitoringDocument(document) {
  if (Array.isArray(document.findings)) {
    const { kept, excluded } = scopeFindings(document.findings);
    return { value: { ...document, findings: kept }, excluded };
  }
  if (Array.isArray(document.jurisdictions)) {
    const excluded = document.jurisdictions.filter(row => !isTrackedJurisdiction(row.code));
    const seen = new Set();
    const jurisdictions = document.jurisdictions.filter(row => {
      if (!isTrackedJurisdiction(row.code)) return false;
      if (seen.has(row.code)) throw new Error(`Duplicate coverage identity ${row.code}`);
      seen.add(row.code);
      return true;
    }).map(row => ({ ...row, sourceScope: row.code }));
    return { value: { ...document, coverageVersion: COVERAGE_VERSION, jurisdictions }, excluded };
  }
  throw new Error('Unrecognized monitoring document');
}
