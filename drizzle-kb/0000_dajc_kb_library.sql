-- DAJC legal library (knowledge base) for DAJC AI. Own schema and own
-- migration history (drizzle.kb.config.ts), independent of dajc_ask.
-- Public-law documents only: no personal data is stored here.
--
-- Access, deny by default:
--   * owner (migrations): everything;
--   * dajc_kb_importer (NOLOGIN until the owner enables it outside the repo):
--     reads and writes the catalogue, never deletes - superseded or repealed
--     versions stay for the history, they are only marked;
--   * dajc_ask_app (DAJC AI): SELECT on the view answerable_provisions only,
--     which hides rejected, unchecked, scanned (no OCR approval), restricted
--     and not-in-force versions. The app never sees the base tables.
CREATE EXTENSION IF NOT EXISTS unaccent;
--> statement-breakpoint
CREATE SCHEMA dajc_kb;
--> statement-breakpoint
CREATE TEXT SEARCH CONFIGURATION dajc_kb.simple_unaccent (COPY = pg_catalog.simple);
--> statement-breakpoint
DO $$
DECLARE dict_schema text;
BEGIN
  SELECT n.nspname INTO dict_schema FROM pg_ts_dict d JOIN pg_namespace n ON n.oid = d.dictnamespace WHERE d.dictname = 'unaccent' LIMIT 1;
  EXECUTE format('ALTER TEXT SEARCH CONFIGURATION dajc_kb.simple_unaccent ALTER MAPPING FOR hword, hword_part, word WITH %I.unaccent, simple', dict_schema);
END
$$;
--> statement-breakpoint
-- Languages with a PostgreSQL stemmer use it; Czech, Slovak, Polish and the
-- other languages without one use simple + unaccent (exact word forms).
CREATE FUNCTION dajc_kb.ts_config(lang text) RETURNS regconfig LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE lower(lang)
    WHEN 'en' THEN 'pg_catalog.english'::regconfig WHEN 'de' THEN 'pg_catalog.german'::regconfig
    WHEN 'fr' THEN 'pg_catalog.french'::regconfig WHEN 'it' THEN 'pg_catalog.italian'::regconfig
    WHEN 'es' THEN 'pg_catalog.spanish'::regconfig WHEN 'nl' THEN 'pg_catalog.dutch'::regconfig
    WHEN 'pt' THEN 'pg_catalog.portuguese'::regconfig WHEN 'da' THEN 'pg_catalog.danish'::regconfig
    WHEN 'sv' THEN 'pg_catalog.swedish'::regconfig WHEN 'fi' THEN 'pg_catalog.finnish'::regconfig
    WHEN 'hu' THEN 'pg_catalog.hungarian'::regconfig WHEN 'ro' THEN 'pg_catalog.romanian'::regconfig
    WHEN 'no' THEN 'pg_catalog.norwegian'::regconfig WHEN 'lt' THEN 'pg_catalog.lithuanian'::regconfig
    WHEN 'el' THEN 'pg_catalog.greek'::regconfig
    ELSE 'dajc_kb.simple_unaccent'::regconfig END
$$;
--> statement-breakpoint
CREATE TABLE dajc_kb.sources (
  id text PRIMARY KEY,
  jurisdiction text NOT NULL,
  name text NOT NULL,
  kind text NOT NULL,
  domains text[] NOT NULL,
  reuse_status text NOT NULL CHECK (reuse_status IN ('PERMITTED', 'PERMITTED_WITH_ATTRIBUTION', 'RESTRICTED', 'UNKNOWN')),
  reuse_basis text,
  terms_url text,
  check_status text NOT NULL,
  checked_on date,
  updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE dajc_kb.documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id text NOT NULL REFERENCES dajc_kb.sources(id),
  jurisdiction text NOT NULL,
  official_number text NOT NULL,
  title text NOT NULL,
  legal_category text NOT NULL CHECK (legal_category IN ('EU_REGULATION', 'EU_DIRECTIVE', 'EU_DECISION', 'INTERNATIONAL_AGREEMENT', 'NATIONAL_ACT', 'NATIONAL_REGULATION', 'AUTHORITY_GUIDANCE', 'OPERATIONAL_INFORMATION')),
  issuing_body text NOT NULL,
  topics text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT documents_number_unique UNIQUE (jurisdiction, official_number)
);
--> statement-breakpoint
CREATE TABLE dajc_kb.document_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES dajc_kb.documents(id),
  version_label text NOT NULL,
  language text NOT NULL CHECK (language ~ '^[a-z]{2}$'),
  official_url text NOT NULL CHECK (official_url LIKE 'https://%'),
  retrieved_at timestamptz NOT NULL,
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  byte_size integer NOT NULL CHECK (byte_size > 0),
  media_type text NOT NULL,
  storage_key text NOT NULL,
  authenticity text NOT NULL CHECK (authenticity IN ('OFFICIAL_PUBLICATION', 'CONSOLIDATED_DOCUMENTATION', 'AUTHORITY_PUBLICATION', 'UNKNOWN')),
  issued_on date,
  effective_from date,
  effective_to date,
  superseded_by uuid REFERENCES dajc_kb.document_versions(id),
  validity text NOT NULL DEFAULT 'UNKNOWN' CHECK (validity IN ('IN_FORCE', 'NOT_YET_IN_FORCE', 'REPEALED', 'SUPERSEDED', 'UNKNOWN')),
  validity_checked_on date,
  provenance text NOT NULL DEFAULT 'UNVERIFIED' CHECK (provenance IN ('UNVERIFIED', 'AUTO_CHECKED', 'HUMAN_VERIFIED', 'REJECTED')),
  provenance_checked_at timestamptz,
  verified_by text,
  last_verified_at timestamptz,
  reuse_status text NOT NULL DEFAULT 'UNKNOWN' CHECK (reuse_status IN ('PERMITTED', 'PERMITTED_WITH_ATTRIBUTION', 'RESTRICTED', 'UNKNOWN')),
  text_extraction text NOT NULL CHECK (text_extraction IN ('TEXT', 'NEEDS_OCR', 'OCR_APPROVED', 'FAILED')),
  page_count integer NOT NULL DEFAULT 0,
  notes text,
  CONSTRAINT versions_content_unique UNIQUE (document_id, language, sha256),
  CONSTRAINT versions_window CHECK (effective_to IS NULL OR effective_from IS NULL OR effective_to > effective_from),
  CONSTRAINT versions_human_verified_named CHECK (provenance <> 'HUMAN_VERIFIED' OR (verified_by IS NOT NULL AND last_verified_at IS NOT NULL)),
  CONSTRAINT versions_in_force_dated CHECK (validity NOT IN ('IN_FORCE', 'NOT_YET_IN_FORCE') OR (effective_from IS NOT NULL AND validity_checked_on IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE dajc_kb.pages (
  version_id uuid NOT NULL REFERENCES dajc_kb.document_versions(id),
  page_no integer NOT NULL CHECK (page_no >= 1),
  text text NOT NULL,
  PRIMARY KEY (version_id, page_no)
);
--> statement-breakpoint
CREATE TABLE dajc_kb.provisions (
  id bigserial PRIMARY KEY,
  version_id uuid NOT NULL REFERENCES dajc_kb.document_versions(id),
  ordinal integer NOT NULL,
  anchor_type text NOT NULL CHECK (anchor_type IN ('ARTICLE', 'SECTION', 'ANNEX', 'PREAMBLE', 'OTHER')),
  anchor_label text NOT NULL,
  anchor_number text,
  heading text,
  page_from integer NOT NULL CHECK (page_from >= 1),
  page_to integer NOT NULL,
  text text NOT NULL,
  ts_config regconfig NOT NULL,
  topics text[] NOT NULL DEFAULT '{}',
  mass_mentions numeric[] NOT NULL DEFAULT '{}',
  mass_min_t numeric,
  mass_min_inclusive boolean,
  mass_max_t numeric,
  mass_max_inclusive boolean,
  mass_basis text CHECK (mass_basis IS NULL OR mass_basis IN ('MAM', 'ACTUAL', 'COMBINATION_MAM')),
  mass_reviewed_by text,
  tsv tsvector GENERATED ALWAYS AS (to_tsvector(ts_config, coalesce(anchor_label, '') || ' ' || coalesce(heading, '') || ' ' || text)) STORED,
  CONSTRAINT provisions_ordinal_unique UNIQUE (version_id, ordinal),
  CONSTRAINT provisions_pages CHECK (page_to >= page_from),
  CONSTRAINT provisions_mass_reviewed CHECK ((mass_min_t IS NULL AND mass_max_t IS NULL) OR mass_reviewed_by IS NOT NULL)
);
--> statement-breakpoint
CREATE INDEX provisions_tsv_idx ON dajc_kb.provisions USING gin (tsv);
--> statement-breakpoint
CREATE INDEX provisions_version_idx ON dajc_kb.provisions (version_id);
--> statement-breakpoint
CREATE INDEX versions_document_idx ON dajc_kb.document_versions (document_id);
--> statement-breakpoint
CREATE TABLE dajc_kb.review_log (
  id bigserial PRIMARY KEY,
  version_id uuid NOT NULL REFERENCES dajc_kb.document_versions(id),
  action text NOT NULL,
  decision text NOT NULL,
  reviewer text NOT NULL,
  note text,
  at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE dajc_kb.ocr_queue (
  version_id uuid PRIMARY KEY REFERENCES dajc_kb.document_versions(id),
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'WAITING_APPROVAL' CHECK (status IN ('WAITING_APPROVAL', 'APPROVED', 'DONE', 'REJECTED')),
  queued_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE VIEW dajc_kb.answerable_provisions WITH (security_barrier = true) AS
SELECT p.id, p.version_id, p.anchor_type, p.anchor_label, p.anchor_number, p.heading, p.page_from, p.page_to, p.text, p.tsv, p.ts_config,
       p.topics AS provision_topics, p.mass_mentions, p.mass_min_t, p.mass_min_inclusive, p.mass_max_t, p.mass_max_inclusive, p.mass_basis,
       v.language, v.official_url, v.sha256, v.version_label, v.authenticity, v.issued_on, v.effective_from, v.effective_to, v.validity,
       v.validity_checked_on, v.provenance, v.verified_by, v.last_verified_at, v.reuse_status,
       d.jurisdiction, d.official_number, d.title, d.legal_category, d.issuing_body, d.topics AS document_topics, d.source_id
FROM dajc_kb.provisions p
JOIN dajc_kb.document_versions v ON v.id = p.version_id
JOIN dajc_kb.documents d ON d.id = v.document_id
WHERE v.provenance IN ('AUTO_CHECKED', 'HUMAN_VERIFIED')
  AND v.text_extraction IN ('TEXT', 'OCR_APPROVED')
  AND v.validity IN ('IN_FORCE', 'NOT_YET_IN_FORCE')
  AND v.reuse_status <> 'RESTRICTED';
--> statement-breakpoint
REVOKE ALL ON SCHEMA dajc_kb FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON ALL TABLES IN SCHEMA dajc_kb FROM PUBLIC;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dajc_kb_importer') THEN
    CREATE ROLE dajc_kb_importer NOLOGIN NOINHERIT;
  END IF;
END
$$;
--> statement-breakpoint
GRANT USAGE ON SCHEMA dajc_kb TO dajc_kb_importer;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON dajc_kb.sources, dajc_kb.documents, dajc_kb.document_versions, dajc_kb.pages, dajc_kb.provisions, dajc_kb.ocr_queue TO dajc_kb_importer;
--> statement-breakpoint
GRANT SELECT, INSERT ON dajc_kb.review_log TO dajc_kb_importer;
--> statement-breakpoint
GRANT USAGE ON SEQUENCE dajc_kb.provisions_id_seq, dajc_kb.review_log_id_seq TO dajc_kb_importer;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION dajc_kb.ts_config(text) TO dajc_kb_importer;
--> statement-breakpoint
DO $$
BEGIN
  -- DAJC AI reads only the answerable view (role created by drizzle-ask/0001).
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dajc_ask_app') THEN
    GRANT USAGE ON SCHEMA dajc_kb TO dajc_ask_app;
    GRANT SELECT ON dajc_kb.answerable_provisions TO dajc_ask_app;
    GRANT EXECUTE ON FUNCTION dajc_kb.ts_config(text) TO dajc_ask_app;
  END IF;
END
$$;
