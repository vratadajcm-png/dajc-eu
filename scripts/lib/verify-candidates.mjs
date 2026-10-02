// Re-verification pass for the Weekly pipeline. Each pre-selected candidate
// must pass two independent checks before it is allowed anywhere near the
// OpenAI call:
//
// 1. The complete deterministic Weekly eligibility check
//    (weekly-eligibility.mjs): operational relevance, heavy-transport domain,
//    the >30-day closure rule, the driving-ban scope rule, specific-development
//    (no homepages/landing/project pages), source suitability, publication-date
//    freshness, target-week date overlap and no repetition of earlier editions.
//    This deliberately repeats pre-selection so verification can never be
//    called with weaker rules.
// 2. Source reachability (HEAD, falling back to GET on any non-2xx HEAD).
//    Some official government sites reject or mishandle HEAD while serving a
//    normal GET successfully; a candidate is still never published with a
//    genuinely dead source link.
//
// A candidate that fails any check is dropped and never reaches the model -
// this is deliberately independent of what the model itself is instructed to
// do (see openai-client.mjs), so a prompt-following failure can't reintroduce
// the class of error this file screens out. Every rejection is logged with
// its specific reason.

import { checkWeeklyEligibility } from './weekly-eligibility.mjs';

const VERIFY_TIMEOUT_MS = 8_000;
const CONCURRENCY = 6;

function isDocumentLikeSourceUrl(url) {
  try {
    const pathname = new URL(url).pathname.toLowerCase();
    return !/\.(?:jpe?g|png|gif|webp|svg|avif|bmp|ico)(?:$|\/)/i.test(pathname);
  } catch {
    return false;
  }
}

async function checkReachable(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), VERIFY_TIMEOUT_MS);
  try {
    let res = await fetch(url, {
      method: 'HEAD',
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; DajcOversizeVerify/1.0; +https://dajc.eu)' },
      redirect: 'follow',
    });
    if (!res.ok) {
      // Government/legal sites commonly return 403/405/501 (or another
      // non-success status) to HEAD while the normal document GET is valid.
      // Retry once with GET before declaring an official source unreachable.
      res = await fetch(url, {
        method: 'GET',
        signal: controller.signal,
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; DajcOversizeVerify/1.0; +https://dajc.eu)' },
        redirect: 'follow',
      });
    }
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * @param {object} candidate
 * @param {Parameters<typeof checkWeeklyEligibility>[1]} ctx
 * @returns {Promise<{ ok: true } | { ok: false, reason: string }>}
 */
async function verifyOne(candidate, ctx) {
  const eligibility = checkWeeklyEligibility(candidate, ctx);
  if (!eligibility.ok) return eligibility;

  if (!isDocumentLikeSourceUrl(candidate.sourceUrl)) {
    return { ok: false, reason: 'source URL points to an image/asset rather than an official article or document' };
  }

  const reachable = await checkReachable(candidate.sourceUrl);
  if (!reachable) return { ok: false, reason: 'source URL unreachable' };

  return { ok: true };
}

/**
 * @param {object[]} candidates - must each have a `sourceUrl`
 * @param {Parameters<typeof checkWeeklyEligibility>[1]} ctx - the same
 *   eligibility context used for pre-selection (now, target week, earlier
 *   editions, source metadata).
 * @returns {Promise<{ verified: object[], failed: object[] }>}
 */
export async function verifyCandidates(candidates, ctx) {
  const verified = [];
  const failed = [];
  const queue = [...candidates];

  async function worker() {
    while (queue.length > 0) {
      const candidate = queue.shift();
      if (!candidate) return;
      const result = await verifyOne(candidate, ctx);
      if (result.ok) {
        verified.push({ ...candidate, confidence: 'verified' });
      } else {
        console.log(`  [rejected] "${candidate.title}" (${candidate.sourceName}): ${result.reason}`);
        failed.push({ ...candidate, rejectionReason: result.reason });
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, candidates.length) }, worker));
  return { verified, failed };
}
