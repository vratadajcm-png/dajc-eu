// Registry of European sources monitored for EU Oversize Weekly findings.
//
// This is a starting/curated set, not exhaustive pan-European coverage - see
// docs/NEWS_AUTOMATION.md "How to add a new source" for how to extend it.
// `feedUrl` is set only where a working RSS/Atom feed is already known; other
// sources are attempted via generic feed-URL guessing at monitor runtime
// (see scripts/lib/fetch-source.mjs) and simply produce zero findings until
// a feed is confirmed or a dedicated adapter is added - the monitor never
// crashes on a source it can't read, it just skips and logs it.
//
// @typedef {'ministry'|'national-road-authority'|'regional-road-authority'|
//   'police'|'abnormal-load-permit-authority'|'bridge-tunnel-operator'|
//   'border-authority'|'traffic-portal'|'industry-media'} SourceType
//
// @typedef {Object} OversizeSource
// @property {string} id
// @property {string} country - ISO 3166-1 alpha-2
// @property {string} authority
// @property {string} name
// @property {string} url - homepage/reference URL
// @property {string} [feedUrl] - known working RSS/Atom feed URL, if any
// @property {SourceType} type
// @property {1|2|3} priority

/** @type {OversizeSource[]} */
export const oversizeSources = [
  {
    id: 'no-vegvesen',
    country: 'NO',
    authority: 'Statens vegvesen',
    name: 'Statens vegvesen - Nyheter',
    url: 'https://www.vegvesen.no',
    feedUrl: 'https://www.vegvesen.no/rss',
    type: 'national-road-authority',
    priority: 1,
  },
  {
    id: 'uk-govuk-dft',
    country: 'UK',
    authority: 'Department for Transport',
    name: 'GOV.UK - Department for Transport news',
    url: 'https://www.gov.uk/government/organisations/department-for-transport',
    feedUrl:
      'https://www.gov.uk/search/news-and-communications.atom?organisations%5B%5D=department-for-transport',
    type: 'ministry',
    priority: 1,
  },
  {
    id: 'uk-npcc',
    country: 'UK',
    authority: "National Police Chiefs' Council",
    name: 'NPCC News (Roads Policing)',
    url: 'https://news.npcc.police.uk',
    feedUrl: 'https://news.npcc.police.uk/feed/rss',
    type: 'police',
    priority: 2,
  },
  {
    id: 'pl-policja',
    country: 'PL',
    authority: 'Policja',
    name: 'Policja.pl - Aktualnosci',
    url: 'https://www.policja.pl',
    feedUrl: 'https://www.policja.pl/dokumenty/rss/1-rss-1.rss',
    type: 'police',
    priority: 2,
  },
  {
    id: 'de-polizei-blaulicht',
    country: 'DE',
    authority: 'Presseportal (all German police forces)',
    name: 'Presseportal - Polizeipresse (Blaulicht)',
    url: 'https://www.presseportal.de/blaulicht',
    feedUrl: 'https://www.presseportal.de/rss/blaulicht.rss2',
    type: 'police',
    priority: 2,
  },
  {
    id: 'hu-kozut',
    country: 'HU',
    authority: 'Magyar Kozut',
    name: 'Magyar Kozut Nonprofit Zrt.',
    url: 'https://www.kozut.hu',
    feedUrl: 'https://internet.kozut.hu/feed/',
    type: 'national-road-authority',
    priority: 1,
  },
  {
    id: 'al-arrsh',
    country: 'AL',
    authority: 'Autoriteti Rrugor Shqiptar',
    name: 'ARRSH - Albanian Road Authority',
    url: 'https://www.arrsh.gov.al',
    feedUrl: 'https://www.arrsh.gov.al/feed',
    type: 'national-road-authority',
    priority: 3,
  },
  {
    id: 'md-drumuri',
    country: 'MD',
    authority: 'Administratia Nationala a Drumurilor',
    name: 'Moldova National Road Administration',
    url: 'https://drumuri.md',
    feedUrl: 'https://drumuri.md/feed/',
    type: 'national-road-authority',
    priority: 3,
  },
  {
    id: 'by-belavtodor',
    country: 'BY',
    authority: 'Belavtodor',
    name: 'Belarus Road Administration',
    url: 'https://belavtodor.by',
    feedUrl: 'https://belavtodor.by/feed/',
    type: 'national-road-authority',
    priority: 3,
  },
  {
    id: 'ua-restoration',
    country: 'UA',
    authority: 'Agentstvo vidnovlennya',
    name: 'Ukraine Restoration and Infrastructure Development Agency',
    url: 'https://restoration.gov.ua',
    feedUrl: 'https://restoration.gov.ua/feed/',
    type: 'national-road-authority',
    priority: 2,
  },
  {
    id: 'mc-gouv',
    country: 'MC',
    authority: 'Gouvernement de Monaco',
    name: 'Gouvernement de Monaco - Actualites',
    url: 'https://www.gouv.mc',
    feedUrl: 'https://www.gouv.mc/rss/feed/portail-gouv-actualites-fr',
    type: 'ministry',
    priority: 3,
  },
  {
    id: 'cz-czechtoll',
    country: 'CZ',
    authority: 'CzechToll',
    name: 'CzechToll - electronic tolling operator',
    url: 'https://www.czechtoll.cz',
    feedUrl: 'https://www.czechtoll.cz/feed/',
    type: 'bridge-tunnel-operator',
    priority: 1,
  },
  {
    id: 'mk-roads',
    country: 'MK',
    authority: 'JP za drzavni patista',
    name: 'North Macedonia Public Enterprise for State Roads',
    url: 'https://roads.org.mk',
    feedUrl: 'https://roads.org.mk/feed/',
    type: 'national-road-authority',
    priority: 3,
  },
  {
    id: 'lt-vialietuva',
    country: 'LT',
    authority: 'Via Lietuva',
    name: 'Via Lietuva (Lithuanian Road Administration)',
    url: 'https://vialietuva.lt',
    feedUrl: 'https://vialietuva.lt/feed',
    type: 'national-road-authority',
    priority: 2,
  },
  {
    id: 'xk-kosovopolice',
    country: 'XK',
    authority: 'Policia e Kosoves',
    name: 'Kosovo Police',
    url: 'https://www.kosovopolice.com',
    feedUrl: 'https://www.kosovopolice.com/feed/',
    type: 'police',
    priority: 3,
  },
  {
    id: 'de-autobahn',
    country: 'DE',
    authority: 'Autobahn GmbH des Bundes',
    name: 'Autobahn GmbH - Aktuelles',
    url: 'https://www.autobahn.de/aktuelles/aktuell',
    type: 'national-road-authority',
    priority: 1,
  },
  {
    id: 'fr-bison-fute',
    country: 'FR',
    authority: 'Bison Fute',
    name: 'Bison Fute - traffic restrictions',
    url: 'https://www.bison-fute.gouv.fr',
    type: 'traffic-portal',
    priority: 1,
  },
  {
    id: 'at-asfinag',
    country: 'AT',
    authority: 'ASFINAG',
    name: 'ASFINAG - press releases',
    url: 'https://www.asfinag.at/ueber-uns/presse/pressemeldungen/',
    type: 'national-road-authority',
    priority: 1,
  },
  {
    id: 'ch-astra',
    country: 'CH',
    authority: 'ASTRA - Bundesamt fur Strassen',
    name: 'ASTRA - Medienmitteilungen',
    url: 'https://www.astra.admin.ch/astra/de/home/dokumentation/medienmitteilungen.html',
    type: 'national-road-authority',
    priority: 1,
  },
  {
    id: 'nl-rijkswaterstaat',
    country: 'NL',
    authority: 'Rijkswaterstaat',
    name: 'Rijkswaterstaat - Actueel',
    url: 'https://www.rijkswaterstaat.nl',
    type: 'national-road-authority',
    priority: 1,
  },
  {
    id: 'it-anas',
    country: 'IT',
    authority: 'ANAS S.p.A.',
    name: 'ANAS - press releases',
    url: 'https://www.stradeanas.it/it',
    type: 'national-road-authority',
    priority: 1,
  },
  {
    id: 'es-dgt',
    country: 'ES',
    authority: 'Direccion General de Trafico',
    name: 'DGT - Sala de Prensa',
    url: 'https://www.dgt.es',
    type: 'ministry',
    priority: 1,
  },
  {
    id: 'be-viapass',
    country: 'BE',
    authority: 'Viapass',
    name: 'Viapass - kilometre charge for trucks',
    url: 'https://www.viapass.be/actualites/',
    type: 'bridge-tunnel-operator',
    priority: 1,
  },
];

// Note: no Slovak (SK) source is included yet. A prior, related audit found
// the obvious candidate (NDS / ndsas.sk) unreliable - its feed serves a
// `pubDate` that tracks `dateModified` rather than the true publish date,
// so years-old press releases can appear as "fresh". Add an SK source only
// after independently confirming its date handling is trustworthy.

export function getSourceById(id) {
  return oversizeSources.find((source) => source.id === id);
}
