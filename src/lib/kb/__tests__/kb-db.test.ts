// Regression tests of the legal library against a real PostgreSQL migrated
// with drizzle-kb/ (and drizzle-ask/). Run with
//   DAJC_KB_TEST_DB_URL     - dajc_kb_importer (adds machine-checked versions)
//   DAJC_KB_TEST_REVIEW_URL - dajc_kb_reviewer (records human decisions)
//   DAJC_KB_TEST_APP_URL    - dajc_ask_app (reads only the answerable view)
// The database must carry the marker row dajc_kb.deployment = 'dev'.
// Skipped in CI without a database, like the Ask store contract.

import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { assertDatabaseTarget } from '../db-guard.mjs';
import { prepareVersion, reviewVersion, writeVersion } from '../importer.mjs';
import { postgresQuery, searchLibrary } from '../search.mjs';
import { makePdf } from './pdf-fixture';

const IMPORTER_URL = process.env.DAJC_KB_TEST_DB_URL;
const APP_URL = process.env.DAJC_KB_TEST_APP_URL;
const REVIEW_URL = process.env.DAJC_KB_TEST_REVIEW_URL;

describe.skipIf(!IMPORTER_URL || !APP_URL || !REVIEW_URL)('legal library in PostgreSQL', () => {
  const run = randomUUID().slice(0, 8);
  const term = `zyx${run.replace(/[^a-z]/g, 'q')}`;
  let importer: any;
  let app: any;
  let reviewer: any;
  const clients = async () => {
    if (!importer) {
      const { default: postgres } = await import('postgres');
      importer = postgres(IMPORTER_URL!, { max: 2, prepare: false, onnotice: () => undefined });
      app = postgres(APP_URL!, { max: 2, prepare: false, onnotice: () => undefined });
      reviewer = postgres(REVIEW_URL!, { max: 2, prepare: false, onnotice: () => undefined });
    }
    return { importer, app, reviewer };
  };
  afterAll(async () => {
    await importer?.end();
    await app?.end();
    await reviewer?.end();
  });

  function entry(number: string, version: Record<string, unknown>, extra: Record<string, unknown> = {}) {
    return {
      sourceId: 'eu-eurlex', jurisdiction: 'EU', officialNumber: `Test ${number} ${run}`, title: `Test ${number}`, legalCategory: 'EU_REGULATION',
      issuingBody: 'Test', topics: ['driving_rest_times'],
      version: {
        label: `Test ${number} ${version.effectiveFrom}`, language: 'en', url: `https://eur-lex.europa.eu/test/${run}/${number}/${version.effectiveFrom}.pdf`,
        authenticity: 'CONSOLIDATED_DOCUMENTATION', issuedOn: '2019-01-01', validity: 'IN_FORCE', validityCheckedOn: '2026-11-08',
        validityEvidenceUrl: `https://eur-lex.europa.eu/test/${run}/${number}`, effectiveTo: null, ...version,
      },
      ...extra,
    };
  }

  async function load(e: any, pages: string[][]) {
    const { importer } = await clients();
    const prepared = await prepareVersion(e, { bytes: makePdf(pages), finalUrl: e.version.url }, { now: new Date('2026-11-08T10:00:00Z') });
    return writeVersion(importer, prepared, { actor: 'kb-db.test' });
  }

  async function search(input: Record<string, unknown>) {
    const { app } = await clients();
    return searchLibrary(postgresQuery(app), {
      terms: [term], question: term, languages: ['en'], countries: ['CZ'], onDate: '2026-11-08', allowedProvenance: ['HUMAN_VERIFIED', 'AUTO_CHECKED'], ...input,
    } as any);
  }

  it('never answers from a superseded version, and keeps it for the history', async () => {
    const old = await load(entry('A', { effectiveFrom: '2020-01-01' }), [['Article 1', `Old rule ${term}: a break of 30 minutes.`]]);
    const current = await load(entry('A', { effectiveFrom: '2025-01-01' }), [['Article 1', `New rule ${term}: a break of 45 minutes.`]]);
    expect(current.superseded).toEqual([old.versionId]);
    const hits = await search({});
    expect(hits.map((h: any) => h.text)).toEqual([`New rule ${term}: a break of 45 minutes.`]);
    expect(await search({ onDate: '2022-06-01' })).toEqual([]);
    const { importer } = await clients();
    const [row] = await importer`select validity, effective_to::text as effective_to, superseded_by from dajc_kb.document_versions where id = ${old.versionId}`;
    expect(row).toEqual({ validity: 'SUPERSEDED', effective_to: '2025-01-01', superseded_by: current.versionId });
  });

  it('never applies a rule of another mass band', async () => {
    const e = entry('B', { effectiveFrom: '2025-01-01' }, {
      massBands: [{ anchor: 'Article 2', minT: 7.5, minInclusive: false, maxT: null, basis: 'MAM', reviewedBy: 'Test Reviewer' }],
    });
    await load(e, [['Article 1', `General ${term} rule for goods vehicles over 3,5 tonnes.`, 'Article 2', `Sunday ${term} ban for lorries over 7,5 t.`]]);
    const forVan = await search({ terms: [`Sunday ${term}`], massT: 3.5 });
    expect(forVan.find((h: any) => h.anchorLabel === 'Article 2' && h.officialNumber.includes(' B '))).toBeUndefined();
    const forTruck = await search({ terms: [`Sunday ${term}`], massT: 40 });
    expect(forTruck.find((h: any) => h.anchorLabel === 'Article 2' && h.officialNumber.includes(' B '))?.massCheck).toBe('MATCH');
    const unknownMass = await search({ terms: [`General ${term}`], massT: null });
    expect(unknownMass.find((h: any) => h.anchorLabel === 'Article 1' && h.officialNumber.includes(' B '))?.massCheck).toBe('UNREVIEWED');
  });

  it('applies EU law only where it applies, and never cites a preamble', async () => {
    await load(entry('C', { effectiveFrom: '2025-01-01' }), [[`Whereas ${term} recital text in the preamble.`, 'Article 1', `Operative ${term} provision.`]]);
    const cz = await search({ terms: [`${term} recital`, `Operative ${term}`] });
    expect(cz.some((h: any) => h.anchorType === 'PREAMBLE')).toBe(false);
    expect(cz.some((h: any) => h.text.includes(`Operative ${term}`) && h.applicability === 'EU_DIRECT')).toBe(true);
    expect(await search({ countries: ['UK'] })).toEqual([]);
    expect((await search({ countries: ['NO'] })).every((h: any) => h.applicability === 'EEA_CHECK_REQUIRED')).toBe(true);
    for (const h of cz) {
      expect(h.url).toMatch(/^https:\/\/eur-lex\.europa\.eu\/.+#page=\d+$/);
      expect(h.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(h.citation).toMatch(/· Article \d+ · p\. \d+/);
    }
  });

  it('uses only person-verified versions by default; rejected ones never', async () => {
    const d = await load(entry('D', { effectiveFrom: '2025-01-01' }), [['Article 1', `Reviewed ${term} provision of a document that a person checked.`]]);
    const strict = { terms: [`Reviewed ${term}`], allowedProvenance: ['HUMAN_VERIFIED'] };
    const isD = (h: any) => h.officialNumber === `Test D ${run}`;
    expect((await search(strict)).filter(isD)).toEqual([]);
    const { reviewer } = await clients();
    await reviewVersion(reviewer, { versionId: d.versionId, reviewer: 'Test Reviewer', decision: 'HUMAN_VERIFIED', note: 'checked on EUR-Lex' });
    const verified = (await search(strict)).filter(isD);
    expect(verified.map((h: any) => h.provenance)).toEqual(['HUMAN_VERIFIED']);
    // The exact term ranks first: whole-term matches beat common words in long provisions.
    expect((await search(strict))[0].officialNumber).toBe(`Test D ${run}`);
    await reviewVersion(reviewer, { versionId: d.versionId, reviewer: 'Test Reviewer', decision: 'REJECTED', note: 'wrong version' });
    expect((await search({ terms: [`Reviewed ${term}`] })).filter(isD)).toEqual([]);
  });

  it('is idempotent for the same content', async () => {
    const e = entry('E', { effectiveFrom: '2025-01-01' });
    const pages = [['Article 1', `Same ${term} content imported twice without any change.`]];
    const first = await load(e, pages);
    const second = await load(e, pages);
    expect(second).toMatchObject({ status: 'UNCHANGED', versionId: first.versionId });
  });

  it('gives each role only what it needs', async () => {
    const { importer, app } = await clients();
    await expect(app`select count(*) from dajc_kb.provisions`).rejects.toThrow(/permission denied/);
    await expect(app`select count(*) from dajc_kb.document_versions`).rejects.toThrow(/permission denied/);
    await expect(app`insert into dajc_kb.review_log (version_id, action, decision, reviewer) values (gen_random_uuid(), 'x', 'y', 'z')`).rejects.toThrow(/permission denied/);
    const [{ n }] = await app`select count(*)::int as n from dajc_kb.answerable_provisions`;
    expect(n).toBeGreaterThan(0);
    await expect(importer`delete from dajc_kb.document_versions`).rejects.toThrow(/permission denied/);
    await expect(importer`select count(*) from dajc_ask.users`).rejects.toThrow(/permission denied/);
  });

  it('keeps every human decision away from the import role (the CI secret)', async () => {
    const { importer, reviewer } = await clients();
    const f = await load(entry('F', { effectiveFrom: '2025-01-01' }), [['Article 1', `Imported ${term} provision waiting for a person.`]]);
    // No self-approval, by update or by insert.
    await expect(reviewVersion(importer, { versionId: f.versionId, reviewer: 'CI import job', decision: 'HUMAN_VERIFIED' })).rejects.toThrow(/permission denied/);
    await expect(importer`update dajc_kb.document_versions set provenance = 'HUMAN_VERIFIED' where id = ${f.versionId}`).rejects.toThrow(/permission denied/);
    const [{ document_id }] = await importer`select document_id from dajc_kb.document_versions where id = ${f.versionId}`;
    const forged = (provenance: string) => importer`
      insert into dajc_kb.document_versions (document_id, version_label, language, official_url, retrieved_at, sha256, byte_size, media_type, storage_key,
        authenticity, effective_from, validity, validity_checked_on, provenance, reuse_status, text_extraction)
      values (${document_id}, 'forged', 'en', 'https://eur-lex.europa.eu/forged.pdf', now(), ${'f'.repeat(64)}, 1, 'application/pdf', 'k',
        'CONSOLIDATED_DOCUMENTATION', '2026-01-01', 'IN_FORCE', '2026-11-08', ${provenance}, 'PERMITTED', 'TEXT')`;
    await expect(forged('HUMAN_VERIFIED')).rejects.toThrow(/only add machine-checked versions/);
    await expect(importer`insert into dajc_kb.document_versions (document_id, verified_by) values (${document_id}, 'CI')`).rejects.toThrow(/permission denied/);
    // Content is written once, with the version; nothing is rewritten later.
    await expect(importer`insert into dajc_kb.provisions (version_id, ordinal, anchor_type, anchor_label, page_from, page_to, text, ts_config)
      values (${f.versionId}, 99, 'ARTICLE', 'Article 99', 1, 1, ${`Added ${term} rule`}, 'simple')`).rejects.toThrow(/provisions of a machine-checked version once/);
    await expect(importer`insert into dajc_kb.pages (version_id, page_no, text) values (${f.versionId}, 99, 'added page')`).rejects.toThrow(/pages of a machine-checked version once/);
    await expect(importer`update dajc_kb.provisions set text = 'rewritten' where version_id = ${f.versionId}`).rejects.toThrow(/permission denied/);
    await expect(importer`update dajc_kb.pages set text = 'rewritten' where version_id = ${f.versionId}`).rejects.toThrow(/permission denied/);
    await expect(importer`update dajc_kb.documents set title = 'forged' where id = ${document_id}`).rejects.toThrow(/permission denied/);
    await expect(importer`update dajc_kb.ocr_queue set status = 'APPROVED'`).rejects.toThrow(/permission denied/);
    await expect(importer`insert into dajc_kb.review_log (version_id, action, decision, reviewer) values (${f.versionId}, 'REVIEW', 'HUMAN_VERIFIED', 'CI')`).rejects.toThrow(/logs only imports/);
    await expect(importer`insert into dajc_kb.review_log (version_id, action, decision, reviewer, at) values (${f.versionId}, 'IMPORT', 'AUTO_CHECKED', 'CI', '2000-01-01')`).rejects.toThrow(/permission denied/);
    await expect(importer`insert into dajc_kb.deployment (environment) values ('production')`).rejects.toThrow(/permission denied/);
    // A person verifies; the database stamps the time and freezes the content.
    await reviewVersion(reviewer, { versionId: f.versionId, reviewer: 'Test Reviewer', decision: 'HUMAN_VERIFIED', now: new Date('2000-01-01T00:00:00Z') });
    const [stamp] = await reviewer`select provenance, verified_by, last_verified_at > now() - interval '1 minute' as fresh from dajc_kb.document_versions where id = ${f.versionId}`;
    expect(stamp).toEqual({ provenance: 'HUMAN_VERIFIED', verified_by: 'Test Reviewer', fresh: true });
    await expect(importer`insert into dajc_kb.provisions (version_id, ordinal, anchor_type, anchor_label, page_from, page_to, text, ts_config)
      values (${f.versionId}, 100, 'ARTICLE', 'Article 100', 1, 1, 'late', 'simple')`).rejects.toThrow(/provisions of a machine-checked version once/);
    await expect(reviewer`update dajc_kb.document_versions set provenance = 'AUTO_CHECKED' where id = ${f.versionId}`).rejects.toThrow(/review records HUMAN_VERIFIED or REJECTED/);
    // The reviewer decides; it never writes content or deletes.
    await expect(reviewer`insert into dajc_kb.pages (version_id, page_no, text) values (${f.versionId}, 98, 'x')`).rejects.toThrow(/permission denied/);
    await expect(reviewer`update dajc_kb.provisions set text = 'x' where version_id = ${f.versionId}`).rejects.toThrow(/permission denied/);
    await expect(reviewer`delete from dajc_kb.review_log`).rejects.toThrow(/permission denied/);
    await expect(reviewer`insert into dajc_kb.review_log (version_id, action, decision, reviewer) values (${f.versionId}, 'IMPORT', 'AUTO_CHECKED', 'x')`).rejects.toThrow(/logs only reviews/);
  });

  it('lets the importer only close an older version, never revive one', async () => {
    const { importer } = await clients();
    const old = await load(entry('G', { effectiveFrom: '2020-01-01' }), [['Article 1', `Older ${term} rule.`]]);
    const current = await load(entry('G', { effectiveFrom: '2025-01-01' }), [['Article 1', `Newer ${term} rule.`]]);
    expect(current.superseded).toEqual([old.versionId]);
    await expect(importer`update dajc_kb.document_versions set validity = 'IN_FORCE', effective_to = null, superseded_by = null where id = ${old.versionId}`)
      .rejects.toThrow(/only close a version that a newer one supersedes/);
    await expect(importer`update dajc_kb.document_versions set validity = 'REPEALED' where id = ${current.versionId}`)
      .rejects.toThrow(/only close a version that a newer one supersedes/);
  });

  it('stops when the manifest disagrees with a stored document', async () => {
    const e = entry('H', { effectiveFrom: '2025-01-01' });
    await load(e, [['Article 1', `Stored ${term} document.`]]);
    const renamed = { ...e, title: 'Renamed title', version: { ...e.version, effectiveFrom: '2026-01-01', label: 'H 2026' } };
    await expect(load(renamed, [['Article 1', `Renamed ${term} document.`]])).rejects.toThrow(/differs from the manifest \(title\)/);
  });

  it('checks the role and the branch marker before an import', async () => {
    const { importer, app } = await clients();
    await expect(assertDatabaseTarget(importer, { role: 'dajc_kb_importer', environment: 'dev' })).resolves.toEqual({ role: 'dajc_kb_importer', environment: 'dev' });
    await expect(assertDatabaseTarget(importer, { role: 'dajc_kb_importer', environment: 'production' })).rejects.toThrow(/marker dajc_kb.deployment is dev, expected production/);
    await expect(assertDatabaseTarget(app, { role: 'dajc_kb_importer', environment: 'dev' })).rejects.toThrow(/connected as dajc_ask_app/);
  });
});
