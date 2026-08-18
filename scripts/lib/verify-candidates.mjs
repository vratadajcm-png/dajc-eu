// Re-verification pass for the Friday pipeline: for each pre-selected
// candidate finding, confirm its source URL is still reachable right now.
// A candidate that fails verification is dropped, never published with a
// dead/unreachable source (see docs/NEWS_AUTOMATION.md "Quality gate").

const VERIFY_TIMEOUT_MS = 8_000;
const CONCURRENCY = 6;

async function verifyOne(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), VERIFY_TIMEOUT_MS);
  try {
    let res = await fetch(url, {
      method: 'HEAD',
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; DajcOversizeVerify/1.0; +https://dajc.eu)' },
      redirect: 'follow',
    });
    if (res.status === 405 || res.status === 501) {
      // some servers reject HEAD - retry with GET before giving up
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
 * @param {object[]} candidates - must each have a `sourceUrl`
 * @returns {Promise<{ verified: object[], failed: object[] }>}
 */
export async function verifyCandidates(candidates) {
  const verified = [];
  const failed = [];
  const queue = [...candidates];

  async function worker() {
    while (queue.length > 0) {
      const candidate = queue.shift();
      if (!candidate) return;
      const ok = await verifyOne(candidate.sourceUrl);
      if (ok) verified.push({ ...candidate, confidence: 'verified' });
      else failed.push(candidate);
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, candidates.length) }, worker));
  return { verified, failed };
}
