-- DAJC market validation / separate from DAJC Platform, TAR and AI data.
-- Dedicated Neon project: dajc-market-research (region aws-eu-central-1).
-- Run only on its dajc_research database; never on product databases.
CREATE TABLE IF NOT EXISTS public.market_research_submissions (
  id uuid PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  product text NOT NULL CHECK (product IN ('platform','tar')),
  company text NOT NULL CHECK (char_length(company) BETWEEN 1 AND 160),
  country text NOT NULL CHECK (char_length(country) BETWEEN 1 AND 100),
  role text NOT NULL CHECK (role IN ('owner','dispatcher','driver','customer','other')),
  current_software text NOT NULL CHECK (char_length(current_software) BETWEEN 1 AND 300),
  biggest_problem text NOT NULL CHECK (char_length(biggest_problem) BETWEEN 1 AND 1500),
  most_useful text NOT NULL,
  usage_interest text NOT NULL CHECK (usage_interest IN ('yes','maybe','no')),
  payment_interest text NOT NULL DEFAULT 'maybe' CHECK (payment_interest IN ('yes','maybe','no')),
  suggestion text NOT NULL DEFAULT '',
  contact_email text,
  follow_up_allowed boolean NOT NULL DEFAULT false,
  privacy_acknowledged_at timestamptz NOT NULL DEFAULT now(),
  form_version text NOT NULL DEFAULT '2026-11-09-v1',
  CONSTRAINT market_research_contact_check CHECK
    (NOT follow_up_allowed OR (contact_email IS NOT NULL AND contact_email <> ''))
);
CREATE INDEX IF NOT EXISTS market_research_product_date_idx
  ON public.market_research_submissions(product, created_at DESC);
CREATE INDEX IF NOT EXISTS market_research_date_idx
  ON public.market_research_submissions(created_at DESC);

-- Pseudonymised, keyed network identifier; raw IP address is not stored.
-- Old rows are purged on accepted form submissions.
CREATE TABLE IF NOT EXISTS public.market_research_rate_limits (
  visitor_hash text NOT NULL CHECK (length(visitor_hash) = 64),
  window_start timestamptz NOT NULL,
  attempts integer NOT NULL CHECK (attempts > 0),
  PRIMARY KEY (visitor_hash, window_start)
);
