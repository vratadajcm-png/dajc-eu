# DAJC News publishing to X and LinkedIn

## Scope and safety

DAJC.eu's already reviewed public News is the only source. EU Oversize
Weekly still requires owner review, green GitHub checks and PR merge
under MAIN_PROTECTION.md. Social publication never bypasses that gate.

Eligible articles:
- EU Oversize Weekly: public and no older than eight days.
- Platform Updates: public, no older than eight days AND frontmatter
  socialPublish: true (explicit editorial approval).
- Paid content must be transparently labeled before any opt-in.
- Nothing before 22 October 2026 is picked up retroactively.
- The live public article URL must return HTML containing the expected title.
- No unpublished drafts, future dates, private content or personal profiles.

The credential-free draft workflow (prepare-news-social.yml) remains separate.

> **Activated 24 October 2026 (owner decision).** X and LinkedIn teasers are
> published through Buffer by default. `DAJC_X_ENABLED` / `DAJC_LINKEDIN_ENABLED`
> are now off switches: setting either to `false` stops that channel; leaving it
> unset publishes. The account checks, the live-article check and the
> anti-duplicate ledger still apply to every post.

## X — @DAJCeu

Workflow: .github/workflows/publish-x-weekly.yml (handles all eligible News).
GitHub Actions secrets required:
X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_TOKEN_SECRET.

The existing publisher verifies /2/users/me == @DAJCeu and refuses
another account. Before enabling repo variable DAJC_X_ENABLED=true, verify
developer API authorization, corporate profile and spending cap.
No purchases or credit top-ups are automatic.

Publication state persists on branch automation/x-publications and file
data/x-publications.json. Existing records and historical weekly keys remain.

## LinkedIn — DAJC COMPANY page only

Workflow: .github/workflows/publish-linkedin-news.yml.
- GitHub secret: LINKEDIN_ACCESS_TOKEN
- GitHub variable: DAJC_LINKEDIN_ORGANIZATION_URN (format:
  urn:li:organization:<numeric ID>; NEVER a person URN)
- GitHub variable: DAJC_LINKEDIN_ENABLED=true only after verifying
  the company page, role, approved LinkedIn API access, w_organization_social
  and a valid token.
- LinkedIn permission is not granted automatically by a ChatGPT connector
  or a personal login; only the account owner can authorize that external app.
- Access tokens expire: renew in the approved OAuth app. Never paste tokens
  into chat, code, repository variables or PR text.

The script uses LinkedIn's official /rest/posts API with a company author.
Records are persisted to branch automation/linkedin-publications and file
data/linkedin-publications.json. There is no personal-profile fallback.

## Posting and recovery

Each enabled workflow checks eligible public content after a merged News
commit and twice daily (Europe/Prague). It handles one new item per run.

1. Before any social POST, verify public article readiness and credentials;
   write a reserved pending record into the channel's JSON ledger.
2. Push the pending reservation to the dedicated automation branch BEFORE
   making the irreversible API request.
3. Attempt one POST, requiring the current GitHub run to own the reservation.
   On success, persist the platform post ID and URL.
4. If API result is ambiguous (timeout, malformed confirmation, etc.), leave
   the record pending and block retries until it is reconciled manually
   against the social profile. Never clear a pending record blindly.

The workflows remain DISABLED by default. A manual dry_run=true produces
copy only, with no token, API charges, social posts or state changes.

If the official LinkedIn organization API cannot be authorized, an account
owner can instead connect an approved publishing service such as Metricool;
that must be a deliberate external connection.


## Alternative: Buffer free plan (no new LinkedIn Developer application)

Buffer's official GraphQL API (https://developers.buffer.com/) supports X and
LinkedIn channels, including the Free plan. The existing GitHub posting
workflows can optionally send through Buffer instead of direct X/LinkedIn APIs.

Requirements (human owner sign-in/consent at https://buffer.com/):
1. Sign up for the free plan, connect the exact X @DAJCeu account and the
   real **DAJC LinkedIn company page** via their own OAuth permissions.
   Do not connect the founder's personal LinkedIn profile. Confirm that the
   company page actually exists; absent pages cannot be authorized.
2. In Buffer Settings -> API create a personal API key. Store it in
   GitHub Actions **secret** BUFFER_API_KEY; never enter the key in chat.
3. Read the two channel IDs from Buffer. Store these GitHub repository
   **variables**:
      DAJC_BUFFER_X_CHANNEL_ID
      DAJC_BUFFER_LINKEDIN_CHANNEL_ID
   IDs are hex strings. The connector checks channel name, social service,
   account type and provider-reported public URL before posting.
4. For each authorized channel individually, set backend repo variable
   DAJC_X_BACKEND=buffer or DAJC_LINKEDIN_BACKEND=buffer.
   Only after verifying account access and a no-write dry-run should the
   existing master enable variables be set to true:
      DAJC_X_ENABLED=true
      DAJC_LINKEDIN_ENABLED=true

Without all prerequisites, every run stops at the Buffer key, channel or identity check before any reservation. Merely setting
the backend option cannot authorize the remote Buffer account.

Buffer returns a post ID but may not report that the content has already
appeared on the destination social network. Our ledger marks it as
"submitted" rather than falsely declaring a public post. Such submissions
are never repeated automatically. Verify delivery in the Buffer queue/social
feed. Buffer API publishing uses mode shareNow and schedulingType automatic.
See https://developers.buffer.com/types/ShareMode.html.

Do not subscribe to a paid social tool, buy X credits, or enable direct X
posting unless its actual cost has been approved separately.
