-- Purpose-specific double opt-in on the existing DAJC Neon research infrastructure.
-- Apply on an isolated preview branch first; never on Platform/TAR/AI product DBs.
-- Grant the runtime role only SELECT/INSERT/UPDATE/DELETE on these two tables.
CREATE TABLE IF NOT EXISTS public.updates_subscriptions (
  id uuid PRIMARY KEY,
  email text NOT NULL CHECK (email = lower(email) AND char_length(email) BETWEEN 3 AND 254),
  purpose text NOT NULL CHECK (purpose IN ('launch', 'newsletter')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active')),
  verification_hash text CHECK (verification_hash IS NULL OR length(verification_hash) = 64),
  unsubscribe_hash text NOT NULL CHECK (length(unsubscribe_hash) = 64),
  verification_expires_at timestamptz,
  last_verification_sent_at timestamptz,
  confirmed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(email, purpose)
);
CREATE UNIQUE INDEX IF NOT EXISTS updates_verification_hash_idx
  ON public.updates_subscriptions(verification_hash) WHERE verification_hash IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS updates_unsubscribe_hash_idx
  ON public.updates_subscriptions(unsubscribe_hash);
CREATE INDEX IF NOT EXISTS updates_active_purpose_idx
  ON public.updates_subscriptions(purpose, confirmed_at DESC) WHERE status = 'active';

-- Server-side, distributed anti-abuse buckets; HMAC keyed IP/email (no raw IP).
CREATE TABLE IF NOT EXISTS public.updates_rate_limits (
  actor_hash text NOT NULL CHECK (length(actor_hash) = 64),
  window_start timestamptz NOT NULL,
  attempts integer NOT NULL CHECK (attempts > 0),
  PRIMARY KEY (actor_hash, window_start)
);
