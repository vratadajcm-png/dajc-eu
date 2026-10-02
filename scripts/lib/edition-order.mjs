// Deterministic presentation order and capacity for an edition.
//
// Operator-first (spec §1 "Published lead order"): importance decides first,
// geography second. Within the same importance tier the wider Central-European
// transport core leads - Czechia, Germany, Austria, Slovakia, Poland, Hungary,
// Switzerland, Slovenia - then directly connected corridors (France, Benelux,
// Italy, Croatia, Romania), then the rest of Europe, with peripheral
// jurisdictions (Madeira, Jersey, Guernsey, Monaco, ...) last. Geography is an
// ordering preference, never a relevance bypass: a critical development from
// a peripheral jurisdiction still leads a weak Central-European item.

import { OVERSIZE_SIGNAL } from './critical-floor.mjs';
import { foldText } from './publication-date.mjs';
import { readableText } from './text-quality.mjs';

const CENTRAL_EUROPE = ['czechia', 'germany', 'austria', 'slovakia', 'poland', 'hungary', 'switzerland', 'slovenia'];
const CENTRAL_ALIASES = {
  'czech republic': 'czechia', cz: 'czechia', de: 'germany', at: 'austria', sk: 'slovakia',
  pl: 'poland', hu: 'hungary', ch: 'switzerland', si: 'slovenia',
};
const CONNECTED_CORRIDORS = new Set([
  'france', 'belgium', 'netherlands', 'luxembourg', 'italy', 'croatia', 'romania',
  'fr', 'be', 'nl', 'lu', 'it', 'hr', 'ro',
]);
const PERIPHERAL = new Set([
  'madeira', 'azores', 'canary islands', 'ceuta', 'melilla', 'guernsey', 'jersey', 'isle of man', 'gibraltar',
  'alderney', 'sark', 'monaco', 'andorra', 'san marino', 'vatican city', 'vatican', 'liechtenstein',
  'faroe islands', 'greenland', 'svalbard', 'jan mayen', 'aland', 'aland islands', 'akrotiri and dhekelia',
  'northern cyprus', 'guadeloupe', 'martinique', 'french guiana', 'reunion', 'mayotte', 'saint-martin',
  'saint martin', 'saint-barthelemy', 'saint barthelemy', 'saint-pierre-et-miquelon', 'wallis and futuna',
  'new caledonia', 'french polynesia', 'aruba', 'curacao', 'sint maarten', 'bonaire', 'saba', 'sint eustatius',
  'abkhazia', 'south ossetia', 'transnistria', 'gagauzia',
  'mc', 'ad', 'sm', 'va', 'li', 'gg', 'je', 'im', 'gi',
]);

/** 0-7 Central Europe (in the order above), 8 connected corridors, 9 rest of Europe, 10 peripheral. */
export function geoRank(country) {
  const key = foldText(country).trim();
  const central = CENTRAL_ALIASES[key] || key;
  const index = CENTRAL_EUROPE.indexOf(central);
  if (index >= 0) return index;
  if (CONNECTED_CORRIDORS.has(key)) return 8;
  if (PERIPHERAL.has(key)) return 10;
  return 9;
}

/**
 * 0 = required critical development, 1 = directly about exceptional/abnormal
 * transport (permits, escorts, movement conditions), 2 = other heavy-transport
 * intelligence. Judged from the verified source record, not the model's prose.
 */
export function importanceTier(item, { candidate = null, criticalUrls = new Set() } = {}) {
  if (criticalUrls.has(item.sourceUrl)) return 0;
  const text = `${candidate?.title || item.title || ''} ${readableText(candidate?.summary) || ''} ${item.whatChanged || ''}`;
  return OVERSIZE_SIGNAL.test(text) ? 1 : 2;
}

/** Stable order: importance tier, then geography, then the model's own ranking. */
export function orderEditionItems(items = [], { candidatesByUrl = new Map(), criticalUrls = new Set() } = {}) {
  return items
    .map((item, index) => ({
      item,
      index,
      tier: importanceTier(item, { candidate: candidatesByUrl.get(item.sourceUrl) || null, criticalUrls }),
      geo: geoRank(item.country),
    }))
    .sort((a, b) => a.tier - b.tier || a.geo - b.geo || a.index - b.index)
    .map(({ item }) => item);
}

/**
 * Keeps at most `max` items (a capacity, never a quota). Protected items -
 * the only report covering a required critical development - are kept first;
 * otherwise the model's ranking decides which overflow is left out.
 */
export function capSection(items = [], max, isProtected = () => false) {
  if (items.length <= max) return { kept: items, left: [] };
  const protectedItems = items.filter(isProtected).slice(0, max);
  const others = items.filter((item) => !isProtected(item)).slice(0, max - protectedItems.length);
  const keep = new Set([...protectedItems, ...others]);
  return { kept: items.filter((item) => keep.has(item)), left: items.filter((item) => !keep.has(item)) };
}

/** The first report covering each critical development (by any of its URLs). */
export function criticalGroupOwners(article, criticalGroups = []) {
  const groupByUrl = new Map();
  for (const group of criticalGroups) {
    for (const candidate of group.candidates) groupByUrl.set(candidate.sourceUrl, group.key);
  }
  const covered = new Set();
  const owners = new Set();
  for (const item of [...(article.developments || []), ...(article.europeRoundup || [])]) {
    const key = groupByUrl.get(item.sourceUrl);
    if (key && !covered.has(key)) {
      covered.add(key);
      owners.add(item);
    }
  }
  return owners;
}
