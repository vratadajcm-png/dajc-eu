// Time-limited, officially verified exceptions that materially modify the
// maintained baseline driving-ban rules. Keep these separate from evergreen
// and annual-calendar rules so expiry and provenance stay explicit.

function fmt(date) {
  return date.toISOString().slice(0, 10);
}

export const currentDrivingBanExceptions = [
  {
    id: 'de-low-water-september-2026-exception',
    country: 'DE',
    countryName: 'Germany',
    kind: 'temporary-exception',
    sourceUrl: 'https://www.berlin.de/sen/uvk/presse/weitere-meldungen/2026/artikel.1701829.php',
    sourceName: 'Berlin Senate Department for Mobility, Transport, Climate Protection and the Environment — general order of 24 August 2026',
    additionalSources: [
      'https://www.berlin.de/sen/uvk/presse/pressemitteilungen/2026/pressemitteilung.1707115.php',
      'https://lbm.rlp.de/service/presse-aktuelles/detail/wolf-weitere-erleichterungen-fuer-guetertransporte-wegen-niedrigwassers',
    ],
    legalBasis: 'Temporary state-level exemptions under §46(2) StVO and §4(3) Ferienreiseverordnung due to low water on German inland waterways',
    vehicleScope: 'Commercial or paid goods transport using trucks over 7.5t or trucks with trailers where the movement is directly or indirectly connected with consequences of low water; required related empty runs are included. In Berlin, Brandenburg and Rhineland-Palatinate the relief also covers Großraum- und Schwertransporte (oversize/heavy transport).',
    routeScope: 'Berlin, Brandenburg and Rhineland-Palatinate; only qualifying low-water-related replacement road transport, not ordinary freight traffic.',
    exemptionNotes: 'The normal Sunday/public-holiday ban remains in force for unrelated freight. For qualifying oversize/heavy transports, the authorities may partially waive the indivisible-load requirement up to 44t and reduce journey-time restrictions to the necessary minimum; the individual §29/§46 permit and other conditions still apply.',
    lastVerified: '2026-09-02',
    validFrom: '2026-08-24',
    validTo: '2026-09-30',
    resolve(weekStart, weekEnd, year) {
      if (year !== 2026) return { occurrences: [] };
      // Emit once when resolving the week that first intersects the current
      // September publication period. Calendar consumers deduplicate the
      // month-long occurrence; weekly editorial output will not repeat it.
      if (fmt(weekStart) !== '2026-08-31') return { occurrences: [] };
      if (fmt(weekEnd) < '2026-09-01') return { occurrences: [] };
      return {
        occurrences: [
          {
            title: 'Low-water exception to Sunday/holiday HGV bans — selected Länder',
            whatChanged: 'Berlin and Brandenburg extended their low-water exemptions through 30 September 2026 and explicitly expanded them to Großraum- und Schwertransporte. Rhineland-Palatinate also includes qualifying oversize/heavy transports in its low-water relief through 30 September.',
            validFrom: '2026-09-01',
            validTo: '2026-09-30',
            timeWindow: 'Applies during otherwise restricted Sunday/public-holiday periods through 30 September 2026; only to qualifying low-water-related replacement transports.',
            impact: 'Qualifying freight shifted from inland waterways may operate despite the normal Sunday/public-holiday restriction. In the listed Länder, qualifying oversize/heavy transports are included subject to permit conditions.',
            recommendedAction: 'Do not treat this as a general lifting of the German HGV ban. Document the direct or indirect low-water connection and confirm the applicable Land-level general order plus the individual oversize/heavy transport permit before departure.',
          },
        ],
      };
    },
  },
];
