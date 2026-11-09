// Validated import queue shared by all API connectors. Discovery produces
// manifest-shaped entries; nothing is imported unless it passes
// validateManifestEntry. Each entry ends in exactly one classified state, the
// run can be repeated after an interruption (stored official URLs are skipped,
// content is deduplicated by SHA-256 in the database) and a WAF block or rate
// limit stops further requests to that publisher for the run.

import { validateManifestEntry, prepareVersion } from '../importer.mjs';
import { isPdf } from '../pdf-text.mjs';
import { classifyError } from './outcomes.mjs';
import { storeVersion } from './pipeline.mjs';

/**
 * @param {{ entries: any[], client: { get: Function }, archive: any, sql?: any, dryRun?: boolean, maxBytes?: number, actor?: string,
 *           storedUrl?: (entry: any) => Promise<string|null> }} input
 * @returns {Promise<any[]>} one result per entry
 */
export async function runImportQueue({ entries, client, archive, sql = null, dryRun = false, maxBytes = 50 * 1024 * 1024, actor = 'kb-acquire' }) {
  const results = [];
  const seen = new Set();
  let stop = null;
  for (const entry of entries) {
    const line = { officialNumber: entry.officialNumber, language: entry.version?.language, url: entry.version?.url };
    if (stop) { results.push({ ...line, status: 'SKIPPED_HOST_BLOCKED', classification: stop }); continue; }
    const problems = validateManifestEntry(entry);
    if (problems.length) { results.push({ ...line, status: 'REJECTED_INVALID', problems }); continue; }
    const key = `${entry.jurisdiction}|${entry.officialNumber}|${entry.version.language}|${entry.version.url}`;
    if (seen.has(key)) { results.push({ ...line, status: 'DUPLICATE_IN_QUEUE' }); continue; }
    seen.add(key);
    try {
      if (sql && !dryRun) {
        const [stored] = await sql`
          select dv.id from dajc_kb.document_versions dv join dajc_kb.documents d on d.id = dv.document_id
          where d.jurisdiction = ${entry.jurisdiction} and d.official_number = ${entry.officialNumber} and dv.language = ${entry.version.language} and dv.official_url = ${entry.version.url}`;
        if (stored) { results.push({ ...line, status: 'STORED', versionId: stored.id }); continue; }
      }
      const got = await client.get(entry.version.url, { accept: 'application/pdf', maxBytes });
      if (!isPdf(got.bytes)) throw Object.assign(new Error('the official file is not a PDF'), { kind: 'PERMANENT_HTTP' });
      const prepared = await prepareVersion(entry, { bytes: got.bytes, finalUrl: got.finalUrl }, { archive: dryRun ? undefined : archive });
      prepared.original = { bytes: got.bytes, contentType: 'application/pdf' };
      const summary = { sha256: prepared.version.sha256, pages: prepared.version.pageCount, provisions: prepared.provisions.length, provenance: prepared.version.provenance, textExtraction: prepared.version.textExtraction, checks: prepared.checks };
      if (dryRun || !sql) { results.push({ ...line, status: 'DRY_RUN', ...summary }); continue; }
      results.push({ ...line, ...summary, ...await storeVersion({ sql, archive, prepared, actor }) });
    } catch (error) {
      const classification = classifyError(error);
      results.push({ ...line, status: error?.name === 'IntegrityError' ? 'INTEGRITY_ERROR' : classification, classification, reason: String(error?.message || error).slice(0, 300) });
      if (['WAF_BLOCKED', 'RATE_LIMITED'].includes(classification)) stop = classification;
    }
  }
  return results;
}
