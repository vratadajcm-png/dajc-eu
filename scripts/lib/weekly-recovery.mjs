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

// Reviewer findings are untrusted model text derived from untrusted source
// pages. They are passed to the writer only as bounded, inert data describing
// what to REMOVE or CORRECT; they can never add a source, fact or exception.
// Only control/invisible characters are stripped: '>12 t' must survive intact.
export const MAX_FEEDBACK_ITEMS = 16;
export const MAX_FEEDBACK_CHARS = 600;
export function sanitizeEditorialFeedback(values) {
  if (!Array.isArray(values)) return [];
  const out = [];
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const text = value
      .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, MAX_FEEDBACK_CHARS);
    if (text.length >= 4 && !out.includes(text)) out.push(text);
    if (out.length >= MAX_FEEDBACK_ITEMS) break;
  }
  return out;
}

/**
 * Turns one complete, structured Claude veto into a bounded repair plan.
 * - Every cited URL must have exactly one check; anything else fails closed.
 * - URLs marked unsupported are excluded, even when that is every cited
 *   source: the writer then works only from the REMAINING verified pool and
 *   an empty result is a blocked edition, never padding.
 * - Without an unsupported URL, the blocking reasons become correction
 *   constraints for a rewrite of the same verified pool (claim-level repair).
 * A repair is only ever a new draft: deterministic gates, live source checks,
 * the build and a fresh independent review still decide.
 */
// A source the reviewer rejects for its QUALITY (relay, general outlet, old or
// evergreen page, own publication...) is removed at once. A source rejected
// only because the article misstated it is first given one rewrite.
export const SOURCE_QUALITY_REJECTION = new RegExp([
  'relay(?:s|ed|ing)?\\b', 'second[- ]?hand', 'third[- ]?hand', 'not (?:a |the )?(?:first[- ]?hand|primary) (?:source|publisher|report)',
  'not (?:from )?the competent authority', 'not an official (?:source|publisher|notice)', 'general[- ](?:interest|automotive|consumer|news) (?:outlet|site|publication|media)',
  'consumer outlet', 'aggregator', 'evergreen', 'guide page', '\\bblog\\b', 'unrelated (?:country|jurisdiction|language|outlet|publication|site)',
  'outdated (?:page|source|article|notice)', 'old (?:page|announcement|article|news)', 'sponsored', 'advertorial', 'promotional',
  'dajc\\.(?:eu|cz)', 'landing page', 'homepage', 'source (?:is |was )?unavailable', 'could not be fetched',
].join('|'), 'i');

export function planEditorialRepair(review, allowedUrls, { attempt = 2 } = {}) {
  const fail = (reason) => ({ ok: false, reason, excludeUrls: [], feedback: [] });
  if (!review || review.verdict !== 'reject') return fail('not a structured editorial rejection');
  if (!Array.isArray(review.blockingReasons) || review.blockingReasons.length === 0 ||
      review.blockingReasons.some((reason) => typeof reason !== 'string' || !reason.trim())) return fail('rejection lacks concrete blocking reasons');
  const known = new Set(Array.isArray(allowedUrls) ? allowedUrls : []);
  if (!known.size || !Array.isArray(review.sourceChecks) || review.sourceChecks.length !== known.size) return fail('rejection does not check every cited source exactly once');
  const seen = new Set();
  const excludeUrls = [];
  const correctUrls = [];
  const sourceNotes = [];
  for (const item of review.sourceChecks) {
    if (!item || !known.has(item.url) || seen.has(item.url) || typeof item.supported !== 'boolean' ||
        typeof item.reason !== 'string' || item.reason.trim().length < 4) return fail('rejection contains an incomplete, duplicate or unknown source check');
    seen.add(item.url);
    if (item.supported !== false) continue;
    // Only the first repair may keep a source whose content was misstated;
    // on the final repair every source that is still rejected is removed.
    if (attempt <= 2 && !SOURCE_QUALITY_REJECTION.test(item.reason)) {
      correctUrls.push(item.url);
      sourceNotes.push('Correct the report citing ' + item.url + ' strictly to its evidence: ' + item.reason);
    } else {
      excludeUrls.push(item.url);
      sourceNotes.push('Removed source ' + item.url + ': ' + item.reason);
    }
  }
  if (seen.size !== known.size) return fail('rejection does not check every cited source');
  // Per-source notes first: the feedback cap must never cut the concrete
  // instruction attached to a cited URL.
  const feedback = sanitizeEditorialFeedback([...sourceNotes, ...review.blockingReasons]);
  if (!excludeUrls.length && !feedback.length) return fail('rejection gives nothing concrete to repair');
  return { ok: true, mode: excludeUrls.length ? 'remove-unsupported-sources' : 'correct-claims', excludeUrls, correctUrls, feedback,
    allSourcesRejected: excludeUrls.length === known.size };
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
