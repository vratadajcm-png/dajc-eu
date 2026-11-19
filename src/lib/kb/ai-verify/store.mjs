// Reading and recording AI verification runs (role dajc_kb_ai_verifier).
// The run, its claims and the database's decision are written in ONE
// transaction: claims are only accepted in the transaction of their run, and
// dajc_kb.apply_ai_verification() re-checks everything before it changes the
// version's state (drizzle-kb/0002).

/** The stored version, its provisions, the first pages and the database's content digest. */
export async function readVersionForVerification(sql, versionId) {
  const [version] = await sql`
    select v.id, v.sha256, v.language, v.version_label, v.official_url, v.effective_from, v.effective_to, v.validity, v.provenance, v.authenticity,
           v.page_count, v.text_extraction, d.jurisdiction, d.official_number, d.title, d.legal_category, d.topics as document_topics
    from dajc_kb.document_versions v join dajc_kb.documents d on d.id = v.document_id where v.id = ${versionId}`;
  if (!version) throw new Error('version not found');
  const provisions = await sql`
    select id, ordinal, anchor_type, anchor_label, anchor_number, page_from, page_to, text, mass_min_t, mass_max_t
    from dajc_kb.provisions where version_id = ${versionId} order by ordinal`;
  const [first] = await sql`select string_agg(text, E'\n' order by page_no) as text from dajc_kb.pages where version_id = ${versionId} and page_no <= 2`;
  const [{ digest }] = await sql`select dajc_kb.content_digest(${versionId}) as digest`;
  return { version, provisions, firstPagesText: first?.text || '', contentDigest: digest };
}

/**
 * Records a run (verifyVersionWithAi) with its claims and applies it.
 * @returns {Promise<{ runId: string, decision: string }>}
 */
export async function recordVerificationRun(sql, run) {
  return sql.begin(async (tx) => {
    const [row] = await tx`
      insert into dajc_kb.verification_runs (version_id, protocol, outcome, version_sha256, content_digest, provision_count, layers,
        extraction_provider, extraction_model, verification_provider, verification_model, usage, cost_usd, source_checked_url, started_at, notes)
      values (${run.versionId}, ${run.protocol}, ${run.outcome}, ${run.versionSha256}, ${run.contentDigest}, ${run.provisionCount}, ${tx.json(run.layers)},
        ${run.extractionProvider}, ${run.extractionModel}, ${run.verificationProvider}, ${run.verificationModel}, ${tx.json(run.usage)}, ${run.costUsd},
        ${run.sourceCheckedUrl}, ${run.startedAt}, ${run.notes})
      returning id`;
    if (run.claims.length > 0) {
      const rows = run.claims.map((c) => ({
        provision_id: c.provisionId, kind: c.kind, statement: c.statement, values_json: c.values, quote: c.quote, verdict: c.verdict,
        verifier_quote: c.verifierQuote ?? null, verifier_values_json: c.verifierValues ?? null, conflict: c.conflict ?? null,
      }));
      await tx`
        insert into dajc_kb.verification_claims (run_id, provision_id, kind, statement, values_json, quote, verdict, verifier_quote, verifier_values_json, conflict)
        select ${row.id}::uuid, r.provision_id, r.kind, r.statement, coalesce(r.values_json, '[]'::jsonb), r.quote, r.verdict, r.verifier_quote, r.verifier_values_json, r.conflict
        from jsonb_to_recordset(${tx.json(rows)}) as r(provision_id bigint, kind text, statement text, values_json jsonb, quote text, verdict text,
             verifier_quote text, verifier_values_json jsonb, conflict text)`;
    }
    const [{ decision }] = await tx`select dajc_kb.apply_ai_verification(${row.id}) as decision`;
    return { runId: row.id, decision };
  });
}
