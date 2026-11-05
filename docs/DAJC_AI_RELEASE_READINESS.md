# DAJC AI — release readiness report (2026-11-05)

Branch `claude/blissful-cori-vo1iyy` (PR #102, stacked on #101 → #98 → main).
All customer features are **off** by default; all release constants are
`false` (`DAJC_AI_PAID_RELEASED`, `DAJC_AI_LIVE_PAYMENTS_RELEASED`,
`DAJC_ACCOUNTING_LIVE_RELEASED`, `DAJC_AI_SHARED_LEARNING_POLICY_APPROVED`).

Legend — **COMPLETE**: implemented, integrated and verified by CI and a real
local run, no external service needed for it to work. **TESTED**: verified only
in isolation (simulators, sandbox, fake provider APIs); the real service is not
verified. **BLOCKED**: needs an external account, contract or owner decision.
**NOT IMPLEMENTED**: missing.

## Features

| Area | State | Evidence / what is missing |
| --- | --- | --- |
| Ask DAJC · FAQ entry (one entry point; FAQ works with AI off) | COMPLETE | `guide-entry.test.ts`; `/api/guide/ready` |
| Account: sign-in session, consents, encrypted history and memory, error reports, export, deletion | COMPLETE | unit + Postgres + `e2e-lifecycle` + browser E2E (cs/en, desktop/mobile) |
| Data protection in the database (RLS per user, least privilege, append-only audit, four eyes) | COMPLETE | `verify.sql` (67 checks) and `paid-store` on Postgres 16 in CI |
| Paid Driving Bans tools (same registry, verified periods, vehicle applicability fail-closed) | COMPLETE | browser E2E against the real published registry |
| Permit comparison (deterministic, never a legal verdict); safe PDF intake | COMPLETE | `paid-features.test.ts` |
| Fair use, per-user AI cost cap, global budget, refunds of system errors | COMPLETE | `paid-features`, `service` tests |
| Controlled learning workflow (reviewer RBAC, four eyes, expiry, revoke, cited use) | COMPLETE (operation needs reviewers) | `paid-features`; DB constraint |
| Free Ask DAJC AI answers (verified sources, independent check) | TESTED | fake providers; real AI keys for Ask not configured |
| Multi-vendor routing on the existing orchestrator (OpenAI, Anthropic, Gemini, xAI, Mistral, Perplexity) | TESTED | `orchestrated.test.ts` with provider-shaped fake APIs, incl. the Anthropic credit refusal seen in the 2026-10-29 live checks |
| AI permit extraction (consented) | TESTED | fake provider; quality on real permits unknown |
| Billing lifecycle (checkout → verified settlement → renewal → cancel → refund → dispute) | TESTED | sandbox provider: unit, Postgres E2E, browser E2E |
| Stripe adapter | TESTED | synthetic signed events only |
| Revolut Merchant adapter incl. merchant-initiated renewals | TESTED | request shapes from the Merchant API reference, fake server |
| GP webpay (Česká spořitelna) | TESTED (checkout/return) / BLOCKED (renewal, refund) | RSA signatures with generated keys; WS API needs the merchant contract |
| ABRA Flexi connector and outbox (invoice, payment pairing, fee, credit note, report) | TESTED | simulated ABRA only |
| VAT / OSS | BLOCKED | rates must be confirmed by the accountant (`DAJC_VAT_RATES_*`) |
| Database runbook (backup, restore, verify, guarded rollback) | TESTED | rehearsed in CI and locally; not on Supabase |
| Shared learning from customer content | BLOCKED | legal policy not approved (constant `false`) |
| Microsoft / Azure AI | NOT IMPLEMENTED | no adapter, keys or contract; Azure OpenAI would add no vendor independence |
| Licensed routing / live road restrictions | NOT IMPLEMENTED (interface only) | `NO_ROUTING` states it to users; no data contract |
| Czech wording of shared Driving Bans warnings | NOT IMPLEMENTED | warnings come from the shared contract in English |
| zod 4 migration | NOT IMPLEMENTED | advisory not reachable today (guarded); separate change |

## Readiness by dimension

| Dimension | Verdict | Why |
| --- | --- | --- |
| Technical | **TECHNICALLY READY for a staging dry run** | CI green (unit, typecheck, build, bundle scan, Postgres integration, runbook rehearsal); browser E2E 36/36 |
| Security | No known critical issue | per-user RLS, CSRF/Origin, signed webhooks, encrypted personal data, no secrets in the client bundle, 13 → 5 dependency advisories, none production-reachable (`SECURITY_DEPENDENCIES.md`) |
| Legal | NOT READY | operator entity, terms, privacy notice, refund policy, shared-learning policy need approval |
| Payments | NOT READY | no merchant contract or provider test account verified |
| Accounting | NOT READY | no ABRA test company; VAT/OSS rates unconfirmed; no legal entity to issue documents |
| Infrastructure | BLOCKED | Supabase HaulBoard projects not reachable in this session; Vercel team scope not authorised |

**Overall: NOT READY for production. TECHNICALLY READY for a staging dry run**
once a staging database and preview environment are available.

## Local / staging dry run (sandbox, no money)

Preview deployment or `astro dev` with: Ask variables, `DAJC_AI_ACCOUNT_ENABLED=true`,
`DAJC_AI_PAID_ENABLED=true`, `DAJC_AI_DRIVING_BANS_ENABLED=true`,
`VERCEL_ENV=preview`, `DAJC_AI_STAGING_SANDBOX=true`,
`DAJC_AI_PAYMENT_PROVIDER=sandbox`, `DAJC_AI_PAYMENT_MODE=sandbox`,
`DAJC_AI_SANDBOX_WEBHOOK_SECRET=<32+ chars>`, `DAJC_AI_DATA_KEYS=k1:<base64 32 bytes>`.
Browser run: `scripts/dajc-ai-e2e/browser-e2e.mjs` (with
`NODE_OPTIONS=--require ./scripts/dajc-ai-e2e/offline-ai.cjs` for the server
so no AI or payment host is contacted).

## Rollback

1. Flags off (`DAJC_AI_PAID_ENABLED`, `DAJC_AI_ACCOUNT_ENABLED`,
   `DAJC_ASK_ENABLED` = `false`): routes answer 404 immediately, the FAQ stays.
2. Revert the deployment in Vercel; database tables are inert.
3. Only on the owner's decision: `scripts/dajc-ai-db/rollback-0003-0002.sql`
   after a backup (see `DAJC_AI_DATABASE_RUNBOOK.md`).

## Owner decisions needed

1. Confirm the narrowed lint boundary that lets `src/lib/ask/orchestrated.ts`
   (only) use the shared orchestrator, and whether to switch Ask to
   `DAJC_ASK_AI_ROUTING=orchestrator` (separate `DAJC_ASK_*` keys required).
2. Supabase: which existing project is staging, and restore it if paused.
3. Vercel: authorise the HaulBoard team for the connector (preview env only).
4. Payment provider choice and test accounts; ABRA test company; accountant's
   VAT/OSS confirmation; legal operator and texts.
