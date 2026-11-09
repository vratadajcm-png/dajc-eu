// Imports one official document version into the DAJC legal library.
//
//   manifest entry -> fetch (registered publisher, HTTPS on every redirect,
//   size cap) -> SHA-256 -> private archive -> page text (pdf-text.mjs) ->
//   provisions (provisions.mjs) -> catalogue rows in ONE transaction.
//
// Rules that keep the library safe to answer from:
//   - a document is fetched and stored only from a registered source whose
//     reuse terms allow it (legal-sources.mjs); UNKNOWN or RESTRICTED terms
//     stop the import before download;
//   - validity (in force, dates) is never guessed from the text: it comes
//     from the manifest, entered from the publisher's own status page, with
//     the date it was checked and the page it was checked on;
//   - provenance is AUTO_CHECKED only when every machine check passed; a
//     named reviewer makes it HUMAN_VERIFIED later (scripts/kb-review.mjs,
//     role dajc_kb_reviewer). The import role cannot record a human decision,
//     cannot change a document's metadata and cannot touch the content of a
//     human-verified version (drizzle-kb/0001);
//   - a scanned PDF is stored and queued for the approved OCR path, but no
//     text of it is indexed;
//   - a newer version of the same document and language closes the older
//     one (SUPERSEDED, effective_to, superseded_by). Nothing is deleted.

import { archiveKey, sha256Hex } from './archive.mjs';
import { legalSourceForUrl, legalSources } from './legal-sources.mjs';
import { extractPdfText, isPdf, PDF_LIMITS } from './pdf-text.mjs';
import { RobotsPolicy } from './robots.mjs';
import { splitProvisions } from './provisions.mjs';
import { LEGAL_AREA_IDS } from './legal-areas.mjs';
import { AUTHENTICITY, KB_TOPICS, LEGAL_CATEGORIES, VALIDITY } from './taxonomy.mjs';

export const USER_AGENT = 'DAJC legal library importer (+https://www.dajc.eu)';
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Problems with a manifest entry (empty = valid). */
export function validateManifestEntry(entry, sources = legalSources) {
  const problems = [];
  const source = sources.find((s) => s.id === entry?.sourceId);
  if (!source) return [`unknown source ${entry?.sourceId}`];
  if (entry.jurisdiction !== source.jurisdiction) problems.push(`jurisdiction ${entry.jurisdiction} differs from source ${source.jurisdiction}`);
  if (!LEGAL_CATEGORIES[entry.legalCategory]) problems.push(`unknown legal category ${entry.legalCategory}`);
  else if (!source.categories.includes(entry.legalCategory)) problems.push(`source ${source.id} does not publish ${entry.legalCategory}`);
  if (!entry.officialNumber || !entry.title || !entry.issuingBody) problems.push('officialNumber, title and issuingBody are required');
  for (const topic of entry.topics || []) if (!KB_TOPICS.includes(topic)) problems.push(`unknown topic ${topic}`);
  if (!Array.isArray(entry.topics) || entry.topics.length === 0) problems.push('at least one topic is required');
  if (!Array.isArray(entry.legalAreas) || entry.legalAreas.length === 0) problems.push('at least one legal area is required (src/lib/kb/legal-areas.mjs)');
  for (const area of entry.legalAreas || []) if (!LEGAL_AREA_IDS.includes(area)) problems.push(`unknown legal area ${area}`);
  const v = entry.version || {};
  if (!/^[a-z]{2}$/.test(v.language || '')) problems.push('version.language must be ISO 639-1');
  if (!source.languages.includes(v.language)) problems.push(`source ${source.id} does not publish in ${v.language}`);
  if (legalSourceForUrl(v.url)?.id !== source.id) problems.push('version.url is not an HTTPS address of the source');
  if (!AUTHENTICITY.includes(v.authenticity)) problems.push('version.authenticity is required');
  if (!VALIDITY.includes(v.validity)) problems.push('version.validity is required');
  for (const field of ['issuedOn', 'effectiveFrom', 'effectiveTo', 'validityCheckedOn']) {
    if (v[field] != null && !DAY.test(v[field])) problems.push(`version.${field} must be YYYY-MM-DD`);
  }
  if (['IN_FORCE', 'NOT_YET_IN_FORCE'].includes(v.validity) && (!v.effectiveFrom || !v.validityCheckedOn)) problems.push('a version in force needs effectiveFrom and validityCheckedOn');
  if (v.validityEvidenceUrl && !legalSourceForUrl(v.validityEvidenceUrl)) problems.push('validityEvidenceUrl must be a registered official address');
  for (const band of entry.massBands || []) {
    if (!band.anchor || !band.reviewedBy || (band.minT == null && band.maxT == null)) problems.push('massBands need anchor, reviewedBy and minT or maxT');
  }
  return problems;
}

/** Reuse terms of the source allow storing and quoting the document. */
export function reuseAllowed(source) {
  return source?.reuse?.status === 'PERMITTED' || source?.reuse?.status === 'PERMITTED_WITH_ATTRIBUTION';
}

let sharedRobots = null;
/** The process-wide robots.txt policy of the library (one cache and pace per host). */
export function officialRobots() {
  sharedRobots ??= new RobotsPolicy({ userAgent: USER_AGENT });
  return sharedRobots;
}

/**
 * Downloads from a registered source only: every redirect must stay HTTPS on
 * the same source; the body is read with a hard size cap; every request is
 * allowed by the publisher's robots.txt and paced by its Crawl-delay
 * (robots: false only in unit tests with a fake fetch).
 */
export async function fetchOfficialBytes(url, { fetchImpl = globalThis.fetch, maxBytes = PDF_LIMITS.maxBytes, maxRedirects = 5, timeoutMs = 120_000, robots = officialRobots() } = {}) {
  const source = legalSourceForUrl(url);
  if (!source) throw new Error('not a registered official source');
  const signal = AbortSignal.timeout(timeoutMs);
  let current = url;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    if (robots) await robots.admit(current);
    const res = await fetchImpl(current, { redirect: 'manual', signal, headers: { 'user-agent': USER_AGENT, accept: 'application/pdf,*/*;q=0.5' } });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      const next = new URL(res.headers.get('location'), current).toString();
      if (legalSourceForUrl(next)?.id !== source.id) throw new Error('redirect left the registered source');
      current = next;
      continue;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const declared = Number(res.headers.get('content-length') || 0);
    if (declared > maxBytes) throw new Error('document larger than the import limit');
    const reader = res.body.getReader();
    const chunks = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new Error('document larger than the import limit');
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return { bytes, finalUrl: current, contentType: res.headers.get('content-type') || '' };
  }
  throw new Error('too many redirects');
}

/**
 * Everything that will be written, computed without a database.
 * @param {any} entry manifest entry (validateManifestEntry)
 * @param {{ bytes: Uint8Array, finalUrl: string }} download
 * @param {{ now?: Date, archive?: { put: (key: string, bytes: Uint8Array, meta?: object) => Promise<unknown> } }} [options]
 * @returns {Promise<any>} prepared version (see writeVersion)
 */
export async function prepareVersion(entry, download, { now = new Date(), archive } = {}) {
  const problems = validateManifestEntry(entry);
  if (problems.length) throw new Error(`invalid manifest entry: ${problems.join('; ')}`);
  const source = legalSources.find((s) => s.id === entry.sourceId);
  if (!reuseAllowed(source)) throw new Error(`reuse terms of ${source.id} are ${source.reuse.status}: not imported`);
  const { bytes, finalUrl } = download;
  const v = entry.version;
  const checks = [];
  if (legalSourceForUrl(finalUrl)?.id !== source.id) checks.push('final URL is not on the registered source');
  if (!isPdf(bytes)) throw new Error('downloaded content is not a PDF');
  const sha256 = sha256Hex(bytes);
  const storageKey = archiveKey({ jurisdiction: entry.jurisdiction, officialNumber: entry.officialNumber, language: v.language, sha256 });
  if (archive) await archive.put(storageKey, bytes, { contentType: 'application/pdf', sha256 });

  let extraction;
  try {
    extraction = await extractPdfText(bytes);
  } catch (error) {
    extraction = { pageCount: 0, pages: [], needsOcr: false, failed: String(error?.message || error).slice(0, 200) };
  }
  const textExtraction = extraction.failed ? 'FAILED' : extraction.needsOcr ? 'NEEDS_OCR' : 'TEXT';
  const provisions = textExtraction === 'TEXT' ? splitProvisions(extraction.pages) : [];
  if (textExtraction === 'TEXT' && !provisions.some((p) => p.anchorType !== 'PREAMBLE')) checks.push('no article, section or annex found');

  for (const band of entry.massBands || []) {
    const targets = provisions.filter((p) => p.anchorLabel === band.anchor);
    if (targets.length === 0) checks.push(`mass band for unknown anchor ${band.anchor}`);
    for (const p of targets) Object.assign(p, { massMinT: band.minT ?? null, massMinInclusive: band.minInclusive ?? false, massMaxT: band.maxT ?? null, massMaxInclusive: band.maxInclusive ?? true, massBasis: band.basis || 'MAM', massReviewedBy: band.reviewedBy });
  }
  if (!v.validityEvidenceUrl) checks.push('no validity evidence URL');
  if (textExtraction !== 'TEXT') checks.push(`text extraction ${textExtraction}`);
  const provenance = checks.length === 0 ? 'AUTO_CHECKED' : 'UNVERIFIED';

  return {
    source,
    document: {
      sourceId: source.id, jurisdiction: entry.jurisdiction, officialNumber: entry.officialNumber, title: entry.title,
      legalCategory: entry.legalCategory, issuingBody: entry.issuingBody, topics: entry.topics,
    },
    version: {
      versionLabel: v.label, language: v.language, officialUrl: v.url, retrievedAt: now.toISOString(), sha256, byteSize: bytes.length,
      mediaType: 'application/pdf', storageKey, authenticity: v.authenticity, issuedOn: v.issuedOn ?? null, effectiveFrom: v.effectiveFrom ?? null,
      effectiveTo: v.effectiveTo ?? null, validity: v.validity, validityCheckedOn: v.validityCheckedOn ?? null, provenance,
      provenanceCheckedAt: now.toISOString(), reuseStatus: source.reuse.status, textExtraction, pageCount: extraction.pageCount,
      notes: [v.notes, v.validityEvidenceUrl ? `validity checked on ${v.validityEvidenceUrl}` : null, ...checks.map((c) => `check: ${c}`)].filter(Boolean).join('\n') || null,
    },
    pages: extraction.pages.map((p) => ({ pageNo: p.pageNo, text: p.text })),
    provisions: provisions.map((p) => ({ ...p, topics: entry.topics })),
    checks,
  };
}

/**
 * Writes a prepared version in one transaction. Idempotent: the same content
 * (document, language, SHA-256) is not stored twice.
 * @param sql postgres-js client connected as the owner or dajc_kb_importer
 */
export async function writeVersion(sql, prepared, { actor = 'importer' } = {}) {
  const { source, document: d, version: v } = prepared;
  return sql.begin(async (tx) => {
    await tx`
      insert into dajc_kb.sources (id, jurisdiction, name, kind, domains, reuse_status, reuse_basis, terms_url, check_status, checked_on)
      values (${source.id}, ${source.jurisdiction}, ${source.name}, ${source.kind}, ${source.domains}, ${source.reuse.status}, ${source.reuse.basis || null},
              ${source.reuse.termsUrl || null}, ${source.check.status}, ${source.check.checkedOn || null})
      on conflict (id) do update set name = excluded.name, domains = excluded.domains, reuse_status = excluded.reuse_status,
        reuse_basis = excluded.reuse_basis, terms_url = excluded.terms_url, check_status = excluded.check_status, checked_on = excluded.checked_on, updated_at = now()`;
    // Documents are insert-only for the importer: a later change of title,
    // topics or category (which steer retrieval of verified versions) is the
    // owner's decision, so a manifest that disagrees with the library stops.
    await tx`
      insert into dajc_kb.documents (source_id, jurisdiction, official_number, title, legal_category, issuing_body, topics)
      values (${d.sourceId}, ${d.jurisdiction}, ${d.officialNumber}, ${d.title}, ${d.legalCategory}, ${d.issuingBody}, ${d.topics})
      on conflict (jurisdiction, official_number) do nothing`;
    const [doc] = await tx`
      select id, source_id, title, legal_category, issuing_body, topics from dajc_kb.documents
      where jurisdiction = ${d.jurisdiction} and official_number = ${d.officialNumber}`;
    const differs = ['source_id', 'title', 'legal_category', 'issuing_body'].filter((k) => doc[k] !== { source_id: d.sourceId, title: d.title, legal_category: d.legalCategory, issuing_body: d.issuingBody }[k]);
    if ([...doc.topics].sort().join('|') !== [...d.topics].sort().join('|')) differs.push('topics');
    if (differs.length > 0) throw new Error(`document ${d.officialNumber} in the library differs from the manifest (${differs.join(', ')}); only the owner changes document metadata`);
    const existing = await tx`select id from dajc_kb.document_versions where document_id = ${doc.id} and language = ${v.language} and sha256 = ${v.sha256}`;
    if (existing.length > 0) return { status: 'UNCHANGED', versionId: existing[0].id, documentId: doc.id };

    const [version] = await tx`
      insert into dajc_kb.document_versions (document_id, version_label, language, official_url, retrieved_at, sha256, byte_size, media_type, storage_key,
        authenticity, issued_on, effective_from, effective_to, validity, validity_checked_on, provenance, provenance_checked_at, reuse_status,
        text_extraction, page_count, notes)
      values (${doc.id}, ${v.versionLabel}, ${v.language}, ${v.officialUrl}, ${v.retrievedAt}, ${v.sha256}, ${v.byteSize}, ${v.mediaType}, ${v.storageKey},
        ${v.authenticity}, ${v.issuedOn}, ${v.effectiveFrom}, ${v.effectiveTo}, ${v.validity}, ${v.validityCheckedOn}, ${v.provenance}, ${v.provenanceCheckedAt},
        ${v.reuseStatus}, ${v.textExtraction}, ${v.pageCount}, ${v.notes})
      returning id`;

    if (prepared.pages.length > 0) {
      await tx`
        insert into dajc_kb.pages (version_id, page_no, text)
        select ${version.id}::uuid, r.page_no, r.text from jsonb_to_recordset(${tx.json(prepared.pages.map((p) => ({ page_no: p.pageNo, text: p.text })))}) as r(page_no int, text text)`;
    }
    if (prepared.provisions.length > 0) {
      const rows = prepared.provisions.map((p) => ({
        ordinal: p.ordinal, anchor_type: p.anchorType, anchor_label: p.anchorLabel, anchor_number: p.anchorNumber, heading: p.heading,
        page_from: p.pageFrom, page_to: p.pageTo, text: p.text, topics: p.topics, mass_mentions: p.massMentions,
        mass_min_t: p.massMinT ?? null, mass_min_inclusive: p.massMinInclusive ?? null, mass_max_t: p.massMaxT ?? null,
        mass_max_inclusive: p.massMaxInclusive ?? null, mass_basis: p.massBasis ?? null, mass_reviewed_by: p.massReviewedBy ?? null,
      }));
      await tx`
        insert into dajc_kb.provisions (version_id, ordinal, anchor_type, anchor_label, anchor_number, heading, page_from, page_to, text, ts_config, topics,
          mass_mentions, mass_min_t, mass_min_inclusive, mass_max_t, mass_max_inclusive, mass_basis, mass_reviewed_by)
        select ${version.id}::uuid, r.ordinal, r.anchor_type, r.anchor_label, r.anchor_number, r.heading, r.page_from, r.page_to, r.text,
               dajc_kb.ts_config(${v.language}), r.topics, r.mass_mentions, r.mass_min_t, r.mass_min_inclusive, r.mass_max_t, r.mass_max_inclusive,
               r.mass_basis, r.mass_reviewed_by
        from jsonb_to_recordset(${tx.json(rows)}) as r(ordinal int, anchor_type text, anchor_label text, anchor_number text, heading text, page_from int,
             page_to int, text text, topics text[], mass_mentions numeric[], mass_min_t numeric, mass_min_inclusive boolean, mass_max_t numeric,
             mass_max_inclusive boolean, mass_basis text, mass_reviewed_by text)`;
    }
    if (v.textExtraction === 'NEEDS_OCR') {
      await tx`insert into dajc_kb.ocr_queue (version_id, reason) values (${version.id}, 'scanned pages without a text layer')`;
    }
    // A newer version in force closes the older one of the same language; history stays.
    let superseded = [];
    if (v.effectiveFrom && ['IN_FORCE', 'NOT_YET_IN_FORCE'].includes(v.validity)) {
      superseded = await tx`
        update dajc_kb.document_versions
        set effective_to = ${v.effectiveFrom}, validity = 'SUPERSEDED', superseded_by = ${version.id}
        where document_id = ${doc.id} and language = ${v.language} and id <> ${version.id}
          and validity in ('IN_FORCE', 'NOT_YET_IN_FORCE') and effective_from < ${v.effectiveFrom}
          and (effective_to is null or effective_to > ${v.effectiveFrom})
        returning id`;
    }
    await tx`insert into dajc_kb.review_log (version_id, action, decision, reviewer, note)
             values (${version.id}, 'IMPORT', ${v.provenance}, ${actor}, ${prepared.checks.join('; ') || 'all machine checks passed'})`;
    for (const old of superseded) {
      await tx`insert into dajc_kb.review_log (version_id, action, decision, reviewer, note)
               values (${old.id}, 'SUPERSEDE', 'SUPERSEDED', ${actor}, ${`superseded by ${version.id} from ${v.effectiveFrom}`})`;
    }
    return { status: 'IMPORTED', versionId: version.id, documentId: doc.id, superseded: superseded.map((r) => r.id) };
  });
}

/** A named reviewer confirms (or rejects) origin, version and validity. */
export async function reviewVersion(sql, { versionId, reviewer, decision, note = null, now = new Date() }) {
  if (!['HUMAN_VERIFIED', 'REJECTED'].includes(decision)) throw new Error('decision must be HUMAN_VERIFIED or REJECTED');
  if (!reviewer || reviewer.trim().length < 3) throw new Error('reviewer name required');
  return sql.begin(async (tx) => {
    const updated = await tx`
      update dajc_kb.document_versions set provenance = ${decision}, verified_by = ${reviewer.trim()}, last_verified_at = ${now.toISOString()}
      where id = ${versionId} and provenance in ('AUTO_CHECKED', 'HUMAN_VERIFIED', 'UNVERIFIED')
      returning id`;
    if (updated.length === 0) throw new Error('version not found or already rejected');
    await tx`insert into dajc_kb.review_log (version_id, action, decision, reviewer, note) values (${versionId}, 'REVIEW', ${decision}, ${reviewer.trim()}, ${note})`;
    return updated[0].id;
  });
}
