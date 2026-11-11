// One vocabulary for why a source could not be read. An unreadable source is
// NEVER "unchanged legislation": every value other than OK means "not checked".
//   OK                 read successfully
//   ROBOTS_DISALLOWED  robots.txt forbids our agent (permanent until the publisher changes it)
//   ROBOTS_UNAVAILABLE robots.txt itself answered 5xx or could not be read (temporary)
//   RATE_LIMITED       HTTP 429
//   WAF_BLOCKED        bot challenge / web application firewall (x-amzn-waf-action, HTTP 202 without content, 403 challenge)
//   NETWORK_ERROR      DNS, TLS, timeout, connection reset
//   HTTP_ERROR         other HTTP failure (4xx/5xx) with the status recorded
export const OUTCOMES = Object.freeze(['OK', 'ROBOTS_DISALLOWED', 'ROBOTS_UNAVAILABLE', 'RATE_LIMITED', 'WAF_BLOCKED', 'NETWORK_ERROR', 'HTTP_ERROR']);

/** Classifies an HTTP answer (status and the headers that matter). */
export function classifyHttp(status, headers = new Headers(), contentLength = null) {
  if (headers.get?.('x-amzn-waf-action')) return 'WAF_BLOCKED';
  if (status === 202 && (contentLength === 0 || headers.get?.('content-length') === '0')) return 'WAF_BLOCKED';
  if (status === 429) return 'RATE_LIMITED';
  if (status >= 200 && status < 400) return 'OK';
  return 'HTTP_ERROR';
}

/** Classifies a thrown error from polite-fetch, probes or fetch. */
export function classifyError(error) {
  const kind = error?.kind;
  if (OUTCOMES.includes(kind)) return kind;
  if (kind === 'CHALLENGE') return /429|rate limit/i.test(error.message) ? 'RATE_LIMITED' : 'WAF_BLOCKED';
  if (kind === 'TRANSIENT_EXHAUSTED') return /network/i.test(error.reason || error.message) ? 'NETWORK_ERROR' : 'HTTP_ERROR';
  if (kind === 'PERMANENT_HTTP') return 'HTTP_ERROR';
  return 'NETWORK_ERROR';
}
