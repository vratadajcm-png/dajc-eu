# DAJC AI — account, paid subscription, billing, accounting and learning

Status date: 2026-11-05. Scope: the code on branch `claude/blissful-cori-vo1iyy`
(built on PR #101 = #98 + #96 + #97 + #78 + #90 + #100 learning/throttling).
Everything described here is **off by default** and **not a release**.

Three states are kept apart on purpose:

- **IMPLEMENTED** – code exists.
- **TECHNICALLY READY** – integrated, automatically tested (unit, contract,
  Postgres, end-to-end through the route handlers, real-browser run).
- **PRODUCTION READY** – additionally real services verified, legal operator,
  approved terms, merchant contract, accounting licence and owner sign-off.

| Area | State | Evidence |
| --- | --- | --- |
| Ask DAJC · FAQ entry (single entry point, FAQ works with AI off) | TECHNICALLY READY | `guide-entry.test.ts`, `/api/guide/ready` |
| Free Ask DAJC AI (3 questions/day, budget caps, verified sources) | TECHNICALLY READY | `service/pipeline/handlers` tests |
| E-mail sign-in, sessions, logout, concurrency, isolation | TECHNICALLY READY | `handlers`, `store` (memory + Postgres), `e2e-lifecycle` |
| Account: consents, encrypted history & memory, error reports, export, deletion | TECHNICALLY READY | `paid-features`, `paid-store`, `e2e-lifecycle`, browser run |
| Paid questions: fair use, cost cap, registry tools, personal context only with consent | TECHNICALLY READY | `paid-features`, `e2e-lifecycle` |
| Permit comparison (deterministic) and PDF intake | TECHNICALLY READY | `paid-features` |
| Permit extraction by AI (consented) | IMPLEMENTED | contract tested with a fake provider only; real model output not evaluated |
| Billing lifecycle (checkout → settle → renew → cancel → refund → dispute) | TECHNICALLY READY with the sandbox provider | `billing`, `e2e-lifecycle`, browser run |
| Stripe adapter | IMPLEMENTED | signature/mapping tests on synthetic events; not run against Stripe test mode |
| Revolut Merchant adapter | IMPLEMENTED | signature/confirmation tests on synthetic data; renewal orders not implemented |
| GP webpay (Česká spořitelna) adapter | IMPLEMENTED (partial) | RSA request/return verified with generated keys; recurring charge, refund and status WS API need the merchant WS contract |
| ABRA Flexi connector + outbox | TECHNICALLY READY against the simulated ABRA | `accounting` tests; not run against an ABRA test company |
| VAT / OSS | IMPLEMENTED, configuration-driven | no rate is built in; needs accountant-confirmed `DAJC_VAT_RATES_JSON` |
| Controlled learning workflow | TECHNICALLY READY | `paid-features` (four eyes, RBAC, expiry, revoke), DB constraint |
| Shared learning from customer content | BLOCKED by policy | `DAJC_AI_SHARED_LEARNING_POLICY_APPROVED = false` |
| Provider resilience (retry, circuit breaker, fail closed, cache) | TECHNICALLY READY | `paid-features` resilience tests |
| Licensed routing / live road restrictions | BLOCKED (no data contract) | `NO_ROUTING` interface states it explicitly |

Nothing here is PRODUCTION READY.

## Architecture (reuses the existing system)

- **One entry point**: the existing *Ask DAJC · FAQ* control links to
  `/intelligence/ask` only when the server confirms the runtime. The FAQ itself
  never depends on AI.
- **One answer pipeline**: `src/lib/ask/pipeline.ts` (classification → own
  verified data → official domains → draft → deterministic guard → independent
  check at another vendor). Paid questions call the same pipeline; there is no
  second orchestrator. The research orchestrator (`src/lib/ai/orchestrator.mjs`)
  keeps its own keys and data classes — customer questions never use it.
- **One Driving Bans registry**: paid tools go through
  `dajc-ai/paid-driving-bans.ts` → `intelligence/driving-bans-ai-contract.ts` →
  `driving-bans-query.ts` (the same published snapshot as `/driving-bans`, JSON,
  ICS). Unverified months stay `INSUFFICIENT_VERIFIED_DATA`, never "no ban".
- **Learning** never touches driving bans; reviewed knowledge enters answers as
  cited sources with their check date.
- **Billing** keeps business events and the subscription ledger; **ABRA Flexi
  remains the accounting authority** (documents, bank import, VAT returns).

### Request flow of a paid question

1. Session cookie → user id (never from the body). 2. Ledger → paid access
(`paidAccess`). 3. Fair use: per-day and per-month counters, per-user AI cost
cap, global Ask budget (all atomic in Postgres). 4. Saved vehicle/route/load are
decrypted for the owner; they reach an AI provider only with
`AI_PERSONAL_CONTEXT`. 5. Pipeline answer (or `AI_UNAVAILABLE`). 6.
Deterministic registry check for the countries and dates. 7. Settlement of
costs; system errors give the question back. 8. History stored only with
`HISTORY` consent.

### Billing flow

`POST /api/ask/billing/checkout` creates a server-side checkout record bound to
the signed-in user, then the provider checkout. Access is activated only by an
authenticated provider event (signature, timestamp tolerance, constant-time
comparison; Revolut additionally re-reads the order through its API; GP webpay
verifies DIGEST and DIGEST1 with GP's public key). The user is resolved from the
checkout record or the customer binding the server created — never from the
event's free fields. Each `(provider, eventId)` is applied once, in one
transaction with the ledger change, accounting outbox entries and a
hash-chained audit record. Authentic events refused by the subscription rules
(wrong price, impossible period) are recorded as `REJECTED` for a human.

Refunds: one self-service refund per user, within 14 days of the period start
and at most 20 paid questions (configurable); everything else goes to a
`BILLING_REVIEWER`. Access ends when the provider confirms the refund. Disputes
revoke the disputed period and are reported to the accountant.

## Security and data protection

- Deny by default: every route answers 404 while its feature is off.
- CSRF: state-changing browser requests need a DAJC `Origin` and a JSON body.
- Sessions: HttpOnly, SameSite=Lax cookie scoped to `/api/ask`; tokens stored
  as SHA-256 hashes; e-mail stored only as an HMAC fingerprint.
- Database: least-privilege role `dajc_ask_app`; RLS on every table; personal
  tables isolated per user through `dajc_ask.user_id` (a query without a user
  filter returns nothing); audit log append-only (no UPDATE/DELETE grant);
  reviewer roles writable only by the owner; four-eyes CHECK constraint.
- Encryption: AES-256-GCM with owner- and purpose-bound AAD, key rotation via
  `DAJC_AI_DATA_KEYS`.
- Retention: history 90 days, memory 365 days, feedback comments 1 year,
  checkouts 24 h, answer cache 6 h; account deletion removes personal rows
  immediately and keeps billing records pseudonymous (tax retention).
- Uploads: PDF only, ≤ 3 MB (request bodies on Vercel are limited to 4.5 MB), ≤ 12 pages, no encryption/JavaScript/launch
  actions/embedded files; processed in memory, never stored.
- SSRF: only official-domain URLs are fetched (existing `official-sources.ts`);
  no user-supplied URL is fetched.
- Client bundle: `scripts/check-ask-bundle.mjs` fails the build if any Ask or
  paid secret name/value or provider/payment API endpoint reaches the browser.

## Environment

See `.env.example` (section "DAJC AI account and paid DAJC AI"). Required for
paid: everything required by Ask, plus `DAJC_AI_ACCOUNT_ENABLED`,
`DAJC_AI_PAID_ENABLED`, `DAJC_AI_DATA_KEYS`, `DAJC_AI_PAYMENT_PROVIDER`,
`DAJC_AI_PAYMENT_MODE` and that provider's credentials. Registry tools also need
`DAJC_AI_DRIVING_BANS_ENABLED`. Accounting needs the `DAJC_ABRA_*` and
`DAJC_VAT_*` variables. The maintenance call needs `DAJC_AI_MAINTENANCE_SECRET`.

## Database migrations (owner, administrative connection)

1. Apply `drizzle-ask/0000`–`0003` in order (`0002`/`0003` are additive only).
2. `ALTER ROLE dajc_ask_app WITH LOGIN PASSWORD '<generated>'` and put the
   connection string into `DAJC_ASK_DB_URL`.
3. Grant reviewers explicitly, e.g.
   `INSERT INTO dajc_ask.reviewers (user_id, role, granted_by) VALUES ('<uuid>', 'KNOWLEDGE_REVIEWER', 'owner');`
4. Backups: rely on the database provider's point-in-time recovery; the
   payment provider and ABRA remain the systems of record for money and
   documents, so the ledger can be rebuilt by replaying provider events
   (events are idempotent).

CI applies the same migrations to a throwaway Postgres 16 service and runs the
store contracts and the end-to-end lifecycle as `dajc_ask_app`
(`ask-postgres-integration` job).

## Launch runbook (each step needs the owner's decision)

1. **Staging dry run** (no money): Vercel *preview* deployment with
   `DAJC_AI_PAYMENT_PROVIDER=sandbox`, `DAJC_AI_PAYMENT_MODE=sandbox`,
   `DAJC_AI_STAGING_SANDBOX=true`, a staging database, `DAJC_ASK_EMAIL_MODE`
   unset. Post signed sandbox events (`signSandboxEvent`) to
   `/api/ask/billing/webhook/sandbox`.
2. **Provider test mode**: choose GP webpay / Revolut / Stripe, create test
   credentials, register the webhook URL
   (`/api/ask/billing/webhook/{stripe|revolut}` or the GP return URL
   `/api/ask/billing/return/gpwebpay`), run the lifecycle with test cards and
   compare real event payloads with the adapter mapping.
3. **ABRA test company**: set `DAJC_ABRA_MODE=sandbox`, run the maintenance
   call, let the accountant check invoice, credit note, payment pairing, fee
   and OSS mapping in ABRA; adjust the `DAJC_ABRA_*` document codes.
4. **Legal and commercial**: operator entity, VAT/OSS registration, approved
   terms and privacy notice, merchant contract, refund policy approval.
5. **Release change** (code review): set `DAJC_AI_PAID_RELEASED`, and for real
   money `DAJC_AI_LIVE_PAYMENTS_RELEASED` / `DAJC_ACCOUNTING_LIVE_RELEASED`.
6. Schedule `POST /api/ask/maintenance/run` (e.g. every 15 minutes) with
   `Authorization: Bearer $DAJC_AI_MAINTENANCE_SECRET`; monthly
   `GET /api/ask/maintenance/report?month=YYYY-MM[&format=csv]`.

## Rollback

- Immediate: set `DAJC_AI_PAID_ENABLED=false` (paid routes 404, checkout
  closed; webhooks also stop — re-enable or let the provider retry later) or
  `DAJC_AI_ACCOUNT_ENABLED=false` / `DAJC_ASK_ENABLED=false`. The FAQ keeps
  working.
- Code: revert the release-constant commit. No migration needs to be undone;
  the added tables are inert when unused.
- Money: refunds and cancellations remain possible in the provider portal;
  record them as reviewed manual actions (audit).

## Known limitations

- Provider adapters are verified only against synthetic payloads; the real
  event shapes (Stripe API version, Revolut order schema, GP webpay field order)
  must be confirmed in each provider's test environment.
- GP webpay recurring charges, refunds and status queries need the Web Services
  API contract; Revolut renewals need merchant-initiated orders (not built).
- ABRA payload field names follow the public REST documentation and must be
  confirmed in an ABRA test company (`statDph`, `sparovani`, document codes).
- AI permit extraction output quality was not evaluated with real permits.
- Registry facts and warnings come from the shared Driving Bans contract and
  are English.
