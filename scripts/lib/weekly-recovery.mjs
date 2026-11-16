// Bounded recovery after a fail-closed editorial rejection.
// Only a reviewer-provided, exact URL with supported=false is eligible for removal.
// Never turn a blocking reason into permission to edit, publish or relax a quality gate.
export const REJECTION_MARKER = 'Editorial status: REJECTED_BY_CLAUDE';
export const MAX_EDITION_ATTEMPTS = 3;
export const RETRY_AFTER_HOURS = 8;

export function selectRejectedSourceUrls(review, allowedUrls) {
  if (!review || review.verdict !== 'reject' || !Array.isArray(review.sourceChecks) ||
      !Array.isArray(review.blockingReasons) || review.blockingReasons.length === 0) return [];
  const known = new Set(allowedUrls);
  if (!known.size || review.sourceChecks.length !== known.size) return [];
  const seen = new Set();
  const rejected = [];
  for (const item of review.sourceChecks) {
    if (!item || !known.has(item.url) || seen.has(item.url) || typeof item.supported !== 'boolean') return [];
    seen.add(item.url);
    if (item.supported === false) rejected.push(item.url);
  }
  return seen.size === known.size ? rejected : [];
}

export function shouldReplaceBlockedEditionPr(pending, allPulls, now, {
  minHours = RETRY_AFTER_HOURS, maxAttempts = MAX_EDITION_ATTEMPTS,
} = {}) {
  if (!pending || !String(pending.body || '').includes(REJECTION_MARKER)) return false;
  const created = new Date(pending.createdAt || NaN);
  const lastUpdate = new Date(pending.updatedAt || pending.createdAt || NaN);
  if (!Number.isFinite(created.getTime()) || !Number.isFinite(lastUpdate.getTime())) return false;
  if (now.getTime() - Math.max(created.getTime(), lastUpdate.getTime()) < minHours * 3600_000) return false;
  const branch = String(pending.headRefName || '');
  const prefix = branch.replace(/-retry-\d+$/, '');
  if (!/^automation\/weekly-\d{4}-w\d{2}$/.test(prefix)) return false;
  const attempts = allPulls.filter((p) => {
    const h = String(p.headRefName || '');
    return h === prefix || /^-retry-\d+$/.test(h.slice(prefix.length)) && h.startsWith(prefix);
  }).length;
  return attempts < maxAttempts;
}
