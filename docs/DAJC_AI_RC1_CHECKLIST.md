# DAJC AI — RC1 checklist (release candidate for a staging dry run)

RC1 is a tagged commit that has passed the staging dry run below. It is not a
production release: all customer features stay off and every release constant
stays `false`. PR #102 stays a draft until the owner decides otherwise.

State on 2026-11-05: everything that can be done without the staging database
is done; the dry run waits for the Supabase organisation's unpaid invoices.

## A. Ready (no external dependency)

- [x] CI green on Postgres 16 and 17 (store, paid store, end-to-end lifecycle, `verify.sql`, runbook rehearsal)
- [x] Unit/integration suite, `astro check`, build, client-bundle secret scan, Driving Bans and geographic lints
- [x] Browser E2E 38/38 (cs/en × desktop/mobile) against the local runtime with sandbox payments
- [x] Deny by default verified on a real Vercel preview (DAJC AI routes 404, FAQ served)
- [x] CSRF: Astro's same-origin rule site-wide (parity test), one exception for the signed GP webpay return POST
- [x] Maintenance bearer stored only as SHA-256; first preview bearer rotated; nothing logs it
- [x] Bounded request-body reading (JSON, webhooks, GP return)
- [x] Monitoring (`health`, `preflight`) and recovery (`requeue`)
- [x] Staging database dry run scripted and rehearsed on Postgres 17 (`scripts/dajc-ai-db/staging-dry-run.sh`)
- [x] Dependencies: 5 known advisories, none reachable in production (`docs/SECURITY_DEPENDENCIES.md`); no upstream fix yet for the build-time `glob`/`minimatch` chain

## B. Staging dry run (blocked: Supabase invoices)

1. Owner settles the HaulBoard organisation's Supabase invoices.
2. Restore `dajc-staging-e2e` (`lryufeoawdlcpydzuhej`, Free plan, no cost within 90 days of the pause).
3. `scripts/dajc-ai-db/staging-dry-run.sh` with `RUN_TESTS=1` (see the database runbook).
4. Vercel Preview variables for branch `claude/blissful-cori-vo1iyy` only:
   `DAJC_ASK_DB_URL` (from the 0600 file), `DAJC_AI_DATA_KEYS`,
   `DAJC_AI_ACCOUNT_ENABLED`, `DAJC_AI_PAID_ENABLED`, `DAJC_AI_DRIVING_BANS_ENABLED`,
   `DAJC_AI_STAGING_SANDBOX=true`, `DAJC_AI_PAYMENT_PROVIDER=sandbox`,
   `DAJC_AI_PAYMENT_MODE=sandbox`, `DAJC_AI_SANDBOX_WEBHOOK_SECRET`, the free Ask
   settings; `DAJC_AI_MAINTENANCE_SECRET_SHA256` is already set.
   Without real Ask AI keys the Ask runtime stays off: the owner decides
   whether to provide Ask keys (≥ 2 vendors for the orchestrator) and a budget.
5. `GET /api/ask/maintenance/preflight` → nothing missing for the sandbox run.
6. Browser E2E against the preview, then `GET /api/ask/maintenance/health`
   (expected: `OUTBOX_STALE` without an ABRA test company, nothing critical).
7. Tag RC1 on that commit; record the evidence in `DAJC_AI_RELEASE_READINESS.md`.

## C. After RC1 (owner decisions, not part of RC1)

- Payment provider test accounts (GP webpay incl. WS contract for renewals and refunds; Revolut; Stripe) and real event shapes
- ABRA test company; accountant-confirmed VAT/OSS rates
- Legal operator, terms, privacy notice, refund and shared-learning policies
- Removal of the two preview deployments that still carry the rotated bearer (`dpl_4D1hcYswWH7aFpLAyjKkrt4YwAPN`, `dpl_496j3g5rN2Tf4Tcr7WKX4M6FATXt`) and of the rotated `DAJC_AI_MAINTENANCE_SECRET` Preview variable
- zod 4 migration (separate change)
