// Prepares a version from a structured original (XML in a ZIP, XML, HTML) whose
// text is extracted deterministically from the original, the counterpart of
// prepareVersion for PDFs. The original bytes are what gets archived; the
// "pages" are notional text segments of the extraction, not printed pages.

import { archiveKey, sha256Hex } from '../archive.mjs';
import { reuseAllowed, validateManifestEntry } from '../importer.mjs';
import { legalSourceForUrl, legalSources } from '../legal-sources.mjs';
import { splitProvisions } from '../provisions.mjs';

/**
 * @param entry manifest-shaped entry (validateManifestEntry)
 * @param {{ bytes: Uint8Array, finalUrl: string, mediaType: string, extension: string, pages: {pageNo:number,text:string}[], extractionNote?: string }} download
 */
export function prepareStructuredVersion(entry, download, { now = new Date() } = {}) {
  const problems = validateManifestEntry(entry);
  if (problems.length) throw new Error(`invalid entry: ${problems.join('; ')}`);
  const source = legalSources.find((s) => s.id === entry.sourceId);
  if (!reuseAllowed(source)) throw new Error(`reuse terms of ${source.id} are ${source.reuse.status}: not imported`);
  const { bytes, finalUrl, pages } = download;
  const v = entry.version;
  const checks = [];
  if (legalSourceForUrl(finalUrl)?.id !== source.id) checks.push('final URL is not on the registered source');
  const sha256 = sha256Hex(bytes);
  const storageKey = archiveKey({ jurisdiction: entry.jurisdiction, officialNumber: entry.officialNumber, language: v.language, sha256, extension: download.extension });
  const provisions = download.provisions ?? splitProvisions(pages);
  if (!provisions.some((p) => p.anchorType !== 'PREAMBLE')) checks.push('no article, section or annex found');
  if (!v.validityEvidenceUrl) checks.push('no validity evidence URL');
  return {
    source,
    document: { sourceId: source.id, jurisdiction: entry.jurisdiction, officialNumber: entry.officialNumber, title: entry.title, legalCategory: entry.legalCategory, issuingBody: entry.issuingBody, topics: entry.topics },
    version: {
      versionLabel: v.label, language: v.language, officialUrl: v.url, retrievedAt: now.toISOString(), sha256, byteSize: bytes.length, mediaType: download.mediaType, storageKey,
      authenticity: v.authenticity, issuedOn: v.issuedOn ?? null, effectiveFrom: v.effectiveFrom ?? null, effectiveTo: v.effectiveTo ?? null, validity: v.validity,
      validityCheckedOn: v.validityCheckedOn ?? null, provenance: checks.length === 0 ? 'AUTO_CHECKED' : 'UNVERIFIED', provenanceCheckedAt: now.toISOString(),
      reuseStatus: source.reuse.status, textExtraction: 'TEXT', pageCount: pages.length,
      notes: [v.notes, download.extractionNote, ...checks.map((c) => `check: ${c}`)].filter(Boolean).join('\n') || null,
    },
    pages: pages.map((p) => ({ pageNo: p.pageNo, text: p.text })),
    provisions: provisions.map((p) => ({ ...p, topics: entry.topics })),
    checks,
    original: { bytes, contentType: download.mediaType },
  };
}
