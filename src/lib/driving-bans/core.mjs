/** Pure canonical Driving Bans engine. No network, no guessed prohibitions. */
export const VERIFICATION_STATES = ['PRIMARY_VERIFIED', 'CROSSCHECKED', 'UNVERIFIED', 'SOURCE_UNAVAILABLE'];
export const BAN_STATES = ['HAS_BAN', 'NO_BAN', 'UNKNOWN'];
export const SCOPE_CHECKS = ['weekend', 'holidays', 'holiday_eves', 'seasonal', 'summer_winter', 'regional', 'corridors', 'directional', 'night', 'weight_specific', 'special_calendar', 'exceptional'];
const DAY = 86400000;
const assert = (condition, message) => { if (!condition) throw new Error(message); };
export function isDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}
export function shiftDate(date, days) {
  assert(isDate(date) && Number.isInteger(days), 'Invalid date arithmetic');
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);
}
export function publicationWindow(now = new Date()) {
  assert(Number.isFinite(now.getTime()), 'Invalid publication clock');
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Prague', year: 'numeric', month: '2-digit' }).formatToParts(now).map(p => [p.type, p.value]));
  const year = Number(parts.year), month = Number(parts.month);
  return { from: `${parts.year}-${parts.month}-01`, to: new Date(Date.UTC(year, month + 1, 0)).toISOString().slice(0, 10), timezone: 'Europe/Prague' };
}
export function validTimezone(value) {
  if (typeof value !== 'string' || !value.includes('/')) return false;
  try { new Intl.DateTimeFormat('en', { timeZone: value }); return true; } catch { return false; }
}
const formatters = new Map();
function localParts(ms, timezone) {
  if (!formatters.has(timezone)) formatters.set(timezone, new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }));
  const values = Object.fromEntries(formatters.get(timezone).formatToParts(new Date(ms)).map(p => [p.type, p.value]));
  return `${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}:${values.second}`;
}
/** Reject nonexistent/ambiguous local times unless the evidence specifies a fold. */
const utcCache = new Map();
export function localToUtc(date, time, timezone, disambiguation = 'reject') {
  const key = `${date}|${time}|${timezone}|${disambiguation}`;
  if (!utcCache.has(key)) utcCache.set(key, resolveLocal(date, time, timezone, disambiguation));
  return utcCache.get(key);
}
function resolveLocal(date, time, timezone, disambiguation) {
  assert(isDate(date) && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time), 'Invalid local date/time');
  assert(validTimezone(timezone), `Invalid timezone ${timezone}`);
  const target = `${date}T${time}:00`;
  const naive = Date.parse(`${target}Z`);
  const matches = new Set();
  for (let h = -36; h <= 36; h += 6) {
    const sample = naive + h * 3600000;
    const offset = Date.parse(`${localParts(sample, timezone)}Z`) - sample;
    const candidate = naive - offset;
    if (localParts(candidate, timezone) === target) matches.add(candidate);
  }
  const candidates = [...matches].sort((a, b) => a - b);
  assert(candidates.length, `Nonexistent local time ${target} ${timezone}`);
  assert(candidates.length === 1 || ['earlier', 'later'].includes(disambiguation), `Ambiguous local time ${target} ${timezone}`);
  return new Date(disambiguation === 'later' ? candidates.at(-1) : candidates[0]).toISOString();
}
const validUrl = value => { try { const u = new URL(value); return u.protocol === 'https:' && !!u.hostname && !/[\r\n]/.test(value); } catch { return false; } };
const validInstant = value => typeof value === 'string' && /T.*Z$/.test(value) && Number.isFinite(Date.parse(value));
/** Exact legal applicability: any_of / all_of groups; numeric leaves in kg, m or axles; `any` marks a category with no mass threshold. Never invent a number. */
export const validWeight = w => !!w && typeof w === 'object' && (Array.isArray(w.any_of) || Array.isArray(w.all_of)
  ? (w.any_of || w.all_of).length > 0 && (w.any_of || w.all_of).every(validWeight) && !(w.any_of && w.all_of)
  : typeof w.applies_to === 'string' && w.applies_to.length > 0 && (w.operator === 'any'
    ? w.value === undefined
    : ['>','>=','<','<=','='].includes(w.operator) && Number.isFinite(w.value) && w.value > 0 && ['kg','m','axles'].includes(w.unit)));
export const includesWindow = (a, b) => isDate(a?.from) && isDate(a?.to) && a.from <= b.from && a.to >= b.to;
/** Missing reviews explicitly materialize as UNKNOWN/UNVERIFIED, never NO_BAN. */
export function hydrateCanonical(raw, identities) {
  const reviews = raw.jurisdiction_reviews || {};
  assert(Object.keys(reviews).every(code => identities.some(([c]) => c === code)), 'Unknown review identity');
  const rules = raw.rules.map(rule => {
    const profile = raw.rule_profiles?.[rule.profile];
    assert(!rule.profile || profile, `Unknown rule profile ${rule.profile}`);
    const value = { ...(profile || {}), ...rule };
    const source = raw.sources.find(s => s.source_id === value.source_id);
    assert(source, `Unknown rule source ${value.source_id}`);
    return { ...value, source_url: source.url, source_authority: source.authority, source_version: value.source_version || source.version };
  });
  return { ...raw, rules, jurisdictions: identities.map(([code, name]) => ({
    verification_state: 'UNVERIFIED', ban_state: 'UNKNOWN', coverage_complete: false,
    last_checked: null, last_verified: null, source_ids: [], no_ban_evidence: [],
    coverage_failures: ['FULL_SCOPE_PRIMARY_REVIEW_NOT_COMPLETED'],
    scope_checks: Object.fromEntries(SCOPE_CHECKS.map(key => [key, {state: 'UNVERIFIED', evidence_ids: []}])),
    ...(reviews[code] || {}),
    jurisdiction: code, name, period: {from: raw.window.from, to: raw.window.to}
  })) };
}
export function validateCanonical(data, identities) {
  assert(data.schema_version === 1, 'Unsupported canonical schema');
  assert(isDate(data.window?.from) && isDate(data.window?.to) && data.window.from <= data.window.to, 'Invalid canonical window');
  assert(identities.length > 0 && new Set(identities.map(r => r[0])).size === identities.length, 'Authoritative scope identities must be unique');
  assert(data.jurisdictions.length === identities.length, 'Exactly one jurisdiction record per scope identity required');
  const expected = new Map(identities), seen = new Set();
  const sources = new Map(data.sources.map(s => [s.source_id, s]));
  assert(sources.size === data.sources.length, 'Duplicate source identity');
  for (const s of data.sources) assert(validUrl(s.url) && s.authority && ['PRIMARY','SECONDARY'].includes(s.role), `Invalid source ${s.source_id}`);
  const ruleIds = new Set();
  assert(Array.isArray(data.rules), 'Rules must be an array');
  for (const rule of data.rules) {
    assert(typeof rule.ban_id === 'string' && /^[a-z0-9][a-z0-9_-]+$/.test(rule.ban_id), 'Invalid ban identity');
    assert(!ruleIds.has(rule.ban_id), `Duplicate ban identity ${rule.ban_id}`); ruleIds.add(rule.ban_id);
    assert(expected.has(rule.jurisdiction), `Untracked jurisdiction ${rule.jurisdiction}`);
    assert(VERIFICATION_STATES.includes(rule.verification_state), 'Invalid rule verification state');
    assert(['ACTIVE','CANCELLED','SUPERSEDED'].includes(rule.status), 'Invalid rule lifecycle');
    assert(isDate(rule.valid_from) && isDate(rule.valid_to) && rule.valid_from <= rule.valid_to, `Invalid rule period ${rule.ban_id}`);
    assert(validTimezone(rule.timezone), `Invalid timezone ${rule.ban_id}`);
    assert(validUrl(rule.source_url) && rule.source_authority && rule.source_version, `Missing provenance ${rule.ban_id}`);
    assert(rule.vehicle_scope && validWeight(rule.weight_threshold) && rule.exceptional_relevance && Array.isArray(rule.exceptions) && Array.isArray(rule.roads) && Array.isArray(rule.regions) && Array.isArray(rule.supersedes), `Missing scope ${rule.ban_id}`);
    assert(Number.isInteger(rule.sequence) && rule.sequence >= 0, `Missing revision sequence ${rule.ban_id}`);
    if (['PRIMARY_VERIFIED','CROSSCHECKED'].includes(rule.verification_state)) {
      assert(validInstant(rule.verified_at) && isDate(rule.review_window?.from) && isDate(rule.review_window?.to) && rule.review_window.from <= rule.review_window.to, `Rule evidence does not cover its published validity ${rule.ban_id}`);
      assert(rule.evidence_ids.length && rule.evidence_ids.every(id => sources.has(id)), `Missing source evidence ${rule.ban_id}`);
      if (rule.verification_state === 'PRIMARY_VERIFIED') assert(rule.evidence_ids.some(id => sources.get(id).role === 'PRIMARY' && sources.get(id).url === rule.source_url), `No primary source ${rule.ban_id}`);
    }
    const schedule = rule.schedule;
    assert(['daily','weekly','dates'].includes(schedule?.kind), `Unsupported recurrence ${rule.ban_id}`);
    assert(/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(schedule.start_time) && /^(?:(?:[01]\d|2[0-3]):[0-5]\d|24:00)$/.test(schedule.end_time), `Invalid times ${rule.ban_id}`);
    assert(Number.isInteger(schedule.end_day_offset) && schedule.end_day_offset >= 0 && schedule.end_day_offset <= 7, 'Invalid end-day offset');
    assert((schedule.excluded_dates || []).every(isDate), 'Invalid excluded date');
    assert(Array.isArray(rule.restriction_types) && rule.restriction_types.length > 0 && rule.restriction_types.every(t => ['general','exceptional'].includes(t)), 'Invalid restriction types');
    if (schedule.kind === 'weekly') assert(schedule.weekdays?.length && new Set(schedule.weekdays).size === schedule.weekdays.length && schedule.weekdays.every(n => Number.isInteger(n) && n >= 0 && n <= 6), 'Invalid weekdays');
    if (schedule.kind === 'dates') assert(schedule.dates?.length && new Set(schedule.dates.map(d => d.occurrence_id)).size === schedule.dates.length && schedule.dates.every(d => isDate(d.date) && /^[a-zA-Z0-9_-]+$/.test(d.occurrence_id)), 'Invalid dated occurrences');
  }
  for (const rule of data.rules) assert(rule.supersedes.every(id => ruleIds.has(id) && id !== rule.ban_id), 'Dangling supersession');
  const visit = (id, trail = new Set()) => {
    assert(!trail.has(id), 'Cyclic supersession');
    const next = new Set([...trail, id]);
    for (const parent of data.rules.find(r => r.ban_id === id).supersedes) visit(parent, next);
  };
  for (const id of ruleIds) visit(id);
  for (const row of data.jurisdictions) {
    assert(expected.get(row.jurisdiction) === row.name && !seen.has(row.jurisdiction), `Duplicate or changed Coverage identity ${row.jurisdiction}`); seen.add(row.jurisdiction);
    assert(VERIFICATION_STATES.includes(row.verification_state) && BAN_STATES.includes(row.ban_state), 'Invalid jurisdiction state');
    assert(row.period?.from === data.window.from && row.period?.to === data.window.to, `Missing active window ${row.jurisdiction}`);
    if (row.ban_state === 'NO_BAN' || row.coverage_complete) {
      assert(row.verification_state === 'PRIMARY_VERIFIED' && row.coverage_complete === true && validInstant(row.last_verified), `NO_BAN/full coverage requires primary verification ${row.jurisdiction}`);
      assert(SCOPE_CHECKS.every(key => row.scope_checks?.[key]?.state === 'PRIMARY_VERIFIED' && row.scope_checks[key].evidence_ids?.length && row.scope_checks[key].evidence_ids.every(id => sources.get(id)?.role === 'PRIMARY')), `Incomplete full-scope primary evidence ${row.jurisdiction}`);
      assert(row.no_ban_evidence?.length || row.ban_state !== 'NO_BAN', `Missing explicit NO_BAN evidence ${row.jurisdiction}`);
      if (row.ban_state === 'NO_BAN') assert(row.no_ban_evidence.every(e => sources.get(e.source_id)?.role === 'PRIMARY' && includesWindow(e.period, data.window) && e.explicit_no_ban === true && e.finding && e.reviewed_by), `Invalid NO_BAN evidence ${row.jurisdiction}`);
    }
    if (row.ban_state === 'HAS_BAN') assert(data.rules.some(r => r.jurisdiction === row.jurisdiction && r.status === 'ACTIVE' && r.verification_state === 'PRIMARY_VERIFIED' && r.valid_to >= data.window.from && r.valid_from <= data.window.to), `HAS_BAN without verified rule ${row.jurisdiction}`);
  }
  return true;
}
export function expandRules(data, window) {
  assert(isDate(window.from) && isDate(window.to) && window.from <= window.to && (Date.parse(window.to) - Date.parse(window.from)) / DAY <= 370, 'Invalid event window');
  const superseded = new Set(data.rules.filter(r => r.status === 'ACTIVE' && r.verification_state === 'PRIMARY_VERIFIED').flatMap(r => r.supersedes));
  const events = [], ids = new Set(), signatures = new Set();
  for (const rule of data.rules) {
    if (rule.status !== 'ACTIVE' || superseded.has(rule.ban_id) || rule.verification_state !== 'PRIMARY_VERIFIED') continue;
    const s = rule.schedule;
    const rangeFrom = shiftDate(window.from, -8), rangeTo = window.to;
    let dates = s.kind === 'dates' ? s.dates : [];
    if (s.kind !== 'dates') {
      for (let day = rangeFrom; day <= rangeTo; day = shiftDate(day, 1)) {
        if (s.kind === 'daily' || s.weekdays.includes(new Date(`${day}T00:00:00Z`).getUTCDay())) dates.push({date: day, occurrence_id: day});
      }
    }
    const startBoundary = localToUtc(window.from, '00:00', rule.timezone);
    const endBoundary = localToUtc(shiftDate(window.to, 1), '00:00', rule.timezone);
    for (const occurrence of dates) {
      const day = occurrence.date;
      // Never extend a verified rule beyond the specifically reviewed date window.
      if (day < rule.review_window.from || day > rule.review_window.to || day < rule.valid_from || day > rule.valid_to || (s.excluded_dates || []).includes(day)) continue;
      let endDate = shiftDate(day, s.end_day_offset), endTime = s.end_time;
      if (endTime === '24:00') { endDate = shiftDate(endDate, 1); endTime = '00:00'; }
      const start = localToUtc(day, s.start_time, rule.timezone, s.disambiguation || 'reject');
      const end = localToUtc(endDate, endTime, rule.timezone, s.disambiguation || 'reject');
      assert(end > start, `Non-positive ban duration ${rule.ban_id}`);
      if (end <= startBoundary || start >= endBoundary) continue;
      const uid = `${rule.ban_id}-${occurrence.occurrence_id}@dajc.eu`;
      assert(!ids.has(uid), `Duplicate event UID ${uid}`); ids.add(uid);
      const signature = JSON.stringify([rule.jurisdiction, rule.source_url, rule.legal_basis, start, end, rule.weight_threshold, rule.vehicle_scope, [...rule.roads].sort(), [...rule.regions].sort(), rule.direction, [...rule.exceptions].sort()]);
      assert(!signatures.has(signature), `Duplicate semantic event ${uid}`); signatures.add(signature);
      events.push({ ...rule, uid, date: day, end_date: endDate, start_time: s.start_time, end_time: endTime, source_end_time: s.end_time, starts_at: start, ends_at: end, occurrence_id: occurrence.occurrence_id });
    }
  }
  events.sort((a,b) => a.starts_at.localeCompare(b.starts_at) || a.uid.localeCompare(b.uid));
  return events;
}
export function snapshot(data, identities, now = new Date()) {
  validateCanonical(data, identities);
  const window = publicationWindow(now);
  const events = expandRules(data, window);
  // The reviewed span may exceed the active window (e.g. reviewed Sep-Nov covers Sep-Oct and, after rollover, Oct-Nov); it must fully contain it.
  const staleWindow = !includesWindow(data.window, window);
  const jurisdictions = data.jurisdictions.map(row => {
    const rules = events.filter(e => e.jurisdiction === row.jurisdiction);
    const canKeepNoBan = !staleWindow && row.ban_state === 'NO_BAN' && row.verification_state === 'PRIMARY_VERIFIED';
    assert(!(canKeepNoBan && rules.length), `NO_BAN conflicts with an actual ban ${row.jurisdiction}`);
    const failures = [...row.coverage_failures];
    if (staleWindow) failures.push('ACTIVE_WINDOW_NOT_REVERIFIED');
    return { ...row, period: { from: window.from, to: window.to }, ban_state: rules.length ? 'HAS_BAN' : canKeepNoBan ? 'NO_BAN' : 'UNKNOWN', verification_state: staleWindow ? 'UNVERIFIED' : row.verification_state, coverage_complete: !staleWindow && row.coverage_complete, coverage_failures: [...new Set(failures)], event_count: rules.length, last_verified: row.last_verified };
  });
  return { schema_version: 1, dataset_version: data.dataset_version, generated_at: now.toISOString(), window, jurisdictions, events, upcoming_events: events.filter(e => e.ends_at > now.toISOString()), sources: data.sources, complete: jurisdictions.every(r => r.coverage_complete) };
}
const esc = value => String(value ?? '').replaceAll('\\','\\\\').replaceAll('\r','').replaceAll('\n','\\n').replaceAll(';','\\;').replaceAll(',','\\,');
const stamp = value => value.replaceAll('-','').replaceAll(':','').replace(/\.\d{3}Z$/, 'Z');
export function foldLine(line) {
  let out = '', length = 0;
  for (const c of line) { const bytes = new TextEncoder().encode(c).length; if (length + bytes > 75) { out += '\r\n '; length = 1; } out += c; length += bytes; }
  return out;
}
export function toIcs(view, { countries = [], type = 'all', upcoming = true } = {}) {
  assert(['all','general','exceptional'].includes(type), 'Invalid restriction type');
  const valid = new Set(view.jurisdictions.map(r => r.jurisdiction));
  assert(countries.every(c => valid.has(c)), 'Unknown jurisdiction');
  const events = (upcoming ? view.upcoming_events : view.events).filter(e => (!countries.length || countries.includes(e.jurisdiction)) && (type !== 'general' || e.restriction_types.includes('general')));
  const selected = view.jurisdictions.filter(r => !countries.length || countries.includes(r.jurisdiction));
  const lines = ['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//DAJC//Canonical Driving Bans//EN','CALSCALE:GREGORIAN','METHOD:PUBLISH','X-WR-CALNAME:DAJC HGV Driving Bans',`X-DAJC-WINDOW:${view.window.from}/${view.window.to}`,`X-DAJC-DATASET:${esc(view.dataset_version)}`,`X-DAJC-EVENT-SCOPE:${upcoming ? 'UPCOMING' : 'WHOLE-WINDOW'}`,`X-DAJC-COVERAGE-COMPLETE:${selected.every(r => r.coverage_complete) ? 'TRUE':'FALSE'}`,`X-DAJC-UNKNOWN:${esc(selected.filter(r => r.ban_state === 'UNKNOWN').map(r => r.jurisdiction).join(','))}`,'X-WR-CALDESC:Verified ban events only. Missing events are NOT evidence of no ban. Consult the DAJC coverage status and official sources.','REFRESH-INTERVAL;VALUE=DURATION:PT1H','X-PUBLISHED-TTL:PT1H'];
  for (const e of events) {
    const description = [`Local time: ${e.date} ${e.start_time} to ${e.end_date} ${e.end_time} (${e.timezone})`, `Vehicles: ${e.vehicle_scope}`, `Weight condition: ${JSON.stringify(e.weight_threshold)}`, `Roads: ${e.roads.join('; ')}`, `Regions: ${e.regions.join('; ')}`, `Direction: ${e.direction}`, `Exceptions: ${e.exceptions.join('; ')}`, `ADR: ${e.adr_relevance}`, `Exceptional transport: ${e.exceptional_relevance}`, `Legal basis: ${e.legal_basis}`, `Authority: ${e.source_authority}`, `Verified: ${e.verified_at}`, `Version: ${e.source_version}`, e.notes, 'Coverage may be incomplete. Check permits and current official instructions.'].join('\n');
    lines.push('BEGIN:VEVENT',`UID:${esc(e.uid)}`,`DTSTAMP:${stamp(e.verified_at)}`,`LAST-MODIFIED:${stamp(e.verified_at)}`,`SEQUENCE:${e.sequence}`,`DTSTART:${stamp(e.starts_at)}`,`DTEND:${stamp(e.ends_at)}`,`SUMMARY:${esc(`${e.jurisdiction} — ${e.title}`)}`,`DESCRIPTION:${esc(description)}`,`URL:${e.source_url}`,`X-DAJC-TIMEZONE:${e.timezone}`,`X-DAJC-VERIFICATION:${e.verification_state}`,'STATUS:CONFIRMED','TRANSP:TRANSPARENT','END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(foldLine).join('\r\n') + '\r\n';
}
/** Every consumer uses this compatibility projection, never the retired files. */
export function calendarRules(data) {
  const retired = new Set(data.rules.filter(r => r.verification_state === 'PRIMARY_VERIFIED' && r.status === 'ACTIVE').flatMap(r => r.supersedes));
  return data.rules.filter(r => r.verification_state === 'PRIMARY_VERIFIED' && r.status === 'ACTIVE' && !retired.has(r.ban_id)).map(r => ({ ...r, id: r.ban_id, country: r.jurisdiction, countryName: data.jurisdictions.find(j => j.jurisdiction === r.jurisdiction)?.name || r.jurisdiction, sourceUrl: r.source_url, sourceName: r.source_authority, legalBasis: r.legal_basis, vehicleScope: r.vehicle_scope, routeScope: `${r.roads.join('; ')}; ${r.regions.join('; ')}; ${r.direction}`, exemptionNotes: r.exceptions.join('; '), restrictionTypes: r.restriction_types, lastVerified: r.verified_at.slice(0,10), kind: 'canonical-rule', suppressFromWeeklyAfter: '2026-09-01', resolve(weekStart, weekEnd) {
    const from = weekStart.toISOString().slice(0,10), to = weekEnd.toISOString().slice(0,10);
    const row = data.jurisdictions.find(j => j.jurisdiction === r.jurisdiction);
    const complete = row?.coverage_complete && row.verification_state === 'PRIMARY_VERIFIED' && includesWindow(row.period, {from, to});
    return { maintenanceError: complete ? undefined : 'Jurisdiction-wide coverage is incomplete for this period; consult canonical coverage states.', occurrences: expandRules({rules:[r]}, {from,to}).map(e => ({title:e.title, validFrom:e.date, validTo: e.source_end_time === '24:00' ? shiftDate(e.end_date,-1) : e.end_date, startsAt:e.starts_at, endsAt:e.ends_at, uid:e.uid, timeWindow:`${e.date} ${e.start_time} – ${e.end_date} ${e.end_time} (${e.timezone})`, whatChanged:e.notes, impact:e.vehicle_scope, recommendedAction:'Verify current source, vehicle applicability and permit conditions before departure.'})) };
  }}));
}
/** A full sweep is a Thursday-only scheduled operation; CI validation is not a sweep. */
export function assertSweepRequest({ mode = 'full', jurisdiction, urgentSource, publishedBanId, initialRepair = false } = {}, data, now = new Date()) {
  const day = new Intl.DateTimeFormat('en-US', {timeZone:'Europe/Prague',weekday:'short'}).format(now);
  if (mode === 'full') { assert(day === 'Thu' || initialRepair, 'Scheduled full sweep is Thursday-only'); return data.jurisdictions.map(j => j.jurisdiction); }
  assert(mode === 'urgent' && data.jurisdictions.some(j => j.jurisdiction === jurisdiction) && validUrl(urgentSource) && data.rules.some(r => r.ban_id === publishedBanId && r.jurisdiction === jurisdiction), 'Urgent recheck requires one tracked jurisdiction, a source and an existing published rule');
  return [jurisdiction];
}
/** Source failures revoke current publication trust, never manufacture NO_BAN. */
export function invalidateSources(data, sourceIds, checkedAt) {
  assert(validInstant(checkedAt), 'Invalid source check timestamp');
  const out = structuredClone(data), failed = new Set(sourceIds);
  assert(sourceIds.every(id => out.sources.some(s => s.source_id === id)), 'Unknown failing source');
  for (const s of out.sources) if (failed.has(s.source_id)) { s.availability = 'SOURCE_UNAVAILABLE'; s.last_attempted_at = checkedAt; }
  const affected = new Set();
  for (const r of out.rules) if (r.evidence_ids.some(id => failed.has(id))) { r.verification_state = 'SOURCE_UNAVAILABLE'; affected.add(r.jurisdiction); }
  for (const j of out.jurisdictions) if (affected.has(j.jurisdiction) || j.source_ids.some(id => failed.has(id))) {
    j.verification_state = 'SOURCE_UNAVAILABLE'; j.ban_state = 'UNKNOWN'; j.coverage_complete = false; j.last_checked = checkedAt;
    j.coverage_failures = [...new Set([...j.coverage_failures, 'PRIMARY_SOURCE_UNAVAILABLE'])];
  }
  return out;
}
/** Deterministic field-level audit. A withdrawn unverified event is not a legal cancellation. */
export function diffCanonical(before, after) {
  const changes = [], previous = new Map(before.rules.map(r => [r.ban_id,r]));
  const fields = ['status','verification_state','valid_from','valid_to','schedule','weight_threshold','vehicle_scope','roads','regions','direction','exceptions','adr_relevance','exceptional_relevance','source_version','supersedes'];
  for (const r of after.rules) {
    const old = previous.get(r.ban_id);
    if (!old) changes.push({kind:'NEW_RULE',jurisdiction:r.jurisdiction,ban_id:r.ban_id});
    else for (const field of fields) if (JSON.stringify(old[field]) !== JSON.stringify(r[field])) changes.push({kind:'RULE_CHANGED',jurisdiction:r.jurisdiction,ban_id:r.ban_id,field,before:old[field],after:r[field]});
    previous.delete(r.ban_id);
  }
  for (const r of previous.values()) changes.push({kind:'REMOVED_RECORD_REQUIRES_REVIEW',jurisdiction:r.jurisdiction,ban_id:r.ban_id});
  const rows = new Map(before.jurisdictions.map(j => [j.jurisdiction,j]));
  for (const j of after.jurisdictions) for (const field of ['ban_state','verification_state','coverage_complete','coverage_failures']) if (JSON.stringify(rows.get(j.jurisdiction)?.[field]) !== JSON.stringify(j[field])) changes.push({kind:'COVERAGE_CHANGED',jurisdiction:j.jurisdiction,field,before:rows.get(j.jurisdiction)?.[field],after:j[field]});
  return changes;
}
