# Ask DAJC AI (Zeptejte se DAJC AI) — Phase 1

DAJC Intelligence feature from master plan DAJC-PLAN-003-FULL §47 (§47.2,
§47.3, §47.7). **Phase 1: free questions with a daily limit. Nothing is sold;
no payments, credits, Revolut or Stripe.**

**Status: built, disabled by default (`DAJC_ASK_ENABLED=false`).** Every
`/api/ask/*` route and `/intelligence/ask` answer 404 until the flag is the
exact string `"true"` *and* the whole configuration (database, separate keys,
model names, prices, budget, pepper) is present. Do not enable it before the
launch checklist below is complete.

## Public entry point: existing Ask DAJC · FAQ

The current floating **Ask DAJC · FAQ** guide on DAJC.eu keeps its original
name, position, static questions and contact actions. It is the sole existing
public entry point for visitors who may later use Ask DAJC AI. Do not rename it
to "DAJC AI", replace its FAQ content or create a second floating chat widget.

When someone opens the FAQ, the browser makes a read-only same-origin GET to
`/api/guide/ai-availability`. This route always returns HTTP 200 with only
`{ "available": false | true }`, `no-store` and `noindex`. The server derives
the boolean from the **existing** `getAskConfig()` gate (exact
`DAJC_ASK_ENABLED=true` plus complete validated settings); no public variable
or API secret is sent to the browser. The probe neither authenticates anyone
nor calls an AI provider or consumes the Ask budget.

- **Disabled/incomplete configuration:** only existing prepared FAQ answers
  and contact options appear, plus a plain-language note that AI is not
  available yet. No link to the gated page is shown; there is no customer-facing
  404.
- **Enabled with validated configuration:** the same FAQ panel reveals a link
  to the existing `/intelligence/ask` page. The browser checks availability
  again before navigation. That page retains its separate email sign-in,
  consent/limits, AI disclosures and server-side authorization.
- **Failure of the read-only availability request:** fail closed and keep FAQ
  usable without the AI link.
- **No early launch:** this UI change does not change `DAJC_ASK_ENABLED`, costs,
  the feature release decision, user entitlements, Privacy/Terms or release
  gates. In particular, it does not authorize customer access prior to the
  owner's approved launch and legal review.

The unchanged deny-by-default rule still applies to **all** `/api/ask/*`
endpoints and to `/intelligence/ask`; they remain 404 while disabled. The
new availability route is under `/api/guide/` specifically to avoid weakening
that requirement.

## What a question goes through

| Step (§47.2) | Where | Notes |
|---|---|---|
| 1. Classification: country, topic, dimensions, date | `pipeline.ts`, OpenAI | Output re-validated in code (tracked jurisdictions, ISO dates). E-mail addresses and phone numbers are removed before any provider sees the question. |
| 2. DAJC's own verified data | `own-data.ts` | Driving bans only from the published Driving Bans registry, read through `readPublishedDrivingBans()` (`src/lib/intelligence/driving-bans-adapter.ts`) and evaluated by the shared contract `answerFreeAskQuery` (`src/lib/intelligence/driving-bans-ai-contract.ts`). No second registry, no own rule expansion, no cache. EU Oversize Weekly findings are all `unverified`, so only their official-tier URLs serve as leads, and never for driving bans. |
| 3. Official domains where DAJC data cannot answer | `pipeline.ts`, Perplexity | `search_domain_filter = officialDomainsFor()` from `scripts/lib/source-policy.mjs`. The search engine receives classifier keywords, never the question. For driving bans only countries with `INSUFFICIENT_VERIFIED_DATA` are searched, and what is found stays an unverified lead (below). |
| 4. Fetch and read the sources | `official-sources.ts`, `text.ts` | `fetchTextWithRetry()` from `scripts/lib/fetch-source.mjs`; a URL is used only if `isOfficialPublisher()` holds before and after redirects. PDFs are skipped in Phase 1. |
| 5. Draft only from the sources | `prompts.ts`, OpenAI | Each statement cites one source and quotes it verbatim. Sources and the question travel in randomly delimited blocks declared as untrusted data. |
| 6a. Deterministic check | `guard.ts` | Source from the allowed set; quote found verbatim; every number in the statement also in the quote; no digits at all for DAJC data (facts come from the template); no "you can / vám hrozí / your transport / tuto přepravu" wording (no decision on an exception, an authorisation or a permit for a specific transport); answer language = question language. A failing statement is not shown. |
| 6b. Independent check | `prompts.ts`, Anthropic | Checks that each source contains its statement and that it is not personal advice. **Any disagreement → the whole answer is NEVÍM** (owner decision). |
| 7. Output | `pipeline.ts`, `facts.ts` | OVĚŘENO / ČÁSTEČNĚ / NEVÍM / NEDOSTATEK OVĚŘENÝCH DAT, for driving bans the registry verification of every asked country, sources with links and check dates, the visible AI label and the `/support` link (voluntary, no benefit). |
| 8. Human review queue | `dajc_ask.review_queue` | New official URLs only — no user, question or e-mail. Nothing is ever written to `data/`. Driving-ban leads are handed to the Driving Bans review layer offline (`npm run driving-bans:web-leads`). |

Levels:

- **OVĚŘENO / VERIFIED** — no statement was dropped, the draft covers the
  whole question and every asked country is answered. For driving bans
  additionally: every asked country is verified in full in the registry and
  decided on every asked day, and the answer cites the registry.
- **ČÁSTEČNĚ / PARTIAL** — every shown statement passed both checks, but the
  answer does not cover everything (a statement was dropped or a country is
  missing). For driving bans only when the registry itself decides every
  asked country.
- **NEDOSTATEK OVĚŘENÝCH DAT / INSUFFICIENT VERIFIED DATA** — driving bans
  only: an asked country is not verified in full or not decided on an asked
  day. Verified registry facts that exist (e.g. a verified ban in a country
  whose coverage is incomplete) are still shown as verified; official pages
  may be quoted as unverified leads. Missing information never means that
  there is no ban.
- **NEVÍM / DON'T KNOW** — out of scope, no country, no source, no passing
  statement, or any disagreement in the independent check (for driving bans
  only when the registry itself decides every asked country).

Driving-ban answers also show a next step that follows the shared contract
(`next_step`, `authority_check_required`): check with the authority when the
data are insufficient, confirm the restriction, exceptions and permit
conditions with the official source when the contract asks for it, otherwise
re-check before departure.

## Driving bans: one authoritative registry (Driving Bans 2.0)

The free Ask, paid DAJC Intelligence and paid DAJC AI read the same published
registry and the same legal verification state. Confirmed driving-ban facts
come only from the published snapshot — the data of `/driving-bans`, its JSON
and ICS — read through `readPublishedDrivingBans()` in
`driving-bans-adapter.ts` and evaluated by the shared contract of PR #84.
`npm run lint:driving-bans` fails if code in `src/lib/ask` reads canonical
data, staging evidence or the review layer directly, or reaches the paid
authorisation path.

| | Free Ask DAJC AI | Paid DAJC AI (not released) |
|---|---|---|
| Entry point | `answerFreeAskQuery` | `answerDrivingBansQuery` |
| Access | Ask gate: `DAJC_ASK_ENABLED`, sign-in, daily limit | `authorizeFeature('ai-assistant')` per call, organisation from the authenticated subject |
| Paid entitlement | never required or consulted | required |
| Tools | `search_bans` (no vehicle), `explain_rule`, `list_exceptions` | all six, incl. vehicle, route and change history |

For every asked country and day the registry answers:

- `BAN_FOUND` — verified legal driving ban; facts rendered by template;
- `NO_CONFIRMED_BAN` — the country is verified in full for the published
  period (current and next month, Prague time) and no verified ban applies.
  Shown as a registry statement that also says temporary restrictions,
  roadworks and permit conditions are not part of the registry;
- `INSUFFICIENT_VERIFIED_DATA` — anything else, including any date outside
  the published period.

Each driving-ban answer lists this per country with the published period,
whether the country is verified in full and the date of last verification.
Exceptions are listed as published and never assessed for a specific
transport.

What the AI may and may not do on driving bans:

- **May:** explain a verified rule, list documented exceptions, show sources
  and verification dates, recommend the next check. Comparing a vehicle or
  route segments with the rules is paid DAJC AI (`evaluate_vehicle`,
  `check_route`), not part of the free Ask.
- **May not:** confirm that a journey is authorised without sufficient data,
  decide whether an exception applies, issue or grant a permit, change an
  approved route, or present a web page as a completed legal review.
- **Future extension, not implemented:** suggesting alternative departure
  times or routes around a ban. Any such suggestion must always be labelled
  as a recommendation ("doporučení"), never as an authorisation, a decision
  on an exception or a change of an approved route.

### Official web findings are leads, not verification

Where the registry answers `INSUFFICIENT_VERIFIED_DATA`, official domains may
be searched. A statement quoted from such a page is marked "neověřeno DAJC",
the model receives the page as `official-web-unverified`, the answer stays
NEDOSTATEK OVĚŘENÝCH DAT, and the AI label says so. Pages that are not
already among the registry's own sources go to `dajc_ask.review_queue` and are
handed to the Driving Bans review layer:

```bash
psql "$ADMIN_DB_URL" -At -c "select coalesce(json_agg(json_build_object('url', url, 'jurisdiction', jurisdiction, 'topic', topic, 'first_seen', first_seen)), '[]')
  from dajc_ask.review_queue where topic = 'driving_ban' and status = 'NEW'" > review-queue.json
npm run driving-bans:web-leads -- review-queue.json   # into data/driving-bans/staging
```

Each lead becomes a link-only submission with one `ADD_SOURCE` (role
`SECONDARY`, "not reviewed") and validates to `INSUFFICIENT_EVIDENCE`
(`src/lib/driving-bans/web-leads.mjs`). It reaches the published registry only
after a reviewer imports the primary document, proposes the rule change and
the change is approved and merged (docs/DRIVING_BANS_EVIDENCE_IMPORT.md).
Afterwards mark the rows, e.g. `update dajc_ask.review_queue set status =
'HANDED_OFF' where topic = 'driving_ban' and status = 'NEW';`.

Other topics keep their own rules: a quoted official page can still make an
oversize, dimension, escort or toll answer OVĚŘENO.

## Storage (schema `dajc_ask`)

Separate Postgres schema and least-privileged role `dajc_ask_app`; migrations
in `drizzle-ask/` (config `drizzle.ask.config.ts`, own bookkeeping table, so
it never interleaves with the portal's migrations). The schema must not be
exposed through the Supabase Data API; `anon`/`authenticated` get nothing; RLS
is on for every table with policies only for `dajc_ask_app`; the app can
write measurements but cannot read them.

| Table | Content | Kept |
|---|---|---|
| `users` | HMAC of the e-mail (never the address) | until deleted |
| `login_tokens` | SHA-256 of one-time tokens | deleted at expiry (15 min) |
| `sessions` | SHA-256 of session tokens | deleted at expiry (7 days) |
| `daily_usage` | user, Prague day, count | 35 days |
| `budget` | spent/reserved micro-EUR per month and day | indefinitely (no personal data) |
| `metrics` | day, level, language, path, cost, latency — **no user, question or answer** | indefinitely (no personal data) |
| `review_queue` | official URL, jurisdiction, topic, first/last day seen | until reviewed |
| `rate_events` | HMAC of IP / e-mail per bucket | 1 day |

Question and answer texts are never stored by DAJC. OpenAI is called with
`store: false`; the providers' own retention applies (DPA to be signed).

## Limits and costs

- 3 questions per verified e-mail per Prague day (`DAJC_ASK_DAILY_QUERY_LIMIT`).
  NEVÍM counts; a question is given back only after a system error.
- Before any provider call, the worst-case cost of the whole question
  (prompt size caps × prices, 1 search) — about €0.24 with the §47.5 prices —
  is reserved against the monthly cap (`DAJC_ASK_MONTHLY_BUDGET_EUR=20`) and
  the daily cap (`DAJC_ASK_DAILY_BUDGET_EUR=2`). The reservation is replaced
  by the actual cost afterwards; a failed call is charged at its worst case.
  When a cap cannot take another worst case the feature pauses itself
  (HTTP 503, message on the page) until the next day/month.
- Sign-in e-mails: 3/hour and 6/day per address, 5/hour per IP, 300/day in
  total.

## Environment variables (server only)

| Variable | Required | Purpose |
|---|---|---|
| `DAJC_ASK_ENABLED` | yes | exactly `true` to enable; default `false` |
| `DAJC_ASK_DB_URL` | yes | Postgres as `dajc_ask_app` |
| `DAJC_ASK_OPENAI_API_KEY` | yes | separate OpenAI project key |
| `DAJC_ASK_OPENAI_CLASSIFIER_MODEL` | yes | classification model |
| `DAJC_ASK_OPENAI_ANSWER_MODEL` | yes | answer model |
| `DAJC_ASK_ANTHROPIC_API_KEY` | yes | separate Anthropic workspace key |
| `DAJC_ASK_ANTHROPIC_VERIFIER_MODEL` | yes | independent check model |
| `DAJC_ASK_PERPLEXITY_API_KEY` | yes | separate Perplexity key |
| `DAJC_ASK_PRICING_USD` | yes | e.g. `{"classifier":{"input":0.2,"output":1.25},"answer":{"input":0.75,"output":4.5},"verifier":{"input":2,"output":10},"searchRequest":0.005}` (USD per 1M tokens; USD per search) |
| `DAJC_ASK_USD_EUR_RATE` | yes | EUR per 1 USD, e.g. `0.92` |
| `DAJC_ASK_MONTHLY_BUDGET_EUR` | yes | `20` |
| `DAJC_ASK_DAILY_BUDGET_EUR` | no | `2` |
| `DAJC_ASK_DAILY_QUERY_LIMIT` | no | `3` (default) |
| `DAJC_ASK_EMAIL_PEPPER` | yes | ≥ 32 random characters |
| `DAJC_ASK_EMAIL_FROM` | no | default `DAJC <team@dajc.eu>` |
| `DAJC_ASK_EMAIL_MODE` | no | `live` to send real e-mails (uses existing `RESEND_API_KEY`) |
| `DAJC_ASK_PUBLIC_ORIGIN` | no | origin in sign-in links, default `https://www.dajc.eu` |
| `DAJC_ASK_MIGRATION_DB_URL` | local only | admin connection for `drizzle-kit migrate`; never in Vercel |

A key equal to the article pipeline's `ANTHROPIC_API_KEY`,
`PERPLEXITY_API_KEY` or `OPENAI_API_KEY` is rejected and keeps the feature off.

## Launch checklist (all required before `DAJC_ASK_ENABLED=true`)

1. **Database** — Supabase project in the EU (Frankfurt). Apply migrations as
   an admin: `DAJC_ASK_MIGRATION_DB_URL=… npx drizzle-kit migrate --config drizzle.ask.config.ts`.
   Then, outside the repository: `ALTER ROLE dajc_ask_app WITH LOGIN PASSWORD '<generated>';`
   and set `DAJC_ASK_DB_URL` to that role (Supabase pooler user
   `dajc_ask_app.<project-ref>`). Confirm `dajc_ask` is **not** in
   Settings → API → Exposed schemas.
2. **Keys with provider limits** — new OpenAI project, Anthropic workspace
   and Perplexity key used only by this feature, each with its own monthly
   spend limit at the provider (≤ the €20 cap). Verify the §47.5 prices and
   put them into `DAJC_ASK_PRICING_USD`.
3. **DPAs** with OpenAI, Anthropic and Perplexity; transfer assessment (USA);
   confirm API data is not used for training and the providers' retention.
4. **Advocate review** — information vs. legal advice boundary (zákon
   č. 85/1996 Sb.), prompts and fixed texts, AI Act Art. 50 label, Terms and
   Privacy texts (draft: `docs/ASK_DAJC_AI_LEGAL_DRAFT.md`).
5. **Operator unification in Privacy and Terms** (Miroslav Dajč vs. Dajc
   s.r.o.) and publication of the approved processing texts — owner decision.
6. Value test on 20 real questions (§47.1), in EN, CS, SK, PL, DE.
7. Resend: verified sender domain, `DAJC_ASK_EMAIL_MODE=live`.
8. Set the variables in Vercel (Production), deploy, smoke-test, then
   `DAJC_ASK_ENABLED=true`.

## Measurement (owner, admin connection)

```sql
select date_trunc('month', day)::date as month,
       count(*) filter (where level <> 'SYSTEM_ERROR')                         as answers,
       round(100.0 * count(*) filter (where level = 'UNKNOWN')
             / nullif(count(*) filter (where level <> 'SYSTEM_ERROR'), 0), 1)  as unknown_pct,
       round(100.0 * count(*) filter (where level = 'INSUFFICIENT_VERIFIED_DATA')
             / nullif(count(*) filter (where level <> 'SYSTEM_ERROR'), 0), 1)  as insufficient_pct,
       round(avg(cost_micro) filter (where level <> 'SYSTEM_ERROR') / 1e6, 4)  as avg_cost_eur,
       round(sum(cost_micro) / 1e6, 2)                                         as total_cost_eur,
       count(*) filter (where level = 'SYSTEM_ERROR')                          as system_errors
from dajc_ask.metrics group by 1 order by 1;

select * from dajc_ask.review_queue where status = 'NEW' order by seen_count desc, last_seen desc;
```

## Isolation from the weekly article pipeline

- Own keys; the pipeline's variables are never read (tests enforce it).
- `scripts/lib/*` and `data/*` are imported read-only and unchanged; the
  pipeline's `searchWithPerplexitySearch()` (weekly prompt, pipeline keys) is
  not used.
- Runs as Vercel functions, never in GitHub Actions; no article or social
  workflow changed. Application CI only gained an offline bundle scan
  (`scripts/check-ask-bundle.mjs`, ≤ 30 s).
- Tests use synthetic fixtures and fakes (no network, no keys), so weekly data
  updates cannot break them.

## Known limitations

- PDFs (many legal texts) are not read in Phase 1.
- The deterministic language check covers EN/CS/SK/PL/DE; other languages
  rely on the classifier. Short Slovak and Czech answers can be confused;
  the result is NEVÍM, never a wrong-language answer.
- Perplexity accepts at most 20 domains per request; multi-country questions
  use the first 20 official domains.
- One request runs for at most ~50 s (internal deadline); check the Vercel
  function duration limit of the project before launch.
- Prompt injection is mitigated (delimited untrusted blocks, verbatim quotes,
  official domains only, independent check), not impossible: an official page
  could itself contain misleading text that is then quoted correctly.
