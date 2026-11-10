-- DAJC integration-document requests: isolated from market research responses.
-- Apply to dajc_research in the dedicated Neon project dajc-market-research,
-- on both production and preview branches. A scoped dajc_integrations_api
-- role should access only the integration_docs schema.
CREATE SCHEMA IF NOT EXISTS integration_docs;

CREATE TABLE IF NOT EXISTS integration_docs.requests (
  id uuid PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  product text NOT NULL CHECK (product IN ('platform','tar')),
  company text NOT NULL CHECK (length(company) BETWEEN 2 AND 160),
  email text NOT NULL CHECK (length(email) BETWEEN 5 AND 254),
  integration_area text NOT NULL CHECK (integration_area IN
    ('tms-erp','routing-permits','telematics','documents','assistance','dispatch','other')),
  privacy_acknowledged_at timestamptz NOT NULL DEFAULT now(),
  verification_token_hash text NOT NULL UNIQUE CHECK (length(verification_token_hash)=64),
  verification_expires_at timestamptz NOT NULL,
  verification_email_sent_at timestamptz,
  verified_at timestamptz,
  download_token_hash text UNIQUE,
  download_expires_at timestamptz,
  download_email_sent_at timestamptz,
  download_count integer NOT NULL DEFAULT 0,
  CONSTRAINT access_after_verification CHECK
    (download_token_hash IS NULL OR verified_at IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS integration_docs_requests_report_idx
  ON integration_docs.requests(product,created_at DESC);

CREATE TABLE IF NOT EXISTS integration_docs.rate_limits (
  visitor_hash text NOT NULL CHECK(length(visitor_hash)=64),
  window_start timestamptz NOT NULL,
  attempts integer NOT NULL CHECK(attempts >= 1),
  PRIMARY KEY (visitor_hash,window_start)
);
