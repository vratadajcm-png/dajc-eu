# DAJC public updates — double opt-in rollout

**Status: draft / disabled by default.** The source and DB migration being present does not mean this is live or has been tested with a real email and Neon preview branch.

## Behaviour
- `/updates` continues to offer manual `mailto:` requests until `DAJC_UPDATES_ENABLED=true` is set in a reviewed deployment.
- Enabled form offers **two separate consents**: one-time launch email (`launch`) or recurring project newsletter (`newsletter`); no implied testing registration, purchase, or cross-subscription.
- `POST /api/updates/subscribe` performs origin and JSON checks, honeypot, DB-backed network/email throttling, and writes a pending row only. Resend delivers a 24-hour confirmation token and independent unsubscribe token.
- `/updates/confirm?token=...` only displays an action; visitor must click **Confirm** to POST the token. Link prefetching/email scanners cannot directly activate it. Token is removed from browser history by client script.
- `/updates/unsubscribe?token=...` likewise requires an explicit visitor action; the POST deletes the matching email/purpose row.
- Tokens are 32 random bytes and stored only as keyed HMAC-SHA256 digests. Pending rows older than 7 days are cleaned during signups and need an additional scheduled retention sweep. Rate-limit records expire after 48 hours. **Do not log raw emails or tokens.**
- Existing customer / testing / market research / integration tables are intentionally not used as subscription lists. **No marketing emails may be sent to research or testing contacts without their independent permission.**

## Configuration (server-side only)
- Apply `db/research/002_updates_double_optin.sql` in a disposable Neon `dajc-market-research` preview branch first. Review ACL with a separate least-privilege DB runtime role, using `DAJC_UPDATES_DATABASE_URL`; never reuse Platform/TAR/AI application credentials.
- Set `DAJC_UPDATES_TOKEN_KEY` and `DAJC_UPDATES_HASH_KEY` to two independent long random secret values via Vercel environment settings.
- Provide a verified sender `DAJC_UPDATES_EMAIL_FROM` and tested `RESEND_API_KEY`.
- Keep `DAJC_UPDATES_ENABLED=false` in all environments until actual delivery, confirmation, cancellation and DB persistence are tested.
- Preview URLs in the verification email use the exact Vercel preview host only when `VERCEL_ENV=preview` and `VERCEL_URL` is a valid Vercel hostname; otherwise links target `https://www.dajc.eu`.

## Required QA
1. Migrate isolated preview DB; confirm only subscription/rate-limit table grants are assigned to the runtime user.
2. Keep the feature disabled in prod. Verify fallback `mailto` remains accessible with JavaScript off and on mobile.
3. Enable on preview only. Test both opt-in purposes with controlled synthetic test inboxes; ensure no automatic subscription after mere link opening.
4. Test bad origin, wrong content type, invalid email, wrong purpose, no consent, honeypot, repeated requests, rate-limit expiry, no database, unavailable Resend, expired/replayed token and double-submit.
5. Confirm unsubscribe removes only the selected address/purpose, never both purposes; test the independent manual removal route.
6. Verify privacy notice accurately reflects deployed behaviour, and establish scheduled cleanup that does not depend on new signups.
7. Owner reviews full preview evidence, then approves merging and activation explicitly. Check Vercel deployment variables and actual incoming mail before marking ACTIVE.

## Newsletter dispatch is a separate release gate
This PR implements the **consent acquisition and cancellation** service. It does not autonomously send EU Oversize Weekly, perform bulk mailings or automatically announce commercial availability. Distribution needs a separate consent-scoped, reviewed sender job with unsubscribe support, bounce/complaint handling, idempotent batch tracking and deliverability testing. No newsletter delivery should be claimed before this workflow is implemented.
