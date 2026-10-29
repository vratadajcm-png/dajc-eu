import { createHash } from 'node:crypto';
import { lookup as dnsLookup } from 'node:dns/promises';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';

/**
 * SSRF-safe retrieval of official documents for Driving Bans research.
 * - https only, port 443, no credentials in the URL, host on the allowlist
 *   (official authority domains and registry sources of the jurisdiction);
 * - every resolved address must be public; the connection is pinned to the
 *   validated address, so DNS rebinding cannot swap it afterwards;
 * - redirects are followed manually and each hop is checked again;
 * - size is capped while streaming; content type and magic bytes are checked.
 * Nothing fetched is executed or interpreted here.
 */

export const FETCH_LIMITS = Object.freeze({ maxBytes: 15_000_000, timeoutMs: 25_000, maxRedirects: 3 });
export const ALLOWED_CONTENT_TYPES = Object.freeze({
  'text/html': 'HTML_SNAPSHOT', 'application/xhtml+xml': 'HTML_SNAPSHOT', 'application/pdf': 'PDF',
  'application/json': 'JSON_DATA', 'application/xml': 'XML_DATA', 'text/xml': 'XML_DATA',
  'application/atom+xml': 'XML_DATA', 'application/rss+xml': 'XML_DATA', 'text/plain': 'TEXT_EXCERPT',
});

export class FetchRejected extends Error {
  constructor(code, message) { super(message); this.name = 'FetchRejected'; this.code = code; }
}

const v4 = address => address.split('.').map(Number);
const inV4 = (address, base, bits) => {
  const [a, b] = [v4(address), v4(base)];
  const value = x => ((x[0] << 24) >>> 0) + (x[1] << 16) + (x[2] << 8) + x[3];
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (value(a) & mask) === (value(b) & mask);
};
const PRIVATE_V4 = [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4]];

/** Eight 16-bit groups of an IPv6 address (zone id ignored, embedded IPv4 tail converted). */
function expandV6(address) {
  let text = address.toLowerCase().replace(/%.*$/, '');
  const tail = /(\d+\.\d+\.\d+\.\d+)$/.exec(text);
  if (tail) { const [a, b, c, d] = v4(tail[1]); text = `${text.slice(0, -tail[1].length)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`; }
  const [head, rest] = text.split('::');
  const h = head ? head.split(':') : [];
  if (rest === undefined) return h.map(group => parseInt(group, 16));
  const t = rest ? rest.split(':') : [];
  return [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill('0'), ...t].map(group => parseInt(group, 16));
}

/** True only for globally routable unicast addresses. */
export function isPublicAddress(address) {
  const family = isIP(address);
  if (family === 4) return !PRIVATE_V4.some(([base, bits]) => inV4(address, base, bits));
  if (family !== 6) return false;
  const g = expandV6(address);
  if (g.length !== 8 || g.some(x => !Number.isInteger(x))) return false;
  if (g.every(x => x === 0) || (g.slice(0, 7).every(x => x === 0) && g[7] === 1)) return false; // :: and ::1
  if ((g[0] & 0xfe00) === 0xfc00 || (g[0] & 0xffc0) === 0xfe80 || (g[0] & 0xff00) === 0xff00) return false; // ULA, link-local, multicast
  if (g[0] === 0x2001 && g[1] === 0x0db8) return false; // documentation
  if (g[0] === 0x0100 && g[1] === 0 && g[2] === 0 && g[3] === 0) return false; // discard-only
  // IPv4-mapped, IPv4-compatible and NAT64 addresses are judged by the embedded IPv4 address.
  const embedded = `${g[6] >> 8}.${g[6] & 255}.${g[7] >> 8}.${g[7] & 255}`;
  if (g.slice(0, 5).every(x => x === 0) && (g[5] === 0xffff || g[5] === 0)) return isPublicAddress(embedded);
  if (g[0] === 0x0064 && g[1] === 0xff9b) return isPublicAddress(embedded);
  return (g[0] & 0xe000) === 0x2000; // global unicast 2000::/3
}

/** Host equals an allowed domain or is one of its subdomains. */
export function hostAllowed(hostname, allowedHosts) {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  return allowedHosts.some(domain => { const d = domain.toLowerCase().replace(/^www\./, ''); return host === d || host === `www.${d}` || host.endsWith(`.${d}`); });
}

export function checkUrl(raw, allowedHosts) {
  let url;
  try { url = new URL(raw); } catch { throw new FetchRejected('INVALID_URL', 'Not a URL'); }
  if (url.protocol !== 'https:') throw new FetchRejected('NOT_HTTPS', `Only https is fetched: ${url.protocol}`);
  if (url.username || url.password) throw new FetchRejected('CREDENTIALS_IN_URL', 'Credentials in URL');
  if (url.port && url.port !== '443') throw new FetchRejected('PORT_NOT_ALLOWED', `Port ${url.port} is not allowed`);
  if (isIP(url.hostname.replace(/^\[|\]$/g, ''))) throw new FetchRejected('IP_LITERAL', 'IP literals are never fetched');
  if (!hostAllowed(url.hostname, allowedHosts)) throw new FetchRejected('HOST_NOT_ALLOWED', `${url.hostname} is not an allowed official host`);
  return url;
}

async function resolvePublic(hostname, resolve) {
  let addresses;
  try { addresses = await resolve(hostname); } catch { throw new FetchRejected('DNS_FAILED', `Cannot resolve ${hostname}`); }
  if (!addresses.length) throw new FetchRejected('DNS_FAILED', `No address for ${hostname}`);
  // Every answer must be public, so a mixed answer cannot be used to reach an internal host.
  const bad = addresses.find(entry => !isPublicAddress(entry.address));
  if (bad) throw new FetchRejected('PRIVATE_ADDRESS', `${hostname} resolves to a non-public address`);
  return addresses[0];
}

export const systemResolve = hostname => dnsLookup(hostname, { all: true, verbatim: true });

/** node:https GET pinned to a validated address; streams with a byte cap. */
export function httpsTransport(url, { address, family, timeoutMs, maxBytes, headers }) {
  return new Promise((resolvePromise, reject) => {
    const req = httpsRequest({
      protocol: 'https:', hostname: url.hostname, port: 443, path: `${url.pathname}${url.search}`, method: 'GET', headers, timeout: timeoutMs,
      lookup: (_host, options, callback) => options?.all ? callback(null, [{ address, family }]) : callback(null, address, family),
    }, res => {
      const chunks = []; let size = 0;
      res.on('data', chunk => {
        size += chunk.length;
        if (size > maxBytes) { req.destroy(new FetchRejected('TOO_LARGE', `Response exceeds ${maxBytes} bytes`)); return; }
        chunks.push(chunk);
      });
      res.on('end', () => resolvePromise({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new FetchRejected('TIMEOUT', 'Request timed out')));
    req.on('error', reject);
    req.end();
  });
}

const header = (headers, name) => { const value = headers?.[name] ?? headers?.[name.toLowerCase()]; return Array.isArray(value) ? value[0] : value ?? null; };

/**
 * Fetch one document. Returns { ok: true, ... } with bytes and SHA-256, or
 * { ok: false, availability: 'SOURCE_UNAVAILABLE' | 'REJECTED', code }.
 * An unavailable source is reported as such and never means a cancelled ban.
 */
export async function safeFetch(rawUrl, { allowedHosts, resolve = systemResolve, transport = httpsTransport, clock = () => new Date(), limits = FETCH_LIMITS } = {}) {
  const redirects = [];
  let current;
  try { current = checkUrl(rawUrl, allowedHosts); } catch (error) { return { ok: false, url: rawUrl, availability: 'REJECTED', code: error.code, message: error.message }; }
  for (let hop = 0; hop <= limits.maxRedirects; hop++) {
    let response;
    try {
      const { address, family } = await resolvePublic(current.hostname, resolve);
      response = await transport(current, { address, family, timeoutMs: limits.timeoutMs, maxBytes: limits.maxBytes, headers: { 'user-agent': 'DAJC-DrivingBans-Research/1.0 (+https://www.dajc.eu/driving-bans)', accept: Object.keys(ALLOWED_CONTENT_TYPES).join(', ') } });
    } catch (error) {
      const code = error instanceof FetchRejected ? error.code : 'NETWORK_ERROR';
      return { ok: false, url: rawUrl, final_url: current.href, availability: ['PRIVATE_ADDRESS', 'TOO_LARGE'].includes(code) ? 'REJECTED' : 'SOURCE_UNAVAILABLE', code, message: error instanceof FetchRejected ? error.message : 'Network error', redirects };
    }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = header(response.headers, 'location');
      if (!location || hop === limits.maxRedirects) return { ok: false, url: rawUrl, final_url: current.href, availability: 'SOURCE_UNAVAILABLE', code: 'REDIRECT_LIMIT', http_status: response.status, redirects };
      try { current = checkUrl(new URL(location, current).href, allowedHosts); } catch (error) { return { ok: false, url: rawUrl, final_url: current.href, availability: 'REJECTED', code: error.code, message: error.message, redirects }; }
      redirects.push(current.href);
      continue;
    }
    if (response.status !== 200) return { ok: false, url: rawUrl, final_url: current.href, availability: 'SOURCE_UNAVAILABLE', code: 'HTTP_STATUS', http_status: response.status, redirects };
    const contentType = String(header(response.headers, 'content-type') || '').split(';')[0].trim().toLowerCase();
    const kind = ALLOWED_CONTENT_TYPES[contentType];
    if (!kind) return { ok: false, url: rawUrl, final_url: current.href, availability: 'REJECTED', code: 'CONTENT_TYPE_NOT_ALLOWED', message: `Content type ${contentType || 'missing'} is not processed`, redirects };
    const body = response.body;
    if (kind === 'PDF' && body.subarray(0, 5).toString('latin1') !== '%PDF-') return { ok: false, url: rawUrl, final_url: current.href, availability: 'REJECTED', code: 'NOT_A_PDF', message: 'Declared PDF without PDF signature', redirects };
    if (kind !== 'PDF' && body.includes(0)) return { ok: false, url: rawUrl, final_url: current.href, availability: 'REJECTED', code: 'BINARY_TEXT', message: 'Text document contains NUL bytes', redirects };
    return {
      ok: true, url: rawUrl, final_url: current.href, http_status: 200, availability: 'REACHABLE', content_type: contentType, kind, bytes: body,
      byte_length: body.length, sha256: createHash('sha256').update(body).digest('hex'), retrieved_at: clock().toISOString(),
      last_modified: header(response.headers, 'last-modified'), etag: header(response.headers, 'etag'), content_language: header(response.headers, 'content-language'),
      charset: /charset=([^;]+)/i.exec(String(header(response.headers, 'content-type') || ''))?.[1]?.trim().toLowerCase() ?? null, redirects,
    };
  }
  return { ok: false, url: rawUrl, availability: 'SOURCE_UNAVAILABLE', code: 'REDIRECT_LIMIT', redirects };
}
