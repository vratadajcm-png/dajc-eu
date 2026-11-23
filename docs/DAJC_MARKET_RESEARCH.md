# DAJC Market Research — Platform and TAR

**Status:** Created in a dedicated Neon PostgreSQL project `dajc-market-research`; website implementation is a draft PR until reviewed and merged. Do not imply the forms are live on DAJC.eu.

## Data flow

- Separate public forms under `/platform` and `/tar` POST to `/api/market-research`.
- The endpoint validates data server-side, applies a honeypot and a distributed 15-minute hashed-network rate limit, and performs an idempotent insert into `public.market_research_submissions`.
- All answer records contain `product` (`platform` or `tar`), so independent interest, problems and software use can be analysed. Preview branch has its own physical database branch for QA.
- Optional best-effort email to `team@dajc.eu` uses existing `RESEND_API_KEY` **only if configured**; email errors never roll back stored records. Do not duplicate existing incoming-mail monitoring.
- Emails are **not** stored without opt-in follow-up permission. Other fields follow the privacy notice. Do not put customer or victim personal details in free text.
- Database-level response retention: delete data older than twelve months as new valid responses arrive. For long periods without traffic, perform an additional scheduled/manual retention sweep.
- Anti-abuse rate limiter uses HMAC-SHA256 with private `DAJC_RESEARCH_HASH_KEY`, and old windows are deleted when new submissions arrive; manually sweep after dormant periods.

## Vercel server-side environment

- `DAJC_RESEARCH_DATABASE_URL` — dedicated least-privilege Neon read/write user, branch-scoped preview and production.
- `DAJC_RESEARCH_HASH_KEY` — separate secret salt used to pseudonymise network addresses, never put in client code.
- `RESEND_API_KEY` — optional notification transport. Not present at initial setup; emails will not be sent until configured and delivery tested.
- Do not move DB URLs to `PUBLIC_*` values, hardcode credentials, or expose an unrestricted export endpoint.

## SQL analysis (run in Neon console with an authorised user)

**Count replies and interest by product:**

```sql
SELECT product, usage_interest, count(*) AS responses
FROM public.market_research_submissions
GROUP BY product, usage_interest ORDER BY product, usage_interest;
```

**Interest and willingness to pay:**

```sql
SELECT product, usage_interest, payment_interest, count(*) AS replies
FROM public.market_research_submissions
GROUP BY product, usage_interest, payment_interest
ORDER BY product, replies DESC;
```

**Top-ranked functions:**

```sql
SELECT product, most_useful, count(*) AS selections
FROM public.market_research_submissions
GROUP BY product, most_useful ORDER BY product, selections DESC;
```

**Company and country overview:**

```sql
SELECT product, country, count(DISTINCT lower(company)) AS companies,
       count(*) AS replies
FROM public.market_research_submissions
GROUP BY product, country ORDER BY product, replies DESC;
```

**Restricted follow-up queue:** Contact information is PII. Access only with authorisation; never publish raw responses.

```sql
SELECT product, created_at, company, contact_email, biggest_problem
FROM public.market_research_submissions
WHERE follow_up_allowed = TRUE AND contact_email IS NOT NULL
ORDER BY created_at DESC;
```

## Before production merge

1. Verify both forms via the **preview-only** database branch with synthetic answers. Do not mix QA submissions into real company research.
2. Verify production DB credentials, least-privilege permissions, and retention process.
3. Verify accessibility, error states, mobile responsiveness, GDPR notice and anti-spam controls.
4. Configure optional Resend delivery only when notifications are wanted; existing mailbox watch remains unchanged.
5. Publish only after owner approval; no automatic merging into `main`.
