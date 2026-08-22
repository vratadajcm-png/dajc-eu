// Maintained official driving-ban / exceptional-transport calendar layer.
//
// RSS monitoring alone cannot provide reliable weekly driving-ban coverage:
// a ban that nobody re-announces in a press release that week is invisible
// to scripts/lib/fetch-source.mjs, even though it is still fully in force
// (see docs/NEWS_AUTOMATION.md "Recurring weekend and seasonal driving
// bans"). This module is a small, curated, testable registry of the
// official rules themselves, resolved directly against the target week's
// date range instead of waiting for a news item to surface them.
//
// Two `kind`s of entry:
// - 'standing-rule': a fixed legal rule (e.g. "every Saturday/Sunday from
//   1 July to 31 August") that needs no per-year maintenance - resolve()
//   computes this week's actual dates fresh every time.
// - 'annual-calendar': an official body republishes a dated calendar every
//   year (e.g. Italy's Ministerial Decree, Germany's BALM summer-Saturday
//   list, Poland/Czechia's summer weekend calendar, Austria's summer
//   corridor order). `validYear` records which year's dates are seeded;
//   resolve() for any other year returns a `maintenanceError` instead of
//   silently reusing stale dates - see driving-ban-calendar.mjs.
//
// This is a curated, not exhaustive, seed (see docs/NEWS_AUTOMATION.md) -
// dates are seeded only where independently verified. Extend the relevant
// entry's seeded list as more of the year's calendar is confirmed.

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function fmt(date) {
  return date.toISOString().slice(0, 10);
}

function addDays(date, n) {
  const copy = new Date(date);
  copy.setUTCDate(copy.getUTCDate() + n);
  return copy;
}

function monthDay(date) {
  return date.toISOString().slice(5, 10); // "MM-DD"
}

function inSeason(date, fromMonthDay, toMonthDay) {
  const md = monthDay(date);
  return md >= fromMonthDay && md <= toMonthDay;
}

function humanDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTH_NAMES[m - 1]} ${y}`;
}

// Compact "29-30 August 2026" style range for same-month spans, falling
// back to two full dates otherwise. Report titles already carry the
// country via renderDevelopmentItem's "### {title} ({country})" heading -
// titles here deliberately do not repeat the country name.
function humanRange(fromIso, toIso) {
  if (fromIso === toIso) return humanDate(fromIso);
  const [fy, fm, fd] = fromIso.split('-').map(Number);
  const [ty, tm, td] = toIso.split('-').map(Number);
  if (fy === ty && fm === tm) return `${fd}-${td} ${MONTH_NAMES[fm - 1]} ${fy}`;
  return `${humanDate(fromIso)} - ${humanDate(toIso)}`;
}

/** @type {Array<object>} */
export const drivingBanCalendars = [
  {
    id: 'de-summer-weekend-ban',
    country: 'DE',
    countryName: 'Germany',
    kind: 'annual-calendar',
    validYear: 2026,
    sourceUrl:
      'https://www.balm.bund.de/DE/Themen/RechtsentwicklungRechtsvorschriften/Rechtsvorschriften/Strassenverkehrsrecht/LKW-Fahrverbote/LKW-Fahrverbote.html',
    sourceName: 'BALM - LKW-Fahrverbote',
    legalBasis: 'StVO summer-holiday Saturday ban (BALM annual list) plus the standing general Sunday/holiday driving ban',
    vehicleScope: 'Goods vehicles (and combinations) over 7.5t gross vehicle weight; goods vehicles with trailers',
    routeScope:
      'Saturday: only the officially BALM-listed motorway and federal-road sections (not a nationwide all-roads ban). Sunday: the general nationwide network.',
    exemptionNotes:
      'Standard exemptions apply (e.g. perishable/livestock transport, empty runs to the nearest suitable depot) - always check the current BALM exemption list for the specific transport.',
    lastVerified: '2026-08-21',
    // Seeded only for the independently-verified 2026 date used in the W35
    // article - extend with the full BALM summer-Saturday list as more
    // dates are confirmed.
    seededSaturdays: ['2026-08-29'],
    resolve(weekStart, _weekEnd, year) {
      if (year !== this.validYear) {
        return {
          maintenanceError: `No ${year} BALM summer-Saturday calendar seeded (last seeded: ${this.validYear}). Add the ${year} list before publishing a Germany driving-ban report.`,
        };
      }
      const saturday = fmt(addDays(weekStart, 5));
      const sunday = fmt(addDays(weekStart, 6));
      if (!this.seededSaturdays.includes(saturday)) {
        // The Saturday list doesn't cover this week - the standing Sunday
        // ban still applies regardless.
        return {
          occurrences: [
            {
              title: `General Sunday driving ban (${humanDate(sunday)})`,
              whatChanged:
                'The standing nationwide Sunday/public-holiday driving ban applies to heavy goods vehicles and goods-vehicle-with-trailer combinations across the entire German road network.',
              validFrom: sunday,
              validTo: sunday,
              timeWindow: `Sunday ${humanDate(sunday)}, 00:00-22:00`,
              impact: 'No general-cargo road haulage by the affected vehicle categories anywhere in Germany during the ban window.',
              recommendedAction:
                'Schedule Sunday transits outside the ban window, or confirm the transport qualifies for a standard StVO exemption before departure.',
            },
          ],
        };
      }
      return {
        occurrences: [
          {
            title: `Summer Saturday and Sunday driving ban (${humanRange(saturday, sunday)})`,
            whatChanged:
              'A summer-holiday Saturday driving ban applies on the BALM-listed motorway and federal-road sections, on top of the standing nationwide Sunday driving ban - the two must not be conflated into one all-roads rule.',
            validFrom: saturday,
            validTo: sunday,
            timeWindow: `Saturday ${humanDate(saturday)} 07:00-20:00 (listed sections only); Sunday ${humanDate(sunday)} 00:00-22:00 (nationwide)`,
            impact:
              'Heavy goods vehicles and goods-vehicle-with-trailer combinations cannot use the BALM-listed sections on Saturday, and cannot operate anywhere in Germany on Sunday.',
            recommendedAction:
              'Check the current BALM list of affected Saturday sections before routing through Germany on 29 August; treat Sunday 30 August as a full nationwide stop for the affected categories.',
          },
        ],
      };
    },
  },

  {
    id: 'pl-summer-weekend-ban',
    country: 'PL',
    countryName: 'Poland',
    kind: 'annual-calendar',
    validYear: 2026,
    sourceUrl: 'https://www.gov.pl/web/witd-radom/wakacyjne-zakazy-jazdy-dla-pojazdow-ciezarowych',
    sourceName: 'WITD Radom - wakacyjne zakazy jazdy',
    legalBasis: '2026 summer holiday weekend driving-ban calendar (Inspekcja Transportu Drogowego)',
    vehicleScope: 'Vehicles and combinations of vehicles above 12 tonnes gross vehicle weight',
    routeScope: 'Nationwide Polish road network',
    exemptionNotes:
      'Statutory exemptions exist (e.g. certain perishable/agricultural/international-transit categories) - check the current exemption list for the specific transport before assuming the ban applies without exception.',
    lastVerified: '2026-08-21',
    seededWeekends: [{ friday: '2026-08-28', saturday: '2026-08-29', sunday: '2026-08-30' }],
    resolve(weekStart, _weekEnd, year) {
      if (year !== this.validYear) {
        return { maintenanceError: `No ${year} Polish summer weekend-ban calendar seeded (last seeded: ${this.validYear}).` };
      }
      const friday = fmt(addDays(weekStart, 4));
      const match = this.seededWeekends.find((w) => w.friday === friday);
      if (!match) return { occurrences: [] };
      return {
        occurrences: [
          {
            title: `Final summer-weekend HGV driving ban (${humanRange(match.friday, match.sunday)})`,
            whatChanged:
              'The last weekend of the 2026 Polish summer holiday driving-ban calendar restricts heavy vehicles and combinations above 12t.',
            validFrom: match.friday,
            validTo: match.sunday,
            timeWindow: `Friday ${humanDate(match.friday)} 18:00-22:00; Saturday ${humanDate(match.saturday)} 08:00-14:00; Sunday ${humanDate(match.sunday)} 08:00-22:00`,
            impact: 'Restricted vehicles cannot use the Polish road network during any of the three windows.',
            recommendedAction: 'Plan Polish transit outside the three ban windows, and check the statutory exemption list if the transport may qualify.',
          },
        ],
      };
    },
  },

  {
    id: 'cz-summer-weekend-ban',
    country: 'CZ',
    countryName: 'Czechia',
    kind: 'annual-calendar',
    validYear: 2026,
    sourceUrl: 'https://md.gov.cz/Dokumenty/Silnicni-doprava/Vyjimky-ze-zakazu-jizdy-%28povoleni%29',
    sourceName: 'Ministerstvo dopravy CR - Vyjimky ze zakazu jizdy',
    legalBasis: '2026 summer weekend driving-ban calendar on motorways and Class I roads',
    vehicleScope: 'Vehicles above 7.5t; vehicles above 3.5t towing a trailer',
    routeScope: 'Motorways and Class I roads',
    exemptionNotes:
      'Individual exemptions ("povoleni") can be granted by the Ministry of Transport for specific transports - check before assuming the ban applies without exception.',
    lastVerified: '2026-08-21',
    seededWeekends: [{ friday: '2026-08-28', saturday: '2026-08-29', sunday: '2026-08-30' }],
    resolve(weekStart, _weekEnd, year) {
      if (year !== this.validYear) {
        return { maintenanceError: `No ${year} Czech summer weekend-ban calendar seeded (last seeded: ${this.validYear}).` };
      }
      const friday = fmt(addDays(weekStart, 4));
      const match = this.seededWeekends.find((w) => w.friday === friday);
      if (!match) return { occurrences: [] };
      return {
        occurrences: [
          {
            title: `Summer Friday/Saturday restriction plus the standard Sunday ban (${humanRange(match.friday, match.sunday)})`,
            whatChanged:
              'A summer-specific Friday and Saturday restriction applies on motorways and Class I roads, in addition to - and with different hours than - the standard Sunday driving ban.',
            validFrom: match.friday,
            validTo: match.sunday,
            timeWindow: `Friday ${humanDate(match.friday)} 17:00-21:00 (summer restriction); Saturday ${humanDate(match.saturday)} 07:00-13:00 (summer restriction); Sunday ${humanDate(match.sunday)} 13:00-22:00 (standard Sunday ban)`,
            impact: 'Affected vehicles cannot use motorways and Class I roads during any of the three windows.',
            recommendedAction:
              'Plan Czech motorway/Class I transits outside all three windows; the Sunday hours are not the same as the Friday/Saturday summer-specific hours.',
          },
        ],
      };
    },
  },

  {
    id: 'sk-section-39-seasonal-ban',
    country: 'SK',
    countryName: 'Slovakia',
    kind: 'standing-rule',
    sourceUrl: 'https://static.slov-lex.sk/static/SK/ZZ/2009/8/20260801.print.html',
    sourceName: 'Slov-Lex - Zakon c. 8/2009 Z. z., Section 39',
    legalBasis: 'Section 39 of Act No. 8/2009 Coll. on Road Traffic (seasonal weekend driving ban)',
    vehicleScope: 'Vehicles above 7.5t; vehicles above 3.5t towing a trailer',
    routeScope: 'Motorways, roads for motor vehicles, and Class I roads',
    exemptionNotes:
      'Section 39 sets out specific statutory exemptions - verify the current consolidated wording for the exact exemption list before relying on one.',
    lastVerified: '2026-08-21',
    seasonFromMonthDay: '07-01',
    seasonToMonthDay: '08-31',
    resolve(weekStart) {
      const saturday = addDays(weekStart, 5);
      const sunday = addDays(weekStart, 6);
      if (!inSeason(saturday, this.seasonFromMonthDay, this.seasonToMonthDay)) return { occurrences: [] };
      const saturdayIso = fmt(saturday);
      const sundayIso = fmt(sunday);
      return {
        occurrences: [
          {
            title: `Section 39 seasonal weekend driving ban (${humanRange(saturdayIso, sundayIso)})`,
            whatChanged: 'The Section 39 seasonal weekend driving ban applies on motorways, roads for motor vehicles, and Class I roads.',
            validFrom: saturdayIso,
            validTo: sundayIso,
            timeWindow: `Saturday ${humanDate(saturdayIso)} 07:00-19:00; Sunday ${humanDate(sundayIso)} 00:00-22:00`,
            impact: 'Affected vehicles cannot use motorways, roads for motor vehicles, or Class I roads during either window.',
            recommendedAction: 'Plan Slovak transit outside the Saturday/Sunday windows; verify the current Section 39 exemption wording for the specific transport.',
          },
        ],
      };
    },
  },

  {
    id: 'it-md-325-2025-calendar',
    country: 'IT',
    countryName: 'Italy',
    kind: 'annual-calendar',
    validYear: 2026,
    sourceUrl: 'https://www.mit.gov.it/normativa/decreto-ministeriale-n-325-del-12-dicembre-2025',
    sourceName: 'Ministero delle Infrastrutture e dei Trasporti - Decreto n. 325/2025',
    legalBasis: 'Ministerial Decree 325 of 12 December 2025 - 2026 driving-ban calendar',
    vehicleScope:
      'Goods vehicles above 7.5t; per the decree, exceptional vehicles and exceptional transports even when authorised, unless a specific exemption or timing adjustment applies',
    routeScope: 'Outside built-up areas, nationwide',
    exemptionNotes:
      "The decree sets out specific exemptions and timing adjustments for vehicles arriving from abroad, port traffic, and other categories - always check the current decree text for the specific transport, including whether an existing exceptional-transport authorisation is still subject to the ban.",
    lastVerified: '2026-08-21',
    additionalSources: [
      {
        name: 'MIT - Mezzi pesanti, calendario 2026 dei divieti di circolazione stradale',
        url: 'https://www.mit.gov.it/index.php/comunicazione/news/mezzi-pesanti-calendario-2026-dei-divieti-di-circolazione-stradale',
      },
    ],
    seededWeekends: [{ saturday: '2026-08-29', sunday: '2026-08-30' }],
    resolve(weekStart, _weekEnd, year) {
      if (year !== this.validYear) {
        return {
          maintenanceError: `No ${year} Italian Ministerial Decree driving-ban calendar seeded (last seeded: Decree 325/2025 for ${this.validYear}). A new decree must be issued and seeded for ${year} before publishing an Italy driving-ban report.`,
        };
      }
      const saturday = fmt(addDays(weekStart, 5));
      const match = this.seededWeekends.find((w) => w.saturday === saturday);
      if (!match) return { occurrences: [] };
      return {
        occurrences: [
          {
            title: `Ministerial Decree 325/2025 weekend driving ban (${humanRange(match.saturday, match.sunday)})`,
            whatChanged:
              'The 2026 driving-ban calendar set by Ministerial Decree 325/2025 restricts goods vehicles above 7.5t outside built-up areas, and - per the decree - extends to exceptional vehicles/transports even when authorised, unless a specific exemption applies.',
            validFrom: match.saturday,
            validTo: match.sunday,
            timeWindow: `Saturday ${humanDate(match.saturday)} 08:00-16:00; Sunday ${humanDate(match.sunday)} 07:00-22:00`,
            impact:
              'Affected vehicles - including, per the decree, authorised exceptional transports without a specific exemption - cannot operate outside built-up areas during either window.',
            recommendedAction:
              "Do not assume an existing exceptional-transport authorisation exempts the movement from this weekend ban; check the decree's specific exemptions for vehicles arriving from abroad or port traffic before departure.",
            additionalSources: this.additionalSources,
          },
        ],
      };
    },
  },

  {
    id: 'fr-exceptional-transport-weekend-ban',
    country: 'FR',
    countryName: 'France',
    kind: 'standing-rule',
    sourceUrl: 'https://www2.bison-fute.gouv.fr/regime-general%2C10852.html',
    sourceName: 'Bison Fute - Regime general des transports exceptionnels',
    legalBasis: 'Standing exceptional-transport weekend/public-holiday movement ban (arrete transports exceptionnels)',
    vehicleScope: 'Exceptional transports (convois exceptionnels) without the necessary departmental exemption',
    routeScope: 'Nationwide French road network',
    exemptionNotes:
      "A departmental exemption (autorisation prefectorale) can permit movement during the ban window for a specific transport - this rule applies only in the absence of such an exemption. Distinct from France's general HGV weekend restrictions, which follow a separate regime.",
    lastVerified: '2026-08-21',
    resolve(weekStart) {
      const saturday = addDays(weekStart, 5);
      const nextMonday = addDays(weekStart, 7);
      const saturdayIso = fmt(saturday);
      const mondayIso = fmt(nextMonday);
      return {
        occurrences: [
          {
            title: `Exceptional-transport weekend movement ban (${humanDate(saturdayIso)} 12:00 to ${humanDate(mondayIso)} 06:00)`,
            whatChanged:
              'Exceptional transport (convoi exceptionnel) movement remains prohibited without the necessary departmental exemption, from Saturday midday to Monday morning (the window shifts around a public holiday - not applicable this week).',
            validFrom: saturdayIso,
            validTo: mondayIso,
            timeWindow: `Saturday ${humanDate(saturdayIso)} 12:00 to Monday ${humanDate(mondayIso)} 06:00`,
            impact:
              'Exceptional/oversized transports without a departmental exemption cannot move anywhere in France during this window - note it extends into the Monday of the following week.',
            recommendedAction:
              "Confirm the departmental exemption is in hand before Saturday midday; do not confuse this exceptional-transport rule with France's separate general HGV weekend restrictions.",
          },
        ],
      };
    },
  },

  {
    id: 'hu-summer-weekend-ban',
    country: 'HU',
    countryName: 'Hungary',
    kind: 'standing-rule',
    sourceUrl: 'https://www.wko.at/aussenwirtschaft/ungarn-lkw-wochenendfahrverbot',
    sourceName: 'WKO Aussenwirtschaft - Ungarn LKW-Wochenendfahrverbot',
    legalBasis: 'Hungarian summer weekend heavy-vehicle driving ban (1 July - 31 August)',
    vehicleScope: 'Heavy vehicles above 7.5t',
    routeScope: 'Nationwide Hungarian road network',
    exemptionNotes:
      'The competent minister may temporarily relax the restriction during an official heat alert - operators must recheck shortly before departure, since a relaxation is announced close to the date rather than in advance.',
    lastVerified: '2026-08-21',
    seasonFromMonthDay: '07-01',
    seasonToMonthDay: '08-31',
    resolve(weekStart) {
      const saturday = addDays(weekStart, 5);
      const sunday = addDays(weekStart, 6);
      if (!inSeason(saturday, this.seasonFromMonthDay, this.seasonToMonthDay)) return { occurrences: [] };
      const saturdayIso = fmt(saturday);
      const sundayIso = fmt(sunday);
      return {
        occurrences: [
          {
            title: `Summer weekend driving ban for heavy vehicles (${humanRange(saturdayIso, sundayIso)})`,
            whatChanged: 'The summer weekend driving ban for heavy vehicles above 7.5t applies nationwide.',
            validFrom: saturdayIso,
            validTo: sundayIso,
            timeWindow: `Saturday ${humanDate(saturdayIso)} from 15:00; Sunday ${humanDate(sundayIso)} until 22:00`,
            impact: 'Heavy vehicles above 7.5t cannot operate on the Hungarian road network during the ban window.',
            recommendedAction: 'Check again shortly before departure for a possible temporary relaxation announced during an official heat alert.',
          },
        ],
      };
    },
  },

  {
    id: 'at-nationwide-weekend-ban',
    country: 'AT',
    countryName: 'Austria',
    kind: 'standing-rule',
    sourceUrl: 'https://www.wko.at/transport/fahrverbote',
    sourceName: 'WKO - Fahrverbote in Oesterreich',
    legalBasis: 'Austrian nationwide weekend driving ban',
    vehicleScope:
      'Goods vehicles with trailers above 3.5t; standalone goods vehicles above 7.5t; articulated combinations above 7.5t; self-propelled working machines above 7.5t - the threshold differs by vehicle type and must not be flattened to a single number',
    routeScope: 'Nationwide Austrian road network',
    exemptionNotes: 'Standard Austrian weekend-ban exemptions apply (e.g. combined transport, certain perishable goods) - check the current exemption list for the specific transport.',
    lastVerified: '2026-08-21',
    resolve(weekStart) {
      const saturday = addDays(weekStart, 5);
      const sunday = addDays(weekStart, 6);
      const saturdayIso = fmt(saturday);
      const sundayIso = fmt(sunday);
      return {
        occurrences: [
          {
            title: `Nationwide weekend driving ban (${humanRange(saturdayIso, sundayIso)})`,
            whatChanged:
              'The standing nationwide weekend driving ban applies, with thresholds that differ by vehicle type: goods vehicles with trailers above 3.5t, standalone goods vehicles and articulated combinations above 7.5t, and self-propelled working machines above 7.5t.',
            validFrom: saturdayIso,
            validTo: sundayIso,
            timeWindow: `Saturday ${humanDate(saturdayIso)} from 15:00; Sunday ${humanDate(sundayIso)} until 22:00`,
            impact: 'Affected vehicle categories cannot operate on the Austrian road network during the ban window - a single flat weight threshold must not be applied across all vehicle types.',
            recommendedAction: 'Confirm which threshold applies to the specific vehicle/combination type before departure, and check the standard exemption list.',
          },
        ],
      };
    },
  },

  {
    id: 'at-summer-corridor-restrictions',
    country: 'AT',
    countryName: 'Austria',
    kind: 'annual-calendar',
    validYear: 2026,
    sourceUrl: 'https://www.wko.at/transport/lkw-fahrverbote-oesterreich-ueberblick',
    sourceName: 'WKO - LKW-Fahrverbote Oesterreich Ueberblick',
    legalBasis: '2026 summer corridor-specific restrictions (additional to the general nationwide weekend ban)',
    vehicleScope: 'Heavy goods vehicles and combinations, per the corridor-specific order',
    routeScope:
      'A10 Tauern Autobahn (both directions); A12/A13/A14 and the Brenner corridor under the valid summer rules; B178, B320, B177, B179, B181, B182; A10/Knoten Pongau exit restrictions',
    exemptionNotes:
      'Destination and origin-traffic exemptions apply - a transport genuinely starting or ending within the restricted corridor is treated differently from through-traffic. Check the current order for the exact exemption conditions.',
    lastVerified: '2026-08-21',
    seededDates: ['2026-08-29'],
    resolve(weekStart, _weekEnd, year) {
      if (year !== this.validYear) {
        return { maintenanceError: `No ${year} Austrian summer corridor-restriction order seeded (last seeded: ${this.validYear}).` };
      }
      const saturday = fmt(addDays(weekStart, 5));
      if (!this.seededDates.includes(saturday)) return { occurrences: [] };
      return {
        occurrences: [
          {
            title: `Additional summer corridor restrictions (${humanDate(saturday)})`,
            whatChanged:
              'On top of the general nationwide weekend ban, additional corridor-specific restrictions apply on the A10 Tauern Autobahn (both directions), the A12/A13/A14 and Brenner corridor under the valid summer rules, and on B178, B320, B177, B179, B181 and B182 - including A10/Knoten Pongau exit restrictions where covered by a valid order.',
            validFrom: saturday,
            validTo: saturday,
            timeWindow: `Saturday ${humanDate(saturday)}: A10 Tauern Autobahn 07:00-15:00; B178/B320/B177/B179/B181/B182 08:00-15:00`,
            impact: 'These corridor restrictions apply in addition to, not instead of, the general nationwide weekend ban - genuine destination/origin traffic in the corridor may be exempt.',
            recommendedAction: 'Check destination/origin-traffic exemption status before routing through the Tauern, Brenner, or listed B-road corridors on 29 August, and recheck the A10/Knoten Pongau exit restriction.',
          },
        ],
      };
    },
  },

  {
    id: 'ch-sunday-night-ban',
    country: 'CH',
    countryName: 'Switzerland',
    kind: 'standing-rule',
    sourceUrl: 'https://www.astra.admin.ch/de/sonntags-und-nachtfahrten',
    sourceName: 'ASTRA - Sonntags- und Nachtfahrverbot',
    legalBasis: 'Standing Sunday and night driving ban',
    vehicleScope: 'Vehicles above 3.5t; articulated vehicles above 5t; vehicles towing a trailer above 3.5t',
    routeScope: 'Nationwide Swiss road network',
    exemptionNotes:
      'A special permit ("Sonderbewilligung") can be requested for Sunday or night movements, and interacts with any separate exceptional-transport permit already held for the same movement - both must be checked.',
    lastVerified: '2026-08-21',
    additionalSources: [
      { name: 'ASTRA - Sonderbewilligungen', url: 'https://www.astra.admin.ch/de/sonderbewilligungen' },
      { name: 'ASTRA - Orientierung fuer Gesuchsteller', url: 'https://www.astra.admin.ch/de/orientierung-gesuchsteller' },
    ],
    resolve(weekStart) {
      const sunday = fmt(addDays(weekStart, 6));
      return {
        occurrences: [
          {
            title: `Sunday and night driving ban (${humanDate(sunday)})`,
            whatChanged: 'The standing nightly driving ban (22:00-05:00, every day) applies as usual, together with the Sunday driving ban.',
            validFrom: sunday,
            validTo: sunday,
            timeWindow: `Nightly 22:00-05:00 (every day); Sunday ${humanDate(sunday)} full-day ban`,
            impact: 'Affected vehicles cannot move at night on any day, or at all on Sunday, without a special permit.',
            recommendedAction:
              'Apply for a Sonderbewilligung in advance for any required Sunday or night movement, and confirm how it interacts with any exceptional-transport permit already held for the same movement.',
            additionalSources: this.additionalSources,
          },
        ],
      };
    },
  },
];

export function getCalendarById(id) {
  return drivingBanCalendars.find((entry) => entry.id === id);
}
