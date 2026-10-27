import { expandRules, RESTRICTION_CLASSES, restrictionClassOf } from './core.mjs';
/**
 * Semantic checks over a hydrated canonical dataset, beyond the hard schema of
 * validateCanonical. Each finding names the workflow state it forces on a proposal
 * that introduces it (CONFLICT or INSUFFICIENT_EVIDENCE) or null when it only
 * needs a person to look. Checks never change data and never decide legal truth.
 */

export { RESTRICTION_CLASSES, restrictionClassOf };

// IANA zones per jurisdiction (several for multi-zone countries and the KZ/RU corridors).
export const JURISDICTION_TIMEZONES = Object.freeze({
  AD: ['Europe/Andorra'], AL: ['Europe/Tirane'], AM: ['Asia/Yerevan'], AT: ['Europe/Vienna'], AZ: ['Asia/Baku'], BA: ['Europe/Sarajevo'],
  BE: ['Europe/Brussels'], BG: ['Europe/Sofia'], BY: ['Europe/Minsk'], CH: ['Europe/Zurich'], CY: ['Asia/Nicosia', 'Asia/Famagusta'],
  CZ: ['Europe/Prague'], DE: ['Europe/Berlin', 'Europe/Busingen'], DK: ['Europe/Copenhagen'], EE: ['Europe/Tallinn'],
  ES: ['Europe/Madrid', 'Atlantic/Canary', 'Africa/Ceuta'], FI: ['Europe/Helsinki'], FR: ['Europe/Paris'], GE: ['Asia/Tbilisi'],
  GR: ['Europe/Athens'], HR: ['Europe/Zagreb'], HU: ['Europe/Budapest'], IE: ['Europe/Dublin'], IS: ['Atlantic/Reykjavik'], IT: ['Europe/Rome'],
  KZ: ['Asia/Almaty', 'Asia/Oral', 'Asia/Atyrau', 'Asia/Aqtobe', 'Asia/Aqtau', 'Asia/Qyzylorda', 'Asia/Qostanay'],
  LI: ['Europe/Vaduz'], LT: ['Europe/Vilnius'], LU: ['Europe/Luxembourg'], LV: ['Europe/Riga'], MC: ['Europe/Monaco'], MD: ['Europe/Chisinau'],
  ME: ['Europe/Podgorica'], MK: ['Europe/Skopje'], MT: ['Europe/Malta'], NL: ['Europe/Amsterdam'], NO: ['Europe/Oslo'], PL: ['Europe/Warsaw'],
  PT: ['Europe/Lisbon', 'Atlantic/Madeira', 'Atlantic/Azores'], RO: ['Europe/Bucharest'], RS: ['Europe/Belgrade'],
  RU: ['Europe/Moscow', 'Europe/Kaliningrad', 'Europe/Samara', 'Europe/Volgograd', 'Europe/Saratov', 'Europe/Ulyanovsk', 'Europe/Astrakhan', 'Europe/Kirov', 'Asia/Yekaterinburg'],
  SE: ['Europe/Stockholm'], SI: ['Europe/Ljubljana'], SK: ['Europe/Bratislava'], SM: ['Europe/San_Marino'], TR: ['Europe/Istanbul'],
  UA: ['Europe/Kyiv'], UK: ['Europe/London'], XK: ['Europe/Belgrade'],
});

// Regions with their own traffic regime: a country-wide rule must say whether it applies there.
export const SEPARATE_REGIMES = Object.freeze({ ES: ['Catalonia', 'Basque Country'], PT: ['Azores', 'Madeira'] });
const GENERIC_NETWORK = /\b(whole|entire|all|national|country)\b.*\b(network|roads?)\b|\bnetwork\b/i;

const leaves = weight => weight?.any_of || weight?.all_of ? (weight.any_of || weight.all_of).flatMap(leaves) : weight ? [weight] : [];
/** Masses written in the vehicle scope, in kg ("7.5t", "7,500 kg", ">12 t"). */
export function massesInText(text) {
  const out = new Set();
  for (const match of String(text).matchAll(/(\d{1,3}(?:[ ,]\d{3})+|\d+(?:[.,]\d+)?)\s*(kg|t)\b/gi)) {
    const raw = match[1], unit = match[2].toLowerCase();
    const thousands = /^\d{1,3}(?:[ ,]\d{3})+$/.test(raw) && unit === 'kg';
    const value = Number(thousands ? raw.replace(/[ ,]/g, '') : raw.replace(',', '.'));
    if (Number.isFinite(value)) out.add(Math.round(unit === 't' ? value * 1000 : value));
  }
  return out;
}

const finding = (code, severity, blocking, rule, message, extra = {}) => ({ code, severity, blocking_state: blocking, jurisdiction: rule?.jurisdiction ?? extra.jurisdiction ?? null, ban_id: rule?.ban_id ?? null, message, ...extra });

export function checkRules(data, { window = data.window } = {}) {
  const findings = [];
  const active = data.rules.filter(rule => rule.status === 'ACTIVE');
  const verified = active.filter(rule => rule.verification_state === 'PRIMARY_VERIFIED');
  const supersededBy = new Map();
  for (const rule of verified) for (const id of rule.supersedes) supersededBy.set(id, rule.ban_id);

  for (const rule of data.rules) {
    const cls = restrictionClassOf(rule);
    if (!RESTRICTION_CLASSES.includes(cls)) findings.push(finding('UNKNOWN_RESTRICTION_CLASS', 'ERROR', 'INSUFFICIENT_EVIDENCE', rule, `Unknown restriction class ${cls}`));
    const zones = JURISDICTION_TIMEZONES[rule.jurisdiction];
    if (zones && !zones.includes(rule.timezone)) findings.push(finding('TIMEZONE_NOT_EXPECTED', 'REVIEW', null, rule, `${rule.timezone} is not a zone of ${rule.jurisdiction}`));
    for (const leaf of leaves(rule.weight_threshold)) {
      if (leaf.unit === 'kg' && (leaf.value < 1000 || leaf.value > 100000)) findings.push(finding('WEIGHT_UNIT_SUSPECT', 'ERROR', 'INSUFFICIENT_EVIDENCE', rule, `${leaf.value} kg looks like a unit error`));
    }
    const written = massesInText(rule.vehicle_scope);
    const encoded = leaves(rule.weight_threshold).filter(leaf => leaf.unit === 'kg').map(leaf => leaf.value);
    if (written.size && encoded.some(value => !written.has(value))) findings.push(finding('WEIGHT_TEXT_MISMATCH', 'REVIEW', 'INSUFFICIENT_EVIDENCE', rule, `Encoded masses ${encoded.join(', ')} kg are not all stated in the vehicle scope (${[...written].join(', ')} kg)`));
    if (rule.status === 'ACTIVE' && supersededBy.has(rule.ban_id)) findings.push(finding('SUPERSEDED_STILL_ACTIVE', 'REVIEW', null, rule, `Superseded by ${supersededBy.get(rule.ban_id)} but still marked ACTIVE`));
    const separate = SEPARATE_REGIMES[rule.jurisdiction];
    if (separate && rule.status === 'ACTIVE' && !(rule.regions || []).length && !rule.excluded_regions && (rule.roads || []).some(road => GENERIC_NETWORK.test(road))) findings.push(finding('NATIONAL_RULE_SEPARATE_REGIME', 'REVIEW', 'INSUFFICIENT_EVIDENCE', rule, `Country-wide rule must state whether it applies in ${separate.join(', ')} (regions or excluded_regions)`));
    if (rule.verification_state === 'PRIMARY_VERIFIED' && rule.status === 'ACTIVE' && rule.valid_to >= window.from && rule.valid_from <= window.to && rule.review_window.to < window.to && rule.valid_to > rule.review_window.to) findings.push(finding('REVIEW_WINDOW_SHORTER_THAN_SPAN', 'INFO', null, rule, `Reviewed only to ${rule.review_window.to}; no events are published after that date`));
  }

  // Conflicting sources: the same road/region/direction/vehicle scope on the same day with different hours from different sources.
  const groups = new Map();
  let events = [];
  try { events = expandRules({ rules: verified.filter(rule => restrictionClassOf(rule) === 'LEGAL_DRIVING_BAN') }, window); }
  catch (error) {
    // Report instead of throwing so a broken candidate still gets a readable finding.
    const message = String(error.message || error);
    findings.push(/Duplicate (semantic event|event UID)/.test(message) ? finding('DUPLICATE_SEMANTIC_EVENT', 'ERROR', 'CONFLICT', null, message) : finding('CALENDAR_EXPANSION_FAILED', 'ERROR', 'INSUFFICIENT_EVIDENCE', null, message));
  }
  for (const event of events) {
    const key = JSON.stringify([event.jurisdiction, event.date, [...event.roads].sort(), [...event.regions].sort(), event.direction, event.vehicle_scope, event.weight_threshold]);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(event);
  }
  for (const events of groups.values()) {
    const sources = new Set(events.map(event => event.source_id));
    const hours = new Set(events.map(event => `${event.start_time}-${event.end_time}`));
    if (sources.size > 1 && hours.size > 1) findings.push(finding('SOURCE_CONFLICT', 'ERROR', 'CONFLICT', null, `Sources ${[...sources].join(', ')} give different hours (${[...hours].join(', ')}) for the same scope on ${events[0].date}`, { jurisdiction: events[0].jurisdiction, ban_ids: [...new Set(events.map(event => event.ban_id))], date: events[0].date }));
  }
  // Regional variant over a country-wide rule with different hours on the same day.
  const byDay = new Map();
  for (const events of groups.values()) for (const event of events) {
    const key = JSON.stringify([event.jurisdiction, event.date, event.direction, event.vehicle_scope]);
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key).push(event);
  }
  for (const events of byDay.values()) {
    const national = events.filter(event => !event.regions.length && event.roads.some(road => GENERIC_NETWORK.test(road)));
    const regional = events.filter(event => event.regions.length);
    for (const region of regional) for (const country of national) {
      if (region.source_id !== country.source_id && (region.start_time !== country.start_time || region.end_time !== country.end_time)) findings.push(finding('REGIONAL_OVERLAP', 'REVIEW', null, null, `${region.ban_id} (${region.regions.join(', ')}) overlaps country-wide ${country.ban_id} with different hours on ${region.date}`, { jurisdiction: region.jurisdiction, ban_ids: [region.ban_id, country.ban_id], date: region.date }));
    }
  }
  return findings;
}

/** Stable identity of a finding so that "new in candidate" comparisons are exact. */
export const findingKey = item => JSON.stringify([item.code, item.jurisdiction, item.ban_id, item.ban_ids || null, item.date || null]);
export function newFindings(before, after) {
  const known = new Set(before.map(findingKey));
  return after.filter(item => !known.has(findingKey(item)));
}
