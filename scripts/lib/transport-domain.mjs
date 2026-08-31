// Deterministic road/freight-domain gate. A keyword such as "permit" or
// "authorisation" is not enough by itself: the candidate must also prove a
// connection to road transport, heavy/exceptional vehicles, routing, tolls,
// escorts, borders or road infrastructure.

export const ROAD_TRANSPORT_CONTEXT =
  /exceptional transport|exceptional vehicle|oversize|oversized|abnormal load|wide load|heavy transport|special transport|ausnahmetransport|ausnahmefahr|schwertransport|gro[ßs]raum|sondertransport|convoi exceptionnel|transport exceptionnel|trasporto eccezionale|transporte especial|transporte excepcional|izvanredni prijevoz|agabaritic|nadrozm[eě]rn|nadmerný|road|roads|roadway|motorway|highway|autobahn|bundesstra[ßs]e|straße|strasse|autoroute|route nationale|autostrada|strada statale|carretera|autopista|drum național|autostradă|silnice|dálnice|cesta|diaľnica|avtocesta|cestn|bridge|brücke|brucke|pont|ponte|most|tunnel|tunel|traffic|verkehr|circulation|trafico|tráfico|traffico|promet|freight|cargo|project cargo|heavy haul|heavy-haul|hgv|lorry|truck|tractor unit|prime mover|low loader|low-loader|lowbed|low-bed|semi lowloader|modular trailer|SPMT|crane|telemetric|telematics|routing API|camion|camión|camione|kamion|nákladn|nakladn|toll|vignette|m[aý]to|maut|péage|pedaggio|peaje|rinkliav|vehicle|fahrzeug|véhicule|veh[ií]culo|veicolo|vozidlo|axle|achslast|essieu|assale|weight limit|height limit|width limit|s[uú]lykorl[aá]toz|escort|begleit|ausnahmetransportbegleit|pilot vehicle|doprovod|sprievod|accompagnement|border crossing|grenz[uü]bergang|hrani[cč]n|permit.*(?:road|vehicle|transport)|(?:road|vehicle|transport).*permit/i;

export function checkTransportDomainRelevance(candidate = {}) {
  if (candidate.isOfficialCalendar) return { ok: true };

  const text = [
    candidate.title,
    candidate.summary,
    candidate.whatChanged,
    candidate.location,
    candidate.routeScope,
    candidate.vehicleScope,
    candidate.impact,
    candidate.sourceName,
  ].filter(Boolean).join(' ');

  if (!ROAD_TRANSPORT_CONTEXT.test(text)) {
    return {
      ok: false,
      reason: 'no demonstrated road/freight/exceptional-transport context',
    };
  }

  return { ok: true };
}
