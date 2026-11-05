# DAJC AI — release readiness report (2026-11-05, updated)

Branch `claude/blissful-cori-vo1iyy` (PR #102, stacked on #101 → #98 → main).
All customer features are **off** by default; all release constants are
`false` (`DAJC_AI_PAID_RELEASED`, `DAJC_AI_LIVE_PAYMENTS_RELEASED`,
`DAJC_ACCOUNTING_LIVE_RELEASED`, `DAJC_AI_SHARED_LEARNING_POLICY_APPROVED`,
`DAJC_ASK_ORCHESTRATOR_PRODUCTION_RELEASED`).

Legend — **COMPLETE**: implemented, integrated and verified by CI and a real
local run, no external service needed for it to work. **TESTED**: verified only
in isolation (simulators, sandbox, fake provider APIs); the real service is not
verified. **BLOCKED**: needs an external account, contract or owner decision.
**NOT IMPLEMENTED**: missing.

## Features

| Area | State | Evidence / what is missing |
| --- | --- | --- |
| Ask DAJC · FAQ entry (one entry point; FAQ works with AI off) | COMPLETE | `guide-entry.test.ts`; `/api/guide/ready` |
| Account: sign-in session, consents, encrypted history and memory, error reports, export, deletion | COMPLETE | unit + Postgres 16/17 + `e2e-lifecycle` + browser E2E 38/38 (cs/en, desktop/mobile) |
| Data protection in the database (RLS per user, least privilege, append-only audit, four eyes) | COMPLETE | `verify.sql` (67 checks; 115 with the Supabase roles) and `paid-store` on Postgres 16 and 17 in CI |
| Paid Driving Bans tools (same registry, verified periods, vehicle applicability fail-closed) | COMPLETE | browser E2E against the real published registry |
| Permit comparison (deterministic, never a legal verdict); safe PDF intake | COMPLETE | `paid-features.test.ts` |
| Fair use, per-user AI cost cap, global budget, refunds of system errors | COMPLETE | `paid-features`, `service` tests |
| Controlled learning workflow (reviewer RBAC, four eyes, expiry, revoke, cited use) | COMPLETE (operation needs reviewers) | `paid-features`; DB constraint |
| Monitoring and recovery (health alerts, preflight by name, dead-letter requeue, audit-chain check) | COMPLETE | `monitoring.test.ts`; `paid-store` contract on Postgres 16 and 17 |
| Free Ask DAJC AI answers (verified sources, independent check) | TESTED | fake providers; real AI keys for Ask not configured |
| Multi-vendor routing on the existing orchestrator (OpenAI, Anthropic, Gemini, xAI, Mistral, Perplexity) | TESTED; preview only | `orchestrated.test.ts` with provider-shaped fake APIs, incl. the Anthropic credit refusal seen in the 2026-10-29 live checks; negative boundary tests (only `src/lib/ask/orchestrated.ts` reaches `lib/ai`, research tasks/keys/data classes refused, verification always at another vendor, no e-mail/phone sent to providers); refused when `VERCEL_ENV=production`; needs both budgets |
| AI permit extraction (consented) | TESTED | fake provider; quality on real permits unknown |
| Billing lifecycle (checkout → verified settlement → renewal → cancel → refund → dispute) | TESTED | sandbox provider: unit, Postgres E2E, browser E2E |
| Stripe adapter | TESTED | synthetic signed events only |
| Revolut Merchant adapter incl. merchant-initiated renewals | TESTED | request shapes from the Merchant API reference, fake server |
| GP webpay (Česká spořitelna) | TESTED (checkout/return) / BLOCKED (renewal, refund) | RSA signatures with generated keys; WS API needs the merchant contract |
| ABRA Flexi connector and outbox (invoice, payment pairing, fee, credit note, report) | TESTED | simulated ABRA only |
| VAT / OSS | BLOCKED | rates must be confirmed by the accountant (`DAJC_VAT_RATES_*`) |
| Database runbook (backup, restore, verify, guarded rollback) | TESTED | rehearsed in CI on Postgres 16 and 17 and locally on 17.11 with Supabase-like roles; not on Supabase |
| Deny by default on a real Vercel preview (no DAJC AI variables set) | COMPLETE | preview of `dcf0343` (`dajc-kabe2w3fw-haul-board.vercel.app`, 2026-11-05): `/driving-bans` 200 with the "Ask DAJC · FAQ" entry, `/api/guide/ready` → `{"available":false}`, `/intelligence/ask` and every `/api/ask/{account,billing,billing/webhook,maintenance}/*` route tried → 404; security headers (CSP, HSTS, `X-Frame-Options: DENY`, `noindex`) present |
| Maintenance endpoints on a real Vercel preview | COMPLETE | redeploy of `58756a0` with only `DAJC_AI_MAINTENANCE_SECRET` (sensitive, Preview, branch `claude/blissful-cori-vo1iyy`): no or wrong bearer → 404; `preflight` → 200 naming every missing setting by name, without the secret's value; `health` / `run` without the runtime → 404; POST without a JSON content type → 403 from Astro's origin check (documented) |
| CSRF with GP webpay return by GET or POST | COMPLETE | Astro's same-origin rule kept site-wide in `src/lib/security/origin-check.ts` (parity test against Astro's implementation, > 2 000 combinations) with one exception: the RSA-signed GP return POST (exact path, url-encoded, ≤ 8 KB); verified in the running app (cross-site form POSTs elsewhere → 403) and by `gpwebpay-return.test.ts` (signed GET/POST settle once, forged/oversized/wrongly encoded → failed, other methods 405) |
| Maintenance bearer rotation | COMPLETE | deployments store only `DAJC_AI_MAINTENANCE_SECRET_SHA256`; the first preview bearer was rotated on 2026-11-05 and verified on the preview (old bearer → 404, hash as bearer → 404, new bearer → 200, no runtime log lines) |
| Staging E2E on `dajc-staging-e2e` with test payments | BLOCKED | Supabase refuses to restore the project: "This organization has unpaid invoices" (see below) |
| Shared learning from customer content | BLOCKED | legal policy not approved (constant `false`) |
| Microsoft / Azure AI | NOT IMPLEMENTED | no adapter, keys or contract; Azure OpenAI would add no vendor independence |
| Licensed routing / live road restrictions | NOT IMPLEMENTED (interface only) | `NO_ROUTING` states it to users; no data contract |
| Czech wording of the registry check (warnings, disclaimer, next step, vehicle applicability) | COMPLETE | fixed templates in `src/lib/ask/paid/registry-i18n.ts` (no AI); `registry-i18n.test.ts` fails when the shared contract gains a text without a template; browser E2E checks the notice language. Event titles and vehicle scope stay in the registry's source language |
| zod 4 migration | NOT IMPLEMENTED | advisory not reachable today (guarded); separate change |

## Readiness by dimension

| Dimension | Verdict | Why |
| --- | --- | --- |
| Technical | **TECHNICALLY READY for a staging dry run** | CI green (unit, typecheck, build, bundle scan, Postgres 16 + 17 integration, runbook rehearsal); browser E2E 38/38; monitoring and recovery in place |
| Security | No known critical issue | per-user RLS, CSRF/Origin, signed webhooks, encrypted personal data, no secrets in the client bundle, maintenance calls behind a constant-time bearer check, 13 → 5 dependency advisories, none production-reachable (`SECURITY_DEPENDENCIES.md`) |
| Legal | NOT READY | operator entity, terms, privacy notice, refund policy, shared-learning policy need approval |
| Payments | NOT READY | no merchant contract or provider test account verified |
| Accounting | NOT READY | no ABRA test company; VAT/OSS rates unconfirmed; no legal entity to issue documents |
| Infrastructure | BLOCKED | connectors now reach the HaulBoard Supabase organisation (Free plan) and the Vercel team `haul-board`; restoring `dajc-staging-e2e` is refused by Supabase because the organisation has unpaid invoices |

**Overall: NOT READY for production. TECHNICALLY READY for a staging dry run**
once the staging database and the preview environment are reachable.

## Remaining real blockers (owner actions)

1. **Supabase invoices** — access works (organisation HaulBoard, Free plan;
   `dajc-staging-e2e`, Postgres 17.6, eu-central-1, INACTIVE like the other
   three projects). `restore_project` answered on 2026-11-05: *"This
   organization has unpaid invoices. Settle outstanding payments before trying
   to restore project."* Settling them is the owner's decision (Supabase
   dashboard → Organization → Billing → Invoices). Restoring a Free project
   paused for inactivity is itself free, within 90 days of the pause. No other
   project was touched and no new project was created.
2. **Vercel** — resolved: the connector reaches the team `haul-board` and the
   project `dajc-eu`. Production is untouched. Preview (branch
   `claude/blissful-cori-vo1iyy` only) holds `DAJC_AI_MAINTENANCE_SECRET_SHA256`
   (a verifier, not the bearer) and the rotated, deliberately invalid
   `DAJC_AI_MAINTENANCE_SECRET` (safe to delete). The first preview bearer was
   rotated on 2026-11-05 because its value had passed through a tool call; it
   is not in the repository, its history, the build output or the session
   files, and the app never logs it. Two earlier preview deployments
   (`dpl_4D1hcYswWH7aFpLAyjKkrt4YwAPN`, `dpl_496j3g5rN2Tf4Tcr7WKX4M6FATXt`)
   still carry the old value baked in; they are behind Vercel Authentication
   (the share link was revoked) and expose only the names-only preflight. The
   owner can delete them in the Vercel dashboard (the connector cannot delete
   deployments). DAJC AI stays off in every environment.
3. **Ask keys for the preview orchestrator** — Ask's own keys of at least two
   vendors and a preview budget (`DAJC_ASK_MONTHLY_BUDGET_EUR`,
   `DAJC_ASK_DAILY_BUDGET_EUR`); without them the routing stays off.
4. Payment provider choice and test accounts (GP webpay WS contract for
   renewals and refunds); ABRA test company; accountant's VAT/OSS
   confirmation; legal operator and texts.

## Local / staging dry run (sandbox, no money)

Preview deployment or `astro dev` with: Ask variables, `DAJC_AI_ACCOUNT_ENABLED=true`,
`DAJC_AI_PAID_ENABLED=true`, `DAJC_AI_DRIVING_BANS_ENABLED=true`,
`VERCEL_ENV=preview`, `DAJC_AI_STAGING_SANDBOX=true`,
`DAJC_AI_PAYMENT_PROVIDER=sandbox`, `DAJC_AI_PAYMENT_MODE=sandbox`,
`DAJC_AI_SANDBOX_WEBHOOK_SECRET=<32+ chars>`, `DAJC_AI_DATA_KEYS=k1:<base64 32 bytes>`,
`DAJC_AI_MAINTENANCE_SECRET_SHA256=<sha256 of a 32+ char bearer>`.
Before the run: `GET /api/ask/maintenance/preflight` (names anything missing).
Browser run: `scripts/dajc-ai-e2e/browser-e2e.mjs` (with
`NODE_OPTIONS=--require ./scripts/dajc-ai-e2e/offline-ai.cjs` for the server
so no AI or payment host is contacted). After the run:
`GET /api/ask/maintenance/health` (expected: `OUTBOX_STALE` without an ABRA
test company, nothing critical).

## Rollback

1. Flags off (`DAJC_AI_PAID_ENABLED`, `DAJC_AI_ACCOUNT_ENABLED`,
   `DAJC_ASK_ENABLED` = `false`; `DAJC_ASK_AI_ROUTING` unset): routes answer
   404 or fall back to the direct routing immediately, the FAQ stays.
2. Revert the deployment in Vercel; database tables are inert.
3. Only on the owner's decision: `scripts/dajc-ai-db/rollback-0003-0002.sql`
   after a backup (see `DAJC_AI_DATABASE_RUNBOOK.md`).

## Owner decisions

Taken (2026-11-05): the narrow lint exception — only `src/lib/ask/orchestrated.ts`
may use the shared orchestrator (enforced by `scripts/lint-driving-bans.mjs`
and a static test); `DAJC_ASK_AI_ROUTING=orchestrator` may be tested in an
isolated preview only (enforced in `readAskConfig`); the staging database is
the existing `dajc-staging-e2e` (no new project).

Open: the four blockers above.
