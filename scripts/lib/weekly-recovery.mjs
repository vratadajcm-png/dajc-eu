import { createHash } from 'node:crypto';
// Bounded recovery after a fail-closed editorial rejection.
// Only a reviewer-provided, exact URL with supported=false is eligible for removal.
// Never turn a blocking reason into permission to edit, publish or relax a quality gate.
export const REJECTION_MARKER = 'Editorial status: REJECTED_BY_CLAUDE';
export const MAX_EDITION_ATTEMPTS = 3;
// New actual evidence, not elapsed time, permits a fresh preparation.
// The semantic fingerprint guard runs before every paid writing call.
export const RETRY_AFTER_HOURS = 0;

export function selectRejectedSourceUrls(review, allowedUrls) {
  if (!review || review.verdict !== 'reject' || !Array.isArray(review.sourceChecks) ||
      !Array.isArray(review.blockingReasons) || review.blockingReasons.length === 0 ||
      review.blockingReasons.some(reason => typeof reason !== 'string' || !reason.trim())) return [];
  const known = new Set(allowedUrls);
  if (!known.size || review.sourceChecks.length !== known.size) return [];
  const seen = new Set();
  const rejected = [];
  for (const item of review.sourceChecks) {
    if (!item || !known.has(item.url) || seen.has(item.url) || typeof item.supported !== 'boolean' ||
        typeof item.reason !== 'string' || item.reason.trim().length < 4) return [];
    seen.add(item.url);
    if (item.supported === false) rejected.push(item.url);
  }
  return seen.size === known.size ? rejected : [];
}

export function shouldReplaceBlockedEditionPr(pending, allPulls, now, {
  minHours = RETRY_AFTER_HOURS, maxAttempts = MAX_EDITION_ATTEMPTS,
} = {}) {
  if (!pending || !(String(pending.body || '').includes(REJECTION_MARKER) || /DAJC_WEEKLY_STATE:\s*(?:EDITORIAL_REJECTED|BLOCKED)/.test(String(pending.body || '')))) return false;
  const created = new Date(pending.createdAt || NaN);
  const lastUpdate = new Date(pending.updatedAt || pending.createdAt || NaN);
  if (!Number.isFinite(created.getTime()) || !Number.isFinite(lastUpdate.getTime())) return false;
  if (now.getTime() - Math.max(created.getTime(), lastUpdate.getTime()) < minHours * 3600_000) return false;
  const branch = String(pending.headRefName || '');
  const prefix = branch.replace(/-retry-\d+(?:-\d+)?$/, '');
  if (!/^automation\/weekly-\d{4}-w\d{2}$/.test(prefix)) return false;
  // Source-snapshot deduplication runs after refresh in check-weekly-preparation.
  // The three-generation budget applies to a preparation, never to the lifetime
  // of an ISO week: genuinely new evidence can start a fresh bounded review.
  return true;
}

// Monitoring timestamps cannot create a new paid editorial preparation. Only
// a changed set of actual source facts can do that. Both collection wrappers
// ({ findings }) and plain finding arrays are accepted for caller convenience.
export function findingsFingerprint(input) {
  const findings = Array.isArray(input) ? input : input?.findings;
  if (!Array.isArray(findings)) throw new Error('Source fingerprint requires findings array');
  const semanticKeys = ['sourceUrl', 'sourceName', 'sourceTier', 'title', 'summary', 'country', 'jurisdiction', 'region', 'location',
    'type', 'publishedAt', 'publishedAtSource', 'validFrom', 'validTo', 'impact', 'recommendedAction', 'vehicleScope', 'exemptions'];
  const records = findings.map(item => Object.fromEntries(semanticKeys.map(key => [key, item[key] ?? null])))
    .map(item => JSON.stringify(item)).sort();
  return createHash('sha256').update(JSON.stringify([...new Set(records)])).digest('hex');
}
