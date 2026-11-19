// Legal areas of the DAJC legal library for road freight transport (owner brief
// of 2026-11-09, sections A-E). Coverage is measured per jurisdiction and per
// sub-area (src/lib/kb/coverage.mjs); retrieval keeps using the twelve library
// topics of taxonomy.mjs, to which every sub-area maps.
//
// `euBasis` lists EU acts that regulate the sub-area for EU (and partly EEA)
// states. It is a research plan for imports, never evidence of coverage: a
// jurisdiction is covered only by documents actually stored and verified, and
// national implementing rules, sanctions and authorities always remain to be
// added. Mass thresholds are never assumed per area; they come from the
// provision that sets them.

import { KB_TOPICS } from './taxonomy.mjs';

const A = (id, en, cs, kbTopics, euBasis = []) => Object.freeze({ id, en, cs, kbTopics: Object.freeze(kbTopics), euBasis: Object.freeze(euBasis) });

export const LEGAL_AREA_GROUPS = Object.freeze({
  A: { en: 'Drivers and operators', cs: 'Řidiči a dopravci' },
  B: { en: 'Vehicles and loads', cs: 'Vozidla a náklady' },
  C: { en: 'Oversize and abnormal transport', cs: 'Nadrozměrná a nadměrná přeprava' },
  D: { en: 'Traffic restrictions', cs: 'Dopravní omezení' },
  E: { en: 'Other legal areas', cs: 'Další právní oblasti' },
});

export const LEGAL_AREAS = Object.freeze({
  A: Object.freeze([
    A('A.driving_rest_times', 'Driving times, breaks and rest periods', 'Doba řízení a odpočinku', ['driving_rest_times'], ['32006R0561']),
    A('A.tachographs', 'Tachographs: use and checks', 'Tachografy, jejich používání a kontroly', ['tachograph'], ['32014R0165']),
    A('A.working_time', 'Working time of mobile workers', 'Pracovní doba řidičů', ['driving_rest_times'], ['32002L0015']),
    A('A.posting_of_drivers', 'Posting of drivers', 'Vysílání řidičů', ['cross_border_cabotage'], ['32020L1057']),
    A('A.driver_qualification', 'Professional competence and qualification (CPC)', 'Odborná způsobilost a profesní kvalifikace', ['roadside_checks_documents'], ['32022L2561']),
    A('A.driving_licences', 'Driving licences', 'Řidičská oprávnění', ['roadside_checks_documents'], ['32006L0126']),
    A('A.operator_licensing', 'Operator licences and access to the occupation', 'Licence dopravců a přístup k povolání', ['cross_border_cabotage'], ['32009R1071']),
    A('A.cabotage_market_access', 'Cabotage and access to the market', 'Kabotáž a přístup na trh', ['cross_border_cabotage'], ['32009R1072']),
    A('A.international_transport', 'Rules of international transport (bilateral and multilateral permits)', 'Pravidla mezinárodní dopravy (bilaterální a multilaterální povolení)', ['cross_border_cabotage'], ['32009R1072']),
  ]),
  B: Object.freeze([
    A('B.weights', 'Maximum authorised weights', 'Největší povolené hmotnosti', ['weights_dimensions_axles'], ['31996L0053']),
    A('B.dimensions', 'Dimensions of vehicles and combinations', 'Rozměry vozidel a souprav', ['weights_dimensions_axles'], ['31996L0053']),
    A('B.axle_loads', 'Axle loads', 'Nápravová zatížení', ['weights_dimensions_axles'], ['31996L0053']),
    A('B.roadworthiness', 'Roadworthiness and periodic tests', 'Technická způsobilost a pravidelné prohlídky', ['roadside_checks_documents'], ['32014L0045']),
    A('B.mandatory_equipment', 'Mandatory equipment', 'Povinná výbava', ['hgv_traffic_rules']),
    A('B.load_securing', 'Load securing', 'Zajištění a upevnění nákladu', ['roadside_checks_documents', 'hgv_traffic_rules'], ['32014L0047']),
    A('B.roadside_technical_inspections', 'Technical roadside inspections', 'Technické silniční kontroly', ['roadside_checks_documents'], ['32014L0047']),
    A('B.emissions_environment', 'Emissions and environmental requirements', 'Emise a ekologické požadavky', ['tolls_charges_environmental']),
    A('B.mass_categories', 'Rules by vehicle mass category (over 2.5 t, from 3.5 t, over 7.5 t, over 12 t, others)', 'Pravidla podle hmotnostních kategorií (nad 2,5 t, od 3,5 t, nad 7,5 t, nad 12 t a další)', ['hgv_traffic_rules']),
  ]),
  C: Object.freeze([
    A('C.oversize_limits', 'Permitted oversize dimensions and weights', 'Povolené nadrozměrné rozměry a hmotnosti', ['oversize_heavy_transport', 'weights_dimensions_axles'], ['31996L0053']),
    A('C.special_use_permits', 'Permits for special use of roads', 'Povolení zvláštního užívání komunikací', ['permits_exceptions_escorts', 'oversize_heavy_transport'], ['31996L0053']),
    A('C.exemptions', 'Exemptions', 'Výjimky', ['permits_exceptions_escorts']),
    A('C.fees', 'Administrative fees', 'Správní poplatky', ['permits_exceptions_escorts']),
    A('C.escorts', 'Escort and police vehicles', 'Doprovodná a policejní vozidla', ['permits_exceptions_escorts']),
    A('C.route_conditions', 'Technical route conditions', 'Technické podmínky tras', ['oversize_heavy_transport']),
    A('C.bridge_tunnel_limits', 'Bridge and tunnel limits', 'Mostní a tunelová omezení', ['oversize_heavy_transport', 'closures_restrictions']),
    A('C.regional_authorities', 'Regional rules and competent authorities', 'Regionální pravidla a místní příslušnost úřadů', ['permits_exceptions_escorts']),
    A('C.permit_validity', 'Validity of permits', 'Doba platnosti povolení', ['permits_exceptions_escorts']),
    A('C.repeated_transports', 'Conditions for repeated transports', 'Podmínky opakovaných přeprav', ['permits_exceptions_escorts']),
    A('C.permit_matching_basis', 'Legal basis for Historical Permit Matching and authority-approved auto-issuance (never a new permit by itself)', 'Právní podklad pro Historical Permit Matching a úřadem schválené automatické vydání (nikdy samo o sobě nové povolení)', ['permits_exceptions_escorts']),
  ]),
  D: Object.freeze([
    A('D.weekend_holiday_bans', 'Weekend and public holiday driving bans', 'Víkendové a sváteční zákazy', ['driving_bans']),
    A('D.night_restrictions', 'Night restrictions', 'Noční omezení', ['driving_bans', 'closures_restrictions']),
    A('D.regional_seasonal_bans', 'Regional and seasonal bans', 'Regionální a sezónní zákazy', ['driving_bans']),
    A('D.weather_restrictions', 'Restrictions in bad weather', 'Omezení při nepříznivém počasí', ['closures_restrictions']),
    A('D.adr_restrictions', 'ADR restrictions', 'ADR omezení', ['adr_dangerous_goods', 'closures_restrictions'], ['32008L0068']),
    A('D.tunnel_bridge_restrictions', 'Tunnel and bridge restrictions', 'Tunelové a mostní restrikce', ['closures_restrictions'], ['32004L0054']),
    A('D.low_emission_zones', 'Low-emission zones', 'Nízkoemisní zóny', ['tolls_charges_environmental']),
    A('D.urban_restrictions', 'Urban restrictions', 'Městská omezení', ['closures_restrictions']),
    A('D.exemptions_sanctions', 'Exemptions and sanctions of restrictions', 'Výjimky a sankce', ['driving_bans', 'roadside_checks_documents']),
  ]),
  E: Object.freeze([
    A('E.adr', 'ADR (dangerous goods)', 'ADR', ['adr_dangerous_goods'], ['32008L0068']),
    A('E.customs_transit', 'Customs, transit, TIR/eTIR, NCTS, AES, ICS2', 'Celní předpisy, tranzit, TIR/eTIR, NCTS, AES, ICS2', ['cross_border_cabotage', 'roadside_checks_documents'], ['32013R0952']),
    A('E.cmr_ecmr', 'CMR and e-CMR', 'CMR a e-CMR', ['roadside_checks_documents']),
    A('E.efti', 'eFTI (electronic freight transport information)', 'eFTI', ['roadside_checks_documents'], ['32020R1056']),
    A('E.tolls_charges', 'Tolls and road charges', 'Mýtné a silniční poplatky', ['tolls_charges_environmental'], ['31999L0062']),
    A('E.insurance', 'Compulsory insurance', 'Povinné pojištění', ['roadside_checks_documents'], ['32009L0103']),
    A('E.carrier_liability', 'Carrier liability', 'Odpovědnost dopravce', ['roadside_checks_documents']),
    A('E.checks_sanctions', 'Roadside checks and sanctions', 'Silniční kontroly a sankce', ['roadside_checks_documents'], ['32006L0022']),
    A('E.accidents_breakdowns', 'Accidents, breakdowns and securing the scene', 'Dopravní nehody, poruchy a zabezpečení místa', ['hgv_traffic_rules']),
    A('E.emergencies', 'Duties in emergencies', 'Povinnosti při mimořádných událostech', ['hgv_traffic_rules', 'closures_restrictions']),
    A('E.specific_cargo', 'Rules for specific kinds of cargo', 'Pravidla přepravy specifických druhů nákladů', ['hgv_traffic_rules', 'adr_dangerous_goods']),
  ]),
});

/** All sub-areas in a fixed order. */
export const LEGAL_AREA_LIST = Object.freeze(Object.values(LEGAL_AREAS).flat());
export const LEGAL_AREA_IDS = Object.freeze(LEGAL_AREA_LIST.map((a) => a.id));

export function legalArea(id) {
  return LEGAL_AREA_LIST.find((a) => a.id === id) ?? null;
}

/** Throws nothing; returns problems of the taxonomy (empty = valid). */
export function validateLegalAreas() {
  const problems = [];
  const ids = new Set();
  for (const a of LEGAL_AREA_LIST) {
    if (ids.has(a.id)) problems.push(`${a.id}: duplicate`);
    ids.add(a.id);
    if (!LEGAL_AREA_GROUPS[a.id.split('.')[0]]) problems.push(`${a.id}: unknown group`);
    for (const t of a.kbTopics) if (!KB_TOPICS.includes(t)) problems.push(`${a.id}: unknown library topic ${t}`);
    for (const c of a.euBasis) if (!/^3\d{4}[A-Z]\d{4}$/.test(c)) problems.push(`${a.id}: bad CELEX ${c}`);
  }
  return problems;
}
