-- ROLLBACK of drizzle-ask 0003 and 0002 (paid DAJC AI tables). DESTRUCTIVE for
-- the paid DAJC AI data only: it drops the tables added in 0002 with their
-- rows. 0000/0001 (free Ask DAJC AI) are not touched.
--
-- Owner decision only. Before running:
--   1. take a backup:  pg_dump "$ADMIN_URL" --schema=dajc_ask -Fc -f dajc_ask-<date>.dump
--   2. disable the features: DAJC_AI_PAID_ENABLED=false, DAJC_AI_ACCOUNT_ENABLED=false
--   3. confirm in the same session:  SET dajc_ask.confirm_rollback = 'drop paid DAJC AI tables';
-- Billing records may be subject to tax retention: export them first.
BEGIN;
DO $$
BEGIN
  IF coalesce(current_setting('dajc_ask.confirm_rollback', true), '') <> 'drop paid DAJC AI tables' THEN
    RAISE EXCEPTION 'refusing to roll back: SET dajc_ask.confirm_rollback = ''drop paid DAJC AI tables'' first';
  END IF;
END
$$;
DROP TABLE IF EXISTS dajc_ask.reviewers, dajc_ask.knowledge_entries, dajc_ask.answer_cache, dajc_ask.accounting_outbox,
  dajc_ask.audit_log, dajc_ask.refund_requests, dajc_ask.payment_events, dajc_ask.subscriptions, dajc_ask.billing_customers,
  dajc_ask.billing_checkouts, dajc_ask.user_cost, dajc_ask.paid_usage, dajc_ask.feedback, dajc_ask.memory_items,
  dajc_ask.history, dajc_ask.consents;
DROP FUNCTION IF EXISTS dajc_ask.current_user_id();
DROP FUNCTION IF EXISTS dajc_ask.is_system_scope();
-- drizzle-kit bookkeeping (when migrations were applied with drizzle-kit migrate).
DO $$
BEGIN
  IF to_regclass('drizzle.__drizzle_migrations_dajc_ask') IS NOT NULL THEN
    DELETE FROM drizzle.__drizzle_migrations_dajc_ask WHERE created_at >= 1793876944008;
  END IF;
END
$$;
COMMIT;
