-- DAJC legal library: automated AI verification instead of mandatory human review.
--
-- Owner decision of 2026-11-09: a document version no longer needs a person's
-- approval; it becomes AI_VERIFIED after an automated multi-layer verification
-- (src/lib/kb/ai-verify/). AI_VERIFIED is never a human, official or legally
-- binding approval, and it is granted by the database, not by the verifier's
-- word:
--   * a separate role dajc_kb_ai_verifier records verification runs and their
--     evidence; it cannot update a version directly;
--   * runs and claims are append-only (no UPDATE, DELETE or TRUNCATE for anyone,
--     the owner included, while the triggers exist); review_log becomes
--     append-only as well;
--   * a run must name the stored SHA-256 and the digest of the stored
--     provisions; every claim must quote the stored official text verbatim and
--     is recorded in the transaction of its run;
--   * only dajc_kb.apply_ai_verification(run) changes the state. It re-checks
--     that the run is recent and the newest for the version, matches the stored
--     content, has PASS in all five layers, used two different vendors and has
--     only supported evidence. CONFLICT makes the version CONFLICTED; FAIL
--     revokes an earlier AI_VERIFIED (fail closed); ERROR (infrastructure, no
--     evidence about the document) changes nothing;
--   * a person's REJECTED or HUMAN_VERIFIED is never overridden by the AI;
--   * the import role (CI secret) has no access to any of this (drizzle-kb/0001
--     stays in force: it still can only add machine-checked versions).
-- DAJC AI may answer from AI_VERIFIED and HUMAN_VERIFIED versions; CONFLICTED
-- and REJECTED versions are never answerable.
ALTER TABLE dajc_kb.document_versions DROP CONSTRAINT document_versions_provenance_check;
--> statement-breakpoint
ALTER TABLE dajc_kb.document_versions ADD CONSTRAINT document_versions_provenance_check
  CHECK (provenance IN ('UNVERIFIED', 'AUTO_CHECKED', 'AI_VERIFIED', 'CONFLICTED', 'HUMAN_VERIFIED', 'REJECTED'));
--> statement-breakpoint
ALTER TABLE dajc_kb.document_versions ADD COLUMN ai_verification_run_id uuid, ADD COLUMN ai_verified_at timestamptz;
--> statement-breakpoint
CREATE TABLE dajc_kb.verification_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version_id uuid NOT NULL REFERENCES dajc_kb.document_versions(id),
  protocol text NOT NULL CHECK (protocol ~ '^dajc-kb-ai-verify/[0-9]+$'),
  outcome text NOT NULL CHECK (outcome IN ('PASS', 'FAIL', 'CONFLICT', 'ERROR')),
  version_sha256 text NOT NULL CHECK (version_sha256 ~ '^[0-9a-f]{64}$'),
  content_digest text NOT NULL CHECK (content_digest ~ '^[0-9a-f]{64}$'),
  provision_count integer NOT NULL CHECK (provision_count >= 0),
  layers jsonb NOT NULL,
  extraction_provider text,
  extraction_model text,
  verification_provider text,
  verification_model text,
  usage jsonb NOT NULL DEFAULT '[]',
  cost_usd numeric(12, 6) NOT NULL DEFAULT 0 CHECK (cost_usd >= 0),
  source_checked_url text CHECK (source_checked_url IS NULL OR source_checked_url LIKE 'https://%'),
  started_at timestamptz NOT NULL,
  finished_at timestamptz NOT NULL DEFAULT now(),
  created_txid bigint NOT NULL DEFAULT txid_current(),
  created_by text NOT NULL DEFAULT current_user,
  notes text
);
--> statement-breakpoint
CREATE INDEX verification_runs_version_idx ON dajc_kb.verification_runs (version_id, finished_at DESC);
--> statement-breakpoint
ALTER TABLE dajc_kb.document_versions
  ADD CONSTRAINT versions_ai_run_fk FOREIGN KEY (ai_verification_run_id) REFERENCES dajc_kb.verification_runs(id),
  ADD CONSTRAINT versions_ai_verified_run CHECK (provenance <> 'AI_VERIFIED' OR (ai_verification_run_id IS NOT NULL AND ai_verified_at IS NOT NULL));
--> statement-breakpoint
CREATE TABLE dajc_kb.verification_claims (
  id bigserial PRIMARY KEY,
  run_id uuid NOT NULL REFERENCES dajc_kb.verification_runs(id),
  provision_id bigint NOT NULL REFERENCES dajc_kb.provisions(id),
  kind text NOT NULL CHECK (kind IN ('OBLIGATION', 'PROHIBITION', 'LIMIT', 'THRESHOLD', 'EXCEPTION', 'DEFINITION', 'EFFECTIVE_DATE', 'SCOPE', 'SANCTION', 'PROCEDURE', 'OTHER')),
  statement text NOT NULL CHECK (length(statement) BETWEEN 3 AND 1000),
  values_json jsonb NOT NULL DEFAULT '[]',
  quote text NOT NULL CHECK (length(quote) BETWEEN 8 AND 1200),
  verdict text NOT NULL CHECK (verdict IN ('SUPPORTED', 'NOT_SUPPORTED', 'CONTRADICTED')),
  verifier_quote text CHECK (verifier_quote IS NULL OR length(verifier_quote) BETWEEN 8 AND 1200),
  verifier_values_json jsonb,
  conflict text
);
--> statement-breakpoint
CREATE INDEX verification_claims_run_idx ON dajc_kb.verification_claims (run_id);
--> statement-breakpoint
-- Digest of the stored provisions (what an AI verification read), comparable by
-- the verifier and by the database itself.
CREATE FUNCTION dajc_kb.content_digest(p_version uuid) RETURNS text LANGUAGE sql STABLE SET search_path = pg_catalog, dajc_kb AS $$
  SELECT encode(sha256(convert_to(coalesce(string_agg(
    p.ordinal::text || E'\x1f' || p.anchor_label || E'\x1f' || p.page_from::text || E'\x1f' || p.page_to::text || E'\x1f' || p.text,
    E'\x1e' ORDER BY p.ordinal), ''), 'UTF8')), 'hex')
  FROM dajc_kb.provisions p WHERE p.version_id = p_version
$$;
--> statement-breakpoint
CREATE FUNCTION dajc_kb.forbid_change() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  RAISE EXCEPTION 'dajc_kb: % is append-only', TG_TABLE_NAME USING ERRCODE = '42501';
END
$$;
--> statement-breakpoint
CREATE TRIGGER verification_runs_append_only BEFORE UPDATE OR DELETE ON dajc_kb.verification_runs FOR EACH ROW EXECUTE FUNCTION dajc_kb.forbid_change();
--> statement-breakpoint
CREATE TRIGGER verification_runs_no_truncate BEFORE TRUNCATE ON dajc_kb.verification_runs FOR EACH STATEMENT EXECUTE FUNCTION dajc_kb.forbid_change();
--> statement-breakpoint
CREATE TRIGGER verification_claims_append_only BEFORE UPDATE OR DELETE ON dajc_kb.verification_claims FOR EACH ROW EXECUTE FUNCTION dajc_kb.forbid_change();
--> statement-breakpoint
CREATE TRIGGER verification_claims_no_truncate BEFORE TRUNCATE ON dajc_kb.verification_claims FOR EACH STATEMENT EXECUTE FUNCTION dajc_kb.forbid_change();
--> statement-breakpoint
CREATE TRIGGER review_log_append_only BEFORE UPDATE OR DELETE ON dajc_kb.review_log FOR EACH ROW EXECUTE FUNCTION dajc_kb.forbid_change();
--> statement-breakpoint
CREATE TRIGGER review_log_no_truncate BEFORE TRUNCATE ON dajc_kb.review_log FOR EACH STATEMENT EXECUTE FUNCTION dajc_kb.forbid_change();
--> statement-breakpoint
-- A run describes exactly the stored version; time, transaction and author are
-- set by the database.
CREATE FUNCTION dajc_kb.guard_verification_runs() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, dajc_kb AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM dajc_kb.document_versions WHERE id = NEW.version_id AND sha256 = NEW.version_sha256) THEN
    RAISE EXCEPTION 'dajc_kb: a verification run must name the stored SHA-256' USING ERRCODE = '42501';
  END IF;
  IF NEW.content_digest <> dajc_kb.content_digest(NEW.version_id)
     OR NEW.provision_count <> (SELECT count(*) FROM dajc_kb.provisions WHERE version_id = NEW.version_id) THEN
    RAISE EXCEPTION 'dajc_kb: a verification run must describe the stored provisions' USING ERRCODE = '42501';
  END IF;
  IF NEW.started_at > now() THEN
    RAISE EXCEPTION 'dajc_kb: a verification run cannot start in the future' USING ERRCODE = '42501';
  END IF;
  NEW.finished_at := now();
  NEW.created_txid := txid_current();
  NEW.created_by := current_user;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER verification_runs_guard BEFORE INSERT ON dajc_kb.verification_runs FOR EACH ROW EXECUTE FUNCTION dajc_kb.guard_verification_runs();
--> statement-breakpoint
-- Evidence is the official text itself: a claim quotes its provision verbatim,
-- and is recorded in the same transaction as its run.
CREATE FUNCTION dajc_kb.guard_verification_claims() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, dajc_kb AS $$
DECLARE
  run_version uuid;
  run_txid bigint;
  body text;
BEGIN
  SELECT version_id, created_txid INTO run_version, run_txid FROM dajc_kb.verification_runs WHERE id = NEW.run_id;
  IF run_txid IS DISTINCT FROM txid_current() THEN
    RAISE EXCEPTION 'dajc_kb: claims are recorded in the transaction of their run' USING ERRCODE = '42501';
  END IF;
  SELECT text INTO body FROM dajc_kb.provisions WHERE id = NEW.provision_id AND version_id = run_version;
  IF body IS NULL OR strpos(body, NEW.quote) = 0 OR (NEW.verifier_quote IS NOT NULL AND strpos(body, NEW.verifier_quote) = 0) THEN
    RAISE EXCEPTION 'dajc_kb: evidence must be quoted verbatim from the stored official text' USING ERRCODE = '42501';
  END IF;
  IF NEW.verdict = 'SUPPORTED' AND NEW.verifier_quote IS NULL THEN
    RAISE EXCEPTION 'dajc_kb: a supported claim needs the independent verifier''s own quote' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER verification_claims_guard BEFORE INSERT ON dajc_kb.verification_claims FOR EACH ROW EXECUTE FUNCTION dajc_kb.guard_verification_claims();
--> statement-breakpoint
-- The only way to AI_VERIFIED / CONFLICTED, and the database decides.
CREATE FUNCTION dajc_kb.apply_ai_verification(p_run uuid) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, dajc_kb AS $$
DECLARE
  r dajc_kb.verification_runs%ROWTYPE;
  v dajc_kb.document_versions%ROWTYPE;
  layer text;
  supported integer;
  unsupported integer;
  decision text;
BEGIN
  SELECT * INTO r FROM dajc_kb.verification_runs WHERE id = p_run;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'dajc_kb: unknown verification run' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v FROM dajc_kb.document_versions WHERE id = r.version_id FOR UPDATE;
  IF v.provenance IN ('HUMAN_VERIFIED', 'REJECTED') THEN
    RETURN 'UNCHANGED_HUMAN_DECISION';
  END IF;
  IF v.ai_verification_run_id = r.id THEN
    RETURN 'UNCHANGED';
  END IF;
  IF r.finished_at < now() - interval '24 hours' THEN
    RAISE EXCEPTION 'dajc_kb: verification run is older than 24 hours' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM dajc_kb.verification_runs o WHERE o.version_id = r.version_id AND o.id <> r.id AND o.finished_at > r.finished_at) THEN
    RAISE EXCEPTION 'dajc_kb: a newer verification run exists for this version' USING ERRCODE = '42501';
  END IF;
  IF r.version_sha256 <> v.sha256 OR r.content_digest <> dajc_kb.content_digest(v.id)
     OR r.provision_count <> (SELECT count(*) FROM dajc_kb.provisions WHERE version_id = v.id) THEN
    RAISE EXCEPTION 'dajc_kb: the stored version changed after the verification run' USING ERRCODE = '42501';
  END IF;

  IF r.outcome = 'PASS' THEN
    IF v.provenance NOT IN ('AUTO_CHECKED', 'AI_VERIFIED', 'CONFLICTED') OR v.validity = 'UNKNOWN' OR v.text_extraction <> 'TEXT' THEN
      RAISE EXCEPTION 'dajc_kb: version % is not eligible for AI verification', v.id USING ERRCODE = '42501';
    END IF;
    FOREACH layer IN ARRAY ARRAY['deterministic', 'extraction', 'independent', 'conflicts', 'applicability'] LOOP
      IF coalesce(r.layers -> layer ->> 'status', '') <> 'PASS' THEN
        RAISE EXCEPTION 'dajc_kb: layer % did not pass', layer USING ERRCODE = '42501';
      END IF;
    END LOOP;
    IF coalesce(r.extraction_provider, '') = '' OR coalesce(r.verification_provider, '') = '' OR r.extraction_provider = r.verification_provider
       OR coalesce(r.extraction_model, '') = '' OR coalesce(r.verification_model, '') = '' THEN
      RAISE EXCEPTION 'dajc_kb: extraction and independent verification need two different vendors' USING ERRCODE = '42501';
    END IF;
    SELECT count(*) FILTER (WHERE verdict = 'SUPPORTED'), count(*) FILTER (WHERE verdict <> 'SUPPORTED')
      INTO supported, unsupported FROM dajc_kb.verification_claims WHERE run_id = r.id;
    IF supported < 1 OR unsupported > 0 THEN
      RAISE EXCEPTION 'dajc_kb: a passing run needs supported evidence and no unsupported claim' USING ERRCODE = '42501';
    END IF;
    UPDATE dajc_kb.document_versions SET provenance = 'AI_VERIFIED', ai_verification_run_id = r.id, ai_verified_at = now() WHERE id = v.id;
    decision := 'AI_VERIFIED';
  ELSIF r.outcome = 'CONFLICT' THEN
    UPDATE dajc_kb.document_versions SET provenance = 'CONFLICTED', ai_verification_run_id = r.id, ai_verified_at = NULL WHERE id = v.id;
    decision := 'CONFLICTED';
  ELSIF r.outcome = 'FAIL' AND v.provenance = 'AI_VERIFIED' THEN
    UPDATE dajc_kb.document_versions SET provenance = 'AUTO_CHECKED', ai_verification_run_id = r.id, ai_verified_at = NULL WHERE id = v.id;
    decision := 'REVOKED';
  ELSE
    decision := CASE WHEN r.outcome = 'ERROR' THEN 'NO_DECISION' ELSE 'NOT_VERIFIED' END;
  END IF;
  INSERT INTO dajc_kb.review_log (version_id, action, decision, reviewer, note)
  VALUES (v.id, 'AI_VERIFICATION', decision, 'ai-verifier run ' || r.id,
          r.protocol || '; ' || coalesce(r.extraction_provider || '/' || r.extraction_model, '-') || ' + ' || coalesce(r.verification_provider || '/' || r.verification_model, '-')
          || '; automated, not a human or official approval');
  RETURN decision;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION dajc_kb.apply_ai_verification(uuid), dajc_kb.content_digest(uuid), dajc_kb.forbid_change(),
  dajc_kb.guard_verification_runs(), dajc_kb.guard_verification_claims() FROM PUBLIC;
--> statement-breakpoint
CREATE OR REPLACE VIEW dajc_kb.answerable_provisions WITH (security_barrier = true) AS
SELECT p.id, p.version_id, p.anchor_type, p.anchor_label, p.anchor_number, p.heading, p.page_from, p.page_to, p.text, p.tsv, p.ts_config,
       p.topics AS provision_topics, p.mass_mentions, p.mass_min_t, p.mass_min_inclusive, p.mass_max_t, p.mass_max_inclusive, p.mass_basis,
       v.language, v.official_url, v.sha256, v.version_label, v.authenticity, v.issued_on, v.effective_from, v.effective_to, v.validity,
       v.validity_checked_on, v.provenance, v.verified_by, v.last_verified_at, v.reuse_status,
       d.jurisdiction, d.official_number, d.title, d.legal_category, d.issuing_body, d.topics AS document_topics, d.source_id,
       v.ai_verified_at, v.ai_verification_run_id, r.protocol AS ai_verification_protocol,
       CASE WHEN r.id IS NULL THEN NULL ELSE r.extraction_provider || '/' || r.extraction_model || ' + ' || r.verification_provider || '/' || r.verification_model END AS ai_verification_models
FROM dajc_kb.provisions p
JOIN dajc_kb.document_versions v ON v.id = p.version_id
JOIN dajc_kb.documents d ON d.id = v.document_id
LEFT JOIN dajc_kb.verification_runs r ON r.id = v.ai_verification_run_id AND v.provenance = 'AI_VERIFIED'
WHERE v.provenance IN ('AUTO_CHECKED', 'AI_VERIFIED', 'HUMAN_VERIFIED')
  AND v.text_extraction IN ('TEXT', 'OCR_APPROVED')
  AND v.validity IN ('IN_FORCE', 'NOT_YET_IN_FORCE')
  AND v.reuse_status <> 'RESTRICTED';
--> statement-breakpoint
-- What the library holds, without any text (coverage dashboard and reports).
CREATE VIEW dajc_kb.library_inventory AS
SELECT d.jurisdiction, d.official_number, d.title, d.legal_category, d.topics, d.source_id,
       v.id AS version_id, v.language, v.version_label, v.official_url, v.sha256, v.validity, v.provenance, v.text_extraction,
       v.issued_on, v.effective_from, v.effective_to, v.validity_checked_on, v.ai_verified_at, v.retrieved_at,
       (SELECT count(*) FROM dajc_kb.provisions p WHERE p.version_id = v.id)::integer AS provision_count
FROM dajc_kb.document_versions v JOIN dajc_kb.documents d ON d.id = v.document_id;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dajc_kb_ai_verifier') THEN
    CREATE ROLE dajc_kb_ai_verifier NOLOGIN NOINHERIT;
  END IF;
END
$$;
--> statement-breakpoint
GRANT USAGE ON SCHEMA dajc_kb TO dajc_kb_ai_verifier;
--> statement-breakpoint
GRANT SELECT ON dajc_kb.sources, dajc_kb.documents, dajc_kb.document_versions, dajc_kb.pages, dajc_kb.provisions, dajc_kb.review_log,
  dajc_kb.answerable_provisions, dajc_kb.library_inventory, dajc_kb.deployment, dajc_kb.verification_runs, dajc_kb.verification_claims TO dajc_kb_ai_verifier;
--> statement-breakpoint
GRANT INSERT (version_id, protocol, outcome, version_sha256, content_digest, provision_count, layers, extraction_provider, extraction_model,
  verification_provider, verification_model, usage, cost_usd, source_checked_url, started_at, notes) ON dajc_kb.verification_runs TO dajc_kb_ai_verifier;
--> statement-breakpoint
GRANT INSERT (run_id, provision_id, kind, statement, values_json, quote, verdict, verifier_quote, verifier_values_json, conflict)
  ON dajc_kb.verification_claims TO dajc_kb_ai_verifier;
--> statement-breakpoint
GRANT USAGE ON SEQUENCE dajc_kb.verification_claims_id_seq TO dajc_kb_ai_verifier;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION dajc_kb.apply_ai_verification(uuid), dajc_kb.content_digest(uuid), dajc_kb.ts_config(text) TO dajc_kb_ai_verifier;
--> statement-breakpoint
GRANT SELECT ON dajc_kb.verification_runs, dajc_kb.verification_claims, dajc_kb.library_inventory TO dajc_kb_reviewer;
--> statement-breakpoint
GRANT SELECT ON dajc_kb.library_inventory TO dajc_kb_importer;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION dajc_kb.content_digest(uuid) TO dajc_kb_importer, dajc_kb_reviewer;
--> statement-breakpoint
DO $$
BEGIN
  -- DAJC AI still reads only the answerable view, plus the text-free inventory.
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dajc_ask_app') THEN
    GRANT SELECT ON dajc_kb.library_inventory TO dajc_ask_app;
  END IF;
END
$$;
