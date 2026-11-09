// Evidence that a connector really acquires a legal document from its official
// publisher: robots.txt-compliant GET, size cap, SHA-256, and a required text
// marker that proves the body is the law and not an application shell, error
// page or bot challenge. Reachability alone is never proof. No content is
// stored by a probe, only hash, size and metadata. Probing is not permission to
// import or republish: reuse terms are checked separately (legal-sources.mjs).

import { createHash } from 'node:crypto';
import { USER_AGENT } from './importer.mjs';
import { classifyHttp } from './acquire/outcomes.mjs';
import { RobotsPolicy } from './robots.mjs';

export const PROBE_MAX_BYTES = 40 * 1024 * 1024;

function textOf(bytes, contentType) {
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) return `ZIP:${zipNames(bytes).join(' ')}`;
  const cs = /charset=([\w-]+)/i.exec(contentType)?.[1] || 'utf-8';
  try { return new TextDecoder(cs).decode(bytes); } catch { return new TextDecoder('utf-8').decode(bytes); }
}

function zipNames(bytes) {
  const names = [];
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = 0; i + 30 < bytes.length && names.length < 20;) {
    if (dv.getUint32(i, true) !== 0x04034b50) break;
    const comp = dv.getUint32(i + 18, true); const nl = dv.getUint16(i + 26, true); const el = dv.getUint16(i + 28, true);
    names.push(new TextDecoder().decode(bytes.subarray(i + 30, i + 30 + nl)));
    if (!comp) break; // sizes in data descriptor: stop after the first name
    i += 30 + nl + el + comp;
  }
  return names;
}

/**
 * @param {{ id: string, url: string, markers: string[] }} probe
 * @returns {Promise<{ id: string, url: string, outcome: 'PROVEN'|'MARKER_MISSING'|'ROBOTS_REFUSED'|'HTTP_ERROR'|'UNREACHABLE', [k: string]: any }>}
 */
export async function runProbe(probe, { robots = new RobotsPolicy({ userAgent: USER_AGENT }), fetchImpl = globalThis.fetch, now = () => new Date() } = {}) {
  const base = { id: probe.id, url: probe.url, retrievedAt: now().toISOString() };
  try {
    let current = probe.url;
    for (let hop = 0; hop < 5; hop++) {
      try { await robots.admit(current); } catch (e) { const temporary = /HTTP 5\d\d for robots\.txt|robots\.txt not readable/.test(String(e.message)); return { ...base, outcome: 'ROBOTS_REFUSED', classification: temporary ? 'ROBOTS_UNAVAILABLE' : 'ROBOTS_DISALLOWED', reason: String(e.message).slice(0, 160) }; }
      const res = await fetchImpl(current, { redirect: 'manual', signal: AbortSignal.timeout(90_000), headers: { 'user-agent': USER_AGENT, accept: '*/*' } });
      if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
        const next = new URL(res.headers.get('location'), current);
        if (next.protocol !== 'https:' || next.hostname.replace(/^www\./, '') !== new URL(probe.url).hostname.replace(/^www\./, '')) return { ...base, outcome: 'HTTP_ERROR', reason: `redirect to ${next.hostname} not followed` };
        current = next.toString();
        continue;
      }
      if (!res.ok || classifyHttp(res.status, res.headers) === 'WAF_BLOCKED') return { ...base, outcome: 'HTTP_ERROR', classification: classifyHttp(res.status, res.headers), status: res.status };
      const buf = new Uint8Array(await res.arrayBuffer());
      if (buf.length > PROBE_MAX_BYTES) return { ...base, outcome: 'HTTP_ERROR', reason: 'larger than the probe limit' };
      const contentType = res.headers.get('content-type') || '';
      const text = textOf(buf, contentType).toLowerCase();
      const missing = probe.markers.filter((m) => !text.includes(m.toLowerCase()));
      const out = { ...base, classification: 'OK', finalUrl: current, status: res.status, contentType, bytes: buf.length, sha256: createHash('sha256').update(buf).digest('hex') };
      return missing.length ? { ...out, outcome: 'MARKER_MISSING', missing } : { ...out, outcome: 'PROVEN' };
    }
    return { ...base, outcome: 'HTTP_ERROR', reason: 'too many redirects' };
  } catch (error) {
    return { ...base, outcome: 'UNREACHABLE', classification: 'NETWORK_ERROR', reason: String(error?.cause?.code || error?.message || error).slice(0, 160) };
  }
}
