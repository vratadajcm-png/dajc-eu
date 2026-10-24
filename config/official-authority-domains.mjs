// Public road, permit, toll and transport authorities per DAJC coverage code
// (config/europe-coverage.mjs). Two uses only:
//   1. the official-first pass of Perplexity Search is restricted to these
//      domains plus the configured official sources (config/oversize-sources),
//      so an authority notice is not crowded out by aggregators and blogs;
//   2. source-policy.mjs classifies them as official primary publishers.
// A missing or wrong entry only means fewer official hits - it never lets a
// page bypass the editorial rules. Keep each list short (Search accepts at
// most 20 domains per request across a whole search group).
export const officialAuthorityDomains = {
  CZ: ['rsd.cz', 'gov.cz', 'dopravniinfo.cz', 'mytocz.eu', 'czechtoll.cz'],
  DE: ['autobahn.de', 'vemags.de', 'bast.de', 'toll-collect.de', 'bund.de', 'brandenburg.de', 'strassen.nrw.de'],
  AT: ['asfinag.at', 'gv.at'],
  SK: ['ssc.sk', 'ndsas.sk', 'mindop.sk', 'cdb.sk', 'gov.sk'],
  PL: ['gov.pl'],
  HU: ['kozut.hu', 'kormany.hu', 'nemzetiutdij.hu'],
  CH: ['admin.ch'],
  LI: ['llv.li'],
  SI: ['dars.si', 'promet.si', 'gov.si'],
  HR: ['hrvatske-ceste.hr', 'hac.hr', 'gov.hr'],
  FR: ['gouv.fr', 'sftrf.fr', 'atmb.com'],
  MC: ['gouv.mc'],
  BE: ['wegenenverkeer.be', 'wallonie.be', 'belgium.be', 'viapass.be'],
  NL: ['rijkswaterstaat.nl', 'rdw.nl', 'overheid.nl'],
  LU: ['gouvernement.lu', 'public.lu'],
  IT: ['gov.it', 'stradeanas.it'],
  SM: ['gov.sm'],
  RO: ['cnair.ro', 'gov.ro'],
  BG: ['api.bg', 'bgtoll.bg'],
  MD: ['asd.md', 'gov.md'],
  ES: ['dgt.es', 'gob.es'],
  PT: ['infraestruturasdeportugal.pt', 'imt-ip.pt'],
  AD: ['govern.ad'],
  UK: ['gov.uk', 'nationalhighways.co.uk'],
  IE: ['tii.ie', 'gov.ie', 'rsa.ie'],
  DK: ['vejdirektoratet.dk', 'storebaelt.dk'],
  SE: ['trafikverket.se', 'transportstyrelsen.se'],
  NO: ['vegvesen.no', 'regjeringen.no'],
  FI: ['vayla.fi', 'traficom.fi', 'fintraffic.fi'],
  IS: ['vegagerdin.is'],
  EE: ['transpordiamet.ee'],
  LV: ['lvceli.lv'],
  LT: ['vialietuva.lt'],
  RS: ['putevi-srbije.rs'],
  ME: ['monteput.me'],
  AL: ['gov.al'],
  GR: ['gov.gr'],
  UA: ['gov.ua'],
  TR: ['gov.tr'],
  CY: ['gov.cy'],
  MT: ['gov.mt'],
};
