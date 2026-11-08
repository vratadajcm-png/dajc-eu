// DAJC legal library (knowledge base) - shared vocabulary.
//
// The library holds official documents (EU and national law, international
// agreements, authority guidance) for DAJC AI. Its answers may only quote
// provisions from documents whose origin and validity were checked; this file
// defines the words that make those checks explicit.

/** Topics in priority order. Oversize and special heavy transport stay first. */
export const KB_TOPICS = Object.freeze([
  'oversize_heavy_transport',
  'permits_exceptions_escorts',
  'weights_dimensions_axles',
  'driving_bans',
  'driving_rest_times',
  'tachograph',
  'hgv_traffic_rules',
  'adr_dangerous_goods',
  'roadside_checks_documents',
  'tolls_charges_environmental',
  'cross_border_cabotage',
  'closures_restrictions',
]);

export const KB_TOPIC_LABELS = Object.freeze({
  oversize_heavy_transport: { cs: 'Nadrozměrná a těžká přeprava', en: 'Oversize and heavy transport' },
  permits_exceptions_escorts: { cs: 'Povolení, výjimky, doprovod a zvláštní podmínky', en: 'Permits, exemptions, escorts and special conditions' },
  weights_dimensions_axles: { cs: 'Hmotnosti, rozměry a zatížení náprav', en: 'Weights, dimensions and axle loads' },
  driving_bans: { cs: 'Národní a mezinárodní zákazy jízd', en: 'National and international driving bans' },
  driving_rest_times: { cs: 'Doby řízení, přestávky a odpočinek', en: 'Driving times, breaks and rest periods' },
  tachograph: { cs: 'Tachografy', en: 'Tachographs' },
  hgv_traffic_rules: { cs: 'Dopravní předpisy pro nákladní vozidla (nad 2,5 t a vyšší prahy)', en: 'Traffic rules for goods vehicles (over 2.5 t and higher thresholds)' },
  adr_dangerous_goods: { cs: 'ADR a přeprava nebezpečných věcí', en: 'ADR and dangerous goods' },
  roadside_checks_documents: { cs: 'Silniční kontroly a povinné doklady', en: 'Roadside checks and mandatory documents' },
  tolls_charges_environmental: { cs: 'Mýto, poplatky a ekologická omezení', en: 'Tolls, charges and environmental restrictions' },
  cross_border_cabotage: { cs: 'Přeshraniční přeprava, kabotáž a předpisy EU', en: 'Cross-border transport, cabotage and EU rules' },
  closures_restrictions: { cs: 'Úřední uzavírky a dopravní omezení', en: 'Official closures and traffic restrictions' },
});

/** Topics of the existing Ask classifier (src/lib/ask/prompts.ts) mapped to library topics. */
export const ASK_TOPIC_TO_KB = Object.freeze({
  driving_ban: ['driving_bans'],
  oversize_permit: ['oversize_heavy_transport', 'permits_exceptions_escorts'],
  dimensions_weights: ['weights_dimensions_axles', 'oversize_heavy_transport'],
  escort: ['permits_exceptions_escorts', 'oversize_heavy_transport'],
  road_restriction: ['closures_restrictions', 'hgv_traffic_rules'],
  toll: ['tolls_charges_environmental'],
  other: ['driving_rest_times', 'tachograph', 'hgv_traffic_rules', 'adr_dangerous_goods', 'roadside_checks_documents', 'cross_border_cabotage'],
});

/** Normative categories are law; guidance and operational information are not. */
export const LEGAL_CATEGORIES = Object.freeze({
  EU_REGULATION: { normative: true },
  EU_DIRECTIVE: { normative: true },
  EU_DECISION: { normative: true },
  INTERNATIONAL_AGREEMENT: { normative: true },
  NATIONAL_ACT: { normative: true },
  NATIONAL_REGULATION: { normative: true },
  AUTHORITY_GUIDANCE: { normative: false },
  OPERATIONAL_INFORMATION: { normative: false },
});

/**
 * Authenticity of a document version. Only the Official Journal of the EU is
 * authentic for EU law; EUR-Lex consolidated texts are documentation tools
 * (EUR-Lex legal notice), which an answer must say.
 */
export const AUTHENTICITY = Object.freeze(['OFFICIAL_PUBLICATION', 'CONSOLIDATED_DOCUMENTATION', 'AUTHORITY_PUBLICATION', 'UNKNOWN']);

/** Legal validity of a version, as last checked against its official source. */
export const VALIDITY = Object.freeze(['IN_FORCE', 'NOT_YET_IN_FORCE', 'REPEALED', 'SUPERSEDED', 'UNKNOWN']);

/**
 * Provenance review: UNVERIFIED -> AUTO_CHECKED (official domain, HTTPS, hash,
 * format, metadata from the publisher) -> HUMAN_VERIFIED (a named reviewer
 * confirmed origin, version and validity). REJECTED is kept for the history.
 */
export const PROVENANCE = Object.freeze(['UNVERIFIED', 'AUTO_CHECKED', 'HUMAN_VERIFIED', 'REJECTED']);

/** Text extraction: scanned PDFs never enter the index without the approved OCR path. */
export const TEXT_EXTRACTION = Object.freeze(['TEXT', 'NEEDS_OCR', 'OCR_APPROVED', 'FAILED']);

/** Download, storage and reuse terms of a source as checked. */
export const REUSE = Object.freeze(['PERMITTED', 'PERMITTED_WITH_ATTRIBUTION', 'RESTRICTED', 'UNKNOWN']);

/**
 * Legal mass thresholds in tonnes that change which rules apply (e.g. 2.5 t:
 * EU operator licensing and tachograph rules for international transport by
 * light commercial vehicles under Regulation (EU) 2020/1054 and 1071/2009 as
 * amended; 3.5 t: category N2 and most driving bans; 7.5 t: e.g. German and
 * Austrian bans; 12 t: category N3). A rule is never carried over from one
 * band to another.
 */
export const MASS_THRESHOLDS_T = Object.freeze([2.5, 3.5, 7.5, 12, 40, 44]);

/**
 * Basis of a mass threshold. MAM = maximum authorised (permissible) mass,
 * "největší povolená hmotnost", "zulässige Gesamtmasse"; ACTUAL = actual mass;
 * COMBINATION_MAM = MAM of the whole combination.
 */
export const MASS_BASIS = Object.freeze(['MAM', 'ACTUAL', 'COMBINATION_MAM']);

/**
 * Whether a provision's reviewed mass band applies to the asked vehicle mass.
 *   NO_THRESHOLD - the provision has no mass condition and mentions none;
 *   MATCH / MISMATCH - against a reviewed band;
 *   UNKNOWN_MASS - the question gives no mass, the band must be stated;
 *   UNREVIEWED - the text mentions tonnes but no reviewer set the band, so
 *                it may not be used as a confirmed statement for this vehicle.
 */
export function massApplies(band, massT, mentions = []) {
  if (!band || (band.minT == null && band.maxT == null)) {
    return mentions.length > 0 ? 'UNREVIEWED' : 'NO_THRESHOLD';
  }
  if (massT == null || !Number.isFinite(massT)) return 'UNKNOWN_MASS';
  const aboveMin = band.minT == null || (band.minInclusive ? massT >= band.minT : massT > band.minT);
  const belowMax = band.maxT == null || (band.maxInclusive ? massT <= band.maxT : massT < band.maxT);
  return aboveMin && belowMax ? 'MATCH' : 'MISMATCH';
}

/** Validity window check: the version must be in force on the asked day. */
export function inForceOn(version, day) {
  if (!version || !day) return false;
  if (!['IN_FORCE', 'NOT_YET_IN_FORCE'].includes(version.validity)) return false;
  if (!version.effectiveFrom || version.effectiveFrom > day) return false;
  return !version.effectiveTo || version.effectiveTo > day;
}

/** EU member states (DAJC coverage codes). EU regulations apply directly here. */
export const EU_MEMBERS = Object.freeze(['AT', 'BE', 'BG', 'CY', 'CZ', 'DE', 'DK', 'EE', 'ES', 'FI', 'FR', 'GR', 'HR', 'HU', 'IE', 'IT', 'LT', 'LU', 'LV', 'MT', 'NL', 'PL', 'PT', 'RO', 'SE', 'SI', 'SK']);
/** EEA EFTA states: EU acts apply only as incorporated into the EEA Agreement. */
export const EEA_EFTA = Object.freeze(['IS', 'LI', 'NO']);

/**
 * How a document of `docJurisdiction` applies to an asked country:
 *   DIRECT                       - national law of that country;
 *   EU_DIRECT                    - EU regulation or decision in a member state;
 *   TRANSPOSITION_CHECK_REQUIRED - EU directive: binds the state, the driver
 *                                  is bound by the national transposition;
 *   EEA_CHECK_REQUIRED           - EU act in an EEA EFTA state;
 *   INTERNATIONAL_CHECK_REQUIRED - international agreement (contracting party status);
 *   NOT_APPLICABLE               - e.g. EU law for the UK, Switzerland or Serbia.
 * Only DIRECT and EU_DIRECT can support a VERIFIED answer.
 */
export function applicability(askedCountry, docJurisdiction, legalCategory) {
  if (docJurisdiction === askedCountry) return 'DIRECT';
  if (docJurisdiction === 'INT') return 'INTERNATIONAL_CHECK_REQUIRED';
  if (docJurisdiction !== 'EU') return 'NOT_APPLICABLE';
  if (EU_MEMBERS.includes(askedCountry)) return legalCategory === 'EU_DIRECTIVE' ? 'TRANSPOSITION_CHECK_REQUIRED' : 'EU_DIRECT';
  if (EEA_EFTA.includes(askedCountry)) return 'EEA_CHECK_REQUIRED';
  return 'NOT_APPLICABLE';
}
