// A polite, serial HTTP client for official legal publishers.
//   - robots.txt is always applied (RobotsPolicy); it is never edited around;
//   - one request at a time (no parallel connections) and a minimum interval
//     per client (AT RIS: 2000 ms = 0.5 req/s, HR: 334 ms = 3 req/s);
//   - failures are classified, never blurred:
//       ROBOTS_DISALLOWED  permanent: the publisher forbids it for our agent
//       PERMANENT_HTTP     401/403/404/410 and other 4xx: not retried
//       CHALLENGE          bot challenge / 429 without a retry window: stop the host
//       TRANSIENT_EXHAUSTED 5xx (e.g. a temporary 503), timeouts, network errors
//                          that persisted after the allowed retries (backoff,
//                          Retry-After honoured): retry in a later run
//   - a publisher refusal is never circumvented: no agent spoofing, no proxies.
// `authorization` records an access arrangement granted by the publisher itself
// (a reference held in a GitHub Environment secret); only then robots.txt of
// that host is not consulted, and the reference is carried into the evidence.

import { USER_AGENT } from '../importer.mjs';
import { RobotsPolicy } from '../robots.mjs';

export class AcquireError extends Error {
  constructor(kind, message, extra = {}) {
    super(message);
    this.name = 'AcquireError';
    this.kind = kind;
    Object.assign(this, extra);
  }
}

const TRANSIENT = (status) => status === 408 || status === 425 || status === 429 || status >= 500;

export class PoliteClient {
  /** @type {{ reference: string } | null} */
  authorization = null;

  constructor({ minIntervalMs = 1000, maxRetries = 3, backoffMs = 2000, maxRetryAfterMs = 60_000, robots = new RobotsPolicy({ userAgent: USER_AGENT }),
    fetchImpl = globalThis.fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), now = () => Date.now(), authorization = null, userAgent = USER_AGENT } = {}) {
    this.authorization = authorization;
    Object.assign(this, { minIntervalMs, maxRetries, backoffMs, maxRetryAfterMs, robots, fetchImpl, sleep, now, authorization, userAgent });
    this.last = 0;
    this.chain = Promise.resolve();
    this.blocked = new Map();
    this.requests = 0;
  }

  /** Serial: calls queue behind each other. */
  get(url, options) {
    const run = this.chain.then(() => this.#get(url, options));
    this.chain = run.catch(() => undefined);
    return run;
  }

  async #pace() {
    const wait = this.last + this.minIntervalMs - this.now();
    if (wait > 0) await this.sleep(wait);
    this.last = this.now();
  }

  // robots.txt answered 5xx / was unreadable: RFC 9309 says assume disallow for now, but this is
  // TEMPORARY, not a ban, so it is retried (cache dropped) and reported as ROBOTS_UNAVAILABLE.
  async #admit(url) {
    for (let attempt = 0; ; attempt++) {
      try { await this.robots.admit(url); return; } catch (e) {
        const message = String(e.message);
        const temporary = /HTTP 5\d\d for robots\.txt|robots\.txt not readable/.test(message);
        if (!temporary) throw new AcquireError('ROBOTS_DISALLOWED', message.slice(0, 200));
        this.robots.hosts?.delete?.(new URL(url).origin);
        if (attempt >= this.maxRetries) throw new AcquireError('ROBOTS_UNAVAILABLE', `${message.slice(0, 160)} (temporary; persisted after ${attempt + 1} attempts, retry in a later run)`);
        await this.sleep(this.backoffMs * 2 ** attempt);
      }
    }
  }

  async #get(url, { accept = '*/*', maxBytes = 60 * 1024 * 1024, timeoutMs = 120_000 } = {}) {
    const u = new URL(url);
    if (u.protocol !== 'https:') throw new AcquireError('PERMANENT_HTTP', 'only HTTPS is fetched');
    if (this.blocked.has(u.host)) throw new AcquireError('CHALLENGE', `${u.host} is blocked for this run: ${this.blocked.get(u.host)}`);
    if (!this.authorization) await this.#admit(url);
    let lastReason = '';
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      await this.#pace();
      this.requests++;
      let res;
      try {
        res = await this.fetchImpl(url, { redirect: 'manual', signal: AbortSignal.timeout(timeoutMs), headers: { 'user-agent': this.userAgent, accept } });
      } catch (error) {
        lastReason = `network: ${error?.cause?.code || error?.name || 'error'}`;
        await this.sleep(this.backoffMs * 2 ** attempt);
        continue;
      }
      if (res.headers.get('x-amzn-waf-action')) {
        this.blocked.set(u.host, 'bot challenge');
        throw new AcquireError('CHALLENGE', `${u.host}: bot challenge, not circumvented`);
      }
      if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
        const next = new URL(res.headers.get('location'), url);
        if (next.protocol !== 'https:' || next.host !== u.host) throw new AcquireError('PERMANENT_HTTP', `redirect leaves ${u.host}`);
        return this.#get(next.toString(), { accept, maxBytes, timeoutMs });
      }
      if (res.ok) {
        const bytes = new Uint8Array(await res.arrayBuffer());
        if (bytes.length > maxBytes) throw new AcquireError('PERMANENT_HTTP', 'document larger than the limit');
        return { bytes, status: res.status, contentType: res.headers.get('content-type') || '', finalUrl: url, requests: this.requests, authorizationRef: this.authorization?.reference ?? null };
      }
      if (!TRANSIENT(res.status)) throw new AcquireError('PERMANENT_HTTP', `HTTP ${res.status}`, { status: res.status });
      lastReason = `HTTP ${res.status}`;
      const retryAfter = Number(res.headers.get('retry-after'));
      const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, this.maxRetryAfterMs) : this.backoffMs * 2 ** attempt;
      if (res.status === 429 && attempt === this.maxRetries) { this.blocked.set(u.host, 'rate limited'); throw new AcquireError('CHALLENGE', `${u.host}: rate limited (HTTP 429)`); }
      await this.sleep(wait);
    }
    throw new AcquireError('TRANSIENT_EXHAUSTED', `${u.host}: ${lastReason} persisted after ${this.maxRetries + 1} attempts; retry in a later run`, { reason: lastReason });
  }
}
