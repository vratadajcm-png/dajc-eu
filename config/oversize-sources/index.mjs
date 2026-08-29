// Registry of European sources monitored for EU Oversize Weekly findings.
//
// This is a starting/curated set, not exhaustive pan-European coverage - see
// docs/NEWS_AUTOMATION.md "How to add a new source" for how to extend it.
// `feedUrl` is set only where a working RSS/Atom feed is already known. Every
// source is also eligible for official-HTML ingestion through its `url`; use
// optional `htmlUrls` when a dedicated official traffic/news listing is more
// useful than the homepage. scripts/lib/fetch-source.mjs keeps RSS preferred,
// then falls back to HTML without using unofficial aggregators.
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
// @property {string[]} [htmlUrls] - preferred official HTML listing pages, if any
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
    url: 'https://internet.kozut.hu/hirek/',
    htmlUrls: [
      'https://internet.kozut.hu/hirek/',
      'https://internet.kozut.hu/ugyfelszolgalat/utvonalengedely-uvr-e-office/altalanos-tajekoztato/forgalomkorlatozasok/',
    ],
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
    htmlUrls: ['https://www.autobahn.de/betrieb-verkehr/verkehrsmeldungen'],
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
    url: 'https://www.astra.admin.ch/de/medienmitteilungen-zentrale',
    htmlUrls: [
      'https://www.astra.admin.ch/de/medienmitteilungen-zentrale',
      'https://www.astra.admin.ch/astra/de/home/themen/nationalstrassen/baustellen/medienmitteilungen.html',
    ],
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
  // Additional national authorities completing the pan-European discovery
  // surface. Entries without a confirmed feedUrl are intentionally retained:
  // fetch-source.mjs reads their official HTML and records a visible
  // UNAVAILABLE state only when no official endpoint can be reached.
  { id: 'ro-cnair', country: 'RO', authority: 'CNAIR', name: 'Romanian National Road Infrastructure Administration', url: 'https://www.cnadnr.ro', type: 'national-road-authority', priority: 1 },
  { id: 'dk-vejdirektoratet', country: 'DK', authority: 'Vejdirektoratet', name: 'Danish Road Directorate', url: 'https://www.vejdirektoratet.dk', type: 'national-road-authority', priority: 1 },
  { id: 'tr-kgm', country: 'TR', authority: 'Karayollari Genel Mudurlugu', name: 'Turkish General Directorate of Highways', url: 'https://www.kgm.gov.tr', type: 'national-road-authority', priority: 1 },
  { id: 'se-trafikverket', country: 'SE', authority: 'Trafikverket', name: 'Swedish Transport Administration', url: 'https://www.trafikverket.se', type: 'national-road-authority', priority: 1 },
  { id: 'fi-vayla', country: 'FI', authority: 'Vaylavirasto', name: 'Finnish Transport Infrastructure Agency', url: 'https://vayla.fi', type: 'national-road-authority', priority: 1 },
  { id: 'ee-transpordiamet', country: 'EE', authority: 'Transpordiamet', name: 'Estonian Transport Administration', url: 'https://www.transpordiamet.ee', type: 'national-road-authority', priority: 1 },
  { id: 'lv-lvceli', country: 'LV', authority: 'Latvijas Valsts celi', name: 'Latvian State Roads', url: 'https://lvceli.lv', type: 'national-road-authority', priority: 1 },
  { id: 'ie-tii', country: 'IE', authority: 'Transport Infrastructure Ireland', name: 'Transport Infrastructure Ireland', url: 'https://www.tii.ie', type: 'national-road-authority', priority: 1 },
  { id: 'pt-ip', country: 'PT', authority: 'Infraestruturas de Portugal', name: 'Infraestruturas de Portugal', url: 'https://www.infraestruturasdeportugal.pt', type: 'national-road-authority', priority: 1 },
  { id: 'bg-api', country: 'BG', authority: 'Road Infrastructure Agency', name: 'Bulgarian Road Infrastructure Agency', url: 'https://www.api.bg', type: 'national-road-authority', priority: 1 },
  { id: 'gr-yme', country: 'GR', authority: 'Ministry of Infrastructure and Transport', name: 'Greek Ministry of Infrastructure and Transport', url: 'https://www.yme.gr', type: 'ministry', priority: 1 },
  { id: 'hr-hrvatske-ceste', country: 'HR', authority: 'Hrvatske ceste', name: 'Croatian Roads', url: 'https://hrvatske-ceste.hr', type: 'national-road-authority', priority: 1 },
  { id: 'si-dars', country: 'SI', authority: 'Traffic Information Centre / DARS', name: 'Promet.si - official Slovenian traffic information', url: 'https://www.promet.si/en/general-limitations', htmlUrls: ['https://www.promet.si/en/my-traffic', 'https://www.promet.si/en/general-limitations'], type: 'national-road-authority', priority: 1 },
  { id: 'rs-putevi', country: 'RS', authority: 'Putevi Srbije', name: 'Roads of Serbia', url: 'https://www.putevi-srbije.rs', type: 'national-road-authority', priority: 1 },
  { id: 'ba-jpdcfbih', country: 'BA', authority: 'JP Ceste FBiH', name: 'Roads of the Federation of Bosnia and Herzegovina', url: 'https://jpdcfbh.ba', type: 'national-road-authority', priority: 2 },
  { id: 'me-monteput', country: 'ME', authority: 'Monteput', name: 'Monteput Montenegro', url: 'https://monteput.me', type: 'national-road-authority', priority: 2 },
  { id: 'lu-pch', country: 'LU', authority: 'Ponts et Chaussees', name: 'Luxembourg Roads Administration', url: 'https://pch.gouvernement.lu', type: 'national-road-authority', priority: 2 },
  { id: 'is-vegagerdin', country: 'IS', authority: 'Vegagerdin', name: 'Icelandic Road and Coastal Administration', url: 'https://www.vegagerdin.is', type: 'national-road-authority', priority: 2 },
  { id: 'cy-public-works', country: 'CY', authority: 'Public Works Department', name: 'Cyprus Public Works Department', url: 'https://www.mcw.gov.cy/mtcw/pwd/pwd.nsf/page41_gr/page41_gr?Count=1000&ExpandView=&OpenDocument=&Start=1', htmlUrls: ['https://www.mcw.gov.cy/mtcw/pwd/pwd.nsf/page41_gr/page41_gr?Count=1000&ExpandView=&OpenDocument=&Start=1'], type: 'national-road-authority', priority: 2 },
  { id: 'mt-transport', country: 'MT', authority: 'Transport Malta', name: 'Transport Malta', url: 'https://www.transport.gov.mt', type: 'national-road-authority', priority: 2 },
];

// Note: no Slovak (SK) source is included yet. A prior, related audit found
// the obvious candidate (NDS / ndsas.sk) unreliable - its feed serves a
// `pubDate` that tracks `dateModified` rather than the true publish date,
// so years-old press releases can appear as "fresh". Add an SK source only
// after independently confirming its date handling is trustworthy.

export function getSourceById(id) {
  return oversizeSources.find((source) => source.id === id);
}
