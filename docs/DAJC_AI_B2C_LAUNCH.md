# DAJC AI — public free launch (B2C): readiness

Status on 2026-11-08, branch `claude/gracious-brown-n9m8el`. This document only
states what was actually verified; everything else is explicitly marked as
unverified or blocking.

**Decision: NO-GO for public operation.** The code is ready for review and
merge (everything stays off), but the database, the AI provider keys, e-mail,
approved legal texts and a budget decision are missing. Details in sections 4–7.

> **Update 2026-11-08 (branch `claude/dajc-ai-neon-knowledge-base`):** the database is now
> **Neon PostgreSQL** (project `dajc-ai`, Frankfurt, branch `dev` with the migrations; the
> production branch is empty) — see `docs/DAJC_AI_NEON.md`. Supabase is unchanged. A European
> library of official legal documents was added (`docs/DAJC_AI_LEGAL_LIBRARY.md`). The points
> below about Supabase apply to Supabase; for Neon, the blocking conditions in that document apply.

## 1. What DAJC AI is in this version

The existing "Ask DAJC AI" (Ask, PR #78) as a free work assistant for
professional truck drivers. No second assistant, orchestrator or driving-ban
registry.

| Property | State in the code |
|---|---|
| Sign-in by e-mail (one-time link, only an HMAC fingerprint is stored) | unchanged from #78 |
| 3 questions per day per verified e-mail, reset at midnight Prague time | unchanged; test "free again the next day" |
| Independent check of answers (another provider) + deterministic check | unchanged, extended by the no-confirmation rule |
| Verifiable sources, "INSUFFICIENT VERIFIED DATA" | unchanged |
| Key protection (server only, separate from the article pipeline and research, bundle scan) | unchanged |
| Cost limits (worst-case reservation, daily and monthly cap) | unchanged; pause message corrected |
| After the limit: the owner's text + button "Dobrovolně podpořit DAJC AI" → `/support` | **new** |
| Driver safety notice (use only when safely stopped) | **new**, on the page and under every answer |
| The AI never confirms route passability, oversize authorisation or a legal exception | **new**, 4 layers (question detector, guard, prompt, independent check) |
| Link in the main navigation and in the FAQ only after activation **and** publication | **new** (`DAJC_ASK_PUBLIC_ENTRY`) |
| Paid DAJC AI, Intelligence, ABRA, payments | **not included**; they stay in #101/#102 |

A contribution unlocks nothing: neither the API nor the database reads any
contribution, and the link to `/support` is a plain link without a redirect
(verified by tests and in the browser).

## 2. PR integration

| PR | Content | How it is on this branch |
|---|---|---|
| #98 | #96 + #97 + #78 | merged with merge commit `81fafd7` into the current `main` (`7d06803`) |
| #96, #97, #78 | Driving Bans verified period, personal calendar (off), Ask | included via #98 |
| #90 (in #101) | entry via "Ask DAJC · FAQ" | taken byte for byte (`2e12b42`), gate changed to `public-entry.ts` |
| #100 (in #101) | atomic sign-in throttling (advisory lock) | taken byte for byte (`2e12b42`) |
| #102 | account, paid DAJC AI, payments, ABRA, learning | **not taken**, except the security fix for bounded request-body reading (`730750a`, same hunks) |

**Why #98 reported `mergeable: false`.** GitHub reported
`mergeable_state: behind` for #98: the branch was based on `ea27928` while
`main` had received 7 commits (#103, #104, #105, the X link, Founding
Customers). There is no textual conflict (a local merge succeeded) and all
Application CI steps passed after the merge. No semantic conflict was found.

**Follow-up PRs stay usable.** A trial merge of #102 (which contains #101) on
top of this branch: conflicts in 4 files only, always "keep both". After
resolving: typecheck 0 errors, `npm test` 111 files, 1,280 tests passed, 26
skipped (Postgres without a DB). Resolution for the later merge:

| File | Resolution |
|---|---|
| `src/lib/ask/guide-entry.ts` | keep this branch's version (`isAskPublicEntryEnabled`) |
| `.env.example` | keep both blocks (`DAJC_ASK_PUBLIC_ENTRY` and #102's variables) |
| `src/pages/intelligence/ask.astro` | combine the imports (`getAccountRuntime` + `limitReachedText`), keep both the limit panel and the account panel, keep both style blocks |
| `src/lib/ask/client/ask-form.ts` | `limitReached = !paid && signedIn && remaining === 0`; append the safety notice after `renderAnswer(…, extras)`; keep the 429 branch with the limit panel |

Merge into `main` with a **merge commit** (not squash), so #101/#102 stay
attached to the history of #98.

## 3. Tests performed

| Step (Application CI) | Result |
|---|---|
| `npm run lint:geographic-coverage` | OK |
| `npm run lint:driving-bans` | PASS |
| `npm run driving-bans:audit` | OK |
| `npm run typecheck` | 0 errors, 0 warnings |
| `npm test` | 97 files, **1,148 passed**, 8 skipped (Postgres without a DB) |
| `npm run build` | OK; the render function has `maxDuration: 60` |
| `node scripts/check-ask-bundle.mjs` | no key and no AI endpoint in the client code |

**Isolated environment (local container, no network access to AI):**

- PostgreSQL 16, `drizzle-ask` migrations 0000 + 0001 applied as admin, role
  `dajc_ask_app` with a password: Ask tests including Postgres **232/232, 0
  skipped** (store contract, 12 parallel sign-ins → exactly 3 allowed, the app
  role cannot read metrics). `anon`/`authenticated` have no access,
  `dajc_ask_app` has no superuser/bypassrls and owns no tables.
- `astro dev` against this DB with fake keys, Chromium (Playwright): limit
  used up → panel with the exact text, `/support` button, submit disabled, no
  navigation away from the page; 4th question via the API → 429 even with the
  field `supported: true`; link in the navigation and the FAQ only with
  `ENABLED` + `PUBLIC_ENTRY`; activated but not published → page 200, no link;
  off → 404, no link; no horizontal overflow at 1180 px or on an iPhone 13.

**Not tested (impossible without approval or access):** real calls to OpenAI,
Anthropic and Perplexity; a real e-mail through Resend; a deployment with the
production configuration; the value test on 20 real questions. None of the
results above proves the production readiness of third-party services.

## 4. Operational services — what is actually missing (checked 2026-11-08, read-only)

| Service | Observed state | Missing |
|---|---|---|
| **Supabase / PostgreSQL EU** | Organisation "DAJC" on the **free** plan. All 4 projects (`dajc-partner-portal` eu-west-1, `dajc-assistance-dev`, `dajc-staging-e2e`, `HaulBoard` eu-central-1) are **INACTIVE**. According to #102, restoring a project failed with "organization has unpaid invoices" (not re-checked; nothing was changed). | an active EU project (Frankfurt), migrations 0000+0001, role password, check of "Exposed schemas"; settle the unpaid invoices |
| **OpenAI API** | No `DAJC_ASK_OPENAI_*` in Vercel. The article pipeline does not use OpenAI; whether an account exists cannot be checked from here. | a separate project key with a spend limit, model names, verified prices, DPA |
| **Anthropic API** | No `DAJC_ASK_ANTHROPIC_*` in Vercel (the article pipeline has its own key in GitHub Actions, which Ask may not use). | a separate workspace and key with a spend limit, the checking model, DPA |
| **Perplexity API** | No `DAJC_ASK_PERPLEXITY_API_KEY` in Vercel. | a separate key with a limit, DPA |
| **Resend** | **`RESEND_API_KEY` is also missing** in Vercel (this also affects the Testing 2027 registration). Domain verification cannot be checked from here. | verified `dajc.eu` domain, key in Production, `DAJC_ASK_EMAIL_MODE=live` |
| **Vercel** | Project `dajc-eu` (team HaulBoard). Variables: investor only + 2 preview variables from #102. Production functions run in **iad1 (USA)**. The plan cannot be read via the API (billing API returns 404 → probably Hobby). | Ask variables; region `fra1` (set in `vercel.json` on this branch, effective after the merge); confirm the plan — Hobby terms restrict commercial use, to be assessed given the contributions and B2B offers |
| **Budgets and monitoring** | In the code: daily and monthly cap, the `metrics` table, SQL in `docs/ASK_DAJC_AI.md`. Nothing set at the providers. | decide the caps (section 5), spend limits at the providers, a daily check of the metrics |

Nothing was created, restored, migrated or changed in Supabase or Vercel.

## 5. Estimated operating costs (3 questions per day, 30 days)

**Assumptions** (an estimate, not a measurement — compare with the `metrics`
table in the first week of operation):

- prices from the configuration §47.5 / `.env.example` (USD per 1M tokens):
  classification 0.20/1.25, answer draft 0.75/4.50, check 2/10 (= Claude
  Sonnet 5.5), search 0.005 USD; rate 0.92 EUR/USD. OpenAI and Perplexity
  prices were not checked against the current price lists; Anthropic prices
  match the price list as of 2026-10.
- tokens per question: classification 700/200, draft 5,000/700, check
  3,000/300, search for 60 % of the questions.
- **baseline ≈ €0.018 per question**; the cheapest variant with Claude Haiku
  5.5 as the checker (0.10/0.50 USD) ≈ €0.010; pessimistic (hidden reasoning
  tokens, search for every question) ≈ €0.028. The worst-case reservation
  before a question ≈ €0.24 (with Haiku ≈ €0.10).

| Active drivers | Questions / month | AI baseline | AI cheapest | AI pessimistic | Infrastructure | **Total baseline** |
|---|---|---|---|---|---|---|
| 100 | 9,000 | €159 | €89 | €248 | ≈ €41 | **≈ €200 / month** |
| 500 | 45,000 | €797 | €445 | €1,238 | ≈ €60 | **≈ €860 / month** |
| 1,000 | 90,000 | €1,593 | €889 | €2,477 | ≈ €60 | **≈ €1,650 / month** |

Infrastructure (list prices, to verify): Supabase Pro 25 USD (≈ €23; the free
plan pauses inactive projects and has no backups), Vercel Pro 20 USD (≈ €18;
if Hobby does not meet the terms), Resend free (3,000 e-mails/month, 100/day)
is enough for 100 drivers, Resend Pro 20 USD (≈ €18) for 500+. A sign-in lasts
7 days → ≈ 4–5 e-mails per driver per month.

Cheapest safe variant for the start (≈ 100 drivers): Claude Haiku 5.5 as the
checker, Supabase Pro, Resend free, Vercel depending on the plan assessment →
**≈ €110–130 / month**. The checking quality with Haiku must be confirmed by
the value test (section 7, step 9) before switching.

**The caps in the code must match the number of users.** The defaults
(`DAJC_ASK_DAILY_BUDGET_EUR=2`, `DAJC_ASK_MONTHLY_BUDGET_EUR=20`) carry only
≈ 100 questions per day and ≈ 1,100 questions per month (≈ 12 fully active
drivers). Then the service pauses — the monthly cap until the end of the
month, which would break "free every day". Recommendation: monthly cap ≥ 31 ×
daily cap, so the daily cap decides and the service resumes every day.

| Drivers | `DAJC_ASK_DAILY_BUDGET_EUR` | `DAJC_ASK_MONTHLY_BUDGET_EUR` |
|---|---|---|
| 100 | 10 | 310 |
| 500 | 35 | 1,085 |
| 1,000 | 65 | 2,015 |

Other capacity limits in the code: at most 300 sign-in e-mails per day in total
(`auth.ts`), Resend free 100 e-mails per day — at a launch for hundreds of
drivers at once, sign-in is limited on the first day.

## 6. Remaining blocking conditions

1. **Legal texts** (`docs/ASK_DAJC_AI_LEGAL_DRAFT.md`): approval by the
   operator and a lawyer, a single operator (Miroslav Dajč vs. Dajc s.r.o.),
   publication in `/privacy` and `/terms` by a separate change.
2. **DPAs and transfers to the USA** with OpenAI, Anthropic, Perplexity (and
   Resend): sign them, verify retention and no training.
3. **Database:** Supabase's unpaid invoices, an active EU project, migrations.
4. **AI keys:** three separate keys with spend limits, models, verified prices.
5. **Resend:** verified domain, key, `live` mode.
6. **Budget:** decision on the caps according to section 5.
7. **Vercel:** plan (commercial use), environment variables, region `fra1`
   after the merge.
8. **Value test** on 20 real questions (EN, CS, SK, PL, DE) with approved
   costs (≈ €0.5).
9. **Merge** of this branch into `main` — only after the owner's explicit
   approval.

Recommended, not blocking: CAPTCHA/bot protection before sign-in (open since
#78), automatic deletion of fingerprints after inactivity (if the Privacy
notice promises it).

## 7. Last steps to launch (in this order)

1. The owner reviews and approves the PR; merge into `main` with a **merge
   commit**. After the deployment, check that the website works (region
   `fra1`) and DAJC AI still answers 404.
2. Owner decisions: operator, caps, the checking model (Sonnet 5.5 vs. Haiku
   5.5), Vercel and Supabase plans.
3. A lawyer approves the texts → a separate PR publishes the DAJC AI sections
   in Privacy and Terms.
4. Supabase: settle the invoices, create/restore an EU project, as admin
   `DAJC_ASK_MIGRATION_DB_URL=… npx drizzle-kit migrate --config drizzle.ask.config.ts`,
   `ALTER ROLE dajc_ask_app WITH LOGIN PASSWORD '…'` outside the repository,
   check that `dajc_ask` is not in "Exposed schemas"; run
   `DAJC_ASK_TEST_DB_URL=… npx vitest run src/lib/ask` against the new DB
   before the first users.
5. Create separate OpenAI / Anthropic / Perplexity keys with a monthly spend
   limit at the provider (≤ the monthly cap) and sign the DPAs.
6. Resend: verify the domain, put the key into Vercel Production.
7. Vercel Production — variables (names only, values outside the repository):
   `DAJC_ASK_ENABLED=true`, `DAJC_ASK_PUBLIC_ENTRY=false`, `DAJC_ASK_DB_URL`,
   `DAJC_ASK_OPENAI_API_KEY`, `DAJC_ASK_ANTHROPIC_API_KEY`,
   `DAJC_ASK_PERPLEXITY_API_KEY`, `DAJC_ASK_OPENAI_CLASSIFIER_MODEL`,
   `DAJC_ASK_OPENAI_ANSWER_MODEL`, `DAJC_ASK_ANTHROPIC_VERIFIER_MODEL`,
   `DAJC_ASK_PRICING_USD`, `DAJC_ASK_USD_EUR_RATE`,
   `DAJC_ASK_DAILY_BUDGET_EUR`, `DAJC_ASK_MONTHLY_BUDGET_EUR`,
   `DAJC_ASK_DAILY_QUERY_LIMIT=3`, `DAJC_ASK_EMAIL_PEPPER` (≥ 32 characters),
   `DAJC_ASK_EMAIL_MODE=live`, `RESEND_API_KEY`; redeploy.
8. Production smoke test via the direct address `/intelligence/ask`: sign-in
   by e-mail, 3 questions (levels, sources, safety notice), 4th question → the
   limit panel with the link to `/support`; check the rows in
   `dajc_ask.metrics` and `dajc_ask.budget` and the Vercel logs.
9. Value test on 20 real questions; the owner reviews the answers.
10. `DAJC_ASK_PUBLIC_ENTRY=true` and a new deployment → the "DAJC AI" link in
    the main navigation and in the FAQ. The service is then publicly launched.
11. Operations: daily SQL from `docs/ASK_DAJC_AI.md` (share of DON'T KNOW,
    cost per question) and provider spend; adjust the caps to the real costs.

Switching off at any time: `DAJC_ASK_PUBLIC_ENTRY=false` (hides the links) or
`DAJC_ASK_ENABLED=false` (everything 404) and a new deployment.
