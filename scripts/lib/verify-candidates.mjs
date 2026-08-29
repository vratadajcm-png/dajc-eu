// Re-verification pass for the Friday pipeline. For each pre-selected
// candidate finding this now runs THREE independent checks before a
// candidate is allowed anywhere near the OpenAI call:
//
// 1. Operational relevance (checkOperationalRelevance, relevance-filter.mjs)
//    - rejects one-off incidents, procurement notices, unconfirmed planned
//      works, and crime/administrative noise, even if the daily monitor's
//      own ingestion filter already let it through (see relevance-filter.mjs
//      for why both layers exist).
// 2. Target-week date overlap (validateDevelopmentDateRange, date-validation.mjs)
//    - rejects a candidate whose already-known validFrom/validTo cannot
//      possibly overlap the week the article is actually being written for.
// 3. Source reachability (HEAD, falling back to GET on any non-2xx HEAD).
//    Some official government sites reject or mishandle HEAD while serving a
//    normal GET successfully; a candidate is still never published with a
//    genuinely dead source link.
//
// A candidate that fails any check is dropped and never reaches the model -
// this is deliberately independent of what the model itself is instructed to
// do (see openai-client.mjs), so a prompt-following failure can't reintroduce
// the class of error this file screens out. Every rejection is logged with
// its specific reason.

import { checkOperationalRelevance } from './relevance-filter.mjs';
import { validateDevelopmentDateRange } from './date-validation.mjs';
import { checkLongRoadClosure } from './closure-duration.mjs';

const VERIFY_TIMEOUT_MS = 8_000;
const CONCURRENCY = 6;

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
 * @param {{ weekStart?: Date, weekEnd?: Date }} targetWeek
 * @returns {Promise<{ ok: true } | { ok: false, reason: string }>}
 */
async function verifyOne(candidate, { weekStart, weekEnd } = {}) {
  const text = `${candidate.title || ''} ${candidate.summary || ''}`;
  const relevance = checkOperationalRelevance(text);
  if (!relevance.ok) return { ok: false, reason: relevance.reason };

  const closureCheck = checkLongRoadClosure(candidate);
  if (!closureCheck.ok) return { ok: false, reason: closureCheck.reason };

  if (weekStart && weekEnd) {
    const dateCheck = validateDevelopmentDateRange(
      { validFrom: candidate.validFrom, validTo: candidate.validTo },
      { weekStart, weekEnd }
    );
    if (!dateCheck.ok) return { ok: false, reason: dateCheck.reason };
  }

  const reachable = await checkReachable(candidate.sourceUrl);
  if (!reachable) return { ok: false, reason: 'source URL unreachable' };

  return { ok: true };
}

/**
 * @param {object[]} candidates - must each have a `sourceUrl`
 * @param {{ weekStart?: Date, weekEnd?: Date }} [targetWeek] - when given,
 *   candidates with a known validFrom/validTo outside this range are dropped.
 * @returns {Promise<{ verified: object[], failed: object[] }>}
 */
export async function verifyCandidates(candidates, targetWeek = {}) {
  const verified = [];
  const failed = [];
  const queue = [...candidates];

  async function worker() {
    while (queue.length > 0) {
      const candidate = queue.shift();
      if (!candidate) return;
      const result = await verifyOne(candidate, targetWeek);
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
