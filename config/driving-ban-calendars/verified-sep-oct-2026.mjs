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
    sourceUrl: 'https://www.gov.me/amp/clanak/obavjestenje-naredba-o-privremenoj-zabrani-saobracaja-teretnih-motornih-vozila-i-ogranicavanju-saobracaja-svih-kategorija-vozila-na-odredenim-putnim-pravcima-2',
    sourceName: 'Government of Montenegro / Police Directorate - 2026 temporary HGV traffic order',
    legalBasis: 'Police Directorate order under Article 130 of the Road Traffic Safety Law',
    vehicleScope: 'Goods motor vehicles with maximum authorised mass above 7.5t',
    routeScope: 'R-1 from Kotor-Trojica (M-1 junction) to Krstac (R-25 junction), Municipality of Cetinje',
    exemptionNotes: 'Use the current official order and road instructions for exceptions/operational changes; the M-1/M-2/M-10 summer bans ended on 15 September.',
    seededPeriods: [{ validFrom: '2026-09-24', validTo: '2026-10-15', title: 'R-1 Kotor-Cetinje seasonal HGV restriction through 15 October', timeWindow: 'Every day through 15 October 2026, 07:00-24:00', whatChanged: 'The verified 2026 order restricts >7.5t goods vehicles daily on the stated R-1 section through 15 October.', impact: 'Affected HGVs cannot use the stated R-1 section between 07:00 and 24:00 during the validity period.', recommendedAction: 'Use an authorised alternative or schedule only when legally allowed; abnormal-load routing must also satisfy permit conditions.' }],
  }),

  seededRule({
    id: 'es-dgt-2026-sep-oct-selected-hgv-restrictions', country: 'ES', countryName: 'Spain', restrictionTypes: ['general', 'exceptional'],
    sourceUrl: 'https://www.boe.es/buscar/act.php?id=BOE-A-2026-1255',
    sourceName: 'BOE / DGT - 2026 special traffic-regulation resolution',
    legalBasis: 'DGT 2026 traffic-regulation resolution, Annexes I-II; consolidated update published 26 June 2026',
    vehicleScope: 'Vehicles/combinations above 7.5t on the listed DGT roads and periods; special vehicles and vehicles requiring complementary circulation authorisation are also subject where Annex II/V applies',
    routeScope: 'Only the specifically published DGT roads/territories; separately competent traffic authorities require their own source profile',
    exemptionNotes: 'DGT Annex II contains statutory exemptions. Do not extrapolate a listed provincial/island restriction to all of Spain.',
    seededPeriods: [
      { validFrom: '2026-09-24', validTo: '2026-09-24', title: 'El Hierro all-roads HGV restriction (24 September 2026)', timeWindow: 'Thursday 24 September 2026 00:00-24:00', whatChanged: 'DGT’s 2026 resolution lists a full-day restriction on all roads of El Hierro.', impact: 'Affected >7.5t vehicles are restricted on all roads of El Hierro during the published day, subject to Annex exemptions.', recommendedAction: 'Do not dispatch an affected vehicle on El Hierro during the day without verifying an applicable exemption and local updates.' },
      { validFrom: '2026-10-12', validTo: '2026-10-12', title: 'Balearic Islands all-roads HGV restriction (12 October 2026)', timeWindow: 'Monday 12 October 2026 00:00-24:00', whatChanged: 'DGT’s 2026 resolution lists a full-day restriction on all roads of the Balearic Islands.', impact: 'Affected >7.5t vehicles are restricted on all roads of the Balearic Islands during the published day, subject to Annex exemptions.', recommendedAction: 'Plan affected freight outside the 12 October window and verify island-specific/year-round restrictions separately.' },
      { validFrom: '2026-10-28', validTo: '2026-11-02', title: 'Tenerife all-roads HGV restriction (28 October-2 November 2026)', timeWindow: 'Wednesday 28 October 2026 00:00 to Monday 2 November 2026 24:00', whatChanged: 'DGT’s 2026 resolution lists a continuous restriction on all roads of Tenerife over the stated period.', impact: 'Affected >7.5t vehicles are restricted on all roads of Tenerife during the published period, subject to Annex exemptions.', recommendedAction: 'Treat the Tenerife period as a hard route/date constraint unless an applicable exemption is verified.' },
      { validFrom: '2026-10-30', validTo: '2026-10-30', title: 'Madrid outbound HGV restrictions for 1 November peak (30 October 2026)', timeWindow: 'Friday 30 October 2026 16:00-22:00 on listed outbound sections', whatChanged: 'DGT Annex II restricts selected outbound Madrid corridors, including A-6/AP-6 Madrid-M40 to San Rafael and A-1 Madrid-M40 to Venturada.', impact: 'Affected >7.5t vehicles and applicable special/authorised vehicles cannot use the listed corridor sections in the restricted direction during the window.', recommendedAction: 'Validate the exact DGT Annex II road/km/direction before dispatch; do not generalise this entry to all Madrid roads.' },
    ],
  }),
];
