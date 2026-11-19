-- Access control for the dajc_ask schema, following the master plan's
-- Supabase / Data API explicit-grant standard. Deny by default:
--   * the schema is NOT to be added to the Supabase Data API exposed
--     schemas (Settings > API); PUBLIC, anon and authenticated get nothing;
--   * RLS is enabled on every table; the only policies are for the
--     application role dajc_ask_app, which owns nothing and has DML only;
--   * the application can write measurements but cannot read them back.
-- The role is created WITHOUT a password (NOLOGIN). The owner enables it
-- outside the repository and puts the result into DAJC_ASK_DB_URL:
--   ALTER ROLE dajc_ask_app WITH LOGIN PASSWORD '<generated secret>';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dajc_ask_app') THEN
    CREATE ROLE dajc_ask_app NOLOGIN NOINHERIT;
  END IF;
END
$$;
--> statement-breakpoint
REVOKE ALL ON SCHEMA dajc_ask FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON ALL TABLES IN SCHEMA dajc_ask FROM PUBLIC;
--> statement-breakpoint
DO $$
DECLARE
  api_role text;
BEGIN
  FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = api_role) THEN
      EXECUTE format('REVOKE ALL ON SCHEMA dajc_ask FROM %I', api_role);
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA dajc_ask FROM %I', api_role);
      EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA dajc_ask FROM %I', api_role);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA dajc_ask REVOKE ALL ON TABLES FROM %I', api_role);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA dajc_ask REVOKE ALL ON SEQUENCES FROM %I', api_role);
    END IF;
  END LOOP;
END
$$;
--> statement-breakpoint
GRANT USAGE ON SCHEMA dajc_ask TO dajc_ask_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON dajc_ask.users, dajc_ask.login_tokens, dajc_ask.sessions, dajc_ask.daily_usage, dajc_ask.budget, dajc_ask.rate_events TO dajc_ask_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON dajc_ask.review_queue TO dajc_ask_app;
--> statement-breakpoint
GRANT INSERT ON dajc_ask.metrics TO dajc_ask_app;
--> statement-breakpoint
GRANT USAGE ON SEQUENCE dajc_ask.metrics_id_seq, dajc_ask.rate_events_id_seq TO dajc_ask_app;
--> statement-breakpoint
ALTER TABLE dajc_ask.users ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE dajc_ask.login_tokens ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE dajc_ask.sessions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE dajc_ask.daily_usage ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE dajc_ask.budget ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE dajc_ask.rate_events ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE dajc_ask.review_queue ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE dajc_ask.metrics ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY dajc_ask_app_rw ON dajc_ask.users FOR ALL TO dajc_ask_app USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY dajc_ask_app_rw ON dajc_ask.login_tokens FOR ALL TO dajc_ask_app USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY dajc_ask_app_rw ON dajc_ask.sessions FOR ALL TO dajc_ask_app USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY dajc_ask_app_rw ON dajc_ask.daily_usage FOR ALL TO dajc_ask_app USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY dajc_ask_app_rw ON dajc_ask.budget FOR ALL TO dajc_ask_app USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY dajc_ask_app_rw ON dajc_ask.rate_events FOR ALL TO dajc_ask_app USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY dajc_ask_app_rw ON dajc_ask.review_queue FOR ALL TO dajc_ask_app USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY dajc_ask_app_insert ON dajc_ask.metrics FOR INSERT TO dajc_ask_app WITH CHECK (true);
