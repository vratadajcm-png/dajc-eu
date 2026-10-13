# DAJC X publication – operational setup

The official account is [@DAJCeu](https://x.com/DAJCeu). This integration publishes the *newly released* Friday EU Oversize Weekly edition and its canonical article URL. It is deliberately independent from the Thursday generation pipeline and does **not** expose credentials in the static Astro site or in this public repository.

## Activation (currently disabled by default)

1. In the official [X Developer Console](https://console.x.com/), sign in as `@DAJCeu`, use **DAJC Publisher** with **Read and Write** access and enable **OAuth 1.0a User Context**. Verify current prices, existing credit and a monthly spending cap no higher than the owner's approved **USD 2**. No automatic credit purchase or top-up is authorized. Do not activate if these conditions cannot be enforced.
2. In GitHub repository `vratadajcm-png/dajc-eu` -> **Settings -> Secrets and variables -> Actions -> Secrets**, securely create `X_API_KEY`, `X_API_SECRET`, `X_ACCESS_TOKEN`, `X_ACCESS_TOKEN_SECRET`. Create/generate **user** access token and secret for the *DAJCeu* account **after** enabling Read and Write; do not paste secrets into issues, source code, PR comments, or ChatGPT. A bearer-only app token will not work.
3. Run **Actions -> Publish DAJC EU Oversize Weekly on X -> Run workflow** with `dry_run=true` (the default). It previews text without any API request or cost. Outside the 48-hour release window it correctly reports no eligible edition.
4. Once the account, billing, dry run and permissions are verified, create the **Actions repository variable** `DAJC_X_ENABLED=true`. This explicitly enables live scheduled publication; otherwise all schedules skip. A manual live run requires the same variable.

## Scheduling and release gate

The article is committed on Thursday but becomes public only on Friday **12:00 Europe/Prague**. This separate workflow checks on Friday 13:17 and 17:23 and Saturday 10:37 **Europe/Prague** (GitHub schedules may be delayed). It requires a matching `published` article in `src/content/news/eu-oversize/`, checks its `publishedAt` matches the Friday release and is not in the future, then verifies the public HTTPS article URL serves HTML. It only sends the current edition (not historical backfill), using `POST https://api.x.com/2/tweets` with OAuth 1.0a user context. Before sending, `GET /2/users/me` must identify `@DAJCeu`; this read may also incur API charges. An absent or unavailable article never triggers a post.

## Preventing duplicates and handling errors

The durable public *nonsecret* ledger is `data/x-publications.json` on
**`automation/x-publications`**, not the bootstrap snapshot on `main`.
The workflow imports only that JSON, saves a `pending` reservation to the
data branch, then performs **one** API POST. A failed reservation push
prevents the POST. On success it saves `published` with the post ID/URL to
the same data branch. No X ledger commit writes to `main`, so main protection
does not need a bot bypass. A stale writer or rejected push fails closed.

If the workflow fails after reserving (including an ambiguous X timeout),
**do not automatically retry**: all subsequent live runs load the durable
ledger and stop on `pending`. Check `@DAJCeu` and reconcile that data branch
after owner review. Never blindly delete a `pending` record: it may represent
a successfully published post whose confirmation failed. Do not run
concurrent publishers outside the workflow. See [main protection](MAIN_PROTECTION.md).

## Authentication verification and HTTP 401

`Verify DAJC X integration` defaults to checking secret presence without an
X request. Its summary says **NOT TESTED**; green does not mean OAuth works.
Use `check_x_account=true` only for the authorized account read. Only a
successful `GET /2/users/me` identifying `@DAJCeu` verifies the connection.

For HTTP 401, verify that the API key/secret and user token/secret all belong
to DAJC Publisher. Regenerate the user token pair after enabling Read and
Write, update all four GitHub secrets securely, then perform one account
read. The publisher rejects whitespace and wrapping quotes locally and
does not log signed headers, response bodies or credential values. No
test post is required. HTTP 402 is a credit/billing blocker and does not
authorize buying credits.

## Profile completion

- Account: `@DAJCeu`; display name: **DAJC**.
- Use the existing approved DAJC Cloud identity from the public website.
- Website: `https://www.dajc.eu`.
- Bio: “European heavy & oversized transport intelligence. Verified transport updates and digital tools in development. Built from real-world experience.”
- Verify the saved logo, bio and link by reading the profile back after saving.
  Do not imply that DAJC Platform is already a released production service.

New credentials, spend-limit changes and temporary shutdown should be handled through X Developer Console and GitHub Settings. To halt publishing immediately set `DAJC_X_ENABLED=false` or remove the secrets. The website and weekly article generation continue unaffected.

## Definition of done

- [ ] Developer account/API payment setup approved; `@DAJCeu` authorized
- [ ] Four GitHub secrets installed (values never exposed)
- [ ] Dry-run preview correct for the current publication slot
- [ ] `DAJC_X_ENABLED=true` set only after the above checks
- [ ] Profile has the approved DAJC logo, company description and website link
- [ ] Account-read verification passes without a test post
- [ ] Next real Friday article is shared exactly once; durable ledger shows `published` and the correct X link
