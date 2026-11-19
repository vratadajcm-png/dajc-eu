// Store one prepared version: archive -> read-back -> PostgreSQL -> read-back
// -> audit evidence. Idempotent and restartable:
//   - the archive is content-addressed and immutable, so re-putting is a no-op
//     and an object left behind by a crash is harmless (re-run finds it);
//   - the database write is one transaction keyed on (document, language,
//     SHA-256); a re-run reports UNCHANGED and creates no duplicate;
//   - earlier legal versions are never rewritten: a newer version closes the
//     older one (SUPERSEDED) and both stay.
// Nothing is reported as stored until the read-back of BOTH stores succeeded.

import { sha256Hex } from '../archive.mjs';
import { writeVersion } from '../importer.mjs';

export class IntegrityError extends Error {
  constructor(stage, message) {
    super(message);
    this.name = 'IntegrityError';
    this.stage = stage;
  }
}

export async function storeVersion({ sql, archive, prepared, actor = 'kb-acquire' }) {
  const { version: v, original } = prepared;
  if (!original?.bytes) throw new IntegrityError('input', 'prepared version carries no original bytes');
  if (sha256Hex(original.bytes) !== v.sha256) throw new IntegrityError('input', 'SHA-256 of the original differs from the prepared version');
  // 1. archive (idempotent) and read back
  await archive.put(v.storageKey, original.bytes, { contentType: original.contentType, sha256: v.sha256 });
  const back = await archive.get(v.storageKey);
  if (!back || sha256Hex(back) !== v.sha256) throw new IntegrityError('archive-readback', `archived original ${v.storageKey} did not read back with the same SHA-256`);
  // 2. database (one transaction) and read back
  const result = await writeVersion(sql, prepared, { actor });
  const [row] = await sql`select sha256, storage_key, byte_size from dajc_kb.document_versions where id = ${result.versionId}`;
  if (!row || row.sha256 !== v.sha256 || row.storage_key !== v.storageKey) throw new IntegrityError('db-readback', `version ${result.versionId} is not stored with the expected SHA-256 and storage key`);
  const [prov] = await sql`select count(*)::int as n from dajc_kb.provisions where version_id = ${result.versionId}`;
  if (v.textExtraction === 'TEXT' && prov.n === 0 && prepared.provisions.length > 0) throw new IntegrityError('db-readback', `version ${result.versionId} has no provisions in the database`);
  const [log] = await sql`select count(*)::int as n from dajc_kb.review_log where version_id = ${result.versionId} and action = 'IMPORT'`;
  if (log.n === 0) throw new IntegrityError('audit', `version ${result.versionId} has no import audit record`);
  return { status: result.status, versionId: result.versionId, documentId: result.documentId, sha256: v.sha256, storageKey: v.storageKey,
    provisions: prov.n, auditRecords: log.n, archiveReadBack: true, databaseReadBack: true, superseded: result.superseded ?? [] };
}
