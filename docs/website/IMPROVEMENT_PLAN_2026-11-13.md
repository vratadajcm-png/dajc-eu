# DAJC Website Improvement Plan — 13 November 2026

**Status:** approved by owner; staged implementation in review PRs. This is a delivery and acceptance plan, not a claim that the changes are live.

## Scope and governance

- `dajc-eu` (Astro): primary European website and product pages.
- `dajc-cz` (Next.js): Czech information site. Maintain both domains; do not redirect the domain without search and traffic evidence.
- Keep DAJC Platform, DAJC TAR and DAJC AI conceptually distinct. TAR is a first-class proposed product, not a footer-only research footnote. Do not claim live integrations, signed partnerships, commercial availability or a confirmed release date.
- Canonical **pre-production Platform testing window: Q3 2027 (July–September)**; exact start date unconfirmed.
- Historical news items retain original publication context with visible schedule amendments when necessary; do not silently rewrite history.
- Do not modify `main`, deploy production, enable fees or change private investor/portal security without separate owner approval.

## P0 — trust and consistency (EU PR + Czech companion PR)

1. Replace obsolete *4 January 2027* testing assertions on **current** public pages; verify homepage, testing, investors, press, demo-guide, Czech landing and testing. Build automated source regression coverage. Historical announcements must carry a visible update.
2. State the consolidated name **DAJC TAR** for current product references, preserving old name only with historical context and/or redirect.
3. Fix broken public links (especially `dajc.cz/kontakt`, `dajc.cz/aktuality`) and run link checks on generated pages; do not imply a form exists until operational.
4. Align investor and media fact sheets with Platform Q3 2027, TAR stage, limitations and evidence. Review archived collateral separately.
5. Correct `robots.txt` rules: public `/platform` and `/platform/integrations` must be crawlable while unpublished subroutes remain excluded from sitemap. Robots is not access control.

**Acceptance:** URL and date tests pass on both sites; CI passes; no broken public internal links; manual review of live/preview HTML; two domain deployments remain controlled by owner.

## P1 — verified conversion and evidence

6. Replace `mailto:` opt-in on `/updates` with a privacy-safe email form for independent interests: one-time launch notice and recurring newsletter. Implement explicit, distinct consents, double opt-in, unsubscribe, durable data storage, rate limiting, bot controls and deletion policy. Do not activate until database migration, sender/domain verification, signing secrets and e2e delivery tests succeed. Keep existing manual path as fallback until verified.
7. Reduce registration friction by asking first for a work email and optional interest, then soliciting detailed research profile; avoid silently converting leads into a testing commitment or ongoing newsletter. Honour explicit opt-in and lawful retention; test keyboard/screen-reader use.
8. Verify Platform/TAR market research end-to-end: submit → Neon row → admin overview/export (consent-scoped) → notification and retention. Use separate product metrics; do not infer customer interest from traffic alone.
9. Keep existing `/integrations`, `/platform/integrations`, `/tar/integrations`. Verify the actual technical-PDF workflow: verification email, seven-day download URL, expiry, revocation, rate limits, minimal logging. Never list unapproved provider names.

**Acceptance:** real preview/staging end-to-end evidence, email sender credentials, database grants/privacy review, owner-approved go-live. User personal data must never appear in logs or exported public artifacts.

## P2 — SEO and measurable growth

10. Test HTTP redirects, trailing slash/canonical convergence, robots/sitemap alignment, hreflang between *equivalent* pages, mobile accessibility and article metadata. **Article schema already exists** in `ArticleDetail.astro`; validate rather than duplicate. Add BreadcrumbList only when actual navigational context supports it.
11. Use Google Search Console and PageSpeed/Core Web Vitals to measure impressions, indexing, SEO errors and actual performance. Record baseline and deltas; avoid invented metrics.
12. Preserve EU Oversize Weekly, official-source citations and editorial QA; add transparent opt-in newsletter distribution only once verified. Keep .eu as European primary and .cz as Czech landing site. DE localization is a future, evidence-based decision, not an immediate task.

**Acceptance:** generated sitemap URLs respond 200 and canonicalize correctly; no accidental private URL indexing; SEO and referral metrics captured with privacy safeguards; no unsupported numeric SEO claims.

## Release sequence

- **PR 1:** P0 content, robots and broken-link fixes + regression tests; Czech companion PR is required for Czech routes. No auto-merge or auto-deploy.
- **PR 2:** P1 email and market research improvements. Feature-gated until verified live infrastructure and owner sign-off.
- **PR 3:** P2 SEO/structured-data validation and instrumentation. No redirects of DAJC.cz without explicit approval.
- Independent, nonconflicting tasks can be developed in parallel; product development repositories remain untouched.
- If existing PRs carry the same change (e.g. legacy #79 date update), flag overlap and rebase/resolve without reverting already-correct main.

## Evidence checklist

- [ ] Source, typecheck, unit and build checks pass on exact PR HEAD
- [ ] Preview smoke tests of EU and CZ routes on actual preview deployments
- [ ] No stale *future* 4 January 2027 claims in current public pages
- [ ] Forms save reliably and emails deliver; consent can be revoked
- [ ] Accessibility review of forms, validation and error messages
- [ ] Robots/sitemap/canonical/hreflang checks against deployed HTML
- [ ] Owner approves merge and production deployment
