// Single authority for all active DAJC geographic monitoring.
// XK is an operational code, not a statement about diplomatic recognition.
// Regional applicability is retained inside a country, never inherited by
// dependencies. KZ/RU/TR cover European and connected international corridors.
export const dajcEuropeCoverage = Object.freeze([
  ['AD','Andorra'],
  ['AL','Albania'],
  ['AM','Armenia'],
  ['AT','Austria'],
  ['AZ','Azerbaijan'],
  ['BA','Bosnia and Herzegovina'],
  ['BE','Belgium'],
  ['BG','Bulgaria'],
  ['BY','Belarus'],
  ['CH','Switzerland'],
  ['CY','Cyprus'],
  ['CZ','Czechia'],
  ['DE','Germany'],
  ['DK','Denmark'],
  ['EE','Estonia'],
  ['ES','Spain'],
  ['FI','Finland'],
  ['FR','France'],
  ['GE','Georgia'],
  ['GR','Greece'],
  ['HR','Croatia'],
  ['HU','Hungary'],
  ['IE','Ireland'],
  ['IS','Iceland'],
  ['IT','Italy'],
  ['KZ','Kazakhstan (European transport scope)'],
  ['LI','Liechtenstein'],
  ['LT','Lithuania'],
  ['LU','Luxembourg'],
  ['LV','Latvia'],
  ['MC','Monaco'],
  ['MD','Moldova'],
  ['ME','Montenegro'],
  ['MK','North Macedonia'],
  ['MT','Malta'],
  ['NL','Netherlands'],
  ['NO','Norway'],
  ['PL','Poland'],
  ['PT','Portugal'],
  ['RO','Romania'],
  ['RS','Serbia'],
  ['RU','Russia (European transport scope)'],
  ['SE','Sweden'],
  ['SI','Slovenia'],
  ['SK','Slovakia'],
  ['SM','San Marino'],
  ['TR','Türkiye (European transport scope)'],
  ['UA','Ukraine'],
  ['UK','United Kingdom'],
  ['XK','Kosovo'],
].map(row => Object.freeze(row)));

const codes = new Set(dajcEuropeCoverage.map(([code]) => code));
if (codes.size !== dajcEuropeCoverage.length) throw new Error('Duplicate geographic identity');
// Read-only facade: consumers cannot expand the shared registry via Set.add().
export const dajcCoverageCodes = Object.freeze({
  size: codes.size, has: code => codes.has(code),
  values: () => codes.values(), [Symbol.iterator]: () => codes.values(),
});
export const dajcCoverageCount = dajcEuropeCoverage.length;
export const coverageName = code => dajcEuropeCoverage.find(([c]) => c === code)?.[1] || code;
export const isTrackedJurisdiction = code => codes.has(code);
export const COVERAGE_VERSION = '2026-10-22.50';
export const corridorOnlyJurisdictions = Object.freeze(['KZ', 'RU', 'TR']);
export const geographicScopePolicy = Object.freeze({
  version: COVERAGE_VERSION,
  corridor_only: corridorOnlyJurisdictions,
  corridor_scope: 'European and connecting international road freight corridors only; never whole-territory coverage.',
  regional_scope: 'Regional rules retain their own roads, regions, directions, thresholds and exceptions.',
  dependencies: 'Untracked territories do not inherit parent-country rules.',
  xk: 'Operational transport jurisdiction; no position on diplomatic recognition.',
});

export const dajcCoverageMpz = Object.freeze({
  AD: ['AND'],
  AL: ['AL'],
  AM: ['AM'],
  AT: ['A'],
  AZ: ['AZ'],
  BA: ['BIH'],
  BE: ['B'],
  BG: ['BG'],
  BY: ['BY'],
  CH: ['CH'],
  CY: ['CY'],
  CZ: ['CZ'],
  DE: ['D'],
  DK: ['DK'],
  EE: ['EST'],
  ES: ['E'],
  FI: ['FIN'],
  FR: ['F'],
  GE: ['GE'],
  GR: ['GR'],
  HR: ['HR'],
  HU: ['H'],
  IE: ['IRL'],
  IS: ['IS'],
  IT: ['I'],
  KZ: ['KZ'],
  LI: ['FL'],
  LT: ['LT'],
  LU: ['L'],
  LV: ['LV'],
  MC: ['MC'],
  MD: ['MD'],
  ME: ['MNE'],
  MK: ['NMK','MK'],
  MT: ['M'],
  NL: ['NL'],
  NO: ['N'],
  PL: ['PL'],
  PT: ['P'],
  RO: ['RO'],
  RS: ['SRB'],
  RU: ['RUS'],
  SE: ['S'],
  SI: ['SLO'],
  SK: ['SK'],
  TR: ['TR'],
  UA: ['UA'],
  UK: ['GB','UK'],
  XK: ['RKS'],
 });

// Organizational mappings only, NOT a second monitoring list or a transfer
// of legal applicability. Disputed/dependent territories have no fallback.
export const regionalScopes = Object.freeze({
  ENG: ['UK', 'England'], SCT: ['UK', 'Scotland'], WLS: ['UK', 'Wales'], NIR: ['UK', 'Northern Ireland'],
  FLA: ['BE', 'Flanders'], WAL: ['BE', 'Wallonia'], BRU: ['BE', 'Brussels-Capital Region'],
  CAT: ['ES', 'Catalonia'], BAS: ['ES', 'Basque Country'], GAL: ['ES', 'Galicia'],
  CEU: ['ES', 'Ceuta'], MLL: ['ES', 'Melilla'], CAN: ['ES', 'Canary Islands'],
  AZO: ['PT', 'Azores'], MAD: ['PT', 'Madeira'],
  FBIH: ['BA', 'Federation of Bosnia and Herzegovina'], RSBA: ['BA', 'Republika Srpska'],
  GAG: ['MD', 'Gagauzia'],
});
const aliases = Object.freeze({
  GB: 'UK', 'Great Britain': 'UK', 'Czech Republic': 'CZ', Turkey: 'TR', Türkiye: 'TR',
  Russia: 'RU', 'Russia (European part)': 'RU', Kazakhstan: 'KZ', 'Kazakhstan (European transit)': 'KZ',
  'PT-AZORES': 'AZO', 'PT-MADEIRA': 'MAD', 'ES-CANARY': 'CAN', 'ES-CEUTA': 'CEU', 'ES-MELILLA': 'MLL',
  RSM: 'SM', 'Republic of San Marino road jurisdiction': 'SM',
});
const normalize = value => String(value || '').trim().toLocaleLowerCase('en');
const lookup = new Map(dajcEuropeCoverage.flatMap(([jurisdiction, name]) =>
  [[normalize(jurisdiction), {jurisdiction}], [normalize(name), {jurisdiction}]]));
for (const [code, [jurisdiction, region]] of Object.entries(regionalScopes)) {
  for (const name of [code, region]) lookup.set(normalize(name), {jurisdiction, region});
}
for (const [alias, target] of Object.entries(aliases)) lookup.set(normalize(alias), lookup.get(normalize(target)));
export function resolveCoverageScope(value) {
  const scope = lookup.get(normalize(value));
  return scope ? {...scope} : null;
}

// Negative input guard only: these labels never create coverage rows or work.
const excludedTerritoryLabels = new Set(["VA", "Vatican City", "AX", "Åland Islands", "FO", "Faroe Islands", "GI", "Gibraltar", "GG", "Guernsey", "JE", "Jersey", "IM", "Isle of Man", "ALDERNEY", "Alderney", "SVALBARD", "Svalbard", "JANMAYEN", "Jan Mayen", "GL", "Greenland (European jurisdiction link)", "SBA", "Akrotiri and Dhekelia", "NCY", "Northern Cyprus", "GP", "Guadeloupe", "MQ", "Martinique", "GF", "French Guiana", "RE", "Réunion", "YT", "Mayotte", "MF", "Saint-Martin", "BL", "Saint-Barthélemy", "PM", "Saint-Pierre-et-Miquelon", "NC", "New Caledonia", "PF", "French Polynesia", "WF", "Wallis and Futuna", "CLIPPERTON", "Clipperton", "TF", "French Southern and Antarctic Lands", "AW", "Aruba", "CW", "Curaçao", "SX", "Sint Maarten", "BQ-BO", "Bonaire", "BQ-SA", "Saba", "BQ-SE", "Sint Eustatius", "AB", "Abkhazia", "SO", "South Ossetia", "TRN", "Transnistria"].map(normalize));
export const isExcludedTerritory = value => excludedTerritoryLabels.has(normalize(value));

export const coverageRegions = code => Object.values(regionalScopes).filter(([parent]) => parent === code).map(([, region]) => region);
