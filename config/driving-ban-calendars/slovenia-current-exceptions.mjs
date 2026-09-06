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
    sourceUrl: 'https://promet.si/sl/aktualna-napoved',
    sourceName: 'PROMET.SI — current traffic forecast, verified 6 September 2026',
    legalBasis: 'Operational motorway closure announced by Slovenia traffic information service for an extraordinary transport movement',
    vehicleScope: 'All traffic on the affected motorway carriageway during the passage of the extraordinary transport; directly relevant to exceptional/oversize transport planning and all HGV traffic using the section.',
    routeScope: 'Extraordinary transport from the Fernetiči border crossing from about 22:00, via the Primorska motorway, Ljubljana ring road and Dolenjska motorway. Temporary closure on the narrowed carriageway between Bič and Ivančna Gorica toward Ljubljana.',
    exemptionNotes: 'This is not a standing nationwide HGV ban. The closure is operational and tied to the exceptional transport; actual passage time can move depending on convoy progress.',
    lastVerified: '2026-09-06',
    validFrom: '2026-09-06',
    validTo: '2026-09-07',
    resolve(weekStart, weekEnd, year) {
      if (year !== 2026) return { occurrences: [] };
      if (fmt(weekEnd) < this.validFrom || fmt(weekStart) > this.validTo) return { occurrences: [] };
      return {
        occurrences: [
          {
            title: 'Extraordinary transport — temporary A2 closure Bič–Ivančna Gorica',
            whatChanged: 'PROMET.SI announced a new overnight extraordinary transport from Fernetiči toward the Dolenjska corridor. Because of the load width, the narrowed motorway carriageway between Bič and Ivančna Gorica toward Ljubljana will be closed for about 30 minutes.',
            validFrom: '2026-09-06',
            validTo: '2026-09-07',
            timeWindow: 'Night of 6/7 September 2026. Departure from Fernetiči about 22:00; expected arrival at the Ivančna Gorica work-zone area about 00:30–01:30. The motorway closure is expected for roughly 30 minutes, approximately between 00:00 and 02:00; actual timing may change.',
            impact: 'All traffic, including HGVs, may be stopped on the affected narrowed carriageway while the exceptional transport passes. Oversize convoy timing and permit windows on the corridor may need adjustment.',
            recommendedAction: 'Check PROMET.SI immediately before entering the corridor, allow at least 30 minutes contingency and coordinate any exceptional-transport timing through Bič–Ivančna Gorica with the live closure window.',
          },
        ],
      };
    },
  },
];
