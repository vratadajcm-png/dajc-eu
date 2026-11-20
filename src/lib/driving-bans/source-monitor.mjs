// Automated official-source monitor for DAJC Driving Bans.
//
//   official source -> legal retrieval (safe fetch / official OGD mirror)
//   -> normalisation -> comparison with the human-reviewed evidence hash
//   -> classified result -> re-verification queue for the legal reviewer.
//
// The monitor is READ-ONLY with respect to the registry: it never edits
// data/driving-bans/canonical.json, never refreshes last_verified/last_checked,
// never extends a review window and never turns UNKNOWN into NO_BAN. A failed
// retrieval keeps the last reviewed data untouched (fail closed). Byte- or
// text-identical evidence is a precondition for a re-verification, not the
// re-verification itself: extending a rule's reviewed span stays a human/legal
// approval through the existing canonical PR gate.
import { createHash } from 'node:crypto';
import { assessEvidence } from './legal-changes.mjs';
import { MONITOR_DEFAULTS, hostPolicyFor } from '../../../config/driving-ban-sources/monitor-policy.mjs';

export const MONITOR_STATES = Object.freeze([
  'UNCHANGED',               // retrieved bytes equal the reviewed content_sha256
  'UNCHANGED_TEXT',          // page chrome changed, normalised legal text equals the reviewed baseline
  'CHANGED',                 // retrieved content differs from the reviewed evidence: legal review required
  'NO_BASELINE',             // retrieved, but no reviewed hash exists to compare with
  'SOURCE_UNAVAILABLE',      // network/HTTP failure; last reviewed data stays in force
  'ACCESS_BLOCKED',          // bot protection or provider block; never bypassed
  'DEFERRED_PROVIDER_TERMS', // provider terms forbid automated access right now
  'REJECTED',                // unsafe URL/host/content type
]);
const RETRIEVED = new Set(['UNCHANGED', 'UNCHANGED_TEXT', 'CHANGED', 'NO_BASELINE']);
const EVIDENCE_OK = new Set(['UNCHANGED', 'UNCHANGED_TEXT']);
const OGD_DOCUMENT = /https:\/\/ogd\.ris\.bka\.gv\.at\/Dokumente\/[A-Za-z]+\/[A-Z]{3}\d+\/[A-Z]{3}\d+\.(?:html|xml|pdf)/;

export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

const ENTITIES = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", sect: '§', ndash: '–', mdash: '—' };
// Bump when normalisation changes: text hashes of another version are never
// compared (the committed baseline and the previous run carry the version).
export const NORMALIZER_VERSION = 2;
// Shorter normalised text is not a reliable fingerprint of a legal document.
export const MIN_COMPARABLE_TEXT = 200;
const codePoint = (value, original) => (Number.isInteger(value) && value >= 0 && value <= 0x10ffff ? String.fromCodePoint(value) : original);
/**
 * Deterministic legal-text normalisation used only to ignore page chrome
 * (scripts, styles, comments, markup, whitespace). It never removes visible
 * element content (forms, headers and navigation may wrap the legal text),
 * never throws on malformed entities, and returns null when the remaining
 * text is too short to compare. PDFs are compared by bytes only.
 */
export function normalizeDocumentText(bytes, contentType = 'text/html') {
  if (!bytes || /pdf/i.test(contentType)) return null;
  let text = Buffer.from(bytes).toString('utf8');
  if (/html|xml/i.test(contentType)) {
    text = text
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<(script|style|noscript|template)\b[^>]*\/>/gi, ' ')
      .replace(/<(script|style|noscript|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&#(\d+);/g, (m, n) => codePoint(Number(n), m))
      .replace(/&#x([0-9a-f]+);/gi, (m, n) => codePoint(parseInt(n, 16), m))
      .replace(/&([a-z]+);/gi, (m, name) => ENTITIES[name.toLowerCase()] ?? m);
  }
  text = text.replace(/\s+/g, ' ').trim();
  return text.length >= MIN_COMPARABLE_TEXT ? text : null;
}

export function isBotChallenge(status, text = '') {
  if (Number(status) === 429) return true; // rate limited: back off, never retry around it
  return [401, 403, 405, 503].includes(Number(status)) && /security check|captcha|access denied|are you a robot|bot protection|cloudflare|ddos|forbidden/i.test(String(text).slice(0, 20000));
}

// Some providers answer automated clients with HTTP 200 and an interstitial
// (bot challenge or WAF rejection). Recorded as a retrieval, its hash would
// replace the last good fingerprint of the real document. Generic words count
// only in the document <head> title; the body needs a vendor challenge marker,
// so an official page that merely mentions "captcha" is never discarded.
const SOFT_BLOCK_TITLE = /just a moment|attention required|security check|checking your browser|are you a (?:robot|human)|captcha|bot protection|ddos protection|access denied|request (?:was )?rejected|request unsuccessful/i;
// Markers that appear only on interstitials. Cloudflare's challenge-platform
// beacon and Incapsula's resource script are injected into ordinary pages too
// (zakonyprolidi.cz, 20 Nov 2026) and are deliberately not markers.
const SOFT_BLOCK_BODY = /cf-browser-verification|cf_chl_opt|checking your browser before accessing|enable javascript and cookies to continue|ddos protection by|the requested url was rejected\. please consult with your administrator|request unsuccessful\. incapsula|attention required! \| cloudflare/i;
const MAX_INTERSTITIAL_TEXT = 1500;
const decodeBasic = (text) => text.replace(/&nbsp;|&#160;/gi, ' ').replace(/&amp;/gi, '&').replace(/&#(\d+);/g, (m, n) => { const c = Number(n); return c > 0 && c < 0x110000 ? String.fromCodePoint(c) : ' '; });
export function isSoftBlockPage(bytes, contentType = null) {
  if (!bytes) return false;
  const html = Buffer.from(bytes).subarray(0, 200000).toString('utf8');
  const looksHtml = /html/i.test(String(contentType || '')) || (!contentType && /^\s*(?:<!doctype html|<html|<head)/i.test(html.slice(0, 512)));
  if (!looksHtml) return false;
  const head = html.match(/<head\b[\s\S]*?<\/head>/i)?.[0] ?? html.split(/<body\b/i)[0];
  const title = decodeBasic(head.match(/<title[^>]*>([\s\S]{0,300}?)<\/title>/i)?.[1] ?? '').replace(/\s+/g, ' ');
  if (SOFT_BLOCK_TITLE.test(title)) return true;
  // A real document has substantial visible text; an interstitial does not.
  const visible = decodeBasic(html.replace(/<(script|style|template)\b[\s\S]*?<\/\1\s*>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
  if (visible.length > MAX_INTERSTITIAL_TEXT) return false;
  return SOFT_BLOCK_BODY.test(decodeBasic(html).replace(/\s+/g, ' '));
}

/** Which official URL the monitor may read for a canonical source, and how. */
export function resolveMonitorTarget(source, { hostPolicy = hostPolicyFor } = {}) {
  const ogd = String(source?.retrieval_method || '').match(OGD_DOCUMENT)?.[0];
  const url = ogd || source?.url;
  let parsed;
  try { parsed = new URL(url); } catch { return { connector: 'none', url: url ?? null, host: null, policy: null, blocked: { state: 'REJECTED', reason: 'Source URL is not a valid absolute URL' } }; }
  const connector = ogd ? 'ris-ogd-document' : 'official-http';
  const policy = hostPolicy(parsed.hostname);
  const blocked = policy?.state === 'ACCESS_BLOCKED' ? { state: 'ACCESS_BLOCKED', reason: policy.reason } : null;
  return { connector, url: parsed.href, host: parsed.hostname.toLowerCase(), policy, blocked };
}

function localParts(now, timezone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: timezone, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now).map((p) => [p.type, p.value]));
  return { weekday: parts.weekday, minutes: Number(parts.hour) * 60 + Number(parts.minute) };
}
const toMinutes = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };

/** True when the provider's published terms allow automated access at `now`. */
export function withinAllowedWindow(window, now) {
  if (!window) return true;
  const { weekday, minutes } = localParts(now, window.timezone);
  if (window.weekends && (weekday === 'Sat' || weekday === 'Sun')) return true;
  const from = toMinutes(window.weekdayFrom), to = toMinutes(window.weekdayTo);
  return from > to ? (minutes >= from || minutes < to) : (minutes >= from && minutes < to);
}

function sourceJurisdictions(canonical) {
  const map = new Map();
  const add = (id, code) => { if (!id || !code) return; if (!map.has(id)) map.set(id, new Set()); map.get(id).add(code); };
  for (const [code, review] of Object.entries(canonical.jurisdiction_reviews || {})) for (const id of review.source_ids || []) add(id, code);
  for (const rule of canonical.rules || []) for (const id of [rule.source_id, ...(rule.evidence_ids || [])]) add(id, rule.jurisdiction);
  for (const profile of Object.values(canonical.rule_profiles || {})) for (const id of [profile.source_id, ...(profile.evidence_ids || [])]) add(id, profile.jurisdiction);
  return map;
}

/**
 * Retrieve and classify every monitored official source. `fetcher(url)` must
 * resolve to safeFetch's result shape ({ ok, http_status, content_type, bytes,
 * availability, code }). Requests are strictly serial with per-host pacing.
 * @param {{ canonical: any, fetcher: (url: string) => Promise<any>, now?: () => Date, baseline?: Record<string, any>,
 *   previous?: any, roles?: readonly string[], only?: string[] | null, maxSources?: number,
 *   sleep?: (ms: number) => Promise<any>, hostPolicy?: (hostname: string) => any, defaultIntervalMs?: number }} options
 */
export async function monitorSources({
  canonical, fetcher, now = () => new Date(), baseline = {}, previous = null, roles = MONITOR_DEFAULTS.roles,
  only = null, maxSources = Infinity, sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  hostPolicy = hostPolicyFor, defaultIntervalMs = MONITOR_DEFAULTS.hostIntervalMs,
} = {}) {
  if (!canonical || !Array.isArray(canonical.sources)) throw new Error('Canonical dataset with sources is required');
  if (typeof fetcher !== 'function') throw new Error('A fetcher is required');
  const jurisdictionsOf = sourceJurisdictions(canonical);
  const wanted = only ? new Set(only) : null;
  const selected = canonical.sources
    .filter((source) => roles.includes(source.role))
    .filter((source) => !wanted || [...(jurisdictionsOf.get(source.source_id) || [])].some((code) => wanted.has(code)))
    .slice(0, maxSources);
  // The previous run (persisted on the automation/driving-bans-monitor data
  // branch) detects content changes between weekly runs even for dynamic pages
  // whose reviewed raw hash can never match again.
  const prior = new Map((previous?.results || []).filter((r) => r && typeof r.source_id === 'string').map((r) => [r.source_id, r]));
  // Last successfully retrieved fingerprint per source, carried through runs
  // where the source was unavailable, blocked or deferred.
  const lastGood = (id) => {
    const before = prior.get(id);
    if (!before) return null;
    if (before.raw_sha256) return { raw_sha256: before.raw_sha256, text_sha256: before.text_sha256 ?? null, url: before.url, checked_at: before.checked_at, normalizer_version: before.normalizer_version ?? 1 };
    return before.last_retrieved ?? null;
  };
  const lastRequest = new Map();
  const results = [];
  for (const source of selected) {
    const target = resolveMonitorTarget(source, { hostPolicy });
    const base = {
      source_id: source.source_id, jurisdictions: [...(jurisdictionsOf.get(source.source_id) || [])].sort(), role: source.role,
      authority: source.authority ?? null, connector: target.connector, url: target.url,
      reviewed_sha256: source.content_sha256 ?? null, reviewed_at: source.checked_at ?? null, licence: target.policy?.licence ?? null,
    };
    const checkedAt = now().toISOString();
    const carried = { last_retrieved: lastGood(source.source_id) };
    if (target.blocked) { results.push({ ...base, ...carried, state: target.blocked.state, reason: target.blocked.reason, checked_at: checkedAt }); continue; }
    if (target.policy?.allowedWindow && !withinAllowedWindow(target.policy.allowedWindow, now())) {
      results.push({ ...base, ...carried, state: 'DEFERRED_PROVIDER_TERMS', reason: `Provider terms allow automated access only ${target.policy.allowedWindow.weekdayFrom}-${target.policy.allowedWindow.weekdayTo} ${target.policy.allowedWindow.timezone} on weekdays${target.policy.allowedWindow.weekends ? ' or at weekends' : ''}.`, checked_at: checkedAt });
      continue;
    }
    const interval = target.policy?.hostIntervalMs ?? defaultIntervalMs;
    const wait = (lastRequest.get(target.host) ?? -Infinity) + interval - Date.now();
    if (wait > 0) await sleep(wait);
    lastRequest.set(target.host, Date.now());
    let response;
    try { response = await fetcher(target.url); } catch (error) { response = { ok: false, availability: 'SOURCE_UNAVAILABLE', code: 'FETCH_ERROR', message: String(error?.message || error) }; }
    if (!response?.ok) {
      const text = response?.bytes ? Buffer.from(response.bytes).toString('utf8') : (response?.snippet || response?.message || '');
      const state = isBotChallenge(response?.http_status, text) || (response?.http_status === 403) ? 'ACCESS_BLOCKED'
        : response?.availability === 'REJECTED' ? 'REJECTED' : 'SOURCE_UNAVAILABLE';
      results.push({ ...base, ...carried, state, http_status: response?.http_status ?? null, reason: response?.code || response?.message || 'Retrieval failed', checked_at: checkedAt });
      continue;
    }
    const rawSha = sha256(response.bytes);
    // A soft block is an outage, never a new document version: the last good
    // fingerprint is carried forward unchanged. Reviewed bytes are always kept.
    // Bytes equal to the reviewed or the last good fingerprint are the document itself.
    const lastGoodRaw = carried.last_retrieved && carried.last_retrieved.url === target.url ? carried.last_retrieved.raw_sha256 : null;
    if (rawSha !== source.content_sha256 && rawSha !== lastGoodRaw && isSoftBlockPage(response.bytes, response.content_type)) {
      results.push({ ...base, ...carried, state: 'ACCESS_BLOCKED', http_status: response.http_status ?? 200,
        reason: 'HTTP 200 interstitial (bot challenge or WAF rejection) instead of the document; never bypassed', checked_at: checkedAt });
      continue;
    }
    let text = null;
    try { text = normalizeDocumentText(response.bytes, response.content_type); } catch { text = null; } // never let one page stop the run
    const textSha = text === null ? null : sha256(text);
    const reviewedText = baseline?.[source.source_id];
    // A text baseline only counts when it vouches for the same reviewed bytes
    // and was produced by the same normaliser.
    const textBaseline = reviewedText && reviewedText.raw_sha256 === source.content_sha256 && (reviewedText.normalizer_version ?? 1) === NORMALIZER_VERSION ? reviewedText.text_sha256 : null;
    let state;
    if (source.content_sha256 && rawSha === source.content_sha256) state = 'UNCHANGED';
    else if (textBaseline && textSha && textSha === textBaseline) state = 'UNCHANGED_TEXT';
    else if (!source.content_sha256) state = 'NO_BASELINE';
    else state = 'CHANGED';
    // Compare with the last good fingerprint of the SAME document only.
    const before = carried.last_retrieved && carried.last_retrieved.url === target.url ? carried.last_retrieved : null;
    const textComparable = textSha && before?.text_sha256 && (before.normalizer_version ?? 1) === NORMALIZER_VERSION;
    const comparable = before?.raw_sha256 ? (textComparable ? [textSha, before.text_sha256] : [rawSha, before.raw_sha256]) : null;
    const sinceLastRun = !comparable ? 'FIRST_RUN' : comparable[0] === comparable[1] ? 'STABLE' : 'CHANGED_SINCE_LAST_RUN';
    results.push({ ...base, state, since_last_run: sinceLastRun, previous_checked_at: before?.checked_at ?? null,
      http_status: response.http_status ?? 200, content_type: response.content_type ?? null, final_url: response.final_url ?? target.url,
      raw_sha256: rawSha, text_sha256: textSha, normalizer_version: NORMALIZER_VERSION, byte_length: response.bytes.length, checked_at: checkedAt });
  }
  return summarizeMonitor(results, { canonical, generatedAt: now().toISOString() });
}

export function summarizeMonitor(results, { canonical, generatedAt }) {
  const byState = Object.fromEntries(MONITOR_STATES.map((state) => [state, results.filter((r) => r.state === state).length]));
  const attempted = results.filter((r) => !['DEFERRED_PROVIDER_TERMS'].includes(r.state));
  const retrieved = attempted.filter((r) => RETRIEVED.has(r.state));
  const changedSinceLastRun = results.filter((r) => r.since_last_run === 'CHANGED_SINCE_LAST_RUN').length;
  const jurisdictions = {};
  for (const r of results) for (const code of r.jurisdictions.length ? r.jurisdictions : ['UNMAPPED']) {
    jurisdictions[code] ||= { sources: 0, retrieved: 0, evidence_unchanged: 0, changed: 0, unavailable: 0 };
    const row = jurisdictions[code];
    row.sources++; if (RETRIEVED.has(r.state)) row.retrieved++; if (EVIDENCE_OK.has(r.state)) row.evidence_unchanged++;
    if (r.state === 'CHANGED') row.changed++; if (!RETRIEVED.has(r.state)) row.unavailable++;
  }
  return {
    schema_version: 1, generated_at: generatedAt, dataset_version: canonical?.dataset_version ?? null,
    note: 'Automated retrieval and comparison only. Not a legal verification; never refreshes last_verified, reviewed spans or NO_BAN.',
    summary: { sources: results.length, attempted: attempted.length, retrieved: retrieved.length,
      success_rate: attempted.length ? Math.round((retrieved.length / attempted.length) * 1000) / 1000 : null, by_state: byState,
      changed_since_last_run: changedSinceLastRun },
    jurisdictions, results,
  };
}

/**
 * Re-verification queue from the current evidence findings and a monitor run.
 * Each item states what a legal reviewer may do next; nothing is applied.
 */
export function buildReverificationQueue({ canonical, report, now = new Date() }) {
  const bySource = new Map((report?.results || []).map((r) => [r.source_id, r]));
  const queue = [];
  const expired = assessEvidence(canonical, { now });
  for (const item of expired) {
    if (!item.ban_id) {
      queue.push({ kind: 'DATASET_WINDOW_EXPIRED', jurisdiction: null, ban_id: null, sources: [], action: 'Full Thursday sweep must re-verify every jurisdiction for the active rolling window before the dataset window may be extended.', detail: item.reason });
      continue;
    }
    const states = item.sources.map((id) => ({ source_id: id, state: bySource.get(id)?.state ?? 'NOT_MONITORED' }));
    const changed = states.filter((s) => s.state === 'CHANGED');
    const notOk = states.filter((s) => !EVIDENCE_OK.has(s.state));
    const kind = changed.length ? 'SOURCE_CHANGED_LEGAL_REVIEW_REQUIRED'
      : states.length && !notOk.length ? 'EVIDENCE_UNCHANGED_READY_FOR_LEGAL_REVIEW'
        : 'EVIDENCE_NOT_REFRESHABLE';
    const action = {
      SOURCE_CHANGED_LEGAL_REVIEW_REQUIRED: 'The reviewed instrument changed. Re-read it, record the new version/hash and update or cancel the rule before any extension.',
      EVIDENCE_UNCHANGED_READY_FOR_LEGAL_REVIEW: 'The reviewed instrument is unchanged. A legal reviewer must still confirm it governs the whole active window (incl. not-yet-promulgated annual calendars) before extending review_window.',
      EVIDENCE_NOT_REFRESHABLE: 'Evidence could not be retrieved or compared automatically; manual primary-source review required. Last reviewed data remains, shown only within its reviewed span.',
    }[kind];
    queue.push({ kind, jurisdiction: item.jurisdiction, ban_id: item.ban_id, reviewed_until: item.before?.to ?? null, sources: states, action });
  }
  // Legal change detection beyond expired evidence: any changed primary
  // instrument puts every rule/jurisdiction that relies on it under review.
  const seen = new Set(queue.map((q) => `${q.kind}:${q.ban_id}`));
  for (const result of report?.results || []) {
    if (result.state !== 'CHANGED') continue;
    for (const rule of canonical.rules || []) {
      if (![rule.source_id, ...(rule.evidence_ids || [])].includes(result.source_id) || rule.status === 'SUPERSEDED' || rule.status === 'CANCELLED') continue;
      const key = `SOURCE_CHANGED_LEGAL_REVIEW_REQUIRED:${rule.ban_id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      queue.push({ kind: 'SOURCE_CHANGED_LEGAL_REVIEW_REQUIRED', jurisdiction: rule.jurisdiction, ban_id: rule.ban_id, sources: [{ source_id: result.source_id, state: 'CHANGED' }], action: 'Primary source content differs from the reviewed version; confirm whether dates, weights, regions or exceptions changed.' });
    }
  }
  for (const result of report?.results || []) {
    if (result.since_last_run !== 'CHANGED_SINCE_LAST_RUN') continue;
    queue.push({ kind: 'SOURCE_CONTENT_CHANGED_SINCE_LAST_RUN', jurisdiction: result.jurisdictions.join(',') || null, ban_id: null,
      sources: [{ source_id: result.source_id, state: result.state }],
      action: `Official document text changed since the run of ${result.previous_checked_at}; check for a new instrument, amendment, cancellation or changed dates/weights/exceptions.` });
  }
  return {
    generated_at: now.toISOString(), expired_evidence: expired.length,
    note: 'expired_evidence decreases only after a reviewed canonical change extends review windows with actual primary-source verification.',
    counts: Object.fromEntries([...new Set(queue.map((q) => q.kind))].map((kind) => [kind, queue.filter((q) => q.kind === kind).length])),
    items: queue,
  };
}

/**
 * Hosts the monitor may fetch: only human-reviewed PRIMARY (official) source
 * hosts plus configured authority domains and mirrors. Secondary hosts are
 * excluded so a redirect cannot turn press/aggregator content into evidence.
 */
export function monitorAllowedHosts(canonical, extraDomains = []) {
  const hosts = (canonical?.sources || []).filter((source) => source.role === 'PRIMARY')
    .map((source) => { try { return new URL(source.url).hostname; } catch { return null; } }).filter(Boolean);
  return [...new Set([...hosts, ...extraDomains])];
}

/** Text baseline entries a reviewer may commit: only sources whose fetched bytes equal the reviewed hash. */
export function verifiedTextBaseline(report) {
  return Object.fromEntries((report?.results || [])
    .filter((r) => r.state === 'UNCHANGED' && r.text_sha256 && r.reviewed_sha256 === r.raw_sha256)
    .map((r) => [r.source_id, { raw_sha256: r.raw_sha256, text_sha256: r.text_sha256, normalizer_version: r.normalizer_version ?? NORMALIZER_VERSION, captured_at: r.checked_at, url: r.url }]));
}

export function monitorMarkdown(report, queue) {
  const s = report.summary;
  const lines = [
    '### Driving Bans official-source monitor', '',
    `Dataset ${report.dataset_version} · ${s.sources} official sources · retrieved ${s.retrieved}/${s.attempted} (success rate ${s.success_rate ?? 'n/a'}) · changed since last run: ${s.changed_since_last_run ?? 0}`, '',
    '| State | Count |', '|---|---|', ...Object.entries(s.by_state).filter(([, n]) => n).map(([state, n]) => `| ${state} | ${n} |`), '',
    `Expired evidence (unchanged by this run): **${queue.expired_evidence}**`, '',
    '| Queue item | Count |', '|---|---|', ...Object.entries(queue.counts).map(([kind, n]) => `| ${kind} | ${n} |`), '',
  ];
  const changed = report.results.filter((r) => r.state === 'CHANGED');
  if (changed.length) lines.push('**Changed primary sources (legal review required):**', ...changed.map((r) => `- ${r.source_id} (${r.jurisdictions.join(', ')}): ${r.url}`), '');
  const blocked = report.results.filter((r) => ['ACCESS_BLOCKED', 'SOURCE_UNAVAILABLE', 'REJECTED', 'DEFERRED_PROVIDER_TERMS'].includes(r.state));
  if (blocked.length) lines.push('**Not retrieved (last reviewed data kept):**', ...blocked.map((r) => `- ${r.source_id}: ${r.state} — ${r.reason ?? r.http_status ?? ''}`), '');
  lines.push(report.note);
  return lines.join('\n');
}
