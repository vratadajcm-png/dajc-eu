// Registry of legal and official sources for the DAJC legal library, by
// jurisdiction and topic. Separate from config/official-authority-domains.mjs
// (road, permit and toll authorities used by search) but checked against it
// and against the single geographic authority config/europe-coverage.mjs.
//
// Only these publishers can be the origin of a library document. Articles,
// forums and commercial portals are never a legal authority here.
//
// `check.status` records what was actually verified, never more:
//   TERMS_VERIFIED   - reuse terms read on the publisher's own page (date given);
//   REACHABLE        - documents downloadable from the DAJC development
//                      environment on that date, terms not yet read;
//   BLOCKED_FROM_DEV - the publisher refused the development environment
//                      (HTTP 403/503 from its own server) on that date;
//   NOT_CHECKED      - listed from the publisher's official status, not yet checked.
// `reuse.basis` states why reuse is expected to be lawful; anything marked
// "to confirm" needs the owner's or advocate's confirmation before import.

import { isTrackedJurisdiction } from '../../../config/europe-coverage.mjs';
import { officialAuthorityDomains } from '../../../config/official-authority-domains.mjs';
import { KB_TOPICS, LEGAL_CATEGORIES } from './taxonomy.mjs';

export const SUPRANATIONAL = Object.freeze(['EU', 'INT']);

const ALL = KB_TOPICS;
const LAW = ['NATIONAL_ACT', 'NATIONAL_REGULATION'];
const CHECKED_ON = '2026-11-08';

const S = (entry) => Object.freeze(entry);

export const legalSources = Object.freeze([
  // --- European Union and international ------------------------------------
  S({
    id: 'eu-eurlex', jurisdiction: 'EU', name: 'EUR-Lex (Publications Office of the European Union)', kind: 'LEGISLATION_DATABASE',
    domains: ['eur-lex.europa.eu'], categories: ['EU_REGULATION', 'EU_DIRECTIVE', 'EU_DECISION'], topics: ALL,
    languages: ['bg', 'cs', 'da', 'de', 'el', 'en', 'es', 'et', 'fi', 'fr', 'ga', 'hr', 'hu', 'it', 'lt', 'lv', 'mt', 'nl', 'pl', 'pt', 'ro', 'sk', 'sl', 'sv'],
    authenticity: 'Only the Official Journal is authentic; consolidated texts are documentation tools.',
    reuse: { status: 'PERMITTED_WITH_ATTRIBUTION', basis: 'Commission Decision 2011/833/EU; consolidated texts and editorial content CC BY 4.0 (acknowledge the source, indicate changes).', termsUrl: 'https://eur-lex.europa.eu/content/legal-notice/legal-notice.html' },
    check: { status: 'TERMS_VERIFIED', checkedOn: CHECKED_ON, note: 'Legal notice read; consolidated PDFs of 561/2006, 165/2014, 96/53/EC downloaded.' },
  }),
  S({
    id: 'eu-commission-transport', jurisdiction: 'EU', name: 'European Commission, DG Mobility and Transport', kind: 'AUTHORITY',
    domains: ['transport.ec.europa.eu', 'ec.europa.eu'], categories: ['AUTHORITY_GUIDANCE', 'OPERATIONAL_INFORMATION'],
    topics: ['driving_rest_times', 'tachograph', 'cross_border_cabotage', 'weights_dimensions_axles', 'roadside_checks_documents'],
    languages: ['en'], reuse: { status: 'PERMITTED_WITH_ATTRIBUTION', basis: 'Commission Decision 2011/833/EU (to confirm per document).', termsUrl: 'https://commission.europa.eu/legal-notice_en' },
    check: { status: 'NOT_CHECKED' },
  }),
  S({
    id: 'int-unece', jurisdiction: 'INT', name: 'UNECE (depositary of ADR and AETR)', kind: 'TREATY_DEPOSITARY',
    domains: ['unece.org'], categories: ['INTERNATIONAL_AGREEMENT', 'AUTHORITY_GUIDANCE'], topics: ['adr_dangerous_goods', 'driving_rest_times', 'tachograph'],
    languages: ['en', 'fr', 'ru'], reuse: { status: 'UNKNOWN', basis: 'UN terms of use (to confirm).', termsUrl: null },
    check: { status: 'BLOCKED_FROM_DEV', checkedOn: CHECKED_ON, note: 'HTTP 403 from unece.org.' },
  }),
  S({
    id: 'int-itf', jurisdiction: 'INT', name: 'International Transport Forum (ECMT multilateral quota)', kind: 'AUTHORITY',
    domains: ['itf-oecd.org'], categories: ['INTERNATIONAL_AGREEMENT', 'AUTHORITY_GUIDANCE'], topics: ['cross_border_cabotage', 'roadside_checks_documents'],
    languages: ['en', 'fr'], reuse: { status: 'UNKNOWN', basis: 'OECD terms (to confirm).', termsUrl: null }, check: { status: 'NOT_CHECKED' },
  }),

  // --- Countries with first verified downloads ------------------------------
  S({
    id: 'cz-esbirka', jurisdiction: 'CZ', name: 'e-Sbírka (Ministerstvo vnitra ČR) - Sbírka zákonů', kind: 'OFFICIAL_JOURNAL',
    domains: ['e-sbirka.gov.cz', 'e-sbirka.cz'], categories: LAW, topics: ALL, languages: ['cs'],
    reuse: { status: 'PERMITTED', basis: 'Official works are not protected by copyright, § 3 písm. a) zákona č. 121/2000 Sb. (to confirm by advocate).', termsUrl: null },
    check: { status: 'REACHABLE', checkedOn: CHECKED_ON },
  }),
  S({
    id: 'cz-md', jurisdiction: 'CZ', name: 'Ministerstvo dopravy ČR', kind: 'MINISTRY', domains: ['md.gov.cz', 'gov.cz'],
    categories: ['AUTHORITY_GUIDANCE', 'OPERATIONAL_INFORMATION'], topics: ALL, languages: ['cs', 'en'],
    reuse: { status: 'UNKNOWN', basis: 'To confirm.', termsUrl: null }, check: { status: 'NOT_CHECKED' },
  }),
  S({
    id: 'cz-rsd', jurisdiction: 'CZ', name: 'Ředitelství silnic a dálnic ČR', kind: 'ROAD_AUTHORITY', domains: ['rsd.cz', 'dopravniinfo.cz'],
    categories: ['OPERATIONAL_INFORMATION', 'AUTHORITY_GUIDANCE'], topics: ['closures_restrictions', 'oversize_heavy_transport', 'tolls_charges_environmental'],
    languages: ['cs'], reuse: { status: 'UNKNOWN', basis: 'To confirm.', termsUrl: null }, check: { status: 'NOT_CHECKED' },
  }),
  S({
    id: 'sk-slovlex', jurisdiction: 'SK', name: 'Slov-Lex (Ministerstvo spravodlivosti SR) - Zbierka zákonov', kind: 'OFFICIAL_JOURNAL',
    domains: ['slov-lex.sk'], categories: LAW, topics: ALL, languages: ['sk'],
    reuse: { status: 'PERMITTED', basis: 'Official works are not protected, § 5 zákona č. 185/2015 Z. z. (to confirm by advocate).', termsUrl: null },
    check: { status: 'REACHABLE', checkedOn: CHECKED_ON },
  }),
  S({
    id: 'sk-mindop', jurisdiction: 'SK', name: 'Ministerstvo dopravy SR, Slovenská správa ciest, NDS', kind: 'ROAD_AUTHORITY',
    domains: ['mindop.sk', 'ssc.sk', 'ndsas.sk'], categories: ['AUTHORITY_GUIDANCE', 'OPERATIONAL_INFORMATION'], topics: ALL, languages: ['sk'],
    reuse: { status: 'UNKNOWN', basis: 'To confirm.', termsUrl: null }, check: { status: 'NOT_CHECKED' },
  }),
  S({
    id: 'pl-isap', jurisdiction: 'PL', name: 'ISAP (Kancelaria Sejmu) / Dziennik Ustaw', kind: 'LEGISLATION_DATABASE',
    domains: ['isap.sejm.gov.pl', 'dziennikustaw.gov.pl'], categories: LAW, topics: ALL, languages: ['pl'],
    reuse: { status: 'PERMITTED', basis: 'Normative acts are not subject to copyright, art. 4 ustawy o prawie autorskim (to confirm by advocate).', termsUrl: null },
    check: { status: 'BLOCKED_FROM_DEV', checkedOn: CHECKED_ON, note: 'HTTP 403 from isap.sejm.gov.pl.' },
  }),
  S({
    id: 'pl-gddkia', jurisdiction: 'PL', name: 'GDDKiA / Ministerstwo Infrastruktury (gov.pl)', kind: 'ROAD_AUTHORITY', domains: ['gov.pl'],
    categories: ['AUTHORITY_GUIDANCE', 'OPERATIONAL_INFORMATION'], topics: ALL, languages: ['pl'],
    reuse: { status: 'UNKNOWN', basis: 'To confirm.', termsUrl: null }, check: { status: 'NOT_CHECKED' },
  }),
  S({
    id: 'de-gesetze', jurisdiction: 'DE', name: 'Gesetze im Internet (Bundesministerium der Justiz)', kind: 'LEGISLATION_DATABASE',
    domains: ['gesetze-im-internet.de'], categories: LAW, topics: ALL, languages: ['de'],
    authenticity: 'Not the authentic Bundesgesetzblatt; the authentic text is the BGBl.',
    reuse: { status: 'PERMITTED', basis: 'Laws and ordinances are official works without copyright, § 5 UrhG (to confirm).', termsUrl: 'https://www.gesetze-im-internet.de/hinweise.html' },
    check: { status: 'REACHABLE', checkedOn: CHECKED_ON, note: 'StVO PDF downloadable with curl, but the importer (Node fetch) receives HTTP 503 and the terms page returned 503: automated access is refused; not circumvented. Use the BGBl or an agreed download path.' },
  }),
  S({
    id: 'de-bgbl', jurisdiction: 'DE', name: 'Bundesgesetzblatt (recht.bund.de)', kind: 'OFFICIAL_JOURNAL', domains: ['recht.bund.de'],
    categories: LAW, topics: ALL, languages: ['de'], reuse: { status: 'PERMITTED', basis: '§ 5 UrhG (to confirm).', termsUrl: null }, check: { status: 'NOT_CHECKED' },
  }),
  S({
    id: 'de-road', jurisdiction: 'DE', name: 'Die Autobahn GmbH, BASt, VEMAGS', kind: 'ROAD_AUTHORITY', domains: ['autobahn.de', 'bast.de', 'vemags.de'],
    categories: ['AUTHORITY_GUIDANCE', 'OPERATIONAL_INFORMATION'], topics: ['oversize_heavy_transport', 'permits_exceptions_escorts', 'closures_restrictions', 'weights_dimensions_axles'],
    languages: ['de'], reuse: { status: 'UNKNOWN', basis: 'To confirm.', termsUrl: null }, check: { status: 'NOT_CHECKED' },
  }),
  S({
    id: 'at-ris', jurisdiction: 'AT', name: 'RIS - Rechtsinformationssystem des Bundes (Bundeskanzleramt)', kind: 'LEGISLATION_DATABASE',
    domains: ['ris.bka.gv.at'], categories: LAW, topics: ALL, languages: ['de'],
    reuse: { status: 'PERMITTED', basis: 'Laws are free works, § 7 UrhG (to confirm).', termsUrl: null },
    check: { status: 'BLOCKED_FROM_DEV', checkedOn: CHECKED_ON, note: 'HTTP 503 from ris.bka.gv.at.' },
  }),

  // --- Official legislation databases, not yet checked ----------------------
  ...[
    ['FR', 'Légifrance', 'legifrance.gouv.fr', 'fr'], ['IT', 'Normattiva', 'normattiva.it', 'it'], ['ES', 'Boletín Oficial del Estado', 'boe.es', 'es'],
    ['NL', 'Overheid.nl - wetten', 'wetten.overheid.nl', 'nl'], ['BE', 'Moniteur belge / Belgisch Staatsblad', 'ejustice.just.fgov.be', 'fr'],
    ['LU', 'Legilux', 'legilux.public.lu', 'fr'], ['HU', 'Nemzeti Jogszabálytár', 'njt.hu', 'hu'], ['SI', 'Pravno-informacijski sistem', 'pisrs.si', 'sl'],
    ['HR', 'Narodne novine', 'narodne-novine.nn.hr', 'hr'], ['RO', 'Portal legislativ', 'legislatie.just.ro', 'ro'], ['BG', 'Държавен вестник', 'dv.parliament.bg', 'bg'],
    ['DK', 'Retsinformation', 'retsinformation.dk', 'da'], ['SE', 'Svensk författningssamling', 'svenskforfattningssamling.se', 'sv'], ['FI', 'Finlex', 'finlex.fi', 'fi'],
    ['EE', 'Riigi Teataja', 'riigiteataja.ee', 'et'], ['LV', 'Likumi.lv', 'likumi.lv', 'lv'], ['LT', 'Teisės aktų registras', 'e-tar.lt', 'lt'],
    ['IE', 'Irish Statute Book', 'irishstatutebook.ie', 'en'], ['PT', 'Diário da República', 'diariodarepublica.pt', 'pt'], ['GR', 'Εθνικό Τυπογραφείο', 'et.gr', 'el'],
    ['CH', 'Fedlex', 'fedlex.admin.ch', 'de'], ['LI', 'Liechtensteinisches Landesgesetzblatt', 'gesetze.li', 'de'], ['NO', 'Lovdata', 'lovdata.no', 'no'],
    ['UK', 'legislation.gov.uk (The National Archives)', 'legislation.gov.uk', 'en'], ['MT', 'Legislation Malta', 'legislation.mt', 'mt'],
  ].map(([jurisdiction, name, domain, lang]) => S({
    id: `${jurisdiction.toLowerCase()}-legislation`, jurisdiction, name, kind: 'LEGISLATION_DATABASE', domains: [domain], categories: LAW, topics: ALL,
    languages: [lang], reuse: { status: 'UNKNOWN', basis: 'To confirm per source before import.', termsUrl: null }, check: { status: 'NOT_CHECKED' },
  })),
]);

function hostOf(url) {
  return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
}

/** The registered source an official URL belongs to (HTTPS only), or null. */
export function legalSourceForUrl(url) {
  let host;
  try {
    if (new URL(url).protocol !== 'https:') return null;
    host = hostOf(url);
  } catch {
    return null;
  }
  return legalSources.find((s) => s.domains.some((d) => host === d || host.endsWith(`.${d}`))) || null;
}

export function legalSourcesFor(jurisdiction, topic = null) {
  return legalSources.filter((s) => s.jurisdiction === jurisdiction && (!topic || s.topics.includes(topic)));
}

/** Coverage codes that have no legislation source yet - the expansion backlog. */
export function legislationCoverageGaps(codes) {
  const withLaw = new Set(legalSources.filter((s) => s.categories.some((c) => LEGAL_CATEGORIES[c]?.normative)).map((s) => s.jurisdiction));
  return codes.filter((code) => !withLaw.has(code));
}

/** Throws on a malformed registry; returns the list of problems otherwise empty. */
export function validateLegalSources(sources = legalSources) {
  const problems = [];
  const ids = new Set();
  for (const s of sources) {
    if (ids.has(s.id)) problems.push(`${s.id}: duplicate id`);
    ids.add(s.id);
    if (!SUPRANATIONAL.includes(s.jurisdiction) && !isTrackedJurisdiction(s.jurisdiction)) problems.push(`${s.id}: ${s.jurisdiction} is not a DAJC jurisdiction`);
    if (!Array.isArray(s.domains) || s.domains.length === 0) problems.push(`${s.id}: no domains`);
    for (const d of s.domains || []) if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(d)) problems.push(`${s.id}: bad domain ${d}`);
    for (const c of s.categories || []) if (!LEGAL_CATEGORIES[c]) problems.push(`${s.id}: unknown category ${c}`);
    for (const t of s.topics || []) if (!KB_TOPICS.includes(t)) problems.push(`${s.id}: unknown topic ${t}`);
    if (!['PERMITTED', 'PERMITTED_WITH_ATTRIBUTION', 'RESTRICTED', 'UNKNOWN'].includes(s.reuse?.status)) problems.push(`${s.id}: reuse status`);
    if (!['TERMS_VERIFIED', 'REACHABLE', 'BLOCKED_FROM_DEV', 'NOT_CHECKED'].includes(s.check?.status)) problems.push(`${s.id}: check status`);
    if (s.check?.status !== 'NOT_CHECKED' && !/^\d{4}-\d{2}-\d{2}$/.test(s.check?.checkedOn || '')) problems.push(`${s.id}: checked without a date`);
    // A road/permit authority here must also be known to the search layer.
    if (s.kind === 'ROAD_AUTHORITY' && !SUPRANATIONAL.includes(s.jurisdiction)) {
      const known = officialAuthorityDomains[s.jurisdiction] || [];
      if (!s.domains.some((d) => known.some((k) => d === k || d.endsWith(`.${k}`) || k.endsWith(`.${d}`)))) problems.push(`${s.id}: no domain in official-authority-domains.mjs`);
    }
  }
  return problems;
}
