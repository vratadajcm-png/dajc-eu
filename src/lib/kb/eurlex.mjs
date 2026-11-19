// EUR-Lex helpers for discovering current consolidated versions of EU acts
// and building manifest entries from the publisher's own status page
// (scripts/kb-eurlex-discover.mjs). Labels are built by rule from the official
// number, never translated freely; validity always comes from EUR-Lex itself.

import { baseActCelex, consolidationDate, eurlexStatusUrl, parseEurlexStatus } from './verify.mjs';

export { baseActCelex, consolidationDate, eurlexStatusUrl };

/** Status, current consolidation and document facts from the "ALL" page. */
export function parseEurlexDocumentInfo(html) {
  const text = String(html || '');
  const field = (label) => {
    const m = text.match(new RegExp(`${label}\\s*:?\\s*</dt>\\s*<dd[^>]*>([\\s\\S]*?)</dd>`, 'i'));
    return m ? m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : null;
  };
  const date = (value) => {
    const m = String(value || '').match(/(\d{2})\/(\d{2})\/(\d{4})/);
    return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
  };
  return { ...parseEurlexStatus(text), dateOfDocument: date(field('Date of document')), form: field('Form'), author: field('Author') };
}

const KIND = {
  Regulation: { cs: 'Nařízení', de: 'Verordnung', en: 'Regulation', pl: 'Rozporządzenie', sk: 'Nariadenie' },
  Directive: { cs: 'Směrnice', de: 'Richtlinie', en: 'Directive', pl: 'Dyrektywa', sk: 'Smernica' },
  Decision: { cs: 'Rozhodnutí', de: 'Beschluss', en: 'Decision', pl: 'Decyzja', sk: 'Rozhodnutie' },
};
const BODY = {
  Council: { cs: 'Rady', de: 'des Rates', en: 'Council', pl: 'Rady', sk: 'Rady' },
  Commission: { cs: 'Komise', de: 'der Kommission', en: 'Commission', pl: 'Komisji', sk: 'Komisie' },
};
const ABBR = {
  EC: { cs: 'ES', de: 'EG', en: 'EC', pl: 'WE', sk: 'ES' },
  EU: { cs: 'EU', de: 'EU', en: 'EU', pl: 'UE', sk: 'EÚ' },
  EEC: { cs: 'EHS', de: 'EWG', en: 'EEC', pl: 'EWG', sk: 'EHS' },
};
const NO = { cs: 'č.', de: 'Nr.', en: 'No', pl: 'nr', sk: 'č.' };
export const LABEL_LANGUAGES = Object.freeze(['cs', 'de', 'en', 'pl', 'sk']);

/** Parts of an English official number: "Regulation (EC) No 561/2006", "Council Directive 96/53/EC", "Directive (EU) 2020/1057". */
export function parseOfficialNumber(number) {
  const s = String(number).trim();
  let m = s.match(/^(?:(Council|Commission) )?(Regulation|Directive|Decision) \((EC|EU|EEC)\) No (\d+)\/(\d{4})$/);
  if (m) return { body: m[1] || null, kind: m[2], abbr: m[3], style: 'no', num: m[4], year: m[5] };
  m = s.match(/^(?:(Council|Commission) )?(Directive|Decision) (\d{2,4})\/(\d+)\/(EC|EU|EEC)$/);
  if (m) return { body: m[1] || null, kind: m[2], abbr: m[5], style: 'suffix', num: m[4], year: m[3] };
  m = s.match(/^(?:(Council|Commission) )?(Regulation|Directive|Decision) \((EU|EC)\) (\d{4})\/(\d+)$/);
  if (m) return { body: m[1] || null, kind: m[2], abbr: m[3], style: 'new', num: m[5], year: m[4] };
  return null;
}

/** The act's short name in one of LABEL_LANGUAGES, by the Official Journal's own patterns. */
export function localizedActName(number, lang) {
  const p = parseOfficialNumber(number);
  if (!p || !LABEL_LANGUAGES.includes(lang)) return null;
  const kind = KIND[p.kind][lang];
  const abbr = ABBR[p.abbr][lang];
  const ident = p.style === 'no' ? `(${abbr}) ${NO[lang]} ${p.num}/${p.year}` : p.style === 'new' ? `(${abbr}) ${p.year}/${p.num}` : `${p.year}/${p.num}/${abbr}`;
  if (!p.body) return `${kind} ${ident}`;
  if (lang === 'en') return `${BODY[p.body].en} ${kind} ${ident}`;
  if (lang === 'de') return `${kind} ${ident} ${BODY[p.body].de}`;
  return `${kind} ${BODY[p.body][lang]} ${ident}`;
}

/** "31.12.2024" / "31. 12. 2024" as the library's existing labels write it. */
function labelDate(isoDay, lang) {
  const [y, m, d] = isoDay.split('-').map(Number);
  return ['cs', 'sk'].includes(lang) ? `${d}. ${m}. ${y}` : `${d}.${m}.${y}`;
}

const CONSOLIDATED = { cs: 'konsolidované znění k', de: 'konsolidierte Fassung vom', en: 'consolidated text of', pl: 'tekst skonsolidowany z', sk: 'konsolidované znenie k' };

export function consolidatedLabel(number, lang, isoDay) {
  const name = localizedActName(number, lang);
  return name ? `${name}, ${CONSOLIDATED[lang]} ${labelDate(isoDay, lang)}` : null;
}

export function consolidatedPdfUrl(lang, celex) {
  return `https://eur-lex.europa.eu/legal-content/${lang.toUpperCase()}/TXT/PDF/?uri=CELEX:${celex}`;
}

/**
 * Manifest entries for every label language from a candidate and its status
 * page. Only an act that EUR-Lex shows in force with a current consolidated
 * version qualifies; anything else returns a reason instead of entries.
 */
/**
 * @param {any} candidate entry of config/legal-library/eurlex-candidates.json
 * @param {any} info parseEurlexDocumentInfo() of the act's status page
 * @param {{ checkedOn: string, languages?: readonly string[] }} options
 * @returns {{ entries: any[], reason: string | null }}
 */
export function entriesFromStatus(candidate, info, { checkedOn, languages = LABEL_LANGUAGES }) {
  if (info.inForce !== true) return { entries: [], reason: `EUR-Lex status: ${info.statusText || 'not readable'}` };
  if (!info.currentConsolidated) return { entries: [], reason: 'EUR-Lex shows no current consolidated version (original act only; dates need a manual check)' };
  if (baseActCelex(info.currentConsolidated) !== candidate.celex) return { entries: [], reason: `consolidation ${info.currentConsolidated} belongs to another act` };
  const effectiveFrom = consolidationDate(info.currentConsolidated);
  if (!info.dateOfDocument || !effectiveFrom || effectiveFrom > checkedOn) return { entries: [], reason: 'dates not readable or consolidation not yet applicable' };
  const entries = languages.map((lang) => ({
    sourceId: 'eu-eurlex', jurisdiction: 'EU', officialNumber: candidate.officialNumber, title: candidate.title, legalCategory: candidate.legalCategory,
    issuingBody: candidate.issuingBody, topics: candidate.topics, legalAreas: candidate.legalAreas,
    version: {
      label: consolidatedLabel(candidate.officialNumber, lang, effectiveFrom), language: lang, url: consolidatedPdfUrl(lang, info.currentConsolidated),
      authenticity: 'CONSOLIDATED_DOCUMENTATION', issuedOn: info.dateOfDocument, effectiveFrom, effectiveTo: null, validity: 'IN_FORCE',
      validityCheckedOn: checkedOn, validityEvidenceUrl: eurlexStatusUrl(candidate.celex),
      notes: `EUR-Lex consolidated text: documentation tool without legal effect; the authentic text is the Official Journal. Current consolidated version listed on EUR-Lex on ${checkedOn} (discovered by scripts/kb-eurlex-discover.mjs).`,
    },
  }));
  if (entries.some((e) => !e.version.label)) return { entries: [], reason: `official number "${candidate.officialNumber}" has no label pattern` };
  return { entries, reason: null };
}
