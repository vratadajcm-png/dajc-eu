-- Post-migration verification of the dajc_ask schema (migrations 0000-0003).
-- Read-only. Run with an administrative connection after applying migrations,
-- and against a restored backup:
--   psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -f scripts/dajc-ai-db/verify.sql
-- Prints one row per check and fails (non-zero exit) if any check fails.
\set QUIET on
CREATE TEMP TABLE dajc_verify (check_name text, ok boolean, detail text) ON COMMIT PRESERVE ROWS;

-- 1. Every table in dajc_ask has row-level security enabled.
INSERT INTO dajc_verify
SELECT 'rls enabled: ' || c.relname, c.relrowsecurity, CASE WHEN c.relrowsecurity THEN 'on' ELSE 'OFF' END
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'dajc_ask' AND c.relkind = 'r';

-- 2. Expected tables exist.
INSERT INTO dajc_verify
SELECT 'table exists: ' || t, to_regclass('dajc_ask.' || t) IS NOT NULL, coalesce(to_regclass('dajc_ask.' || t)::text, 'missing')
FROM unnest(ARRAY['users','login_tokens','sessions','daily_usage','budget','metrics','review_queue','rate_events',
  'consents','history','memory_items','feedback','paid_usage','user_cost','billing_checkouts','billing_customers',
  'subscriptions','payment_events','refund_requests','audit_log','accounting_outbox','answer_cache','knowledge_entries','reviewers']) AS t;

-- 3. Personal tables are isolated per user (policy uses dajc_ask.current_user_id()).
INSERT INTO dajc_verify
SELECT 'per-user policy: ' || t,
  EXISTS (SELECT 1 FROM pg_policies p WHERE p.schemaname = 'dajc_ask' AND p.tablename = t AND p.qual LIKE '%current_user_id()%' AND p.with_check LIKE '%current_user_id()%'),
  'USING and WITH CHECK bound to dajc_ask.current_user_id()'
FROM unnest(ARRAY['consents','history','memory_items','paid_usage','user_cost','feedback']) AS t;

-- 4. Least privilege of the application role.
INSERT INTO dajc_verify VALUES
  ('app role exists', EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dajc_ask_app'), 'dajc_ask_app'),
  ('app role is not superuser / bypassrls', NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dajc_ask_app' AND (rolsuper OR rolbypassrls)), 'no SUPERUSER, no BYPASSRLS'),
  ('app role owns nothing in dajc_ask', NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'dajc_ask' AND pg_get_userbyid(c.relowner) = 'dajc_ask_app'), 'owner bypasses RLS, so it must not own tables'),
  ('audit_log append-only', NOT has_table_privilege('dajc_ask_app', 'dajc_ask.audit_log', 'UPDATE') AND NOT has_table_privilege('dajc_ask_app', 'dajc_ask.audit_log', 'DELETE') AND NOT has_table_privilege('dajc_ask_app', 'dajc_ask.audit_log', 'TRUNCATE'), 'no UPDATE/DELETE/TRUNCATE'),
  ('reviewers read-only for app', NOT has_table_privilege('dajc_ask_app', 'dajc_ask.reviewers', 'INSERT') AND NOT has_table_privilege('dajc_ask_app', 'dajc_ask.reviewers', 'UPDATE') AND NOT has_table_privilege('dajc_ask_app', 'dajc_ask.reviewers', 'DELETE'), 'granted by the owner only'),
  ('billing records not deletable', NOT has_table_privilege('dajc_ask_app', 'dajc_ask.payment_events', 'DELETE') AND NOT has_table_privilege('dajc_ask_app', 'dajc_ask.subscriptions', 'DELETE') AND NOT has_table_privilege('dajc_ask_app', 'dajc_ask.refund_requests', 'DELETE') AND NOT has_table_privilege('dajc_ask_app', 'dajc_ask.accounting_outbox', 'DELETE'), 'retention'),
  ('metrics write-only for app', NOT has_table_privilege('dajc_ask_app', 'dajc_ask.metrics', 'SELECT'), 'content-free measurements cannot be read back');

-- 5. Supabase API roles have no access (only if those roles exist).
INSERT INTO dajc_verify
SELECT 'no access for ' || r.rolname || ' on ' || c.relname,
  NOT (has_table_privilege(r.rolname, c.oid, 'SELECT') OR has_table_privilege(r.rolname, c.oid, 'INSERT') OR has_table_privilege(r.rolname, c.oid, 'UPDATE') OR has_table_privilege(r.rolname, c.oid, 'DELETE')),
  'deny by default'
FROM pg_roles r CROSS JOIN pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE r.rolname IN ('anon', 'authenticated', 'public') AND n.nspname = 'dajc_ask' AND c.relkind = 'r';

-- 6. Integrity constraints.
INSERT INTO dajc_verify
SELECT 'constraint: ' || x, EXISTS (SELECT 1 FROM pg_constraint WHERE conname = x), 'present'
FROM unnest(ARRAY['knowledge_entries_four_eyes','knowledge_entries_not_driving_bans','billing_checkouts_amount_check','accounting_outbox_idem_key_unique','consents_purpose_check']) AS x;

-- 7. Exactly-once payment events: the primary key is (provider, event_id).
INSERT INTO dajc_verify
SELECT 'payment events unique per (provider, event_id)',
  EXISTS (SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid = i.indrelid JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'dajc_ask' AND c.relname = 'payment_events' AND i.indisprimary
      AND (SELECT array_agg(a.attname::text ORDER BY a.attname) FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attnum = ANY(i.indkey)) = ARRAY['event_id','provider']),
  'primary key';

SELECT check_name, CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END AS result, detail FROM dajc_verify ORDER BY ok, check_name;

DO $$
DECLARE failed int;
BEGIN
  SELECT count(*) INTO failed FROM dajc_verify WHERE NOT ok;
  IF failed > 0 THEN RAISE EXCEPTION 'dajc_ask verification failed: % check(s)', failed; END IF;
  RAISE NOTICE 'dajc_ask verification passed (% checks)', (SELECT count(*) FROM dajc_verify);
END
$$;
