# DAJC AI — Phase A implementation plan (2026-11-05)

Status: **development only**; NOT a release authorization. The existing **Ask DAJC · FAQ** name and floating control must remain unchanged. No payment, provider key, production feature flag or live access is activated by this work.

## Current verified GitHub baseline

- PR #78: free Ask with email magic-link auth, daily/cost limits, source verification, no payments, default OFF. Draft, not merged.
- PR #90: reuses the existing FAQ as a gated entry to PR #78, dependent on that PR. Draft, not merged.
- PR #98: separate merge candidate for #96 + #97 + #78, not #90. Draft. Avoid reimplementing these modules.
- PR #96: legal verification must be per jurisdiction and reviewed month; do not mark unreviewed 2027 periods as verified.
- Legal/privacy review and necessary authenticated production runtime remain outstanding.

## Paid DAJC AI: agreed product boundaries

- Proposed single individual subscription: EUR 15/month, basic answers available free.
- Commercial operations must remain off until Phase B payment tests, actual legal operator, card merchant approval, tax/fiscal policy and written launch decision.
- Billing, cancellation, refund and accounting integration are a *separate* phase. Do not assume a provider's redirect proves settlement.
- Do not duplicate the central model orchestrator, Driving Bans registry, tenant entitlements, or FAQ.

## Safe longitudinal learning: first code increment

`src/lib/ask/learning/knowledge.ts` contains **only an offline policy kernel** with tests. It cannot persist data, execute a payment, activate a feature, or change any published legal facts.

1. Do NOT store questions/answers or the user's identity by default. Phase 1 stores content-free usage metrics and official source URLs only.
2. For a question-derived learning proposal, collect explicit opt-in **before** any reuse; require independent human sanitation and verified official source. Privacy/retention text and deletion pathways need legal review before collecting content.
3. All proposed knowledge starts PENDING; only authenticated authorized human reviewers may mark it approved. The pure function itself is not an authentication boundary.
4. Only source-backed, time-bounded approved material may be retrieved. Source quote is a citation aid, not permission to assert a specific route is legal.
5. Tenant-specific knowledge must never be returned to other organisations. No access to question, e-mail or bank details via this learning policy.
6. **Driving Bans are excluded.** Their only legal authority in DAJC is the existing published, human-verified Driving Bans register and its verified date scopes.
7. Reviewed knowledge must be revalidated as law and infrastructure change. Never fine-tune a model on users' raw conversations without distinct approved policy and dataset.

## Remaining Phase A delivery gates (not completed by this PR)

- Reconcile draft #78/#90 with #96 and #98 without duplicate routes, merge chains or legal-state regression.
- Validate user auth, session isolation, abuse controls, rate limiting and data deletion; run full test/typecheck/build/CI after integration.
- Finish paid AI entitlement flows behind an OFF flag; prove unauthenticated and unpaid requests cannot reach paid providers.
- Implement a persistent, permissioned review workflow only AFTER data retention, deletion, opt-in and reviewer RBAC have been approved.
- Run multilingual accessibility and verified-source safety QA; independent review of driving bans, permit advice and terms.
- Fix provider credit and infrastructure readiness issues before a live smoke test. Prevent uncontrolled AI spend.
- Keep live flags and paid checkout disabled until the owner approves customer release.

This PR targets #90 as a stacked draft so it can reuse the existing Ask implementation; it must NOT be merged into main ahead of its dependencies.

## Update — integration of the remaining gates

The account, paid subscription, billing adapters, accounting outbox, controlled
learning workflow and their tests are documented in
[DAJC_AI_PAID_OPERATIONS.md](DAJC_AI_PAID_OPERATIONS.md), with the state of each
area (IMPLEMENTED / TECHNICALLY READY / PRODUCTION READY), the launch runbook,
rollback and the remaining external blockers. All release constants stay false.
