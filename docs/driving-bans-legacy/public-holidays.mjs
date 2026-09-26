// Public-holiday driving bans for the countries whose weekend/Sunday rule is
// already in the maintained registry. The baseline rules in index.mjs only
// compute weekday-based windows (Saturday/Sunday), so a ban that falls on a
// weekday or Saturday public holiday (e.g. Germany 3 October, Czechia
// 28 September, Austria 26 October) would otherwise be missing entirely.
//
// Holiday dates move every year, so every entry is an 'annual-calendar':
// resolve() for an unseeded year returns a maintenanceError instead of
// silently reusing 2026's dates (see driving-ban-calendar.mjs). Only
// holidays that are NOT already covered by a Sunday/weekend baseline window
// are listed (e.g. Sunday 1 November 2026 is omitted where the Sunday ban
// already applies).

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function fmt(date) {
  return date.toISOString().slice(0, 10);
}

function humanDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTH_NAMES[m - 1]} ${y}`;
}

// Shared resolve(): an occurrence belongs to the week in which it starts, so
// weekly reports list it once and calendar consumers dedupe by key anyway.
function resolveSeededHolidays(entry, weekStart, weekEnd, year) {
  if (year !== entry.validYear) {
    return {
      maintenanceError: `No ${year} ${entry.countryName} public-holiday driving-ban dates seeded (last seeded: ${entry.validYear}). Add the ${year} holidays before publishing a ${entry.countryName} driving-ban report.`,
    };
  }
  const startIso = fmt(weekStart);
  const endIso = fmt(weekEnd);
  return {
    occurrences: entry.seededHolidays
      .filter((h) => h.validFrom >= startIso && h.validFrom <= endIso)
      .map((h) => ({
        title: `Public-holiday driving ban — ${h.holiday} (${humanDate(h.holidayDate || h.validTo)})`,
        whatChanged: h.whatChanged || entry.whatChanged,
        validFrom: h.validFrom,
        validTo: h.validTo,
        timeWindow: h.timeWindow,
        impact: h.impact || entry.impact,
        recommendedAction: h.recommendedAction || entry.recommendedAction,
      })),
  };
}

/** @type {Array<object>} */
export const publicHolidayDrivingBans = [
  {
    id: 'de-public-holiday-ban-2026',
    country: 'DE',
    countryName: 'Germany',
    kind: 'annual-calendar',
    validYear: 2026,
    sourceUrl:
      'https://www.balm.bund.de/DE/Themen/RechtsentwicklungRechtsvorschriften/Rechtsvorschriften/Strassenverkehrsrecht/LKW-Fahrverbote/LKW-Fahrverbote.html',
    sourceName: 'BALM - LKW-Fahrverbote',
    legalBasis: '§30(3) StVO - Sunday and public-holiday driving ban',
    vehicleScope: 'Goods vehicles (and combinations) over 7.5t gross vehicle weight; goods vehicles with trailers',
    routeScope:
      'Nationwide for nationwide holidays; regional holidays apply only in the Länder where the day is a public holiday (stated per occurrence).',
    exemptionNotes:
      'Standard §30(3) StVO exemptions apply (e.g. combined transport, fresh perishable goods, empty runs connected with them) - check the current BALM list for the specific transport.',
    lastVerified: '2026-09-23',
    whatChanged: 'The Sunday driving ban also applies on this public holiday.',
    impact: 'Heavy goods vehicles and goods-vehicle-with-trailer combinations cannot operate during the holiday window in the affected area.',
    recommendedAction: 'Schedule German transits outside 00:00-22:00 on the holiday or confirm a §30(3) StVO exemption before departure.',
    seededHolidays: [
      {
        holiday: 'Day of German Unity',
        validFrom: '2026-10-03',
        validTo: '2026-10-03',
        timeWindow: 'Saturday 3 October 2026 00:00-22:00, nationwide',
      },
      {
        holiday: 'Reformation Day (regional)',
        validFrom: '2026-10-31',
        validTo: '2026-10-31',
        timeWindow:
          'Saturday 31 October 2026 00:00-22:00, only in Brandenburg, Bremen, Hamburg, Mecklenburg-Vorpommern, Lower Saxony, Saxony, Saxony-Anhalt, Schleswig-Holstein and Thuringia',
      },
      {
        holiday: 'Day of Repentance and Prayer (Saxony)',
        validFrom: '2026-11-18',
        validTo: '2026-11-18',
        timeWindow: 'Wednesday 18 November 2026 00:00-22:00, Saxony only',
      },
      {
        holiday: 'Christmas',
        holidayDate: '2026-12-25',
        validFrom: '2026-12-25',
        validTo: '2026-12-26',
        timeWindow: 'Friday 25 December 2026 00:00-22:00 and Saturday 26 December 2026 00:00-22:00, nationwide',
      },
    ],
    resolve(weekStart, weekEnd, year) {
      return resolveSeededHolidays(this, weekStart, weekEnd, year);
    },
  },

  {
    id: 'cz-public-holiday-ban-2026',
    country: 'CZ',
    countryName: 'Czechia',
    kind: 'annual-calendar',
    validYear: 2026,
    sourceUrl: 'https://md.gov.cz/Dokumenty/Silnicni-doprava/Vyjimky-ze-zakazu-jizdy-%28povoleni%29',
    sourceName: 'Ministerstvo dopravy CR - Vyjimky ze zakazu jizdy',
    legalBasis: 'Section 43(1) of Act No. 361/2000 Coll. - Sunday and public-holiday restriction',
    vehicleScope: 'Vehicles above 7.5t; vehicles above 3.5t towing a trailer',
    routeScope: 'Motorways and Class I roads',
    exemptionNotes:
      'Statutory exemptions and individual Ministry of Transport exemptions ("povoleni") apply - check before assuming the ban applies without exception.',
    lastVerified: '2026-09-23',
    whatChanged: 'The Sunday restriction (13:00-22:00) also applies on this public holiday.',
    impact: 'Affected vehicles cannot use Czech motorways or Class I roads during the holiday window.',
    recommendedAction: 'Plan Czech motorway/Class I transit outside 13:00-22:00 on the holiday, or confirm a valid exemption before departure.',
    seededHolidays: [
      { holiday: 'St. Wenceslas Day', validFrom: '2026-09-28', validTo: '2026-09-28', timeWindow: 'Monday 28 September 2026 13:00-22:00' },
      { holiday: 'Independent Czechoslovak State Day', validFrom: '2026-10-28', validTo: '2026-10-28', timeWindow: 'Wednesday 28 October 2026 13:00-22:00' },
      { holiday: 'Struggle for Freedom and Democracy Day', validFrom: '2026-11-17', validTo: '2026-11-17', timeWindow: 'Tuesday 17 November 2026 13:00-22:00' },
      {
        holiday: 'Christmas',
        holidayDate: '2026-12-24',
        validFrom: '2026-12-24',
        validTo: '2026-12-26',
        timeWindow: 'Thursday 24, Friday 25 and Saturday 26 December 2026, each day 13:00-22:00',
      },
    ],
    resolve(weekStart, weekEnd, year) {
      return resolveSeededHolidays(this, weekStart, weekEnd, year);
    },
  },

  {
    id: 'at-public-holiday-ban-2026',
    country: 'AT',
    countryName: 'Austria',
    kind: 'annual-calendar',
    validYear: 2026,
    sourceUrl: 'https://www.wko.at/transport/fahrverbote',
    sourceName: 'WKO - Fahrverbote in Oesterreich',
    legalBasis: '§42(1) StVO - weekend and public-holiday driving ban',
    vehicleScope:
      'Goods vehicles with trailers above 3.5t; standalone goods vehicles above 7.5t; articulated combinations above 7.5t; self-propelled working machines above 7.5t - the threshold differs by vehicle type and must not be flattened to a single number',
    routeScope: 'Nationwide Austrian road network',
    exemptionNotes: 'Standard Austrian weekend/holiday-ban exemptions apply (e.g. combined transport, fresh perishable goods) - check the current exemption list for the specific transport.',
    lastVerified: '2026-09-23',
    whatChanged: 'The Austrian public-holiday driving ban applies from 00:00 to 22:00.',
    impact: 'Affected vehicle categories cannot operate on the Austrian road network during the holiday window.',
    recommendedAction: 'Plan Austrian transit outside 00:00-22:00 on the holiday and check the standard exemption list.',
    seededHolidays: [
      { holiday: 'National Day', validFrom: '2026-10-26', validTo: '2026-10-26', timeWindow: 'Monday 26 October 2026 00:00-22:00' },
      { holiday: 'Immaculate Conception', validFrom: '2026-12-08', validTo: '2026-12-08', timeWindow: 'Tuesday 8 December 2026 00:00-22:00' },
      {
        holiday: 'Christmas',
        holidayDate: '2026-12-25',
        validFrom: '2026-12-25',
        validTo: '2026-12-26',
        timeWindow:
          'Friday 25 December 2026 00:00-22:00; Saturday 26 December 2026 00:00-22:00 (holiday) plus the regular Saturday ban from 15:00, running into the Sunday ban',
      },
    ],
    resolve(weekStart, weekEnd, year) {
      return resolveSeededHolidays(this, weekStart, weekEnd, year);
    },
  },

  {
    id: 'si-public-holiday-ban-2026',
    country: 'SI',
    countryName: 'Slovenia',
    kind: 'annual-calendar',
    validYear: 2026,
    sourceUrl: 'https://www.promet.si/en/general-limitations',
    sourceName: 'Promet.si - Limitation of cargo traffic in Slovenia',
    legalBasis: 'Order on the Limiting of Traffic on Roads in the Republic of Slovenia - Sundays, public holidays and non-working days',
    vehicleScope: 'Heavy goods vehicles above 7.5t maximum authorised total weight',
    routeScope: 'Roads covered by the Slovenian cargo-traffic restriction order',
    exemptionNotes:
      'Promet.si lists statutory exceptions including emergency/public-interest movements, specified perishable goods, certain combined transport and documented empty runs; verify the current list for the specific movement.',
    lastVerified: '2026-09-23',
    whatChanged: "Slovenia's Sunday restriction (08:00-22:00) also applies on this public holiday.",
    impact: 'Affected HGVs cannot operate on roads covered by the restriction order during the holiday window unless an exception applies.',
    recommendedAction: 'Plan Slovenian HGV transit outside 08:00-22:00 on the holiday and verify the published exception list.',
    seededHolidays: [
      { holiday: 'Reformation Day', validFrom: '2026-10-31', validTo: '2026-10-31', timeWindow: 'Saturday 31 October 2026 08:00-22:00' },
      {
        holiday: 'Christmas / Independence and Unity Day',
        holidayDate: '2026-12-25',
        validFrom: '2026-12-25',
        validTo: '2026-12-26',
        timeWindow: 'Friday 25 December 2026 08:00-22:00 and Saturday 26 December 2026 08:00-22:00',
      },
    ],
    resolve(weekStart, weekEnd, year) {
      return resolveSeededHolidays(this, weekStart, weekEnd, year);
    },
  },

  {
    id: 'sk-public-holiday-ban-2026',
    country: 'SK',
    countryName: 'Slovakia',
    kind: 'annual-calendar',
    validYear: 2026,
    sourceUrl: 'https://static.slov-lex.sk/static/SK/ZZ/2009/8/20260901.html',
    sourceName: 'Slov-Lex - Act No. 8/2009 Coll., Section 39 (as amended from 1 September 2026)',
    additionalSources: [
      { name: 'Cargo magazin - Zakaz jazdy kamionov 2026', url: 'https://www.cargomagazin.sk/nakladne-vozidla/zakaz-jazdy-kamionov/' },
      { name: 'CESMAD Slovakia - Informacie podla krajin: Slovensko', url: 'https://www.cesmad.sk/informacie-podla-krajiny/33-informacie-podla-krajin/28-slovensko' },
    ],
    legalBasis: 'Section 39 of Act No. 8/2009 Coll. on Road Traffic - driving ban on days of rest (Act No. 131/2026 moved the start from 00:00 to 06:00 from 1 September 2026)',
    vehicleScope: 'Vehicles above 7.5t; vehicles above 3.5t towing a trailer',
    routeScope: 'Motorways, roads for motor vehicles, and Class I roads',
    exemptionNotes:
      'Section 39(3) statutory exemptions apply. In recent years (2020, 2025) the Police Force has also issued a general exemption for 24-26 December allowing vehicles entering Slovakia with a destination inside the country to travel 00:00-09:00 and 16:00-24:00 - check whether a 2026 exemption has been published. 17 November is a state holiday but no longer a day of rest, so no ban applies on it.',
    lastVerified: '2026-09-23',
    whatChanged: 'The Section 39 day-of-rest driving ban applies over the Christmas holidays.',
    impact: 'Affected vehicles cannot use Slovak motorways, roads for motor vehicles, or Class I roads during the holiday windows.',
    recommendedAction:
      'Plan Slovak transit outside 06:00-22:00 on 24-26 December (and Sunday 27 December), and check for the police general exemption for traffic entering Slovakia.',
    seededHolidays: [
      {
        holiday: 'Christmas',
        holidayDate: '2026-12-24',
        validFrom: '2026-12-24',
        validTo: '2026-12-26',
        timeWindow:
          'Thursday 24, Friday 25 and Saturday 26 December 2026, each day 06:00-22:00; the regular Sunday ban follows on 27 December 06:00-22:00. Conservative planning window: the amended Section 39 names a shorter 09:00-19:00 window for the first day of a multi-day rest period, but trade sources and police practice treat all three days as ban days.',
      },
    ],
    resolve(weekStart, weekEnd, year) {
      return resolveSeededHolidays(this, weekStart, weekEnd, year);
    },
  },

  {
    id: 'ch-public-holiday-ban-2026',
    country: 'CH',
    countryName: 'Switzerland',
    kind: 'annual-calendar',
    validYear: 2026,
    sourceUrl: 'https://www.astra.admin.ch/de/sonntags-und-nachtfahrten',
    sourceName: 'ASTRA - Sonntags- und Nachtfahrverbot',
    legalBasis: 'Sunday driving ban extended to the federally listed public holidays (Art. 91 VRV)',
    vehicleScope: 'Vehicles above 3.5t; articulated vehicles above 5t; vehicles towing a trailer above 3.5t',
    routeScope: 'Nationwide Swiss road network',
    exemptionNotes:
      'A special permit ("Sonderbewilligung") can be requested; it interacts with any separate exceptional-transport permit held for the same movement - both must be checked.',
    lastVerified: '2026-09-23',
    whatChanged: 'The Swiss Sunday driving ban applies on this federally listed public holiday, on top of the nightly 22:00-05:00 ban.',
    impact: 'Affected vehicles cannot move on the holiday without a special permit.',
    recommendedAction: 'Apply for a Sonderbewilligung in advance for any movement required on the holiday.',
    seededHolidays: [
      {
        holiday: 'Christmas Day and St. Stephen’s Day',
        holidayDate: '2026-12-25',
        validFrom: '2026-12-25',
        validTo: '2026-12-26',
        timeWindow: 'Friday 25 and Saturday 26 December 2026, full-day ban (night ban 22:00-05:00 also applies)',
      },
    ],
    resolve(weekStart, weekEnd, year) {
      return resolveSeededHolidays(this, weekStart, weekEnd, year);
    },
  },

  {
    id: 'fr-general-hgv-public-holiday-ban-2026',
    country: 'FR',
    countryName: 'France',
    kind: 'annual-calendar',
    validYear: 2026,
    sourceUrl: 'https://www3.bison-fute.gouv.fr/IMG/pdf/BisonFute_Brochure_vehicules_lourds_FR_2025.pdf',
    sourceName: 'Bison Fute - Vehicules lourds, interdictions generales',
    legalBasis: 'Article 1 of the Order of 16 April 2021 - general restriction from 22:00 on the eve of a public holiday to 22:00 on the holiday',
    vehicleScope: 'Goods vehicles and combinations above 7.5t GVW, excluding the specialised and agricultural categories defined by the order',
    routeScope: 'Entire French road network',
    exemptionNotes: 'Article 4 transport categories are exempt unless a prefect decides otherwise under the order.',
    lastVerified: '2026-09-23',
    whatChanged: "France's general goods-vehicle restriction applies from 22:00 on the eve of the public holiday to 22:00 on the holiday.",
    impact: 'Affected general-goods vehicles cannot operate on the French road network during the holiday window unless an Article 4 exemption applies.',
    recommendedAction: 'Schedule general HGV transit outside the eve-22:00 to holiday-22:00 window, and verify the Article 4 exemption list.',
    seededHolidays: [
      {
        holiday: 'Armistice Day',
        holidayDate: '2026-11-11',
        validFrom: '2026-11-10',
        validTo: '2026-11-11',
        timeWindow: 'Tuesday 10 November 2026 22:00 to Wednesday 11 November 2026 22:00',
      },
      {
        holiday: 'Christmas Day',
        holidayDate: '2026-12-25',
        validFrom: '2026-12-24',
        validTo: '2026-12-25',
        timeWindow: 'Thursday 24 December 2026 22:00 to Friday 25 December 2026 22:00',
      },
    ],
    resolve(weekStart, weekEnd, year) {
      return resolveSeededHolidays(this, weekStart, weekEnd, year);
    },
  },

  {
    id: 'fr-exceptional-transport-public-holiday-ban-2026',
    country: 'FR',
    countryName: 'France',
    kind: 'annual-calendar',
    validYear: 2026,
    sourceUrl: 'https://www2.bison-fute.gouv.fr/regime-general%2C10852.html',
    sourceName: 'Bison Fute - Regime general des transports exceptionnels',
    legalBasis: 'Standing exceptional-transport movement ban from midday on the eve of a public holiday to 06:00 on the day after it',
    vehicleScope: 'Exceptional transports (convois exceptionnels) without the necessary departmental exemption',
    routeScope: 'Nationwide French road network',
    exemptionNotes:
      'A departmental exemption (autorisation prefectorale) can permit movement during the ban window for a specific transport. Distinct from the general HGV holiday restriction.',
    lastVerified: '2026-09-23',
    whatChanged: 'The exceptional-transport movement ban extends around this public holiday: from 12:00 on the eve to 06:00 on the following day.',
    impact: 'Exceptional/oversized transports without a departmental exemption cannot move anywhere in France during this window.',
    recommendedAction: 'Confirm the departmental exemption before midday on the eve of the holiday, or plan the movement outside the window.',
    seededHolidays: [
      {
        holiday: 'Armistice Day',
        holidayDate: '2026-11-11',
        validFrom: '2026-11-10',
        validTo: '2026-11-12',
        timeWindow: 'Tuesday 10 November 2026 12:00 to Thursday 12 November 2026 06:00',
      },
      {
        holiday: 'Christmas Day',
        holidayDate: '2026-12-25',
        validFrom: '2026-12-24',
        validTo: '2026-12-26',
        timeWindow: 'Thursday 24 December 2026 12:00 to Saturday 26 December 2026 06:00 (the weekend ban then starts again on Saturday at 12:00)',
      },
    ],
    resolve(weekStart, weekEnd, year) {
      return resolveSeededHolidays(this, weekStart, weekEnd, year);
    },
  },

  {
    id: 'hu-public-holiday-ban-2026',
    country: 'HU',
    countryName: 'Hungary',
    kind: 'annual-calendar',
    validYear: 2026,
    sourceUrl: 'https://www.wko.at/aussenwirtschaft/ungarn-lkw-wochenendfahrverbot',
    sourceName: 'WKO Aussenwirtschaft - Ungarn LKW-Wochenendfahrverbot',
    legalBasis: 'Hungarian heavy-vehicle driving ban on public holidays (from 22:00 on the preceding day to 22:00 on the holiday)',
    vehicleScope: 'Heavy vehicles above 7.5t',
    routeScope: 'Nationwide Hungarian road network',
    exemptionNotes:
      'Statutory exemptions and permits apply. International transports classified EURO-3 or higher are exempt from the weekend and holiday ban between 4 November 2026 and 1 March 2027 (WKO / Útinform) - check the current exemption list for the specific transport.',
    lastVerified: '2026-09-23',
    whatChanged: 'The Hungarian holiday driving ban runs from 22:00 on the day before the holiday until 22:00 on the holiday.',
    impact: 'Heavy vehicles above 7.5t cannot operate on the Hungarian road network during the holiday window.',
    recommendedAction: 'Plan Hungarian transit outside the holiday window and recheck shortly before departure.',
    seededHolidays: [
      {
        holiday: 'National Day (1956 Revolution)',
        holidayDate: '2026-10-23',
        validFrom: '2026-10-22',
        validTo: '2026-10-23',
        timeWindow: 'Thursday 22 October 2026 22:00 to Friday 23 October 2026 22:00',
      },
      {
        holiday: 'Christmas',
        holidayDate: '2026-12-25',
        validFrom: '2026-12-24',
        validTo: '2026-12-26',
        timeWindow: 'Thursday 24 December 2026 22:00 to Saturday 26 December 2026 22:00, followed directly by the weekend ban to Sunday 27 December 22:00',
      },
    ],
    resolve(weekStart, weekEnd, year) {
      return resolveSeededHolidays(this, weekStart, weekEnd, year);
    },
  },

  {
    id: 'pl-public-holiday-ban-2026',
    country: 'PL',
    countryName: 'Poland',
    kind: 'annual-calendar',
    validYear: 2026,
    sourceUrl: 'https://www.gov.pl/web/gitd/zakazy-jazdy-10-i-11-listopada',
    sourceName: 'GITD - zakazy jazdy w dni ustawowo wolne od pracy',
    legalBasis: 'Art. 50a of the Road Traffic Act - public-holiday ban 08:00-22:00 and 18:00-22:00 on the preceding day',
    vehicleScope: 'Vehicles and combinations of vehicles above 12 tonnes gross vehicle weight (buses excluded)',
    routeScope: 'Nationwide Polish road network',
    exemptionNotes:
      'Statutory exemptions exist (e.g. vehicles returning from abroad to their base, perishable goods, livestock, fuel) - check the current exemption list for the specific transport.',
    lastVerified: '2026-09-23',
    whatChanged: 'The Polish public-holiday driving ban applies 08:00-22:00 on the holiday and 18:00-22:00 on the preceding day.',
    impact: 'Vehicles above 12t cannot use the Polish road network during the holiday windows.',
    recommendedAction: 'Plan Polish transit outside the eve and holiday windows, and check the statutory exemption list.',
    seededHolidays: [
      {
        holiday: 'All Saints’ Day',
        holidayDate: '2026-11-01',
        validFrom: '2026-10-31',
        validTo: '2026-11-01',
        timeWindow: 'Saturday 31 October 2026 18:00-22:00; Sunday 1 November 2026 08:00-22:00',
      },
      {
        holiday: 'Independence Day',
        holidayDate: '2026-11-11',
        validFrom: '2026-11-10',
        validTo: '2026-11-11',
        timeWindow: 'Tuesday 10 November 2026 18:00-22:00; Wednesday 11 November 2026 08:00-22:00',
      },
      {
        holiday: 'Christmas',
        holidayDate: '2026-12-25',
        validFrom: '2026-12-25',
        validTo: '2026-12-26',
        timeWindow:
          'Friday 25 and Saturday 26 December 2026 08:00-22:00. No ban on 24 December: although it has been a statutory day off since 2025, the Ministry of Infrastructure confirmed it is not on the regulation\'s list of restricted days.',
      },
    ],
    resolve(weekStart, weekEnd, year) {
      return resolveSeededHolidays(this, weekStart, weekEnd, year);
    },
  },
];
