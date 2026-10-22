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
