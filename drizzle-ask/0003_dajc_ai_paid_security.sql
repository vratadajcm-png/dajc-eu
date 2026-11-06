-- Paid DAJC AI: access control, row-level isolation and integrity rules
-- for the tables added in 0002. Additive only: no existing table, column
-- or row is changed or removed. Same deny-by-default standard as 0001:
-- PUBLIC, anon and authenticated get nothing; dajc_ask_app gets only the
-- operations listed below.
--
-- Per-user isolation (defence in depth). Every personal table carries a
-- policy that matches rows only for the user named in the transaction
-- setting dajc_ask.user_id, which the store sets with set_config(..., true)
-- before touching personal data. A query that forgets "WHERE user_id = ..."
-- therefore still sees only the signed-in user's rows. Maintenance work
-- that must span users (retention purge, account deletion) runs in a
-- transaction with dajc_ask.scope = 'system'; the application never takes
-- either setting from a request.
REVOKE ALL ON ALL TABLES IN SCHEMA dajc_ask FROM PUBLIC;
--> statement-breakpoint
DO $$
DECLARE
  api_role text;
BEGIN
  FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = api_role) THEN
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA dajc_ask FROM %I', api_role);
      EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA dajc_ask FROM %I', api_role);
    END IF;
  END LOOP;
END
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION dajc_ask.current_user_id() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('dajc_ask.user_id', true), '')::uuid $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION dajc_ask.is_system_scope() RETURNS boolean
  LANGUAGE sql STABLE
  AS $$ SELECT coalesce(current_setting('dajc_ask.scope', true), '') = 'system' $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION dajc_ask.current_user_id() FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION dajc_ask.is_system_scope() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION dajc_ask.current_user_id(), dajc_ask.is_system_scope() TO dajc_ask_app;
--> statement-breakpoint
-- Personal data: full DML, isolated per user.
GRANT SELECT, INSERT, UPDATE, DELETE ON dajc_ask.consents, dajc_ask.history, dajc_ask.memory_items, dajc_ask.paid_usage, dajc_ask.user_cost TO dajc_ask_app;
--> statement-breakpoint
GRANT USAGE ON SEQUENCE dajc_ask.consents_id_seq TO dajc_ask_app;
--> statement-breakpoint
-- Feedback: a user may file it; reviewers read it through the system scope.
GRANT SELECT, INSERT, UPDATE, DELETE ON dajc_ask.feedback TO dajc_ask_app;
--> statement-breakpoint
-- Business records: no DELETE (retention); checkouts may be purged when expired.
GRANT SELECT, INSERT, UPDATE ON dajc_ask.billing_customers, dajc_ask.subscriptions, dajc_ask.payment_events, dajc_ask.refund_requests, dajc_ask.accounting_outbox, dajc_ask.knowledge_entries TO dajc_ask_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON dajc_ask.billing_checkouts, dajc_ask.answer_cache TO dajc_ask_app;
--> statement-breakpoint
GRANT USAGE ON SEQUENCE dajc_ask.accounting_outbox_id_seq TO dajc_ask_app;
--> statement-breakpoint
-- Audit trail: append and read only. No UPDATE, no DELETE, no TRUNCATE.
GRANT SELECT, INSERT ON dajc_ask.audit_log TO dajc_ask_app;
--> statement-breakpoint
GRANT USAGE ON SEQUENCE dajc_ask.audit_log_id_seq TO dajc_ask_app;
--> statement-breakpoint
-- Reviewer roles: read only for the application; granted by the owner.
GRANT SELECT ON dajc_ask.reviewers TO dajc_ask_app;
--> statement-breakpoint
ALTER TABLE dajc_ask.consents ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE dajc_ask.history ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE dajc_ask.memory_items ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE dajc_ask.paid_usage ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE dajc_ask.user_cost ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE dajc_ask.feedback ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE dajc_ask.billing_checkouts ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE dajc_ask.billing_customers ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE dajc_ask.subscriptions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE dajc_ask.payment_events ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE dajc_ask.refund_requests ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE dajc_ask.audit_log ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE dajc_ask.accounting_outbox ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE dajc_ask.answer_cache ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE dajc_ask.knowledge_entries ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE dajc_ask.reviewers ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY dajc_ask_owner ON dajc_ask.consents FOR ALL TO dajc_ask_app
  USING (user_id = dajc_ask.current_user_id() OR dajc_ask.is_system_scope())
  WITH CHECK (user_id = dajc_ask.current_user_id() OR dajc_ask.is_system_scope());
--> statement-breakpoint
CREATE POLICY dajc_ask_owner ON dajc_ask.history FOR ALL TO dajc_ask_app
  USING (user_id = dajc_ask.current_user_id() OR dajc_ask.is_system_scope())
  WITH CHECK (user_id = dajc_ask.current_user_id() OR dajc_ask.is_system_scope());
--> statement-breakpoint
CREATE POLICY dajc_ask_owner ON dajc_ask.memory_items FOR ALL TO dajc_ask_app
  USING (user_id = dajc_ask.current_user_id() OR dajc_ask.is_system_scope())
  WITH CHECK (user_id = dajc_ask.current_user_id() OR dajc_ask.is_system_scope());
--> statement-breakpoint
CREATE POLICY dajc_ask_owner ON dajc_ask.paid_usage FOR ALL TO dajc_ask_app
  USING (user_id = dajc_ask.current_user_id() OR dajc_ask.is_system_scope())
  WITH CHECK (user_id = dajc_ask.current_user_id() OR dajc_ask.is_system_scope());
--> statement-breakpoint
CREATE POLICY dajc_ask_owner ON dajc_ask.user_cost FOR ALL TO dajc_ask_app
  USING (user_id = dajc_ask.current_user_id() OR dajc_ask.is_system_scope())
  WITH CHECK (user_id = dajc_ask.current_user_id() OR dajc_ask.is_system_scope());
--> statement-breakpoint
-- A user can file feedback for themselves and read their own; review and
-- retention run in the system scope.
CREATE POLICY dajc_ask_owner ON dajc_ask.feedback FOR ALL TO dajc_ask_app
  USING (user_id = dajc_ask.current_user_id() OR dajc_ask.is_system_scope())
  WITH CHECK (user_id = dajc_ask.current_user_id() OR dajc_ask.is_system_scope());
--> statement-breakpoint
CREATE POLICY dajc_ask_app_rw ON dajc_ask.billing_checkouts FOR ALL TO dajc_ask_app USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY dajc_ask_app_rw ON dajc_ask.billing_customers FOR ALL TO dajc_ask_app USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY dajc_ask_app_rw ON dajc_ask.subscriptions FOR ALL TO dajc_ask_app USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY dajc_ask_app_rw ON dajc_ask.payment_events FOR ALL TO dajc_ask_app USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY dajc_ask_app_rw ON dajc_ask.refund_requests FOR ALL TO dajc_ask_app USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY dajc_ask_app_read ON dajc_ask.audit_log FOR SELECT TO dajc_ask_app USING (true);
--> statement-breakpoint
CREATE POLICY dajc_ask_app_append ON dajc_ask.audit_log FOR INSERT TO dajc_ask_app WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY dajc_ask_app_rw ON dajc_ask.accounting_outbox FOR ALL TO dajc_ask_app USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY dajc_ask_app_rw ON dajc_ask.answer_cache FOR ALL TO dajc_ask_app USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY dajc_ask_app_rw ON dajc_ask.knowledge_entries FOR ALL TO dajc_ask_app USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY dajc_ask_app_read ON dajc_ask.reviewers FOR SELECT TO dajc_ask_app USING (true);
--> statement-breakpoint
-- Integrity rules the application also enforces; the database is the last line.
ALTER TABLE dajc_ask.consents ADD CONSTRAINT consents_purpose_check CHECK (purpose IN ('HISTORY', 'MEMORY', 'AI_PERSONAL_CONTEXT', 'DOCUMENT_ANALYSIS', 'SHARED_LEARNING'));
--> statement-breakpoint
ALTER TABLE dajc_ask.memory_items ADD CONSTRAINT memory_items_kind_check CHECK (kind IN ('VEHICLE', 'CARGO', 'ROUTE', 'PREFERENCE'));
--> statement-breakpoint
ALTER TABLE dajc_ask.feedback ADD CONSTRAINT feedback_category_check CHECK (category IN ('WRONG_FACT', 'OUTDATED', 'MISSING_SOURCE', 'UNCLEAR', 'OTHER'));
--> statement-breakpoint
ALTER TABLE dajc_ask.feedback ADD CONSTRAINT feedback_status_check CHECK (status IN ('NEW', 'TRIAGED', 'PROPOSED', 'CLOSED'));
--> statement-breakpoint
ALTER TABLE dajc_ask.billing_checkouts ADD CONSTRAINT billing_checkouts_status_check CHECK (status IN ('OPEN', 'COMPLETED', 'EXPIRED'));
--> statement-breakpoint
ALTER TABLE dajc_ask.billing_checkouts ADD CONSTRAINT billing_checkouts_amount_check CHECK (amount_cents = 1500 AND currency = 'EUR');
--> statement-breakpoint
ALTER TABLE dajc_ask.payment_events ADD CONSTRAINT payment_events_outcome_check CHECK (outcome IN ('APPLIED', 'IGNORED', 'REJECTED'));
--> statement-breakpoint
ALTER TABLE dajc_ask.refund_requests ADD CONSTRAINT refund_requests_status_check CHECK (status IN ('PENDING_REVIEW', 'APPROVED', 'EXECUTED', 'REJECTED', 'FAILED'));
--> statement-breakpoint
ALTER TABLE dajc_ask.accounting_outbox ADD CONSTRAINT accounting_outbox_status_check CHECK (status IN ('PENDING', 'SYNCED', 'DEAD'));
--> statement-breakpoint
ALTER TABLE dajc_ask.knowledge_entries ADD CONSTRAINT knowledge_entries_status_check CHECK (status IN ('PENDING', 'SOURCE_CHECKED', 'VERIFIED', 'APPROVED', 'REJECTED', 'REVOKED'));
--> statement-breakpoint
ALTER TABLE dajc_ask.knowledge_entries ADD CONSTRAINT knowledge_entries_not_driving_bans CHECK (topic <> 'driving_ban');
--> statement-breakpoint
ALTER TABLE dajc_ask.reviewers ADD CONSTRAINT reviewers_role_check CHECK (role IN ('KNOWLEDGE_REVIEWER', 'BILLING_REVIEWER'));
--> statement-breakpoint
-- Four eyes, enforced by the database as well: the source check and the
-- independent verification are done by two different reviewers, neither of
-- them the proposer, and the proposer never approves their own entry.
ALTER TABLE dajc_ask.knowledge_entries ADD CONSTRAINT knowledge_entries_four_eyes CHECK (
  (source_checked_by IS NULL OR source_checked_by <> proposed_by)
  AND (verified_by IS NULL OR (verified_by <> proposed_by AND verified_by IS DISTINCT FROM source_checked_by))
  AND (approved_by IS NULL OR approved_by <> proposed_by)
);
