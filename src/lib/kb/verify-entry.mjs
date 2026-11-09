// Deterministic verification of one stored library version against its
// manifest entry and its official source (read-only). Shared by
// scripts/kb-verify.mjs (after every import) and by the AI verification engine,
// for which it is layer 1 (src/lib/kb/ai-verify/engine.mjs).

import { sha256Hex } from './archive.mjs';
import { fetchOfficialBytes, prepareVersion } from './importer.mjs';
import { legalSourceForUrl } from './legal-sources.mjs';
import { citationLabel, postgresQuery, searchLibrary } from './search.mjs';
import { ASK_TOPIC_TO_KB } from './taxonomy.mjs';
import {
  baseActCelex, celexOf, checkStoredVersion, consolidationDate, digestRows, eurlexStatusUrl, parseEurlexStatus, textOnPages,
} from './verify.mjs';

export const DETERMINISTIC_CHECKS = Object.freeze(['catalogue', 'source', 'validity', 'integrity', 'content', 'search', 'citation']);

/** Every machine-checked or verified state the library can answer from (internal tests and verification). */
export const ANY_CHECKED_PROVENANCE = Object.freeze(['AUTO_CHECKED', 'AI_VERIFIED', 'HUMAN_VERIFIED']);

/** Caches the EUR-Lex status page per act for one run. */
export function eurlexStatusReader({ fetchImpl } = {}) {
  const cache = new Map();
  return (baseCelex) => {
    if (!cache.has(baseCelex)) {
      cache.set(baseCelex, (async () => {
        const page = await fetchOfficialBytes(eurlexStatusUrl(baseCelex), { maxBytes: 5 * 1024 * 1024, ...(fetchImpl ? { fetchImpl } : {}) });
        return parseEurlexStatus(new TextDecoder().decode(page.bytes));
      })());
    }
    return cache.get(baseCelex);
  };
}

/**
 * @param {{ sql: any, entry: any, archive?: any, online?: boolean, onDate: string, searchChecks: any[], modelSources: number,
 *           eurlexStatus?: (celex: string) => Promise<any>, redactError?: (message: string) => string }} input
 * @returns {Promise<{ problems: Record<string, string[]>, facts: Record<string, any>, row: any, bytes: Uint8Array | null, passed: boolean }>}
 */
export async function verifyEntry({ sql, entry, archive = null, online = false, onDate, searchChecks, modelSources, eurlexStatus = eurlexStatusReader(), redactError = (m) => m }) {
  const v = entry.version;
  const problems = Object.fromEntries(DETERMINISTIC_CHECKS.map((c) => [c, []]));
  const facts = {};
  let row = null;
  let bytes = null;
  try {
    const rows = await sql`
      select dv.*, d.official_number, d.title, d.jurisdiction, d.legal_category, d.topics as document_topics
      from dajc_kb.document_versions dv join dajc_kb.documents d on d.id = dv.document_id
      where d.jurisdiction = ${entry.jurisdiction} and d.official_number = ${entry.officialNumber} and dv.language = ${v.language} and dv.official_url = ${v.url}`;
    if (rows.length !== 1) {
      problems.catalogue.push(rows.length === 0 ? 'not imported' : `${rows.length} stored versions for one URL`);
      throw new Error('skip');
    }
    row = rows[0];
    facts.versionId = row.id;
    facts.sha256 = row.sha256;
    facts.pages = row.page_count;
    facts.provenance = row.provenance;
    const [ranges] = await sql`
      select count(*)::int as count, count(*) filter (where anchor_type in ('ARTICLE', 'SECTION', 'ANNEX'))::int as citable,
             count(*) filter (where page_from < 1 or page_to > ${row.page_count} or page_to < page_from)::int as outside
      from dajc_kb.provisions where version_id = ${row.id}`;
    facts.provisions = ranges.count;
    const stored = checkStoredVersion({ entry, row, provisionRanges: ranges, onDate, source: legalSourceForUrl(row.official_url) });
    for (const k of ['catalogue', 'source', 'validity']) problems[k].push(...stored[k]);

    // Two versions of one document and language in force at the same time are a conflict.
    const [overlap] = await sql`
      select count(*)::int as n from dajc_kb.document_versions o
      where o.document_id = ${row.document_id} and o.language = ${row.language} and o.id <> ${row.id}
        and o.validity in ('IN_FORCE', 'NOT_YET_IN_FORCE') and o.provenance not in ('REJECTED')
        and (o.effective_to is null or o.effective_to > ${row.effective_from}) and (${row.effective_to}::date is null or o.effective_from < ${row.effective_to})`;
    if (overlap.n > 0) problems.validity.push(`${overlap.n} other version(s) of this document and language in force at the same time`);

    // Validity at the publisher: in force, and this text is the current consolidated one.
    const celex = celexOf(row.official_url);
    if (online && entry.sourceId === 'eu-eurlex') {
      facts.sourceCheckedUrl = eurlexStatusUrl(baseActCelex(celex));
      const status = await eurlexStatus(baseActCelex(celex));
      facts.publisherStatus = status.statusText;
      facts.currentConsolidated = status.currentConsolidated;
      if (row.validity === 'IN_FORCE' && status.inForce !== true) problems.validity.push(`EUR-Lex status: ${status.statusText || 'not readable'}`);
      if (celex && /-\d{8}$/.test(celex) && status.currentConsolidated !== celex) {
        problems.validity.push(status.currentConsolidated
          ? `EUR-Lex lists ${consolidationDate(status.currentConsolidated)} as the current consolidated version, stored ${consolidationDate(celex)}`
          : 'EUR-Lex shows no current consolidated version');
      }
    } else if (online) {
      problems.validity.push(`no online status check implemented for source ${entry.sourceId}`);
    }

    // Integrity: archived original and the official URL serve the stored bytes.
    if (archive) {
      bytes = await archive.get(row.storage_key);
      if (!bytes) problems.integrity.push('original missing in the archive');
      else if (sha256Hex(bytes) !== row.sha256 || bytes.length !== row.byte_size) problems.integrity.push('archived original differs from the catalogue');
    }
    if (online) {
      const fresh = await fetchOfficialBytes(row.official_url);
      if (sha256Hex(fresh.bytes) !== row.sha256) problems.integrity.push('the official URL now serves different bytes');
      bytes = bytes || fresh.bytes;
    }
    if (!bytes) problems.integrity.push('no original available to check (no archive, offline)');

    // Content: re-extraction of the original equals what is stored.
    if (bytes) {
      const prepared = await prepareVersion(entry, { bytes, finalUrl: row.official_url });
      const pages = await sql`select page_no, text from dajc_kb.pages where version_id = ${row.id} order by page_no`;
      const provisions = await sql`
        select ordinal, anchor_type, anchor_label, anchor_number, heading, page_from, page_to, text
        from dajc_kb.provisions where version_id = ${row.id} order by ordinal`;
      const pageFields = ['page_no', 'text'];
      const provisionFields = ['ordinal', 'anchor_type', 'anchor_label', 'anchor_number', 'heading', 'page_from', 'page_to', 'text'];
      const fresh = {
        pages: prepared.pages.map((p) => ({ page_no: p.pageNo, text: p.text })),
        provisions: prepared.provisions.map((p) => ({ ordinal: p.ordinal, anchor_type: p.anchorType, anchor_label: p.anchorLabel, anchor_number: p.anchorNumber ?? null,
          heading: p.heading ?? null, page_from: p.pageFrom, page_to: p.pageTo, text: p.text })),
      };
      if (digestRows(pages, pageFields) !== digestRows(fresh.pages, pageFields)) problems.content.push(`pages differ from the original (${pages.length} stored, ${fresh.pages.length} extracted)`);
      if (digestRows(provisions, provisionFields) !== digestRows(fresh.provisions, provisionFields)) {
        const first = fresh.provisions.find((p, i) => digestRows([p], provisionFields) !== digestRows([provisions[i] || {}], provisionFields));
        problems.content.push(`provisions differ from the original (${provisions.length} stored, ${fresh.provisions.length} extracted${first ? `; first at ${first.anchor_label}` : ''})`);
      }
    }

    // Search exactly as DAJC AI asks (src/lib/ask/library.ts), then the citation of the expected provision.
    const check = searchChecks.find((c) => c.officialNumber === entry.officialNumber);
    const asked = check?.questions?.[v.language];
    if (!asked) problems.search.push('no search check defined for this language');
    else {
      const hits = await searchLibrary(postgresQuery(sql), {
        terms: [...asked.terms, asked.question], question: asked.question, languages: [v.language], countries: [check.country || 'CZ'], onDate,
        topics: ASK_TOPIC_TO_KB[check.askTopic] ?? null, allowedProvenance: [...ANY_CHECKED_PROVENANCE], limit: modelSources * 2,
      });
      const anchorRe = new RegExp(`(^|\\s)${check.anchorNumber}$`);
      const position = hits.findIndex((h) => h.url.startsWith(`${row.official_url}#`) && anchorRe.test(h.anchorLabel));
      facts.search = { question: asked.question, top: hits.slice(0, modelSources).map((h) => h.citation), position: position < 0 ? null : position + 1 };
      if (position < 0) problems.search.push(`Article ${check.anchorNumber} not found (top: ${hits.slice(0, 3).map((h) => h.citation).join(' | ') || 'nothing'})`);
      else if (position >= modelSources) problems.search.push(`Article ${check.anchorNumber} at position ${position + 1}, after the ${modelSources} sources the model receives`);
      if (position >= 0) problems.citation.push(...await citationProblems(sql, row, hits[position], facts));
    }
  } catch (error) {
    if (error?.message !== 'skip') problems.catalogue.push(`error: ${redactError(String(error?.message || error)).slice(0, 200)}`);
  }
  const passed = DETERMINISTIC_CHECKS.every((c) => problems[c].length === 0);
  return { problems, facts, row, bytes, passed };
}

/** A hit's citation is complete and points at text that really is on the cited pages. */
export async function citationProblems(sql, row, hit, facts = {}) {
  const problems = [];
  facts.citation = hit.citation;
  if (hit.citation !== citationLabel({ ...hit, versionLabel: row.version_label }) || !hit.citation.startsWith(row.version_label)) problems.push('citation label incomplete');
  if (hit.url !== `${row.official_url}#page=${hit.pageFrom}`) problems.push('citation URL is not the official URL with the page');
  if (hit.pageFrom < 1 || hit.pageTo > row.page_count) problems.push(`cited pages ${hit.pageFrom}-${hit.pageTo} outside the document (${row.page_count})`);
  if (hit.sha256 !== row.sha256) problems.push('citation SHA-256 differs from the version');
  const [onPages] = await sql`select string_agg(text, ' ' order by page_no) as text from dajc_kb.pages where version_id = ${row.id} and page_no between ${hit.pageFrom} and ${hit.pageTo}`;
  if (!textOnPages(hit.text, onPages?.text || '')) problems.push(`quoted text not found on page ${hit.pageFrom}${hit.pageTo !== hit.pageFrom ? `-${hit.pageTo}` : ''}`);
  return problems;
}
