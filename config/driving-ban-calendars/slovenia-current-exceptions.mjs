// Time-limited Slovenia operational restrictions verified from PROMET.SI.
// Kept separate so short-lived exceptional-transport movements can expire
// without changing the maintained standing-rule registry.

function fmt(date) {
  return date.toISOString().slice(0, 10);
}

export const sloveniaCurrentDrivingBanExceptions = [
  {
    id: 'si-extraordinary-transport-fernetici-ivancna-2026-09-06',
    country: 'SI',
    countryName: 'Slovenia',
    kind: 'temporary-restriction',
    sourceUrl: 'https://promet.si/sl/napoved-del',
    sourceName: 'PROMET.SI — current roadworks forecast, verified 7 September 2026',
    legalBasis: 'Operational motorway closure announced by Slovenia traffic information service for an extraordinary transport movement',
    vehicleScope: 'All traffic on the affected motorway carriageway during the passage of the extraordinary transport; directly relevant to exceptional/oversize transport planning and all HGV traffic using the section.',
    routeScope: 'Extraordinary transport from the Fernetiči border crossing via the Primorska motorway, Ljubljana ring road and Dolenjska motorway. Temporary closure on the A2 between Bič and Ivančna Gorica toward Ljubljana.',
    exemptionNotes: 'This is not a standing nationwide HGV ban. The closure is operational and tied to the exceptional transport; live traffic management can still alter the exact passage time.',
    lastVerified: '2026-09-07',
    validFrom: '2026-09-06',
    validTo: '2026-09-07',
    resolve(weekStart, weekEnd, year) {
      if (year !== 2026) return { occurrences: [] };
      if (fmt(weekEnd) < this.validFrom || fmt(weekStart) > this.validTo) return { occurrences: [] };
      return {
        occurrences: [
          {
            title: 'Extraordinary transport — temporary A2 closure Bič–Ivančna Gorica',
            whatChanged: 'PROMET.SI updated the operational notice for the extraordinary transport: the short full closure between Bič and Ivančna Gorica toward Ljubljana is now scheduled between 01:00 and 03:00 on 7 September 2026, replacing the earlier approximate midnight–02:00 planning window.',
            validFrom: '2026-09-07',
            validTo: '2026-09-07',
            timeWindow: 'Monday 7 September 2026, 01:00–03:00. Short full closure during passage of the extraordinary transport.',
            impact: 'All traffic, including HGVs, can be stopped on the affected A2 carriageway while the exceptional transport passes. Oversize convoy timing and permit windows on the corridor may need adjustment.',
            recommendedAction: 'Use the updated 01:00–03:00 closure window for planning, check PROMET.SI immediately before entering the corridor, and coordinate exceptional-transport timing through Bič–Ivančna Gorica with live traffic control.',
          },
        ],
      };
    },
  },
];
