// Primary-source-verified additions found by the 24 Sep 2026 full driving-ban audit.
// Keep this layer limited to verified gaps not yet represented in the base registry.

const DAY = 86400000;
const fmt = (d) => d.toISOString().slice(0, 10);
const addDays = (d, n) => new Date(d.getTime() + n * DAY);
const humanDate = (iso) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${iso}T00:00:00Z`));

function seededRule(rule) {
  return {
    ...rule,
    kind: 'annual-calendar',
    validYear: 2026,
    lastVerified: '2026-09-24',
    resolve(weekStart, weekEnd, year) {
      if (year !== 2026) return { occurrences: [] };
      const from = fmt(weekStart);
      const to = fmt(weekEnd);
      return { occurrences: this.seededPeriods.filter((p) => p.validTo >= from && p.validFrom <= to) };
    },
  };
}

const SPAIN_SOURCE = 'https://www.boe.es/eli/es/res/2026/01/14/(1)';
const SPAIN_SOURCE_NAME = 'BOE / DGT - 2026 special traffic-regulation resolution, Annex II';
const SPAIN_LEGAL = 'DGT 2026 Resolution, Annex II - restrictions for vehicles above 7.5t, vehicles requiring complementary circulation authorisation, and special vehicles (B.1.1 / B.3.1)';
const SPAIN_SCOPE = 'Vehicles/combinations above 7.5t; the same Annex II calendar also applies to vehicles requiring complementary circulation authorisation and special vehicles, subject to the published exemptions.';
const SPAIN_EXEMPTIONS = 'Use the exemptions in sections B.1.2 and B.3.2 of the DGT resolution. The road, kilometre limits, direction and date/time are decisive. Catalonia, the Basque Country and Navarre have separate competent traffic authorities and are not inferred from DGT coverage.';

export const verifiedSepOct2026DrivingBans = [
  seededRule({
    id: 'at-2026-october-transit-corridor-ban',
    country: 'AT', countryName: 'Austria', restrictionTypes: ['general', 'exceptional'],
    sourceUrl: 'https://www.ris.bka.gv.at/eli/bgbl/ii/2026/77/P1/NOR40276924',
    sourceName: 'RIS - Fahrverbotskalender 2026, BGBl. II Nr. 77/2026 § 1',
    legalBasis: 'Fahrverbotskalender 2026 § 1',
    vehicleScope: 'Goods/articulated vehicles above 7.5t and goods vehicles with trailers whose combined maximum authorised mass exceeds 7.5t',
    routeScope: 'A12 Inntal and A13 Brenner Autobahn where the destination is Germany or a country reached via Germany',
    exemptionNotes: 'Apply the current statutory exemptions and destination conditions; this restriction is additional to the nationwide weekend ban.',
    seededPeriods: [{
      validFrom: '2026-10-03', validTo: '2026-10-03',
      title: 'A12/A13 Germany-bound transit restriction (3 October 2026)',
      timeWindow: 'Saturday 3 October 2026 00:00-15:00',
      whatChanged: 'The 2026 Fahrverbotskalender imposes an additional Germany-bound/via-Germany HGV restriction on the A12 and A13.',
      impact: 'Affected HGVs cannot use the stated A12/A13 corridor toward Germany or onward via Germany during the window unless an exemption applies.',
      recommendedAction: 'Do not route an affected Germany-bound/via-Germany movement on the A12/A13 during 00:00-15:00; recheck the order and permit conditions before dispatch.',
    }],
  }),

  seededRule({
    id: 'at-2026-lueg-brenner-special-ban',
    country: 'AT', countryName: 'Austria', restrictionTypes: ['general', 'exceptional'],
    sourceUrl: 'https://ris.bka.gv.at/eli/bgbl/ii/2025/338/P1/NOR40276795',
    sourceName: 'RIS - Lkw-Fahrverbote Generalerneuerung Luegbrücke 2026 § 1',
    legalBasis: 'Special 2026 HGV restrictions connected with the Lueg Bridge renewal',
    vehicleScope: 'Goods/articulated vehicles above 7.5t and goods vehicles with trailers whose combined maximum authorised mass exceeds 7.5t',
    routeScope: 'A12 Inntal, A13 Brenner and A14 Rheintal/Walgau where the destination is reached via the A13 Nößlach-Brenner Nord section toward the state border',
    exemptionNotes: 'Destination and statutory exceptions must be checked in the current consolidated regulation.',
    seededPeriods: [
      { validFrom: '2026-10-02', validTo: '2026-10-02', title: 'Lueg/Brenner corridor special HGV restriction (2 October 2026)', timeWindow: 'Friday 2 October 2026 07:00-22:00', whatChanged: 'The Lueg Bridge renewal regulation imposes a special HGV restriction on the defined A12/A13/A14 route condition.', impact: 'Affected HGVs cannot use the defined corridor toward the Brenner state-border route during the window unless an exemption applies.', recommendedAction: 'Revalidate the exact route/destination condition and any permit exemption before using the Brenner corridor.' },
      { validFrom: '2026-10-03', validTo: '2026-10-03', title: 'Lueg/Brenner corridor special HGV restriction (3 October 2026)', timeWindow: 'Saturday 3 October 2026 07:00-15:00', whatChanged: 'The Lueg Bridge renewal regulation imposes a special HGV restriction on the defined A12/A13/A14 route condition.', impact: 'Affected HGVs cannot use the defined corridor toward the Brenner state-border route during the window unless an exemption applies.', recommendedAction: 'Revalidate the exact route/destination condition and any permit exemption before using the Brenner corridor.' },
    ],
  }),

  {
    id: 'li-sunday-night-ban', country: 'LI', countryName: 'Liechtenstein', kind: 'standing-rule', restrictionTypes: ['general', 'exceptional'],
    sourceUrl: 'https://www.llv.li/de/landesverwaltung/amt-fuer-strassenverkehr/sonderbewilligung/sonntags-und-nachtfahrtsbewilligung',
    sourceName: 'Liechtenstein Amt für Strassenverkehr - Sonntags- und Nachtfahrbewilligung',
    legalBasis: 'Standing Sunday/public-holiday and night driving-ban regime',
    vehicleScope: 'Heavy motor vehicles above 3.5t; commercial tractors/work vehicles above 3.5t; articulated vehicles above 5t; vehicles towing a trailer above 3.5t',
    routeScope: 'Liechtenstein road network',
    exemptionNotes: 'Published exemptions apply; other urgent journeys require a special permit. Exceptional transports also need their separate special-transport authorisation.',
    lastVerified: '2026-09-24',
    resolve(weekStart) {
      const sunday = fmt(addDays(weekStart, 6));
      return { occurrences: [{ title: `Sunday and nightly HGV driving ban (${humanDate(sunday)})`, whatChanged: 'Liechtenstein applies a nightly 22:00-05:00 ban every day and an all-day Sunday/public-holiday ban to the affected heavy vehicle classes.', validFrom: sunday, validTo: sunday, timeWindow: `Night ban every day 22:00-05:00; Sunday ${humanDate(sunday)} all day`, impact: 'Affected vehicles require a valid exception/permit to move during the nightly or Sunday/public-holiday restriction.', recommendedAction: 'Plan ordinary HGV movements outside the night/Sunday windows or obtain the required permit.' }] };
    },
  },

  {
    id: 'lu-directional-weekend-transit-ban', country: 'LU', countryName: 'Luxembourg', kind: 'standing-rule', restrictionTypes: ['general', 'exceptional'],
    sourceUrl: 'https://police.public.lu/en/legislation/code-de-la-route/routiers-poids-lourds1.html',
    sourceName: 'Police Grand-Ducale - Driving bans on heavy goods vehicles',
    legalBasis: 'Grand-Ducal regulation of 19 July 1997 on Sunday/public-holiday HGV transit restrictions',
    vehicleScope: 'Transit goods vehicles above 7.5t with or without trailer',
    routeScope: 'Transit through Luxembourg heading to France or Germany; transit toward Belgium and domestic Luxembourg transport are not covered by this rule',
    exemptionNotes: 'Direction is decisive. Parking on public roads/rest areas is also prohibited for vehicles subject to the ban during the restriction period.',
    lastVerified: '2026-09-24',
    resolve(weekStart) {
      const saturday = fmt(addDays(weekStart, 5));
      const sunday = fmt(addDays(weekStart, 6));
      return { occurrences: [{ title: `Directional weekend transit ban (${humanDate(saturday)}-${humanDate(sunday)})`, whatChanged: 'Luxembourg restricts >7.5t transit HGVs heading to France or Germany on weekends, with different start times by destination direction.', validFrom: saturday, validTo: sunday, timeWindow: `Toward France: Saturday ${humanDate(saturday)} 21:30 to Sunday ${humanDate(sunday)} 21:45; toward Germany: Saturday ${humanDate(saturday)} 23:30 to Sunday ${humanDate(sunday)} 21:45`, impact: 'Affected transit HGVs cannot continue toward France/Germany during the applicable direction-specific window.', recommendedAction: 'Determine the onward destination before applying the rule; do not treat it as a blanket domestic or Belgium-bound ban.' }] };
    },
  },

  seededRule({
    id: 'lu-german-unity-day-2026', country: 'LU', countryName: 'Luxembourg', restrictionTypes: ['general', 'exceptional'],
    sourceUrl: 'https://police.public.lu/en/legislation/code-de-la-route/routiers-poids-lourds1.html',
    sourceName: 'Police Grand-Ducale - Driving bans on heavy goods vehicles',
    legalBasis: 'Grand-Ducal regulation of 19 July 1997; German National Holiday transit restriction',
    vehicleScope: 'Transit goods vehicles above 7.5t with or without trailer heading to Germany',
    routeScope: 'Luxembourg transit traffic heading to Germany',
    exemptionNotes: 'Direction-specific rule; it does not cover domestic Luxembourg traffic or transit toward Belgium.',
    seededPeriods: [{ validFrom: '2026-10-02', validTo: '2026-10-03', title: 'Germany-bound transit ban for German Unity Day', timeWindow: 'Friday 2 October 2026 23:30 to Saturday 3 October 2026 21:45', whatChanged: 'The German National Holiday on 3 October activates Luxembourg’s public-holiday transit ban for >7.5t HGVs heading to Germany.', impact: 'Germany-bound transit HGVs above 7.5t cannot proceed through Luxembourg during the holiday window.', recommendedAction: 'Hold Germany-bound transit outside the window or verify a lawful exemption before departure.' }],
  }),

  seededRule({
    id: 'me-2026-r1-kotor-cetinje-hgv-ban', country: 'ME', countryName: 'Montenegro', restrictionTypes: ['general', 'exceptional'],
    sourceUrl: 'https://www.gov.me/clanak/obavjestenje-naredba-o-privremenoj-zabrani-saobracaja-teretnih-motornih-vozila-i-ogranicavanju-saobracaja-svih-kategorija-vozila-na-odredenim-putnim-pravcima-2',
    sourceName: 'Government of Montenegro / Police Directorate - 2026 temporary HGV traffic order',
    legalBasis: 'Police Directorate order under Article 130 of the Road Traffic Safety Law',
    vehicleScope: 'Goods motor vehicles with maximum authorised mass above 7.5t',
    routeScope: 'R-1 from Kotor-Trojica (M-1 junction) to Krstac (R-25 junction), Municipality of Cetinje',
    exemptionNotes: 'Use the current official order and road instructions for exceptions/operational changes; the M-1/M-2/M-10 summer bans ended on 15 September.',
    seededPeriods: [{ validFrom: '2026-09-24', validTo: '2026-10-15', title: 'R-1 Kotor-Cetinje seasonal HGV restriction through 15 October', timeWindow: 'Every day through 15 October 2026, 07:00-24:00', whatChanged: 'The verified 2026 order restricts >7.5t goods vehicles daily on the stated R-1 section through 15 October.', impact: 'Affected HGVs cannot use the stated R-1 section between 07:00 and 24:00 during the validity period.', recommendedAction: 'Use an authorised alternative or schedule only when legally allowed; abnormal-load routing must also satisfy permit conditions.' }],
  }),

  seededRule({
    id: 'es-dgt-2026-oct08-annex-ii', country: 'ES', countryName: 'Spain', restrictionTypes: ['general', 'exceptional'],
    sourceUrl: SPAIN_SOURCE, sourceName: SPAIN_SOURCE_NAME, legalBasis: SPAIN_LEGAL, vehicleScope: SPAIN_SCOPE,
    routeScope: 'A-3 km 352 Valencia to km 292 Requena, direction outbound from Valencia.', exemptionNotes: SPAIN_EXEMPTIONS,
    seededPeriods: [{ validFrom: '2026-10-08', validTo: '2026-10-08', title: 'DGT Annex II HGV / special-vehicle restriction - El Pilar outbound (8 October)', timeWindow: 'Thursday 8 October 2026 15:00-21:00', whatChanged: 'DGT Annex II restricts the A-3 from Valencia km 352 to Requena km 292 in the outbound direction.', impact: 'Affected >7.5t goods vehicles, vehicles requiring complementary circulation authorisation and special vehicles cannot use the listed section during the window unless an exemption applies.', recommendedAction: 'Route outside the window or verify an applicable DGT exemption before dispatch.' }],
  }),

  seededRule({
    id: 'es-dgt-2026-oct09-annex-ii', country: 'ES', countryName: 'Spain', restrictionTypes: ['general', 'exceptional'],
    sourceUrl: SPAIN_SOURCE, sourceName: SPAIN_SOURCE_NAME, legalBasis: SPAIN_LEGAL, vehicleScope: SPAIN_SCOPE,
    routeScope: '9 Oct: A-6/AP-6 Madrid M-40 km 11.65-San Rafael km 61.3 outbound; AP-6/A-6 San Rafael km 61.3-Tordesillas km 182 toward A Coruña; A-1 km 11.8-50 outbound Madrid; A-2 km 18.3-38.7 outbound; R-2 km 17.1-37.5 outbound; A-3 km 13-80.4 both directions; R-3 km 7.3-29.4 outbound; A-4 km 17.3-62 outbound; R-4 km 0-52.5 outbound; A-5 km 15.6-106 both directions; R-5 km 15-30.5 outbound; N-6 km 42.5-62.5 outbound; M-501 km 4-59.5 outbound; A-62 km 113-151 toward Portugal; A-3 km 275-352 inbound Valencia; A-8 km 139.2-169 toward Santander; N-230 sections km 64.1-116.1, 119.5-120.9 and 133.6-149.2 toward France.', exemptionNotes: SPAIN_EXEMPTIONS,
    seededPeriods: [{ validFrom: '2026-10-09', validTo: '2026-10-09', title: 'DGT Annex II HGV / special-vehicle restrictions - El Pilar outbound (9 October)', timeWindow: 'Friday 9 October 2026: mostly 16:00-22:00; A-62 15:00-23:00; A-3 Utiel-Valencia 13:00-22:00; A-8 17:00-21:00; N-230 17:00-24:00', whatChanged: 'DGT Annex II sets route-, kilometre- and direction-specific restrictions on the listed corridors for the El Pilar traffic period.', impact: 'Affected HGV/special-vehicle movements are blocked on the listed segments during each segment’s published time window unless an exemption applies.', recommendedAction: 'Match the exact planned road, kilometre interval and direction to Annex II before dispatch.' }],
  }),

  seededRule({
    id: 'es-dgt-2026-oct10-annex-ii', country: 'ES', countryName: 'Spain', restrictionTypes: ['general', 'exceptional'],
    sourceUrl: SPAIN_SOURCE, sourceName: SPAIN_SOURCE_NAME, legalBasis: SPAIN_LEGAL, vehicleScope: SPAIN_SCOPE,
    routeScope: '10 Oct: A-6/AP-6 Madrid M-40 km 11.65-San Rafael km 61.3 outbound; AP-6/A-6 San Rafael km 61.3-Tordesillas km 182 toward A Coruña; A-1 km 11.8-50 outbound; A-2 km 18.3-38.7 outbound; R-2 km 17.1-37.5 outbound; A-3 km 13-80.4 both directions; R-3 km 7.3-29.4 outbound; A-4 km 17.3-62 outbound; R-4 km 0-52.5 outbound; A-5 km 15.6-106 both directions; R-5 km 15-30.5 outbound; N-6 km 42.5-62.5 outbound; M-501 km 4-59.5 outbound; A-62 km 113-151 toward Portugal; A-8 km 139.2-169 toward Santander.', exemptionNotes: SPAIN_EXEMPTIONS,
    seededPeriods: [{ validFrom: '2026-10-10', validTo: '2026-10-10', title: 'DGT Annex II HGV / special-vehicle restrictions - El Pilar outbound (10 October)', timeWindow: 'Saturday 10 October 2026: 08:00-15:00 or 08:00-13:00 by segment; A-8 10:00-15:00', whatChanged: 'DGT Annex II continues route-specific outbound restrictions on the listed corridors for the El Pilar traffic period.', impact: 'Affected HGV/special-vehicle movements are blocked on the listed segments during each segment’s published time window unless an exemption applies.', recommendedAction: 'Match the exact planned road, kilometre interval and direction to Annex II before dispatch.' }],
  }),

  seededRule({
    id: 'es-dgt-2026-oct12-annex-ii', country: 'ES', countryName: 'Spain', restrictionTypes: ['general', 'exceptional'],
    sourceUrl: SPAIN_SOURCE, sourceName: SPAIN_SOURCE_NAME, legalBasis: SPAIN_LEGAL, vehicleScope: SPAIN_SCOPE,
    routeScope: '12 Oct return restrictions: A-1 Boceguillas km 118.3-Madrid M-40 km 11.8; A-2 Almadrones km 102-Madrid km 10.8; A-3 Atalaya km 177-Madrid km 6.9 and Arganda km 25-Tarancón km 80.4; A-4 Madridejos km 122-Madrid km 6.7; A-5 Talavera km 126-Madrid km 11.8 plus Madrid M-50 km 15.6-Talavera km 126; A-6 Tordesillas km 184-Arévalo km 123, Arévalo km 123-Adanero km 110 and Las Rozas km 22.3-Madrid km 6.8; AP-6 Adanero km 110-San Rafael km 60.5; N-6 km 110-42.5; AP-51 Ávila km 104.8-Villacastín km 81.8; AP-61 Segovia km 88.55-San Rafael km 61.5; N-110 km 246-228; N-603 km 74.9-64; M-501 km 59.5-0; A-62 Tordesillas km 151-Valladolid km 125 toward Burgos; A-1/AP-1/N-1 toward Vitoria; A-8 Laredo km 169-Castro-Urdiales km 139.2 toward Bilbao; A-3 Valencia/Requena both outbound/inbound segments; N-230 listed sections toward Benabarre.', exemptionNotes: SPAIN_EXEMPTIONS,
    seededPeriods: [{ validFrom: '2026-10-12', validTo: '2026-10-12', title: 'DGT Annex II HGV / special-vehicle return restrictions - El Pilar (12 October)', timeWindow: 'Monday 12 October 2026: mainly 16:00-22:00/24:00; A-62 15:00-23:00; A-3 Valencia outbound 09:00-21:00 and inbound 13:00-21:00; N-230 13:00-20:00', whatChanged: 'DGT Annex II sets the return-phase restrictions on the listed Madrid, northern, Valencia and N-230 corridors.', impact: 'Affected HGV/special-vehicle movements are blocked on the listed segments during each segment’s published time window unless an exemption applies.', recommendedAction: 'Match the exact planned road, kilometre interval and direction to Annex II before dispatch.' }],
  }),

  seededRule({
    id: 'es-dgt-2026-oct30-annex-ii', country: 'ES', countryName: 'Spain', restrictionTypes: ['general', 'exceptional'],
    sourceUrl: SPAIN_SOURCE, sourceName: SPAIN_SOURCE_NAME, legalBasis: SPAIN_LEGAL, vehicleScope: SPAIN_SCOPE,
    routeScope: '30 Oct: A-6/AP-6 Madrid M-40 km 11.65-San Rafael km 61.3 outbound; AP-6/A-6 San Rafael km 61.3-Tordesillas km 182 toward A Coruña; A-1 km 11.8-50 outbound; A-2 km 18.3-38.7 outbound; R-2 km 17.1-37.5 outbound; A-3 km 13-80.4 both directions; R-3 km 7.3-29.4 outbound; A-4 km 17.3-62 outbound; R-4 km 0-52.5 outbound; A-5 km 15.6-106 both directions; R-5 km 15-30.5 outbound; N-6 km 42.5-62.5 outbound; M-501 km 4-59.5 outbound; A-62 km 113-151 toward Portugal; A-3 km 275-352 inbound Valencia; A-8 km 139.2-169 toward Santander.', exemptionNotes: SPAIN_EXEMPTIONS,
    seededPeriods: [{ validFrom: '2026-10-30', validTo: '2026-10-30', title: 'DGT Annex II HGV / special-vehicle restrictions - All Saints outbound (30 October)', timeWindow: 'Friday 30 October 2026: mostly 16:00-22:00; A-62 15:00-23:00; A-3 Utiel-Valencia 15:00-22:00; A-8 17:00-21:00', whatChanged: 'DGT Annex II sets route-specific outbound restrictions on the listed corridors for the All Saints traffic period.', impact: 'Affected HGV/special-vehicle movements are blocked on the listed segments during each segment’s published time window unless an exemption applies.', recommendedAction: 'Match the exact planned road, kilometre interval and direction to Annex II before dispatch.' }],
  }),

  seededRule({
    id: 'es-dgt-2026-oct31-annex-ii', country: 'ES', countryName: 'Spain', restrictionTypes: ['general', 'exceptional'],
    sourceUrl: SPAIN_SOURCE, sourceName: SPAIN_SOURCE_NAME, legalBasis: SPAIN_LEGAL, vehicleScope: SPAIN_SCOPE,
    routeScope: '31 Oct: A-6/AP-6 Madrid M-40 km 11.65-San Rafael km 61.3 outbound; AP-6/A-6 San Rafael km 61.3-Tordesillas km 182 toward A Coruña; A-1 km 11.8-50 outbound; A-2 km 18.3-38.7 outbound; R-2 km 17.1-37.5 outbound; A-3 km 13-80.4 both directions; R-3 km 7.3-29.4 outbound; A-4 km 17.3-62 outbound; R-4 km 0-52.5 outbound; A-5 km 15.6-106 both directions; R-5 km 15-30.5 outbound; N-6 km 42.5-62.5 outbound; M-501 km 4-59.5 outbound; A-62 km 113-151 toward Portugal; A-8 km 139.2-169 toward Santander.', exemptionNotes: SPAIN_EXEMPTIONS,
    seededPeriods: [{ validFrom: '2026-10-31', validTo: '2026-10-31', title: 'DGT Annex II HGV / special-vehicle restrictions - All Saints outbound (31 October)', timeWindow: 'Saturday 31 October 2026: 08:00-15:00 or 08:00-13:00 by segment; A-8 11:00-14:00', whatChanged: 'DGT Annex II continues route-specific outbound restrictions on the listed corridors for the All Saints traffic period.', impact: 'Affected HGV/special-vehicle movements are blocked on the listed segments during each segment’s published time window unless an exemption applies.', recommendedAction: 'Match the exact planned road, kilometre interval and direction to Annex II before dispatch.' }],
  }),
];
