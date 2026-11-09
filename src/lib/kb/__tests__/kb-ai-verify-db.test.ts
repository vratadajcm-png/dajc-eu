// Security of AI verification in PostgreSQL (drizzle-kb/0002): nobody can make
// a version AI_VERIFIED except through a complete, evidence-backed run that the
// database itself checks. Run with
//   DAJC_KB_TEST_DB_URL           - dajc_kb_importer
//   DAJC_KB_TEST_AI_VERIFIER_URL  - dajc_kb_ai_verifier
//   DAJC_KB_TEST_REVIEW_URL       - dajc_kb_reviewer
//   DAJC_KB_TEST_APP_URL          - dajc_ask_app
//   DAJC_KB_TEST_OWNER_URL        - optional: the owner, for the append-only checks
// Skipped without a database, like the other library DB tests.

import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { readVersionForVerification, recordVerificationRun } from '../ai-verify/store.mjs';
import { PROTOCOL } from '../ai-verify/protocol.mjs';
import { prepareVersion, reviewVersion, writeVersion } from '../importer.mjs';
import { postgresQuery, searchLibrary } from '../search.mjs';
import { makePdf } from './pdf-fixture';

const IMPORTER_URL = process.env.DAJC_KB_TEST_DB_URL;
const VERIFIER_URL = process.env.DAJC_KB_TEST_AI_VERIFIER_URL;
const REVIEW_URL = process.env.DAJC_KB_TEST_REVIEW_URL;
const APP_URL = process.env.DAJC_KB_TEST_APP_URL;
const OWNER_URL = process.env.DAJC_KB_TEST_OWNER_URL;

describe.skipIf(!IMPORTER_URL || !VERIFIER_URL || !REVIEW_URL || !APP_URL)('AI verification in PostgreSQL', () => {
  const run = randomUUID().slice(0, 8);
  const term = `aiv${run.replace(/[^a-z]/g, 'q')}`;
  const db: Record<string, any> = {};
  const clients = async () => {
    if (!db.importer) {
      const { default: postgres } = await import('postgres');
      const open = (url: string) => postgres(url, { max: 2, prepare: false, onnotice: () => undefined });
      Object.assign(db, { importer: open(IMPORTER_URL!), verifier: open(VERIFIER_URL!), reviewer: open(REVIEW_URL!), app: open(APP_URL!) });
      if (OWNER_URL) db.owner = open(OWNER_URL);
    }
    return db;
  };
  afterAll(async () => {
    for (const client of Object.values(db)) await client?.end();
  });

  async function load(name: string) {
    const { importer } = await clients();
    const entry = {
      sourceId: 'eu-eurlex', jurisdiction: 'EU', officialNumber: `AI test ${name} ${run}`, title: `AI test ${name}`, legalCategory: 'EU_REGULATION',
      issuingBody: 'Test', topics: ['driving_rest_times'],
      version: {
        label: `AI test ${name}`, language: 'en', url: `https://eur-lex.europa.eu/test/${run}/${name}.pdf`, authenticity: 'CONSOLIDATED_DOCUMENTATION',
        issuedOn: '2019-01-01', effectiveFrom: '2025-01-01', effectiveTo: null, validity: 'IN_FORCE', validityCheckedOn: '2026-11-08',
        validityEvidenceUrl: `https://eur-lex.europa.eu/test/${run}`,
      },
    };
    const pages = [['Article 1', `A driver shall take a ${term} break of 45 minutes after four and a half hours of driving.`, 'Article 2', `The ${term} rest period shall be at least 11 hours.`]];
    const prepared = await prepareVersion(entry, { bytes: makePdf(pages), finalUrl: entry.version.url }, { now: new Date('2026-11-08T10:00:00Z') });
    return (await writeVersion(importer, prepared, { actor: 'kb-ai-verify-db.test' })).versionId as string;
  }

  const allPass = { deterministic: { status: 'PASS' }, extraction: { status: 'PASS' }, independent: { status: 'PASS' }, conflicts: { status: 'PASS' }, applicability: { status: 'PASS' } };

  /** A complete run as the engine would produce it, with evidence quoted from the stored provisions. */
  async function runFor(versionId: string, overrides: Record<string, any> = {}) {
    const { verifier } = await clients();
    const stored = await readVersionForVerification(verifier, versionId);
    const claims = stored.provisions.filter((p: any) => p.anchor_type === 'ARTICLE').map((p: any) => ({
      provisionId: p.id, kind: 'LIMIT', statement: `The provision says: ${p.text.slice(0, 60)}`, values: [], quote: p.text.slice(0, 40),
      verdict: 'SUPPORTED', verifierQuote: p.text.slice(0, 50), verifierValues: [], conflict: null,
    }));
    return {
      protocol: PROTOCOL, versionId, versionSha256: stored.version.sha256, contentDigest: stored.contentDigest, provisionCount: stored.provisions.length,
      layers: allPass, claims, usage: [], costUsd: 0, startedAt: new Date(Date.now() - 60_000).toISOString(), sourceCheckedUrl: null,
      extractionProvider: 'openai', extractionModel: 'test-model-a', verificationProvider: 'anthropic', verificationModel: 'test-model-b',
      outcome: 'PASS', notes: 'kb-ai-verify-db.test (synthetic run, not a real AI verification)', ...overrides,
    };
  }

  const provenanceOf = async (versionId: string) => (await (await clients()).verifier`select provenance from dajc_kb.document_versions where id = ${versionId}`)[0].provenance;

  it('gives the import role (CI secret) no way to verify', async () => {
    const { importer } = await clients();
    const versionId = await load('import');
    const good = await runFor(versionId);
    await expect(recordVerificationRun(importer, good)).rejects.toThrow(/permission denied/);
    await expect(importer`select dajc_kb.apply_ai_verification(gen_random_uuid())`).rejects.toThrow(/permission denied/);
    await expect(importer`update dajc_kb.document_versions set provenance = 'AI_VERIFIED' where id = ${versionId}`).rejects.toThrow(/permission denied/);
    await expect(importer`select count(*) from dajc_kb.verification_runs`).rejects.toThrow(/permission denied/);
    expect(await provenanceOf(versionId)).toBe('AUTO_CHECKED');
  });

  it('lets the verifier change nothing directly and refuses forged evidence', async () => {
    const { verifier } = await clients();
    const versionId = await load('forge');
    await expect(verifier`update dajc_kb.document_versions set provenance = 'AI_VERIFIED' where id = ${versionId}`).rejects.toThrow(/permission denied/);
    await expect(verifier`insert into dajc_kb.provisions (version_id, ordinal, anchor_type, anchor_label, page_from, page_to, text, ts_config)
      values (${versionId}, 50, 'ARTICLE', 'Article 50', 1, 1, 'x', 'simple')`).rejects.toThrow(/permission denied/);
    // Another document's SHA-256, or content that is not what is stored.
    await expect(recordVerificationRun(verifier, await runFor(versionId, { versionSha256: 'a'.repeat(64) }))).rejects.toThrow(/must name the stored SHA-256/);
    await expect(recordVerificationRun(verifier, await runFor(versionId, { contentDigest: 'b'.repeat(64) }))).rejects.toThrow(/must describe the stored provisions/);
    // A quote that is not in the official text.
    const invented = await runFor(versionId);
    invented.claims[0].quote = 'A driver may drive for twenty hours without any break.';
    await expect(recordVerificationRun(verifier, invented)).rejects.toThrow(/quoted verbatim from the stored official text/);
    // Claims added later, outside the transaction of their run.
    const good = await runFor(versionId, { outcome: 'ERROR', layers: { ...allPass, extraction: { status: 'SKIPPED' } } });
    const { runId } = await recordVerificationRun(verifier, { ...good, claims: [] });
    const [p] = await verifier`select id, text from dajc_kb.provisions where version_id = ${versionId} and anchor_type = 'ARTICLE' order by ordinal limit 1`;
    await expect(verifier`insert into dajc_kb.verification_claims (run_id, provision_id, kind, statement, quote, verdict, verifier_quote)
      values (${runId}, ${p.id}, 'LIMIT', 'late claim', ${p.text.slice(0, 40)}, 'SUPPORTED', ${p.text.slice(0, 40)})`).rejects.toThrow(/transaction of their run/);
    expect(await provenanceOf(versionId)).toBe('AUTO_CHECKED');
  });

  it('lets the database refuse an incomplete PASS', async () => {
    const { verifier } = await clients();
    const versionId = await load('incomplete');
    await expect(recordVerificationRun(verifier, await runFor(versionId, { layers: { ...allPass, applicability: { status: 'FAIL' } } }))).rejects.toThrow(/layer applicability did not pass/);
    await expect(recordVerificationRun(verifier, await runFor(versionId, { verificationProvider: 'openai' }))).rejects.toThrow(/two different vendors/);
    const unsupported = await runFor(versionId);
    unsupported.claims[0].verdict = 'NOT_SUPPORTED';
    await expect(recordVerificationRun(verifier, unsupported)).rejects.toThrow(/no unsupported claim/);
    await expect(recordVerificationRun(verifier, await runFor(versionId, { claims: [] }))).rejects.toThrow(/supported evidence/);
    const noOwnQuote = await runFor(versionId);
    noOwnQuote.claims[0].verifierQuote = null;
    await expect(recordVerificationRun(verifier, noOwnQuote)).rejects.toThrow(/verifier's own quote/);
    expect(await provenanceOf(versionId)).toBe('AUTO_CHECKED');
  });

  it('verifies a complete run, serves it as AI_VERIFIED and labels it as automated', async () => {
    const { verifier, app } = await clients();
    const versionId = await load('pass');
    const { decision } = await recordVerificationRun(verifier, await runFor(versionId));
    expect(decision).toBe('AI_VERIFIED');
    expect(await provenanceOf(versionId)).toBe('AI_VERIFIED');
    const hits = await searchLibrary(postgresQuery(app), { terms: [`${term} break`], question: term, languages: ['en'], countries: ['CZ'], onDate: '2026-11-08', allowedProvenance: ['AI_VERIFIED'] } as any);
    expect(hits.some((h: any) => h.officialNumber === `AI test pass ${run}` && h.provenance === 'AI_VERIFIED')).toBe(true);
    const [view] = await app`select ai_verification_models, ai_verified_at is not null as dated from dajc_kb.answerable_provisions where version_id = ${versionId} limit 1`;
    expect(view).toEqual({ ai_verification_models: 'openai/test-model-a + anthropic/test-model-b', dated: true });
    const [log] = await verifier`select decision, note from dajc_kb.review_log where version_id = ${versionId} and action = 'AI_VERIFICATION'`;
    expect(log.decision).toBe('AI_VERIFIED');
    expect(log.note).toMatch(/automated, not a human or official approval/);
    await expect(app`select count(*) from dajc_kb.verification_runs`).rejects.toThrow(/permission denied/);
  });

  it('keeps conflicts out, revokes on a failed re-check and ignores infrastructure errors', async () => {
    const { verifier, app } = await clients();
    const conflicted = await load('conflict');
    expect((await recordVerificationRun(verifier, await runFor(conflicted, { outcome: 'CONFLICT', layers: { ...allPass, conflicts: { status: 'FAIL' } } }))).decision).toBe('CONFLICTED');
    expect(await provenanceOf(conflicted)).toBe('CONFLICTED');
    const [{ n }] = await app`select count(*)::int as n from dajc_kb.answerable_provisions where version_id = ${conflicted}`;
    expect(n).toBe(0);

    const revoked = await load('revoke');
    await recordVerificationRun(verifier, await runFor(revoked));
    expect((await recordVerificationRun(verifier, await runFor(revoked, { outcome: 'ERROR', claims: [] }))).decision).toBe('NO_DECISION');
    expect(await provenanceOf(revoked)).toBe('AI_VERIFIED');
    expect((await recordVerificationRun(verifier, await runFor(revoked, { outcome: 'FAIL', claims: [] }))).decision).toBe('REVOKED');
    expect(await provenanceOf(revoked)).toBe('AUTO_CHECKED');
  });

  it('never overrides a person, and never applies a stale run', async () => {
    const { verifier, reviewer } = await clients();
    const rejected = await load('human');
    await reviewVersion(reviewer, { versionId: rejected, reviewer: 'Test Reviewer', decision: 'REJECTED', note: 'wrong document' });
    expect((await recordVerificationRun(verifier, await runFor(rejected))).decision).toBe('UNCHANGED_HUMAN_DECISION');
    expect(await provenanceOf(rejected)).toBe('REJECTED');

    const stale = await load('stale');
    // The first run is recorded (ERROR, no decision); a newer FAIL follows; the old run cannot be applied again later.
    const first = await recordVerificationRun(verifier, await runFor(stale, { outcome: 'ERROR', claims: [] }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    await recordVerificationRun(verifier, await runFor(stale, { outcome: 'FAIL', claims: [] }));
    await expect(verifier`select dajc_kb.apply_ai_verification(${first.runId})`).rejects.toThrow(/newer verification run exists/);
  });

  it.skipIf(!OWNER_URL)('keeps the audit append-only, even for the owner', async () => {
    const { owner, verifier } = await clients();
    const versionId = await load('audit');
    const { runId } = await recordVerificationRun(verifier, await runFor(versionId));
    await expect(owner`update dajc_kb.verification_runs set outcome = 'FAIL' where id = ${runId}`).rejects.toThrow(/append-only/);
    await expect(owner`delete from dajc_kb.verification_claims where run_id = ${runId}`).rejects.toThrow(/append-only/);
    await expect(owner`delete from dajc_kb.review_log where version_id = ${versionId}`).rejects.toThrow(/append-only/);
    await expect(verifier`update dajc_kb.verification_runs set outcome = 'FAIL' where id = ${runId}`).rejects.toThrow(/permission denied/);
  });
});
