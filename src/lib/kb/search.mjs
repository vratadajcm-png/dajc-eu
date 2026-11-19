// Retrieval from the DAJC legal library for DAJC AI.
//
// Exact full-text search over provisions of checked, in-force versions only
// (view dajc_kb.answerable_provisions), filtered by jurisdiction, effective
// date, topic and allowed provenance. Every hit carries a complete citation
// (document, article/section/annex, PDF page, official URL, SHA-256) and the
// checks the answer must respect:
//   - applicability of EU and international law to the asked country;
//   - the reviewed mass band of the provision against the asked vehicle;
//   - whether the version was confirmed by a person.
// Hits without a citable anchor (preamble/recitals) are never returned.
// Vector search is not used; if added later it may only propose candidates
// that this exact search and the guard then verify.

import { applicability, massApplies } from './taxonomy.mjs';

export const SEARCH_LIMITS = Object.freeze({ maxTerms: 12, maxTermChars: 80, maxResults: 8, candidateFactor: 4 });

const ANCHOR_IN_QUESTION = /(?:article|artikel|artykuł|art\.|článek|článok|čl\.|§)\s*(\d{1,3}[a-z]?)/giu;

/** Search terms reduced to letters, digits, spaces and hyphens. */
export function sanitizeTerms(terms) {
  return [...new Set((terms || []).map((t) => String(t).normalize('NFC').replace(/[^\p{L}\p{N}\s\-/]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, SEARCH_LIMITS.maxTermChars)).filter((t) => t.length >= 2))]
    .slice(0, SEARCH_LIMITS.maxTerms);
}

/** "a b", "c" -> websearch query "a b or c": all words of one term must match. */
export function strictQuery(terms) {
  return sanitizeTerms(terms).map((t) => t.replace(/\bor\b/gi, ' ')).join(' or ');
}

/** "a b", "c" -> websearch query "a b or c or a or b" (phrases first, single words as fallbacks). */
export function websearchQuery(terms) {
  const clean = sanitizeTerms(terms);
  const words = [...new Set(clean.flatMap((t) => t.split(' ')).filter((w) => w.length >= 3))];
  return [...clean, ...words].map((t) => t.replace(/\bor\b/gi, ' ')).join(' or ');
}

/** Languages with a PostgreSQL stemmer (must match dajc_kb.ts_config in drizzle-kb/0000). */
export const STEMMED_LANGUAGES = Object.freeze(['en', 'de', 'fr', 'it', 'es', 'nl', 'pt', 'da', 'sv', 'fi', 'hu', 'ro', 'no', 'lt', 'el']);

/**
 * Czech, Slovak, Polish and other inflected languages have no PostgreSQL
 * stemmer: "přestávka" would never match "přestávku". For them a word is
 * searched by its stem prefix (the ending removed): "přestáv:*". Coarse on
 * purpose - recall here, precision from ranking, the quote check and the
 * independent check.
 */
export function stemPrefix(word) {
  const w = String(word).toLowerCase();
  if (w.length >= 7) return w.slice(0, w.length - 2);
  if (w.length >= 5) return w.slice(0, w.length - 1);
  return w;
}

/** to_tsquery text: terms -> (w1:* & w2:*) | (w3:*); words of letters and digits only. */
export function prefixQuery(terms, { wordsOnly = false } = {}) {
  const clean = sanitizeTerms(terms);
  const word = (w) => `'${stemPrefix(w)}':*`;
  const words = (t) => t.split(/[\s\-/]+/).filter((w) => /^[\p{L}\p{N}]{2,}$/u.test(w));
  if (wordsOnly) return [...new Set(clean.flatMap(words).filter((w) => w.length >= 3))].map(word).join(' | ');
  return clean.map((t) => words(t)).filter((ws) => ws.length > 0).map((ws) => `(${ws.map(word).join(' & ')})`).join(' | ');
}

export function anchorsInText(text) {
  return [...new Set([...String(text || '').matchAll(ANCHOR_IN_QUESTION)].map((m) => m[1].toLowerCase()))];
}

/** Jurisdictions whose documents may apply to the asked countries. */
export function searchJurisdictions(asked) {
  const set = new Set(asked);
  if (asked.some((c) => applicability(c, 'EU', 'EU_REGULATION') !== 'NOT_APPLICABLE')) set.add('EU');
  set.add('INT');
  return [...set];
}

export function citationLabel(hit) {
  const pages = hit.pageFrom === hit.pageTo ? `${hit.pageFrom}` : `${hit.pageFrom}-${hit.pageTo}`;
  const page = { cs: 's.', sk: 's.', de: 'S.', pl: 'str.' }[hit.language] || 'p.';
  return `${hit.versionLabel} · ${hit.anchorLabel} · ${page} ${pages}`;
}

/**
 * @param {(text: string, params: unknown[]) => Promise<any[]>} query  parameterised SQL executor
 * @param {{ terms: string[], languages: string[], countries: string[], onDate: string, topics?: string[]|null,
 *           massT?: number|null, allowedProvenance?: string[], question?: string, limit?: number }} input
 */
export async function searchLibrary(query, input) {
  const { languages, countries, onDate } = input;
  const allowed = input.allowedProvenance?.length ? input.allowedProvenance : ['AI_VERIFIED', 'HUMAN_VERIFIED'];
  const limit = Math.min(input.limit || 6, SEARCH_LIMITS.maxResults);
  const q = websearchQuery(input.terms);
  const strict = strictQuery(input.terms);
  if (!q || countries.length === 0 || !/^\d{4}-\d{2}-\d{2}$/.test(onDate || '')) return [];
  const jurisdictions = searchJurisdictions(countries);
  const anchors = anchorsInText(input.question);
  const hits = [];
  for (const language of [...new Set(languages)].filter((l) => /^[a-z]{2}$/.test(l))) {
    const stemmed = STEMMED_LANGUAGES.includes(language);
    const loose = stemmed ? q : prefixQuery(input.terms, { wordsOnly: true });
    const exact = stemmed ? strict : prefixQuery(input.terms);
    if (!loose || !exact) continue;
    const parse = stemmed ? 'websearch_to_tsquery' : 'to_tsquery';
    const rows = await query(`
      select ap.id, ap.anchor_type, ap.anchor_label, ap.anchor_number, ap.page_from, ap.page_to, ap.text, ap.language, ap.official_url,
             ap.sha256, ap.version_label, ap.authenticity, ap.effective_from::text as effective_from, ap.effective_to::text as effective_to,
             ap.validity, ap.validity_checked_on::text as validity_checked_on, ap.provenance, ap.verified_by, ap.last_verified_at,
             ap.ai_verified_at, ap.ai_verification_models,
             ap.jurisdiction, ap.official_number, ap.title, ap.legal_category, ap.issuing_body, ap.mass_mentions,
             ap.mass_min_t, ap.mass_min_inclusive, ap.mass_max_t, ap.mass_max_inclusive, ap.mass_basis,
             -- PostgreSQL ranking has no word rarity (IDF): a whole search term matching counts most,
             -- single words only break ties; lengths are normalised (flags 1|32).
             (case when ap.tsv @@ qs then 1 else 0 end) + ts_rank_cd(ap.tsv, qs, 33) + 0.3 * ts_rank_cd(ap.tsv, q, 33)
               + case when ap.anchor_number = any($8::text[]) then 0.5 else 0 end as rank
      from dajc_kb.answerable_provisions ap, ${parse}(dajc_kb.ts_config($1), $2) q, ${parse}(dajc_kb.ts_config($1), $9) qs
      where ap.language = $1 and ap.ts_config = dajc_kb.ts_config($1)
        and ap.tsv @@ q
        and ap.jurisdiction = any($3::text[])
        and ap.effective_from <= $4::date and (ap.effective_to is null or ap.effective_to > $4::date)
        and ap.provenance = any($5::text[])
        and ap.anchor_type in ('ARTICLE', 'SECTION', 'ANNEX')
        and ($6::text[] is null or ap.document_topics && $6::text[] or ap.provision_topics && $6::text[])
      order by rank desc, ap.id
      limit $7`,
    [language, loose, jurisdictions, onDate, allowed, input.topics?.length ? input.topics : null, limit * SEARCH_LIMITS.candidateFactor, anchors, exact]);
    for (const row of rows) hits.push(toHit(row, countries, input.massT ?? null));
  }
  return hits
    .filter((h) => h.applicability !== 'NOT_APPLICABLE' && h.massCheck !== 'MISMATCH')
    .sort((a, b) => b.rank - a.rank)
    .slice(0, limit);
}

function toHit(row, countries, massT) {
  const applies = countries.map((c) => applicability(c, row.jurisdiction, row.legal_category));
  const best = ['DIRECT', 'EU_DIRECT', 'TRANSPOSITION_CHECK_REQUIRED', 'EEA_CHECK_REQUIRED', 'INTERNATIONAL_CHECK_REQUIRED', 'NOT_APPLICABLE'].find((a) => applies.includes(a));
  const band = row.mass_min_t == null && row.mass_max_t == null ? null : {
    minT: row.mass_min_t == null ? null : Number(row.mass_min_t), minInclusive: row.mass_min_inclusive,
    maxT: row.mass_max_t == null ? null : Number(row.mass_max_t), maxInclusive: row.mass_max_inclusive, basis: row.mass_basis,
  };
  const hit = {
    id: String(row.id), jurisdiction: row.jurisdiction, title: row.title, officialNumber: row.official_number, legalCategory: row.legal_category,
    issuingBody: row.issuing_body, anchorType: row.anchor_type, anchorLabel: row.anchor_label, pageFrom: row.page_from, pageTo: row.page_to,
    text: row.text, language: row.language, url: `${row.official_url}#page=${row.page_from}`, sha256: row.sha256, versionLabel: row.version_label,
    authenticity: row.authenticity, effectiveFrom: row.effective_from, effectiveTo: row.effective_to, validity: row.validity,
    validityCheckedOn: row.validity_checked_on, provenance: row.provenance, verifiedBy: row.verified_by,
    lastVerifiedAt: row.last_verified_at ? new Date(row.last_verified_at).toISOString() : null,
    aiVerifiedAt: row.ai_verified_at ? new Date(row.ai_verified_at).toISOString() : null, aiVerificationModels: row.ai_verification_models ?? null,
    applicability: best, massBand: band, massCheck: massApplies(band, massT, (row.mass_mentions || []).map(Number)), rank: Number(row.rank),
  };
  hit.citation = citationLabel(hit);
  return hit;
}

/** postgres-js client -> executor for searchLibrary. */
export function postgresQuery(sql) {
  return (text, params) => sql.unsafe(text, params);
}
