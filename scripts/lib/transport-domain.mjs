// Deterministic heavy-transport domain gate.
//
// The candidate's OWN content must show a connection to heavy, abnormal,
// oversized or special road transport: a heavy/goods vehicle, an
// exceptional-transport term, a weight/dimension/axle limit, an escort or
// transport permit, a truck toll, freight/project-cargo handling, a goods
// border crossing or freight-operations rules. Generic words such as "road",
// "tunnel", "bridge", "traffic" or "vehicle" are not enough, and the source's
// name never counts: a page from a "Roads Administration" is not heavy-transport
// intelligence merely because of who published it. (That is how a pedestrian
// tunnel, battery wheel loaders and a ministry homepage reached the W41 edition.)
//
// The one exception is the closure rule (DAJC_WEEKLY_INTELLIGENCE_SPEC.md §6):
// a motorway/national-road closure with a proven planned duration of more
// than 30 days matters for heavy-transport routing without further wording.

import { checkLongRoadClosure } from './closure-duration.mjs';
import { looksBinary } from './text-quality.mjs';

export const HEAVY_TRANSPORT_CONTEXT = new RegExp([
  // exceptional / abnormal / oversize transport
  'exceptional (?:transport|load|vehicle|convoy)', 'abnormal (?:indivisible )?(?:load|transport|vehicle)',
  'over-?sized?', 'over-?dimension', 'wide load', 'heavy[- ]haul', 'heavy (?:transport|lift)', 'special transport',
  'indivisible load', 'ausnahmetransport', 'ausnahmefahr', 'schwertransport', 'schwerlast', 'gro(?:ß|ss)raum',
  'sondertransport', 'convois? exceptionnels?', 'transports? exceptionnels?', 'trasport[oi] eccezional[ei]',
  'veicoli eccezionali', 'transportes? especial(?:es)?', 'transporte excepcional', 'izvanredn[ia] prijevoz',
  'izredni prevoz', 'vanredni prevoz', 'nadrozm[eě]rn', 'nadm[eě]rn', 'nadgabaryt', 'ponadnormatyw',
  't[uú]lm[eé]retes', 'agabaritic', 'exceptionee?le? transport', 'uitzonderlijk vervoer', 'spesialtransport',
  'specialtransport', 'dispenstransport', 'erikoiskuljetus',
  // heavy goods vehicles
  '\\bhgvs?\\b', '\\blgvs?\\b', 'heavy goods vehicle', 'heavy vehicle', 'goods vehicle', '\\blorr(?:y|ies)\\b',
  '\\btrucks?\\b', '\\blkw\\b', 'lkw-', 'lastwagen', 'schwerverkehr', 'g(?:ü|ue)terverkehr', 'nutzfahrzeug', 'sattelz(?:u|ü)g',
  'autocarr', 'cami(?:ã|a)o', 'cami(?:õ|o)es', '\\bkamyon',
  'poids lourds?', 'v[ée]hicules lourds', '\\bcamion', '\\bcami[oó]n', 'mezzi pesanti', 'veicoli pesanti',
  've(?:h|í)[ií]culos pesados', 'n[aá]kladn[ií]', 'n[aá]kladn[yý]ch', '\\bkamion', 'ci[eę](?:ż|z)arow',
  'teherg[eé]pj[aá]rm', 'tovorn', 'teretn', 'te(?:š|s)ka vozila', 'sunkiasvor', 'kravas', 'raskas',
  'lastebil', 'lastbil', 'vrachtwagen', 'vrachtverkeer', 'vrachtauto',
  // freight/cargo only when not explicitly rail, air or sea (an aviation
  // cargo-screening notice is not road intelligence)
  '(?<!rail |air |sea |rail-|air-)freight(?! trains?\\b)', 'haulage', 'hauliers?', 'road transport operators?',
  // weight / dimension / axle limits
  'weight (?:limit|restriction)', 'load limit', 'tonnage', '\\b\\d+(?:[.,]\\d+)?\\s?(?:t|tonnes?|tons?|tonnen|tona|tony)\\b',
  'axle (?:load|weight)', 'achslast', 'gewichtsbeschr(?:ä|ae)nk', 'h(?:ö|oe)henbeschr(?:ä|ae)nk', 'durchfahrtsh(?:ö|oe)he',
  'breitenbeschr(?:ä|ae)nk', 'height (?:limit|restriction)', 'width (?:limit|restriction)', 'limitation de (?:tonnage|poids|hauteur)',
  'essieu', 'limite di (?:peso|massa)', 'carico per asse', 'l[ií]mite de peso', 'nosnost', 'ton[aá](?:ž|z)', 'hmotnost',
  'v[yý](?:š|s)kov', '(?:š|s)[ií](?:ř|r)k', 'osovin', 'no(?:ś|s)no(?:ś|s)', 'nacisk na o(?:ś|s)', 's[uú]lykorl[aá]toz',
  'tengelyterhel', 'osna obremenitev', 'nosivost',
  // escorts and transport permits
  'escort', 'pilot (?:vehicle|car)', 'begleitfahrzeug', 'transportbegleit', 'polizeibegleit',
  'doprovod.{0,30}(?:p(?:ř|r)eprav|vozid|kolon)', 'sprievod.{0,30}(?:preprav|vozid|kolón)',
  'pilot(?:á|a)(?:ž|z)', 'pilotow', 'accompagnement.{0,30}(?:convoi|transport)', 'v[ée]hicule pilote', 'scorta tecnica', 'veh[ií]culo piloto',
  'pratnj', 'spremstv', 'k[ií]s[eé]ret',
  '(?:transport|vehicle|route|movement|haulage) (?:permit|authori[sz]ation)', '(?:permit|authori[sz]ation) (?:for|to) (?:transport|move|vehicle)',
  'vemags', 'esdal', '(?:genehmigung|erlaubnis|bewilligung).{0,40}(?:transport|fahrzeug)', 'povolen[ií].{0,40}(?:p(?:ř|r)eprav|j[ií]zd|vozid)',
  'zezwoleni.{0,40}(?:przejazd|pojazd)', 'dozvol.{0,40}(?:prijevoz|prevoz)', 'autorisation.{0,40}(?:transport|convoi)',
  'autorizzazion.{0,40}(?:trasport|transit)',
  // tolls / road charges
  '\\btolls?\\b', 'tolling', 'road (?:user )?charg', '\\bmaut', 'm(?:ý|y)t(?:o|n)', 'p(?:é|e)age', 'pedaggi', 'peaje',
  'portage', 'tolheffing', 'vrachtwagenheffing', 'kilometerheffing', 'vignet', 'hu-go', 'via ?toll', 'e-?toll',
  'go-box', 'eurovignet', 'rinkliav', 'keli(?:ų|u) mokest', 'cestnin', 'cestarin',
  // freight logistics: ports, ferries, borders, freight operations rules
  'ferry', 'ferries', 'ro-?ro', 'eurotunnel', 'project cargo', 'border (?:crossing|checkpoint)', 'grenz(?:ü|ue)bergang',
  'hrani(?:č|c)n(?:í|i) p(?:ř|r)echod', 'przej(?:ś|s)cie graniczne', 'grani(?:č|c)ni prijelaz', 'hat[aá]r[aá]tkel',
  'customs', '\\bzoll', 'douane', 'dogana', 'aduana', 'tachogra', 'fahrtenschreiber', 'driving time', 'lenkzeit',
  'e-?cmr', 'cabotage', 'kabotage', 'mobility package', '\\badr\\b', 'dangerous goods', 'gefahrgut',
  'mati(?:è|e)res dangereuses', 'merci pericolose', 'mercanc(?:í|i)as peligrosas',
  // heavy-haul equipment
  'low[- ]?loader', 'low[- ]?bed', 'tieflader', 'semi-?trailer', 'auflieger', 'modular trailer', '\\bspmts?\\b',
  'self-propelled modular', 'mobile crane', '\\bcranes?\\b', 'autokran', 'rotorbl(?:a|ä)tt', 'turbine blade',
].join('|'), 'i');

const ROAD_NETWORK_CONTEXT =
  /motorway|autobahn|autoroute|autostrad|autopista|auto-estrada|snelweg|d[aá]lnic|dia[lľ]nic|autocest|avtocest|aut[oó]p[aá]ly|expressway|schnellstra(?:ß|ss)e|rychlostn[ií] silnic|droga ekspresowa|national road|bundesstra(?:ß|ss)e|route nationale|strada statale|carretera nacional|\b[ADEMNRS]\d{1,3}\b/i;

// Broad road/freight context used only by the daily monitor when deciding
// what to RECORD (data collection is deliberately not pruned by editorial
// rules, and - as before - a road authority's own name counts as context).
// What may be PUBLISHED is decided by checkTransportDomainRelevance below.
const ROAD_CONTEXT_FOR_INGESTION =
  /exceptional transport|exceptional vehicle|oversize|oversized|abnormal load|wide load|heavy transport|special transport|ausnahmetransport|ausnahmefahr|schwertransport|gro[ßs]raum|sondertransport|convoi exceptionnel|transport exceptionnel|trasporto eccezionale|transporte especial|transporte excepcional|izvanredni prijevoz|agabaritic|nadrozm[eě]rn|nadmerný|road|roads|roadway|motorway|highway|autobahn|bundesstra[ßs]e|straße|strasse|autoroute|route nationale|autostrada|strada statale|carretera|autopista|drum național|autostradă|silnice|dálnice|cesta|diaľnica|avtocesta|cestn|bridge|brücke|brucke|\bpont\b|\bponte\b|\bmost\b|tunnel|tunel|traffic|verkehr|circulation|trafico|tráfico|traffico|promet|freight|cargo|heavy haul|heavy-haul|hgv|lorry|truck|tractor unit|low loader|low-loader|lowbed|low-bed|modular trailer|SPMT|crane|telematics|camion|camión|camione|kamion|nákladn|nakladn|toll|vignette|m[aý]to|maut|péage|pedaggio|peaje|rinkliav|vehicle|fahrzeug|véhicule|veh[ií]culo|veicolo|vozidlo|axle|achslast|essieu|assale|weight limit|height limit|width limit|escort|begleit|pilot vehicle|doprovod|sprievod|accompagnement|border crossing|grenz[uü]bergang|hrani[cč]n/i;

export function checkIngestionRoadContext(candidate = {}) {
  const text = [candidate.title, candidate.summary, candidate.sourceName].filter(Boolean).join(' ');
  return ROAD_CONTEXT_FOR_INGESTION.test(text)
    ? { ok: true }
    : { ok: false, reason: 'no road/freight context' };
}

function candidateText(candidate) {
  // Deliberately excludes sourceName and location: an authority's name says
  // who published the page, not what the page is about.
  return [
    candidate.title,
    candidate.summary,
    candidate.whatChanged,
    candidate.vehicleScope,
    candidate.impact,
  ].filter((part) => part && !looksBinary(part)).join(' ');
}

export function checkTransportDomainRelevance(candidate = {}) {
  const text = candidateText(candidate);

  if (HEAVY_TRANSPORT_CONTEXT.test(text)) return { ok: true };

  const closure = checkLongRoadClosure(candidate);
  if (closure.ok && closure.durationDays > 30 && ROAD_NETWORK_CONTEXT.test(text)) return { ok: true };

  return {
    ok: false,
    reason: 'no demonstrated heavy/abnormal/oversize road-transport context (a generic road, tunnel or bridge mention is not enough)',
  };
}
