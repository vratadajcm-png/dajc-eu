# DAJC integration architecture and gated PDF delivery

## Scope

- /integrations - public product-specific gateway.
- /platform/integrations - neutral Platform integration overview and document request.
- /tar/integrations - neutral TAR integration overview and document request.
- /integrations/confirm?t=... - confirmation page requiring a human POST action (GET does not verify).
- /api/integrations/request - send verification email.
- /api/integrations/verify - verify single-use token and email document access link.
- /api/integrations/download?t=... - serve programmatically generated, branded PDF on a valid 7-day token.
- /api/integrations/maintenance - Vercel Cron daily cleanup, authenticated with CRON_SECRET.

No public vendor/partner names, integration-completion percentages, pipeline statuses or disclosures of current partner negotiations. Pages describe intended architecture, not guaranteed production connections.

## Architecture PDFs

The eight-page Platform and TAR briefs are generated on the server by `src/lib/integrations/pdf.ts`. The document routes never expose raw files in `public/`; a verified, hashed, time-limited bearer token must be presented. No provider API keys, security credentials or sensitive architecture secrets are included.

## Data protection

Requests are stored in the dedicated `integration_docs` schema of the DAJC Neon research database. Its `dajc_integrations_api` user has read/write access only to that schema and is separated from market research submissions. Data consists of the company name, business email, chosen product and area, timestamps, hashed verification and download tokens and download counters. A keyed hashed network identifier rate-limits submissions (4 per hour). There is no automated marketing opt-in.

Token validity: verification 24h, PDF access 7 days. Nightly maintenance removes unverified requests older than 30 days and identifiable requests older than 12 months, plus rate-limit metadata older than 48h.

On a production-ready project, confirm applicable controller/processor contracts, GDPR legal basis, document content, retention configuration and user rights workflows.

## Vercel configuration

Sensitive server-side environment variables:
- `DAJC_INTEGRATIONS_DATABASE_URL`: least-privilege Neon role, separate physical DB branches for production and PR preview.
- `DAJC_INTEGRATIONS_TOKEN_KEY`: unique HMAC key for hash-only token and network identifier persistence.
- `RESEND_API_KEY`: **NOT CONFIGURED YET**. Required for all user-request interactions; the form is deliberately disabled until available.
- `DAJC_INTEGRATIONS_EMAIL_FROM`: optional domain-verified sender identity (default team@dajc.eu). Must verify domain with Resend before activation.
- `CRON_SECRET`: Vercel Cron-only bearer for daily retention cleanup (production).

The application validates configuration before accepting any request. DO NOT expose secrets via `PUBLIC_*` or place them in email contents, logs, Git or the frontend.

## Manual QA before production merge

1. Use Resend sandbox/test credentials to configure **preview only**.
2. Request both Platform and TAR documents and confirm exactly one verification email reaches each test inbox.
3. Verify a link via the confirmation button; the link must not be consumed on GET.
4. Confirm the second email arrives, the downloaded PDF is valid and the expiry is enforced.
5. Verify malformed origins, wrong product/area, honeypots, duplicate/expired token and rate-limiting paths.
6. Check PDF content visually, accessibility and mobile layout.
7. Validate that synthetic preview records do not enter production.
8. Run `npm run build`, `npm run typecheck` and tests; check Vercel CI.
9. Obtain explicit owner approval before merging PR to main.

## Operational constraints

No claim of operational email delivery is permitted until a verified Resend sender, API key and end-to-end mail test are confirmed. This feature is *prepared* but not activated on dajc.eu.

For privacy access or erasure requests, authorise the requester separately using the registered email address; never make raw request or response data publicly searchable.
