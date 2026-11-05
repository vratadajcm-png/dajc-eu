# DAJC AI database runbook (Supabase / Postgres)

Scope: schema `dajc_ask` (free Ask DAJC AI, migrations `0000`–`0001`; paid DAJC
AI and account, `0002`–`0003`). Every step is rehearsed automatically in the
Application CI job `ask-postgres-integration` on throwaway Postgres **16 and
17** (matrix), with the Supabase API roles `anon`, `authenticated` and
`service_role` emulated (migrate → verify → store and end-to-end tests → backup
→ restore → verify → refused rollback → confirmed rollback → re-apply →
verify). The same sequence was also run locally on Postgres 17.11 with those
roles: `verify.sql` 115/115 PASS (67 checks without the Supabase roles).

Nothing here was run against a Supabase project. Staging target named by the
owner: **`dajc-staging-e2e`**, ref `lryufeoawdlcpydzuhej`, organisation
`etnqzdukabzlzfzxqzgw` (HaulBoard), eu-central-1, Postgres 17, last state
INACTIVE. After the owner reconnected the Supabase connector (2026-11-05) the
organisation is visible (Free plan, all four projects INACTIVE), but
`restore_project` is refused: "This organization has unpaid invoices. Settle
outstanding payments before trying to restore project." The steps below can
run only after the owner settles the invoices and the project is restored.

## 0. Choose the target (owner)

- Use an **existing staging project** (e.g. `dajc-staging-e2e`); never create a
  replacement production database and never apply first to production.
- A paused (INACTIVE) free project can be restored from the Supabase dashboard
  (Project → Restore). Restoring is free on the Free plan; upgrading the plan or
  enabling point-in-time recovery costs money and needs the owner's approval.
  Before restoring, read the project's pause reason and the organisation's plan
  in the dashboard (or `get_project` / `get_organization` once the connector
  can see HaulBoard): a project paused for inactivity on the Free plan restores
  at no cost; a project on a paid organisation is billed from the moment it
  runs again. Paused Free projects can only be restored for a limited time
  after pausing; after that only the backup download remains.
- Use the **direct connection** (port 5432) for `pg_dump`, `pg_restore` and
  migrations; the transaction pooler is for the application only.

## 1. Backup and proof of restorability (before any change)

```bash
export ADMIN_URL='postgres://postgres:<password>@db.<ref>.supabase.co:5432/postgres'   # never commit
pg_dump "$ADMIN_URL" --schema=dajc_ask -Fc -f dajc_ask-$(date +%F).dump
# Restore into a scratch database (local Postgres 16 is enough) and verify it:
createdb dajc_restore && pg_restore -d dajc_restore --exit-on-error dajc_ask-$(date +%F).dump
psql -d dajc_restore -v ON_ERROR_STOP=1 -f scripts/dajc-ai-db/verify.sql
```

Use `pg_dump`/`pg_restore` of the **same major version as the target server**
(or newer for dumping, but restore into a server at least as new as the client):
a newer client writes settings such as `transaction_timeout` that an older
server rejects. CI therefore runs both inside the Postgres service container of
the matrix version. For `dajc-staging-e2e` (Postgres 17) use client 17.

If `dajc_ask` does not exist yet, the backup is empty and step 2 creates it.
Keep the dump encrypted at rest; it contains e-mail fingerprints (HMAC), not
addresses.

## 2. Existing migrations

```bash
psql "$ADMIN_URL" -c "select * from drizzle.__drizzle_migrations_dajc_ask order by created_at"
```

Compare with `drizzle-ask/meta/_journal.json`. `0000`/`0001` must be present
before `0002`/`0003`. All four are additive; `0002`/`0003` change no existing
table or row.

## 3. Apply the DAJC AI migrations

```bash
DAJC_ASK_MIGRATION_DB_URL="$ADMIN_URL" npx drizzle-kit migrate --config drizzle.ask.config.ts
psql "$ADMIN_URL" -c "ALTER ROLE dajc_ask_app WITH LOGIN PASSWORD '<generated>'"   # once
```

Then put the `dajc_ask_app` connection string (pooler) into `DAJC_ASK_DB_URL`
of the **preview** environment only.

## 4. Verify grants, RLS, tenant isolation and audit

```bash
psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -f scripts/dajc-ai-db/verify.sql
```

Checks (all must PASS): RLS on every table; per-user policies on personal
tables; `dajc_ask_app` not superuser, no BYPASSRLS, owns nothing; audit log
append-only; reviewer roles read-only; billing records not deletable; metrics
write-only; `anon` / `authenticated` / PUBLIC have no access; four-eyes and
driving-bans exclusion constraints; exactly-once payment events.

Behavioural checks (isolation between users, four eyes, append-only audit,
exactly-once events) run with the real role in
`src/lib/ask/__tests__/paid-store.test.ts`; against staging:

```bash
DAJC_ASK_TEST_DB_URL='<dajc_ask_app connection to STAGING>' npx vitest run src/lib/ask/__tests__/paid-store.test.ts src/lib/ask/__tests__/store.test.ts
```

(They create synthetic rows prefixed `hmac-`, `evt_`, `kn_`; run them on
staging only.)

## 5. Four-eyes test of knowledge review

Grant two reviewer test accounts on staging, then repeat the workflow from
`paid-features.test.ts` ("controlled learning workflow"). The database refuses a
proposer checking or approving their own entry
(`knowledge_entries_four_eyes`).

## 6. Rollback

1. Turn the features off: `DAJC_AI_PAID_ENABLED=false`, `DAJC_AI_ACCOUNT_ENABLED=false`
   (routes answer 404 at once; the free Ask keeps working).
2. Code rollback: revert the deployment in Vercel; the tables are inert.
3. Only if the tables themselves must go (owner decision, destructive for paid
   DAJC AI data; export billing records first for tax retention):

```bash
pg_dump "$ADMIN_URL" --schema=dajc_ask -Fc -f before-rollback.dump
{ echo "SET dajc_ask.confirm_rollback = 'drop paid DAJC AI tables';"; cat scripts/dajc-ai-db/rollback-0003-0002.sql; } | psql "$ADMIN_URL" -v ON_ERROR_STOP=1
```

The script refuses to run without the confirmation setting, drops only the
`0002` tables and `0003` functions (free Ask tables stay), and removes the
matching drizzle bookkeeping rows so the migrations can be re-applied.
