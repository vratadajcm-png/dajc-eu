# DAJC Partner Access Governance/Portal

A private, disabled-by-default governance layer for administering external
partners who will eventually consume DAJC data through a future **DAJC
Outbound Partner/Public API**. This is **not** part of the D-ID / transport
core DAJC Platform - it is a separate access-governance system that happens
to be operated on `dajc.eu`'s infrastructure.

It ships fully built but **must stay unreachable** until the DAJC Platform
owner explicitly turns it on. See "The feature gate" below - this is the
single most important fact about this subsystem.

## Architectural boundary

```
Partner Portal  ->  partner identity  ->  grants  ->  scopes  ->  approved API client
                                                                        |
                                                                        v
                                                        DAJC Outbound API Gateway
                                                                        |
                                                                        v
                                                     authorized data projections
```

The Partner Portal manages **who may get access**. A future DAJC Outbound
API Gateway (not part of this repo) manages **what data they actually
get**. This repo never gives an external partner direct database access,
never stores a long-lived API secret, and never implements a full OAuth
authorization server - `src/portal/db/schema.ts`'s `apiClients` table is a
metadata registry/contract for that future system, not a credential store.

## Audit of the existing repo (2026-08-20)

dajc.eu was, before this change, a **100% static Astro site**
(`output: 'static'`, no adapter) deployed to Vercel via Git integration on
`main`. There was no server runtime, no auth, no database, and no email
infrastructure - the only external API call in the repo
(`scripts/lib/openai-client.mjs`) is for AI-assisted news content
generation, not email. Content lived in Zod-validated Astro content
collections (`src/content.config.ts`). The one existing precedent worth
noting: `src/content.config.ts`'s provider schema already uses a
deny-by-default, explicit-approval pattern (`status: 'active'` +
`logoApproved` + `descriptionApproved`) - the same philosophy this portal
applies at the infrastructure level.

Because none of auth/DB/email/admin/sessions existed, this phase had to
introduce them rather than reuse something already there. Where a real
choice existed, the decision and its rationale is recorded below instead
of being invented silently.

## What this phase added (the delta)

- **Rendering**: `astro.config.mjs` gained `adapter: vercel()`. `output`
  stays `'static'` (the default, unchanged) - every existing page keeps
  being prerendered at build time exactly as before. Only routes under
  `src/pages/partner-portal/**` opt out via `export const prerender =
  false`, so they run as real on-demand Vercel functions per request
  (required for a true server-side gate, sessions, and DB access - a
  static build cannot decide anything at request time). Verified: `npm
  run build` still emits the same four static pages
  (`/`, `/news`, `/news/platform/...`, `/partners`) byte-for-byte in
  `dist/`, and the portal routes are bundled separately into the Vercel
  server function.
- **Database**: Supabase Postgres, accessed via `drizzle-orm/postgres-js`
  (`src/portal/db/client.ts`, `src/portal/db/schema.ts`). Nine new tables,
  all prefixed `partner_portal_`, purely additive - see "Schema delta"
  below. No existing table or file was touched. The client connects
  lazily on first use, never at import/build time, so a missing
  `DAJC_PARTNER_DB_URL` cannot break `astro build`.
- **Email**: Resend (`src/portal/lib/email.ts`), sending only invitation
  and magic-link emails from `team@dajc.eu`. Two independent conditions
  must both hold before a real email is sent - see "Email safety" below.
- **Auth**: passwordless magic-link sessions, shared by ADMIN (allowlisted
  DAJC staff) and PARTNER_CONTACT principals (`src/portal/lib/session.ts`,
  `src/portal/lib/magicLink.ts`). No passwords anywhere in this system.
- **Tests**: `vitest` (new dev dependency), `npm run test`, scoped to
  `src/portal/__tests__/**`. The rest of the repo has no test suite to
  integrate with.

## The feature gate

```
DAJC_PARTNER_PORTAL_ENABLED=true   # only this exact string enables it
```

Anything else - unset, empty, `"TRUE"`, `"1"`, `"false"`, a typo - leaves
the portal fully disabled. Enforced in two independent layers:

1. **`src/middleware.ts`** - Astro global middleware. Every request whose
   path is `/partner-portal` or starts with `/partner-portal/` is
   intercepted before any route handler runs; if the gate is off, it
   returns a `404` immediately (`next()` is never called).
2. **Every route independently** - each page/endpoint under
   `src/pages/partner-portal/**` also calls
   `notFoundIfPortalDisabled()` (`src/portal/lib/guards.ts`) itself. This
   is intentional redundancy: a route added later that somehow bypassed
   the middleware still fails closed on its own.

Additional belt-and-suspenders, applied even when the gate is on:
`X-Robots-Tag: noindex, nofollow, noarchive` and `Cache-Control: no-store`
on every portal response (set in the middleware and again via
`<meta name="robots">` in `src/portal/components/PortalLayout.astro`), the
sitemap integration in `astro.config.mjs` explicitly filters out
`/partner-portal/**`, and nothing in the public site
(`src/components/Header.astro`, `Footer.astro`, any page) links to it.

**Verified live** (see "How this was verified" below): with the env var
unset, every portal path returns a real HTTP 404 with those headers, and
existing public pages are untouched.

## Email safety

Two conditions must **both** hold before `src/portal/lib/email.ts` sends a
real email via Resend:

1. `DAJC_PARTNER_PORTAL_ENABLED === 'true'` (checked inside the email
   functions themselves, not just at the calling route).
2. `DAJC_PARTNER_EMAIL_MODE === 'live'` **and** `RESEND_API_KEY` is set.

Any other combination uses `DevNoopEmailSender`, which never makes a
network call - it only logs. This means local dev, CI, and any preview/
staging deployment that doesn't explicitly set `DAJC_PARTNER_EMAIL_MODE=live`
cannot ever reach a real partner's inbox, even with a real API key
accidentally present in that environment.

## Data model / schema delta

`drizzle/0000_rare_bug.sql`, generated by `npx drizzle-kit generate` from
`src/portal/db/schema.ts`, has **never been applied to any database** -
generation only reads the schema file, it does not connect anywhere. It is
purely additive: 9 new tables (`partner_portal_partners`,
`partner_portal_contacts`, `partner_portal_invitations`,
`partner_portal_api_clients`, `partner_portal_access_grants`,
`partner_portal_login_tokens`, `partner_portal_sessions`,
`partner_portal_audit_log`, `partner_portal_rate_limit_events`), no
existing table touched. To apply it to a real Supabase project once
`DAJC_PARTNER_DB_URL` is provisioned: `npx drizzle-kit migrate` (review the
SQL file first - nobody should run this against production without
reading it).

Key design decisions baked into the schema:

- **Raw tokens are never stored** - invitations, login links and sessions
  all persist only a SHA-256 digest (`tokenHash`), never the raw value
  (`src/portal/lib/tokens.ts`). The raw token exists only in the email
  link / cookie.
- **`api_clients` has no secret column.** This phase is a registry/
  contract for a future real OAuth authorization server, not one itself.
- **A grant always references a specific `api_client` and `tenantRef`.**
  `orders.read` alone is never access to all DAJC data -
  `src/portal/lib/accessGrants.ts#createAccessGrant` enforces that the
  grant's environment matches its client's environment, and that the
  partner's overall status is consistent with the environment being
  granted (no PRODUCTION grant unless the partner itself is PRODUCTION).
- **Partner status is never written directly.** Every transition goes
  through `src/portal/lib/partnerLifecycle.ts`, which validates the
  current state before allowing the next one and writes the audit event
  in the same DB transaction as the state change - see the sandbox ->
  production lifecycle below.
- **Audit log is append-only by convention**: `src/portal/lib/audit.ts` is
  the only module that writes to it, and exposes no update/delete.
  Hardening the DB role itself (`REVOKE UPDATE, DELETE`) is a deployment
  step that needs access to the Supabase project - tracked as TODO below.

## Sandbox -> production lifecycle

```
PENDING --verify--> VERIFIED --enable sandbox--> SANDBOX --approve production--> PRODUCTION
   |                    |                            |                              |
   +----------------suspend (admin, any active status)-----------------------------+
   |                                                                                 |
   +--------------------------- revoke (terminal, any status) ---------------------+
```

Every arrow is a distinct administrator action in
`src/portal/lib/partnerLifecycle.ts` (`verifyPartner`, `enableSandbox`,
`approveProduction`, `suspendPartner`, `revokePartner`), each validating
the partner's current status server-side and writing an audited event.
`approveProduction` is never automatically derived from a working
sandbox - a partner cannot elevate its own status; only an
`requireAdminPrincipal`-gated admin route can call these functions.
`revokePartner` also revokes every non-revoked `api_client` for that
partner in the same transaction.

## Security notes

- **Deny-by-default** everywhere: the portal gate, the admin allowlist
  (`DAJC_PARTNER_ADMIN_ALLOWLIST` empty/missing = nobody can log in), and
  access grants (zero rows = zero access) all fail closed.
- **CSRF**: double-submit cookie pattern
  (`src/portal/lib/session.ts#validateCsrfToken`) on every state-changing
  form, including pre-auth ones (login request, invitation activation) via
  `ensureCsrfCookie`.
- **Sessions**: httpOnly, `SameSite=Lax`, scoped to `/partner-portal`, 12h
  TTL, opaque token + server-side hash lookup (same no-raw-storage rule as
  invitations). `Secure` is derived from the actual request's protocol
  (`requestUrl.protocol === 'https:'` in `src/portal/lib/session.ts`), not
  `process.env.NODE_ENV` - a pre-commit review caught that NODE_ENV is not
  guaranteed to be `"production"` in Vercel's Node runtime for an
  adapter-built serverless function the way it is for Next.js, so trusting
  it could have silently shipped session/CSRF cookies without `Secure` in
  real production. Checking the request's own protocol is correct
  regardless of platform env-var behavior.
- **Rate limiting**: DB-backed (`src/portal/lib/rateLimit.ts`), not
  in-memory - each on-demand Vercel invocation is an independent process,
  so an in-memory counter would not actually limit anything. Applied to
  login requests, magic-link callbacks, and invitation acceptance.
- **No user enumeration**: login-request endpoints return the identical
  response whether or not the email is allowlisted/has an active contact
  (`src/portal/lib/magicLink.ts`); invitation activation shows the same
  generic "invalid or expired" message for every failure reason
  (not-found, expired, revoked, already-used) while still recording the
  specific reason internally in the audit log.
- **Replay protection**: invitation acceptance and magic-link consumption
  both flip their token's status inside the same transaction that
  validates it, and - as of the pre-commit review - both now also check
  the affected-row count of that update (`invitations.ts#acceptInvitation`,
  `magicLink.ts#consumeLoginToken`). The initial bug: the UPDATE's `WHERE`
  clause alone provides a correct compare-and-swap at the Postgres level
  (only one of two concurrent transactions using the same raw token can
  actually flip the row, the loser affects zero rows), but the code wasn't
  checking that, so the "losing" concurrent request would silently fall
  through and still get a session minted - defeating single-use under a
  race even though the DB row itself only ever flipped once.
  `consumeLoginToken`'s UPDATE was worse: it had no CAS condition
  (`consumedAt IS NULL`) at all, so a true concurrent replay could re-mint
  a session even without racing a fresh read. Both are fixed; every
  rejected re-use (including race losers) is audited as
  `invitation.replay_rejected` / `login.failed` with a `concurrent_use`
  reason.
- **Secret redaction**: `src/portal/lib/audit.ts#redactMetadata` strips any
  metadata key that looks like a secret/token before it reaches the audit
  table, as defense-in-depth on top of "never pass one in".
- **Output encoding**: the only place user input is interpolated into raw
  HTML (email bodies in `src/portal/lib/email.ts`) is escaped
  (`escapeHtml`); all Astro page templates use `{}` expressions, which
  Astro escapes by default.
- **Tenant isolation**: a partner contact's session only ever resolves
  data scoped to `contact.partnerId` (`requirePartnerContactPrincipal` in
  `src/portal/lib/session.ts`); there is no route that accepts an
  arbitrary partner/grant/invitation ID from a non-admin session.
- **Grant expiry**: `isGrantActive()` (`src/portal/lib/accessGrants.ts`) is
  the single source of truth for "is this grant currently active" -
  `!revokedAt`, and, if `expiresAt` is set, not yet past it. The partner
  dashboard's "active grants" list uses it; a pre-commit review caught
  that it had originally only checked `revokedAt`, which would have shown
  a lapsed-but-not-explicitly-revoked grant as still active.
- **Admin authority is intentionally global, not partner-scoped**: admin
  actions on a sub-resource (`revoke_invitation`, `revoke_grant`,
  `rotate_client`, `revoke_client` in
  `src/pages/partner-portal/admin/partners/[id].astro`) take that
  resource's own ID and act on it without re-checking it belongs to the
  `partnerId` in the URL. This is by design, not a gap - there is only one
  admin realm with authority over every partner (see spec section 8) - but
  it does mean the audit log's `partnerId` on those events always comes
  from the resource's own DB row, never from the (possibly mismatched) URL
  param, so the audit trail stays accurate even if a request mixed IDs
  from two different partner pages. `createAccessGrant` is the one
  exception that already re-validates its `apiClientId` belongs to the
  given `partnerId` (`src/portal/lib/accessGrants.ts`), because a mismatch
  there would let a grant reference a client environment it wasn't
  validated against.

## Known TODOs / not yet done

- **DB role hardening**: once a real Supabase project is provisioned,
  create a dedicated role for the app connection with `INSERT`/`SELECT`
  only (no `UPDATE`/`DELETE`) on `partner_portal_audit_log`, enforcing
  append-only at the database level, not just by convention.
- **Un-suspend flow**: `suspendPartner` has no corresponding "lift
  suspension" admin action yet - out of scope for this phase.
- **Rate-limit table growth**: `partner_portal_rate_limit_events` has no
  scheduled cleanup job yet; old rows accumulate. Fine at low volume, but
  needs a periodic delete (e.g. a cron) before real traffic. The same gap
  applies to expired `partner_portal_invitations`, `_login_tokens` and
  `_sessions` rows - they're never deleted, only treated as invalid on
  read (lazy expiry). Fine for a private, low-volume governance portal;
  worth a periodic cleanup before meaningful traffic.
- **Rate limiter has a non-atomic check-then-insert race**:
  `checkAndRecordRateLimit` (`src/portal/lib/rateLimit.ts`) does a
  `SELECT count(*)` then an `INSERT`, not a single atomic operation - a
  burst of truly concurrent requests could each read a count below the
  limit before any of them inserts, allowing slightly more than
  `maxAttempts` through in a tight race. Bounded by realistic concurrency,
  not a full bypass (email enumeration and login are separately protected
  by the allowlist/generic-response pattern), but worth a single atomic
  SQL statement (e.g. an `INSERT ... SELECT` with a `HAVING count(*) <
  limit` guard, or an advisory lock) if this ever needs to be precise.
- **Partner lifecycle transitions don't row-lock the partner during
  read-then-write**: `verifyPartner`/`enableSandbox`/`approveProduction`/etc.
  (`src/portal/lib/partnerLifecycle.ts`) `SELECT` the partner, check its
  status in application code, then `UPDATE` - without `SELECT ... FOR
  UPDATE`, two concurrent calls to the same transition (e.g. an admin
  double-clicking "Enable sandbox") could both read the same starting
  status before either commits, each inserting its own `api_clients` row
  (there's no unique constraint on `(partner_id, environment)` to catch
  this at the DB level either). Admin-only, self-inflicted, not a
  privilege issue - just a data-hygiene gap worth a `FOR UPDATE` lock or a
  partial unique index later.
- **`npm audit`**: 7 advisories (3 high, 4 moderate), none in code reachable
  from a deployed request. Breakdown by directness/reachability:
  - **Direct, build-time-only**: `@astrojs/vercel` (high, via
    `@vercel/routing-utils` -> `path-to-regexp` ReDoS) - this dependency
    chain runs during `astro build` to turn our own fixed route file
    structure into Vercel's `config.json` routing rules; it does not
    re-execute against untrusted request data at runtime (verified: Vercel
    routes are interpreted by Vercel's own edge router from the generated
    `config.json`, not by re-invoking this library per request). `drizzle-kit`
    (moderate, via `@esbuild-kit/esm-loader` -> `esbuild`) - a local CLI
    tool (`npx drizzle-kit generate`) never imported by the deployed app;
    it's a `devDependency`.
  - **Transitive**: `@vercel/routing-utils`, `path-to-regexp`,
    `@esbuild-kit/core-utils`, `@esbuild-kit/esm-loader`, `esbuild` - all
    pulled in only by the two direct packages above, same reachability
    analysis applies.
  - **Runtime-relevant**: none. `drizzle-orm`, `postgres`, `resend`, `zod`
    (the packages actually imported by `src/portal/**` at request time)
    have zero advisories.
  - `npm audit fix --force` was deliberately **not** run - it downgrades
    `@astrojs/vercel` to `8.0.4` and `drizzle-kit` to `0.18.1`, both major
    regressions from what's installed now (`11.0.7` / `0.31.10`). Worth a
    deliberate look at whether upstream has shipped a non-breaking fix
    later, not an automatic downgrade now.
- **This document's own claims decay.** Before relying on anything above
  as still true, check the code it references still exists as described -
  see the repo-wide guidance on treating memory/docs as a snapshot, not a
  live source of truth.

## How this was verified

- `npm run typecheck` (`astro check`): 0 errors, both before and after the
  pre-commit review's fixes.
- `npm run build`: succeeds; the four pre-existing static pages are
  emitted unchanged; portal routes bundle into the Vercel server
  function; `sitemap-index.xml`/`sitemap-0.xml` contain no
  `/partner-portal` entries. The built server bundle
  (`.vercel/output/_functions/chunks/session_*.mjs`) was inspected
  directly to confirm the `secure` cookie fix actually changed the
  compiled output, not just the source.
- `npm run test` (vitest, `src/portal/__tests__/**`): **94 tests / 7
  files**, all passing - feature-gate truth table (every non-`"true"`
  value of the env var, for both `isPartnerPortalEnabled()` directly and
  the actual `src/middleware.ts#onRequest` handler across every portal
  path), token/hash correctness, admin-allowlist deny-by-default, CSRF
  double-submit logic, audit metadata redaction, and the grant
  active/expired/revoked invariant added during the pre-commit review.
- Live `astro dev` smoke test, re-run after the review's fixes: with the
  env var unset, every portal path returned a real `404` with
  `X-Robots-Tag: noindex...` and `Cache-Control: no-store`, while `/`,
  `/news`, `/partners` returned `200` unaffected. With
  `DAJC_PARTNER_PORTAL_ENABLED=true` set only for that local process,
  `/partner-portal/admin/login` returned `200` and `/partner-portal/admin`
  (no session) correctly redirected to it - proving the gate actually
  flips routing behavior, not just a stub.
- `.vercel/output/config.json` was inspected directly: `"handle":
  "filesystem"` is the first routing rule, meaning every prerendered
  static page is served straight from disk/CDN and never even reaches the
  middleware/function - the adapter change cannot have altered their
  behavior, because they don't run through the new code path at all in
  production. Only `/partner-portal/**` routes are mapped to the `_render`
  function.
- No database, Resend account, or Vercel project settings were touched -
  none of this was tested against real infrastructure because none was
  provisioned for this phase.

## Deployment safety

This repo deploys to Vercel automatically on every push to `main`
(`README.md`, `scripts/vercel-ignore-build.sh`). Nothing in this phase was
pushed or committed - see `git status` in the final task summary. Before
this is ever merged to `main`:

- `DAJC_PARTNER_PORTAL_ENABLED` must **not** be set to `true` in the
  Vercel project's environment variables - its absence (or `false`) is the
  safe default this whole design relies on.
- `DAJC_PARTNER_DB_URL` / `RESEND_API_KEY` do not need to exist in
  production yet; the portal works (stays gated) without them.
- No DNS, Vercel project setting, or production environment variable was
  changed by this work.
