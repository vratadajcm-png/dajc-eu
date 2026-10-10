# DAJC X publication – operational setup

The official account is [@DAJCeu](https://x.com/DAJCeu). This integration publishes the *newly released* Friday EU Oversize Weekly edition and its canonical article URL. It is deliberately independent from the Thursday generation pipeline and does **not** expose credentials in the static Astro site or in this public repository.

## Activation (currently disabled by default)

1. In the official [X Developer Console](https://console.x.com/), sign in as `@DAJCeu`, create an app with **Read and Write** access and enable **OAuth 1.0a User Context**. Check the current X API pay-per-use price and set a small credit/spend limit. X currently lists **$0.20 per post with a URL**, in addition to a possible account identity read.
2. In GitHub repository `vratadajcm-png/dajc-eu` -> **Settings -> Secrets and variables -> Actions -> Secrets**, securely create `X_API_KEY`, `X_API_SECRET`, `X_ACCESS_TOKEN`, `X_ACCESS_TOKEN_SECRET`. Create/generate **user** access token and secret for the *DAJCeu* account **after** enabling Read and Write; do not paste secrets into issues, source code, PR comments, or ChatGPT. A bearer-only app token will not work.
3. Run **Actions -> Publish DAJC EU Oversize Weekly on X -> Run workflow** with `dry_run=true` (the default). It previews text without any API request or cost. Outside the 48-hour release window it correctly reports no eligible edition.
4. Once the account, billing, dry run and permissions are verified, create the **Actions repository variable** `DAJC_X_ENABLED=true`. This explicitly enables live scheduled publication; otherwise all schedules skip. A manual live run requires the same variable.

## Scheduling and release gate

The article is committed on Thursday but becomes public only on Friday **12:00 Europe/Prague**. This separate workflow checks on Friday 13:17 and 17:23 and Saturday 10:37 **Europe/Prague** (GitHub schedules may be delayed). It requires a matching `published` article in `src/content/news/eu-oversize/`, checks its `publishedAt` matches the Friday release and is not in the future, then verifies the public HTTPS article URL serves HTML. It only sends the current edition (not historical backfill), using `POST https://api.x.com/2/tweets` with OAuth 1.0a user context. Before sending, `GET /2/users/me` must identify `@DAJCeu`; this read may also incur API charges. An absent or unavailable article never triggers a post.

## Preventing duplicates and handling errors

`data/x-publications.json` is a public *nonsecret* ledger. The workflow first commits and pushes a `pending` reservation, then performs **one** API POST. On success it commits `published` together with the X post ID and URL. If the workflow fails after reserving (including an ambiguous X timeout), **do not automatically retry**: all subsequent runs stop on `pending`. Check `@DAJCeu` manually and reconcile the ledger in a reviewed commit before a later attempt. Never blindly delete a `pending` record: it may represent a successfully published post whose confirmation failed. Do not run concurrent publishers outside the workflow.

New credentials, spend-limit changes and temporary shutdown should be handled through X Developer Console and GitHub Settings. To halt publishing immediately set `DAJC_X_ENABLED=false` or remove the secrets. The website and weekly article generation continue unaffected.

## Definition of done

- [ ] Developer account/API payment setup approved; `@DAJCeu` authorized
- [ ] Four GitHub secrets installed (values never exposed)
- [ ] Dry-run preview correct for the current publication slot
- [ ] `DAJC_X_ENABLED=true` set only after the above checks
- [ ] A live, user-authorized test published exactly once; ledger shows `published` and correct X link
- [ ] Next Friday published article is detected and shared without manual action
