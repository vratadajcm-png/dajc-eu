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
    id: 'cz-weekend-ban',
    country: 'CZ',
    countryName: 'Czechia',
    kind: 'standing-rule',
    sourceUrl: 'https://md.gov.cz/Dokumenty/Silnicni-doprava/Vyjimky-ze-zakazu-jizdy-%28povoleni%29',
    sourceName: 'Ministerstvo dopravy CR - Vyjimky ze zakazu jizdy',
    legalBasis: 'Section 43(1) of Act No. 361/2000 Coll. - Sunday/rest-day and summer Friday/Saturday restrictions',
    vehicleScope: 'Vehicles above 7.5t; vehicles above 3.5t towing a trailer',
    routeScope: 'Motorways and Class I roads',
    exemptionNotes:
      'Individual exemptions ("povoleni") can be granted by the Ministry of Transport for specific transports - check before assuming the ban applies without exception.',
    lastVerified: '2026-08-29',
    seasonFromMonthDay: '07-01',
    seasonToMonthDay: '08-31',
    resolve(weekStart) {
      const friday = addDays(weekStart, 4);
      const saturday = addDays(weekStart, 5);
      const sunday = addDays(weekStart, 6);
      const fridayIso = fmt(friday);
      const saturdayIso = fmt(saturday);
      const sundayIso = fmt(sunday);
      const summer = inSeason(saturday, this.seasonFromMonthDay, this.seasonToMonthDay);

      if (!summer) {
        return {
          occurrences: [
            {
              title: `Standard Sunday driving ban (${humanDate(sundayIso)})`,
              whatChanged:
                'The standing Sunday/rest-day driving ban applies on Czech motorways and Class I roads to the affected heavy vehicle categories.',
              validFrom: sundayIso,
              validTo: sundayIso,
              timeWindow: `Sunday ${humanDate(sundayIso)} 13:00-22:00`,
              impact: 'Affected vehicles cannot use Czech motorways or Class I roads during the Sunday ban window.',
              recommendedAction:
                'Plan Czech motorway/Class I-road transit outside 13:00-22:00 on Sunday, or confirm a valid statutory/individual exemption before departure.',
            },
          ],
        };
      }

      return {
        occurrences: [
          {
            title: `Summer Friday/Saturday restriction plus the standard Sunday ban (${humanRange(fridayIso, sundayIso)})`,
            whatChanged:
              'The Section 43 summer Friday and Saturday restrictions apply on motorways and Class I roads, in addition to the standing Sunday/rest-day ban.',
            validFrom: fridayIso,
            validTo: sundayIso,
            timeWindow: `Friday ${humanDate(fridayIso)} 17:00-21:00; Saturday ${humanDate(saturdayIso)} 07:00-13:00; Sunday ${humanDate(sundayIso)} 13:00-22:00`,
            impact: 'Affected vehicles cannot use motorways and Class I roads during any of the three windows.',
            recommendedAction:
              'Plan Czech motorway/Class I transits outside all three windows; the Sunday hours differ from the Friday/Saturday summer-specific hours.',
          },
        ],
      };
    },
  },

  {
    id: 'cz-special-vehicle-seasonal-ban',
    country: 'CZ',
    countryName: 'Czechia',
    kind: 'standing-rule',
    sourceUrl: 'https://md.gov.cz/Media/Media-a-tiskove-zpravy/Stanovisko-MD-k-omezeni-jizdy-kamionu',
    sourceName: 'Ministerstvo dopravy CR - stanovisko k Section 43(2)',
    legalBasis: 'Section 43(2) of Act No. 361/2000 Coll. - seasonal restriction for wide special/animal-drawn vehicles and handcarts',
    vehicleScope: 'Special vehicles, animal-drawn vehicles and handcarts with total width above 600 mm',
    routeScope: 'Class I roads outside built-up areas',
    exemptionNotes:
      'This is a separate Section 43(2) regime and must not be confused with the general HGV restriction in Section 43(1). Check the vehicle legal classification before applying it.',
    lastVerified: '2026-08-29',
    seasonFromMonthDay: '04-15',
    seasonToMonthDay: '09-30',
    resolve(weekStart) {
      const friday = addDays(weekStart, 4);
      const saturday = addDays(weekStart, 5);
      const sunday = addDays(weekStart, 6);
      if (!inSeason(saturday, this.seasonFromMonthDay, this.seasonToMonthDay)) return { occurrences: [] };

      const fridayIso = fmt(friday);
      const saturdayIso = fmt(saturday);
      const sundayIso = fmt(sunday);
      return {
        occurrences: [
          {
            title: `Seasonal Class I-road restriction for wide special vehicles (${humanRange(fridayIso, sundayIso)})`,
            whatChanged:
              'A separate seasonal restriction applies to special vehicles, animal-drawn vehicles and handcarts over 600 mm wide on Class I roads outside built-up areas.',
            validFrom: fridayIso,
            validTo: sundayIso,
            timeWindow: `Friday ${humanDate(fridayIso)} 15:00-21:00; Saturday ${humanDate(saturdayIso)} 07:00-11:00; Sunday ${humanDate(sundayIso)} 15:00-21:00`,
            impact:
              'Vehicles falling under this special legal classification cannot use affected Class I roads during the listed windows, even though the timing differs from the general HGV ban.',
            recommendedAction:
              'Confirm whether the planned vehicle is legally a "special vehicle" under Section 43(2); if it is, route or time the movement outside these Class I-road windows.',
          },
        ],
      };
    },
  },

  {
    id: 'sk-section-39-weekend-ban',
    country: 'SK',
    countryName: 'Slovakia',
    kind: 'standing-rule',
    sourceUrl: 'https://static.slov-lex.sk/static/SK/ZZ/2009/8/20260901.html',
    sourceName: 'Slov-Lex - Act No. 8/2009 Coll., Section 39',
    legalBasis: 'Section 39 of Act No. 8/2009 Coll. on Road Traffic',
    vehicleScope: 'Vehicles above 7.5t; vehicles above 3.5t towing a trailer',
    routeScope: 'Motorways, roads for motor vehicles, and Class I roads',
    exemptionNotes:
      'Section 39 contains statutory exemptions including specified public-service, combined-transport, fuel-supply, dangerous-goods, humanitarian and emergency movements; verify the current consolidated wording for the specific transport.',
    lastVerified: '2026-08-29',
    seasonFromMonthDay: '07-01',
    seasonToMonthDay: '08-31',
    september2026Change: '2026-09-01',
    resolve(weekStart) {
      const saturday = addDays(weekStart, 5);
      const sunday = addDays(weekStart, 6);
      const saturdayIso = fmt(saturday);
      const sundayIso = fmt(sunday);
      const summer = inSeason(saturday, this.seasonFromMonthDay, this.seasonToMonthDay);
      const postChange = sundayIso >= this.september2026Change;

      if (!summer) {
        return {
          occurrences: [
            {
              title: `Section 39 Sunday driving ban (${humanDate(sundayIso)})`,
              whatChanged:
                postChange
                  ? 'From 1 September 2026, the consolidated Section 39 Sunday/last-rest-day restriction applies from 06:00 to 22:00.'
                  : 'The Section 39 Sunday/last-rest-day driving ban applies on motorways, roads for motor vehicles, and Class I roads.',
              validFrom: sundayIso,
              validTo: sundayIso,
              timeWindow: `Sunday ${humanDate(sundayIso)} ${postChange ? '06:00' : '00:00'}-22:00`,
              impact: 'Affected vehicles cannot use motorways, roads for motor vehicles, or Class I roads during the Sunday window.',
              recommendedAction:
                'Plan Slovak transit outside the Section 39 Sunday window and verify whether a statutory exemption covers the specific movement.',
              sourceUrl: postChange
                ? 'https://static.slov-lex.sk/static/SK/ZZ/2009/8/20260901.html'
                : 'https://static.slov-lex.sk/static/SK/ZZ/2009/8/20260801.print.html',
            },
          ],
        };
      }

      return {
        occurrences: [
          {
            title: `Section 39 seasonal weekend driving ban (${humanRange(saturdayIso, sundayIso)})`,
            whatChanged: 'The Section 39 summer Saturday and Sunday driving-ban regime applies on motorways, roads for motor vehicles, and Class I roads.',
            validFrom: saturdayIso,
            validTo: sundayIso,
            timeWindow: `Saturday ${humanDate(saturdayIso)} 07:00-19:00; Sunday ${humanDate(sundayIso)} 00:00-22:00`,
            impact: 'Affected vehicles cannot use motorways, roads for motor vehicles, or Class I roads during either window.',
            recommendedAction:
              'Plan Slovak transit outside the Saturday/Sunday windows and verify the current Section 39 exemptions for the specific transport.',
            sourceUrl: 'https://static.slov-lex.sk/static/SK/ZZ/2009/8/20260801.print.html',
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
    lastVerified: '2026-08-29',
    additionalSources: [
      {
        name: 'MIT - Mezzi pesanti, calendario 2026 dei divieti di circolazione stradale',
        url: 'https://www.mit.gov.it/index.php/comunicazione/news/mezzi-pesanti-calendario-2026-dei-divieti-di-circolazione-stradale',
      },
    ],
    seededPeriods: [
      {
        validFrom: '2026-08-29',
        validTo: '2026-08-30',
        timeWindow: 'Saturday 29 August 2026 08:00-16:00; Sunday 30 August 2026 07:00-22:00',
      },
      { validFrom: '2026-09-06', validTo: '2026-09-06', timeWindow: 'Sunday 6 September 2026 07:00-22:00' },
      { validFrom: '2026-09-13', validTo: '2026-09-13', timeWindow: 'Sunday 13 September 2026 07:00-22:00' },
      { validFrom: '2026-09-20', validTo: '2026-09-20', timeWindow: 'Sunday 20 September 2026 07:00-22:00' },
      { validFrom: '2026-09-27', validTo: '2026-09-27', timeWindow: 'Sunday 27 September 2026 07:00-22:00' },
      { validFrom: '2026-10-04', validTo: '2026-10-04', timeWindow: 'Sunday 4 October 2026 09:00-22:00' },
    ],
    resolve(weekStart, weekEnd, year) {
      if (year !== this.validYear) {
        return {
          maintenanceError: `No ${year} Italian Ministerial Decree driving-ban calendar seeded (last seeded: Decree 325/2025 for ${this.validYear}). A new decree must be issued and seeded for ${year} before publishing an Italy driving-ban report.`,
        };
      }

      const startIso = fmt(weekStart);
      const endIso = fmt(weekEnd);
      const match = this.seededPeriods.find((p) => p.validTo >= startIso && p.validFrom <= endIso);
      if (!match) return { occurrences: [] };

      return {
        occurrences: [
          {
            title: `Ministerial Decree 325/2025 driving ban (${humanRange(match.validFrom, match.validTo)})`,
            whatChanged:
              'The 2026 calendar in Ministerial Decree 325/2025 restricts goods vehicles above 7.5t outside built-up areas and, under the decree, also applies to exceptional vehicles/transports even when authorised unless a specific exemption applies.',
            validFrom: match.validFrom,
            validTo: match.validTo,
            timeWindow: match.timeWindow,
            impact:
              'Affected vehicles - including authorised exceptional transports without a specific exemption - cannot operate outside built-up areas during the listed window.',
            recommendedAction:
              "Do not assume an existing exceptional-transport authorisation exempts the movement; check the decree's exemptions and timing adjustments for the specific transport before departure.",
            additionalSources: this.additionalSources,
          },
        ],
      };
    },
  },

  {
    id: 'fr-general-hgv-weekend-ban',
    country: 'FR',
    countryName: 'France',
    kind: 'standing-rule',
    sourceUrl: 'https://www.legifrance.gouv.fr/loda/article_lc/LEGIARTI000043418560',
    sourceName: 'Legifrance - Arrete du 16 avril 2021, Article 1',
    legalBasis: 'Article 1 of the Order of 16 April 2021 - permanent general goods-vehicle restriction',
    vehicleScope: 'Goods vehicles and combinations above 7.5t GVW, excluding the specialised and agricultural categories defined by the order',
    routeScope: 'Entire French road network',
    exemptionNotes:
      'Article 4 transport categories are exempt from the general restriction unless a prefect decides otherwise under the order. This is distinct from the separate exceptional-transport movement regime.',
    lastVerified: '2026-08-29',
    resolve(weekStart) {
      const saturday = addDays(weekStart, 5);
      const sunday = addDays(weekStart, 6);
      const saturdayIso = fmt(saturday);
      const sundayIso = fmt(sunday);
      return {
        occurrences: [
          {
            title: `General HGV weekend driving ban (${humanRange(saturdayIso, sundayIso)})`,
            whatChanged:
              'France\'s permanent general restriction for goods vehicles and combinations above 7.5t applies from Saturday evening through Sunday evening on the entire road network.',
            validFrom: saturdayIso,
            validTo: sundayIso,
            timeWindow: `Saturday ${humanDate(saturdayIso)} 22:00 to Sunday ${humanDate(sundayIso)} 22:00`,
            impact: 'Affected general-goods vehicles cannot operate on the French road network during the weekend window unless an Article 4 exemption applies.',
            recommendedAction:
              'Schedule general HGV transit outside Saturday 22:00-Sunday 22:00, and verify the Article 4 exemption list if the load may qualify.',
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
    id: 'si-standing-sunday-hgv-ban',
    country: 'SI',
    countryName: 'Slovenia',
    kind: 'standing-rule',
    sourceUrl: 'https://www.promet.si/en/general-limitations',
    sourceName: 'Promet.si - Limitation of cargo traffic in Slovenia',
    legalBasis: 'Order on the Limiting of Traffic on Roads in the Republic of Slovenia',
    vehicleScope: 'Heavy goods vehicles above 7.5t maximum authorised total weight',
    routeScope: 'Roads covered by the Slovenian cargo-traffic restriction order',
    exemptionNotes:
      'Promet.si lists statutory exceptions including emergency/public-interest movements, specified perishable goods, certain combined transport and documented empty runs to loading/from unloading; verify the current list for the specific movement.',
    lastVerified: '2026-08-29',
    resolve(weekStart) {
      const sunday = fmt(addDays(weekStart, 6));
      return {
        occurrences: [
          {
            title: `Sunday HGV driving restriction (${humanDate(sunday)})`,
            whatChanged: 'Slovenia\'s standing Sunday/public-holiday restriction applies to HGVs above 7.5t.',
            validFrom: sunday,
            validTo: sunday,
            timeWindow: `Sunday ${humanDate(sunday)} 08:00-22:00`,
            impact: 'Affected HGVs cannot operate on roads covered by the restriction order during the Sunday window unless an exception applies.',
            recommendedAction:
              'Plan Slovenian HGV transit outside 08:00-22:00 on Sunday and verify the published exception list for the specific transport.',
          },
        ],
      };
    },
  },

  {
    id: 'si-2026-tourist-saturday-ban',
    country: 'SI',
    countryName: 'Slovenia',
    kind: 'annual-calendar',
    validYear: 2026,
    sourceUrl: 'https://www.promet.si/en/my-traffic',
    sourceName: 'Promet.si - 2026 tourist-season HGV restriction',
    legalBasis: '2026 high-tourist-season cargo restriction through the first weekend in September',
    vehicleScope: 'Heavy goods vehicles above 7.5t maximum authorised total weight',
    routeScope: 'Tourist-season restricted routes; coastal routes have the longer Saturday window stated by Promet.si',
    exemptionNotes:
      'The same published Slovenian cargo-restriction exceptions remain relevant. Route scope and coastal-road timing must be checked against the current Promet.si notice.',
    lastVerified: '2026-08-29',
    seededSaturdays: ['2026-08-29', '2026-09-05'],
    resolve(weekStart, _weekEnd, year) {
      if (year !== this.validYear) {
        return {
          maintenanceError: `No ${year} Slovenian tourist-season Saturday calendar seeded (last seeded: ${this.validYear}).`,
        };
      }
      const saturday = fmt(addDays(weekStart, 5));
      if (!this.seededSaturdays.includes(saturday)) return { occurrences: [] };
      return {
        occurrences: [
          {
            title: `Tourist-season Saturday HGV restriction (${humanDate(saturday)})`,
            whatChanged:
              'The 2026 tourist-season Saturday restriction for HGVs above 7.5t remains in force through the first weekend in September; coastal routes have a longer Saturday window.',
            validFrom: saturday,
            validTo: saturday,
            timeWindow: `Saturday ${humanDate(saturday)} 08:00-13:00; coastal routes 06:00-16:00`,
            impact:
              'Affected HGVs must avoid the tourist-season restricted routes during the Saturday window, with the longer 06:00-16:00 restriction on coastal routes.',
            recommendedAction:
              'Check whether the planned Slovenian route is in the tourist-season restriction set and, on coastal routes, treat 06:00-16:00 as the operative Saturday window.',
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
