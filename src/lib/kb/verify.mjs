// Verification of imported library versions against their official source.
// Read-only. Used by scripts/kb-verify.mjs after an import (in CI and locally).
//
// For every manifest entry it checks, and reports PASS / FAIL per check:
//   catalogue  - exactly one stored version for the official URL and language,
//                machine-checked or human-verified, text layer, pages and
//                provisions present, every provision inside the page range;
//   source     - the stored URL is HTTPS on the registered official source of
//                the entry, whose reuse terms allow storing and quoting;
//   validity   - status and dates equal the manifest, the version is in force
//                on the check day, the status check is recent and, online, the
//                publisher still lists this text as the current one;
//   integrity  - the archived original exists, its SHA-256 and size equal the
//                catalogue and, online, the official URL still serves exactly
//                these bytes (so a citation link opens the stored text);
//   content    - pages and provisions re-extracted from the archived original
//                equal the stored ones (nothing added, changed or lost);
//   search     - the production search (searchLibrary) finds the expected
//                provision for a question in the version's language;
//   citation   - that hit carries a complete citation: version label, article,
//                page, official URL with #page=N inside the document, and the
//                quoted text really is on the cited pages.

import { createHash } from 'node:crypto';
import { stripEurlexMarkers } from './provisions.mjs';

// EUR-Lex running header of a consolidated text: "02014R0165 — EN — 31.12.2024 — 003.001 — 28".
const EURLEX_RUNNING_HEADER = /\b0\d{4}[A-Z]{1,2}\d{4}\s+—\s+[A-Z]{2}\s+—\s+\d{2}\.\d{2}\.\d{4}\s+—\s+\d{3}\.\d{3}\s+—\s+\d+\b/g;

/** CELEX number in an EUR-Lex URL, e.g. 02006R0561-20241231. */
export function celexOf(url) {
  const m = String(url || '').match(/CELEX(?::|%3A)([0-9]{5}[A-Z]{1,2}[0-9]{4}(?:-[0-9]{8})?)/i);
  return m ? m[1].toUpperCase() : null;
}

/** 02006R0561-20241231 -> 32006R0561 (the act itself, sector 3). */
export function baseActCelex(celex) {
  const m = String(celex || '').match(/^0([0-9]{4}[A-Z]{1,2}[0-9]{4})(?:-[0-9]{8})?$/);
  return m ? `3${m[1]}` : null;
}

/** 02006R0561-20241231 -> 2024-12-31 */
export function consolidationDate(celex) {
  const m = String(celex || '').match(/-(\d{4})(\d{2})(\d{2})$/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

/** The English "document information" page of an act on EUR-Lex. */
export function eurlexStatusUrl(baseCelex) {
  return `https://eur-lex.europa.eu/legal-content/EN/ALL/?uri=CELEX:${baseCelex}`;
}

/**
 * Legal status and current consolidated version from the EUR-Lex page
 * (paragraph "forceIndicator"). Unknown markup gives nulls, never a guess.
 */
export function parseEurlexStatus(html) {
  const block = String(html || '').match(/<p[^>]*class="forceIndicator"[^>]*>([\s\S]*?)<\/p>/i);
  if (!block) return { inForce: null, statusText: null, currentConsolidated: null };
  const statusText = block[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const inForce = /^No longer in force/i.test(statusText) ? false : /^In force/i.test(statusText) ? true : null;
  const current = block[1].match(/Current consolidated version:[\s\S]*?data-celex="([0-9A-Z]+-[0-9]{8})"/i);
  return { inForce, statusText: statusText.slice(0, 160), currentConsolidated: current ? current[1].toUpperCase() : null };
}

/**
 * Lower case, letters and digits only, single spaces, without EUR-Lex amendment
 * markers and running headers (for "is this text on that page").
 */
export function normalizeForMatch(text) {
  return stripEurlexMarkers(String(text || '').replace(EURLEX_RUNNING_HEADER, ' '))
    .normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

/** Whether the first words of a quoted provision appear on the cited pages. */
export function textOnPages(provisionText, pagesText, words = 8) {
  const head = normalizeForMatch(provisionText).split(' ').slice(0, words).join(' ');
  return head.length > 0 && normalizeForMatch(pagesText).includes(head);
}

/** Stable digest of rows (only the listed fields, in order). */
export function digestRows(rows, fields) {
  const hash = createHash('sha256');
  for (const row of rows) hash.update(JSON.stringify(fields.map((f) => row[f] ?? null))).update('\n');
  return hash.digest('hex');
}

/** Days between two YYYY-MM-DD dates. */
export function daysBetween(from, to) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

const day = (value) => (value == null ? null : typeof value === 'string' ? value.slice(0, 10) : new Date(value).toISOString().slice(0, 10));

/**
 * Catalogue, source and validity checks of one stored version against its
 * manifest entry (no network).
 * @returns {{ catalogue: string[], source: string[], validity: string[] }} problems per check
 */
export function checkStoredVersion({ entry, row, provisionRanges, onDate, source, maxCheckAgeDays = 31 }) {
  const v = entry.version;
  const catalogue = [];
  const sourceProblems = [];
  const validity = [];
  if (!['AUTO_CHECKED', 'HUMAN_VERIFIED'].includes(row.provenance)) catalogue.push(`provenance ${row.provenance}`);
  if (row.text_extraction !== 'TEXT') catalogue.push(`text extraction ${row.text_extraction}`);
  if (!(row.page_count > 0)) catalogue.push('no pages');
  if (row.version_label !== v.label) catalogue.push('version label differs from the manifest');
  if (provisionRanges.count === 0) catalogue.push('no provisions');
  if (provisionRanges.citable === 0) catalogue.push('no citable article, section or annex');
  if (provisionRanges.outside > 0) catalogue.push(`${provisionRanges.outside} provisions point outside the document's pages`);

  if (!source) sourceProblems.push('the URL is not on a registered official source');
  else {
    if (source.id !== entry.sourceId) sourceProblems.push(`the URL belongs to ${source.id}, the manifest says ${entry.sourceId}`);
    if (!['PERMITTED', 'PERMITTED_WITH_ATTRIBUTION'].includes(row.reuse_status)) sourceProblems.push(`reuse status ${row.reuse_status}`);
  }
  if (!String(row.official_url).startsWith('https://')) sourceProblems.push('not HTTPS');
  if (row.official_url !== v.url) sourceProblems.push('URL differs from the manifest');

  const expected = { validity: v.validity, effective_from: v.effectiveFrom ?? null, effective_to: v.effectiveTo ?? null, issued_on: v.issuedOn ?? null, validity_checked_on: v.validityCheckedOn ?? null };
  for (const [k, want] of Object.entries(expected)) {
    const got = k === 'validity' ? row[k] : day(row[k]);
    if (got !== want) validity.push(`${k} is ${got ?? 'empty'}, manifest ${want ?? 'empty'}`);
  }
  if (row.validity === 'IN_FORCE') {
    if (day(row.effective_from) > onDate) validity.push(`in force only from ${day(row.effective_from)}`);
    if (row.effective_to && day(row.effective_to) <= onDate) validity.push(`ended on ${day(row.effective_to)}`);
  }
  if (row.superseded_by) validity.push('superseded by a newer version');
  const checkedOn = day(row.validity_checked_on);
  if (!checkedOn) validity.push('validity never checked');
  else if (daysBetween(checkedOn, onDate) > maxCheckAgeDays) validity.push(`validity last checked ${checkedOn} (more than ${maxCheckAgeDays} days ago)`);
  return { catalogue, source: sourceProblems, validity };
}
