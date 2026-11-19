-- DAJC legal library: separation of duties between the import and human review.
--
-- The connection string of dajc_kb_importer is a CI secret (GitHub environment
-- "kb-import-dev"), so the importer must never be able to make anything
-- answerable in production, where DAJC AI uses HUMAN_VERIFIED versions only.
-- After this migration:
--   * only dajc_kb_reviewer (a person, never CI) records HUMAN_VERIFIED or
--     REJECTED, approves OCR and changes mass bands of stored provisions;
--   * the importer adds machine-checked versions (UNVERIFIED / AUTO_CHECKED),
--     writes the pages and provisions of a version once, and closes an older
--     version when a newer one of the same document and language enters into
--     force - nothing else; documents are insert-only for it;
--   * the content of a human-verified version is frozen for the importer;
--   * review_log time stamps come from the database, and each role writes only
--     its own kind of entry.
-- Checks run in SECURITY INVOKER triggers keyed on current_user: both roles are
-- NOINHERIT, so their privileges are used only under their own name. The owner
-- (migrations) is not restricted.
--
-- dajc_kb.deployment marks which environment a Neon branch is. The migration
-- leaves it empty; the owner writes one row per branch
-- (INSERT INTO dajc_kb.deployment (environment) VALUES ('dev')), and the CI
-- import refuses any database whose marker is not 'dev'. A branch created from
-- another one inherits its row, so a new production branch must get
-- 'production' before anything else runs there.
CREATE TABLE dajc_kb.deployment (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  environment text NOT NULL CHECK (environment IN ('dev', 'test', 'preview', 'production')),
  marked_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
REVOKE ALL ON dajc_kb.deployment FROM PUBLIC;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dajc_kb_reviewer') THEN
    CREATE ROLE dajc_kb_reviewer NOLOGIN NOINHERIT;
  END IF;
END
$$;
--> statement-breakpoint
REVOKE INSERT, UPDATE ON dajc_kb.sources, dajc_kb.documents, dajc_kb.document_versions, dajc_kb.pages, dajc_kb.provisions, dajc_kb.ocr_queue, dajc_kb.review_log FROM dajc_kb_importer;
--> statement-breakpoint
GRANT INSERT (id, jurisdiction, name, kind, domains, reuse_status, reuse_basis, terms_url, check_status, checked_on) ON dajc_kb.sources TO dajc_kb_importer;
--> statement-breakpoint
GRANT UPDATE (name, domains, reuse_status, reuse_basis, terms_url, check_status, checked_on, updated_at) ON dajc_kb.sources TO dajc_kb_importer;
--> statement-breakpoint
GRANT INSERT (source_id, jurisdiction, official_number, title, legal_category, issuing_body, topics) ON dajc_kb.documents TO dajc_kb_importer;
--> statement-breakpoint
GRANT INSERT (document_id, version_label, language, official_url, retrieved_at, sha256, byte_size, media_type, storage_key, authenticity, issued_on,
  effective_from, effective_to, validity, validity_checked_on, provenance, provenance_checked_at, reuse_status, text_extraction, page_count, notes)
  ON dajc_kb.document_versions TO dajc_kb_importer;
--> statement-breakpoint
GRANT UPDATE (effective_to, validity, superseded_by) ON dajc_kb.document_versions TO dajc_kb_importer;
--> statement-breakpoint
GRANT INSERT (version_id, page_no, text) ON dajc_kb.pages TO dajc_kb_importer;
--> statement-breakpoint
GRANT INSERT (version_id, ordinal, anchor_type, anchor_label, anchor_number, heading, page_from, page_to, text, ts_config, topics, mass_mentions,
  mass_min_t, mass_min_inclusive, mass_max_t, mass_max_inclusive, mass_basis, mass_reviewed_by) ON dajc_kb.provisions TO dajc_kb_importer;
--> statement-breakpoint
GRANT INSERT (version_id, reason) ON dajc_kb.ocr_queue TO dajc_kb_importer;
--> statement-breakpoint
GRANT INSERT (version_id, action, decision, reviewer, note) ON dajc_kb.review_log TO dajc_kb_importer;
--> statement-breakpoint
-- The CI verification after an import runs the production search code.
GRANT SELECT ON dajc_kb.answerable_provisions, dajc_kb.deployment TO dajc_kb_importer;
--> statement-breakpoint
GRANT USAGE ON SCHEMA dajc_kb TO dajc_kb_reviewer;
--> statement-breakpoint
GRANT SELECT ON dajc_kb.sources, dajc_kb.documents, dajc_kb.document_versions, dajc_kb.pages, dajc_kb.provisions, dajc_kb.ocr_queue, dajc_kb.review_log,
  dajc_kb.answerable_provisions, dajc_kb.deployment TO dajc_kb_reviewer;
--> statement-breakpoint
GRANT UPDATE (provenance, verified_by, last_verified_at) ON dajc_kb.document_versions TO dajc_kb_reviewer;
--> statement-breakpoint
GRANT UPDATE (mass_min_t, mass_min_inclusive, mass_max_t, mass_max_inclusive, mass_basis, mass_reviewed_by) ON dajc_kb.provisions TO dajc_kb_reviewer;
--> statement-breakpoint
GRANT UPDATE (status) ON dajc_kb.ocr_queue TO dajc_kb_reviewer;
--> statement-breakpoint
GRANT INSERT (version_id, action, decision, reviewer, note) ON dajc_kb.review_log TO dajc_kb_reviewer;
--> statement-breakpoint
GRANT USAGE ON SEQUENCE dajc_kb.review_log_id_seq TO dajc_kb_reviewer;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION dajc_kb.ts_config(text) TO dajc_kb_reviewer;
--> statement-breakpoint
CREATE FUNCTION dajc_kb.guard_versions() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, dajc_kb AS $$
DECLARE
  successor dajc_kb.document_versions%ROWTYPE;
  allowed boolean;
BEGIN
  IF current_user = 'dajc_kb_importer' THEN
    IF TG_OP = 'INSERT' THEN
      allowed := NEW.provenance IN ('UNVERIFIED', 'AUTO_CHECKED') AND NEW.text_extraction <> 'OCR_APPROVED';
      IF allowed IS NOT TRUE THEN
        RAISE EXCEPTION 'dajc_kb: the importer may only add machine-checked versions' USING ERRCODE = '42501';
      END IF;
      RETURN NEW;
    END IF;
    IF ROW(NEW.*) IS NOT DISTINCT FROM ROW(OLD.*) THEN
      RETURN NEW;
    END IF;
    -- The only update: a newer version of the same document and language that
    -- enters into force closes this one (validity, end date, successor).
    SELECT * INTO successor FROM dajc_kb.document_versions WHERE id = NEW.superseded_by;
    allowed := OLD.validity IN ('IN_FORCE', 'NOT_YET_IN_FORCE') AND OLD.superseded_by IS NULL
      AND NEW.validity = 'SUPERSEDED' AND successor.id IS NOT NULL
      AND successor.document_id = OLD.document_id AND successor.language = OLD.language
      AND successor.validity IN ('IN_FORCE', 'NOT_YET_IN_FORCE')
      AND successor.effective_from > OLD.effective_from
      AND NEW.effective_to = successor.effective_from
      AND (OLD.effective_to IS NULL OR NEW.effective_to < OLD.effective_to);
    IF allowed IS NOT TRUE THEN
      RAISE EXCEPTION 'dajc_kb: the importer may only close a version that a newer one supersedes' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF current_user = 'dajc_kb_reviewer' AND TG_OP = 'UPDATE'
     AND (NEW.provenance IS DISTINCT FROM OLD.provenance OR NEW.verified_by IS DISTINCT FROM OLD.verified_by
          OR NEW.last_verified_at IS DISTINCT FROM OLD.last_verified_at) THEN
    allowed := NEW.provenance IN ('HUMAN_VERIFIED', 'REJECTED') AND length(btrim(coalesce(NEW.verified_by, ''))) >= 3;
    IF allowed IS NOT TRUE THEN
      RAISE EXCEPTION 'dajc_kb: a review records HUMAN_VERIFIED or REJECTED with the reviewer''s name' USING ERRCODE = '42501';
    END IF;
    NEW.last_verified_at := now();
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER versions_guard BEFORE INSERT OR UPDATE ON dajc_kb.document_versions FOR EACH ROW EXECUTE FUNCTION dajc_kb.guard_versions();
--> statement-breakpoint
-- Pages and provisions of a version are written once, in the import of that
-- version, and only while the version is machine-checked.
CREATE FUNCTION dajc_kb.guard_pages() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, dajc_kb AS $$
BEGIN
  IF current_user = 'dajc_kb_importer' AND EXISTS (
    SELECT 1 FROM (SELECT version_id, count(*) AS added FROM new_rows GROUP BY version_id) n
    JOIN dajc_kb.document_versions v ON v.id = n.version_id
    WHERE v.provenance NOT IN ('UNVERIFIED', 'AUTO_CHECKED')
       OR (SELECT count(*) FROM dajc_kb.pages p WHERE p.version_id = n.version_id) <> n.added
  ) THEN
    RAISE EXCEPTION 'dajc_kb: the importer writes the pages of a machine-checked version once' USING ERRCODE = '42501';
  END IF;
  RETURN NULL;
END
$$;
--> statement-breakpoint
CREATE TRIGGER pages_guard AFTER INSERT ON dajc_kb.pages REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION dajc_kb.guard_pages();
--> statement-breakpoint
CREATE FUNCTION dajc_kb.guard_provisions() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, dajc_kb AS $$
BEGIN
  IF current_user = 'dajc_kb_importer' AND EXISTS (
    SELECT 1 FROM (SELECT version_id, count(*) AS added FROM new_rows GROUP BY version_id) n
    JOIN dajc_kb.document_versions v ON v.id = n.version_id
    WHERE v.provenance NOT IN ('UNVERIFIED', 'AUTO_CHECKED')
       OR (SELECT count(*) FROM dajc_kb.provisions p WHERE p.version_id = n.version_id) <> n.added
  ) THEN
    RAISE EXCEPTION 'dajc_kb: the importer writes the provisions of a machine-checked version once' USING ERRCODE = '42501';
  END IF;
  RETURN NULL;
END
$$;
--> statement-breakpoint
CREATE TRIGGER provisions_guard AFTER INSERT ON dajc_kb.provisions REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION dajc_kb.guard_provisions();
--> statement-breakpoint
CREATE FUNCTION dajc_kb.guard_review_log() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, dajc_kb AS $$
BEGIN
  IF current_user = 'dajc_kb_importer'
     AND (NEW.action NOT IN ('IMPORT', 'SUPERSEDE') OR NEW.decision NOT IN ('UNVERIFIED', 'AUTO_CHECKED', 'SUPERSEDED')) THEN
    RAISE EXCEPTION 'dajc_kb: the importer logs only imports and supersessions' USING ERRCODE = '42501';
  END IF;
  IF current_user = 'dajc_kb_reviewer' AND NEW.action NOT IN ('REVIEW', 'MASS_REVIEW', 'OCR_REVIEW') THEN
    RAISE EXCEPTION 'dajc_kb: the reviewer logs only reviews' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER review_log_guard BEFORE INSERT ON dajc_kb.review_log FOR EACH ROW EXECUTE FUNCTION dajc_kb.guard_review_log();
--> statement-breakpoint
REVOKE ALL ON FUNCTION dajc_kb.guard_versions(), dajc_kb.guard_pages(), dajc_kb.guard_provisions(), dajc_kb.guard_review_log() FROM PUBLIC;
