# Owner-decision and evidence escalation protocol
**Effective as a proposed development rule (2026-11-10)**; applies to the product in this repository. This document is not a delegation of release, spending or external contract authority.

## Decision and evidence states
- `PROCEED_APPROVED`: requirement already authorised by product master; enough inputs for testable synthetic implementation. Continue in a PR without unnecessary user questions.
- `NEEDS_EVIDENCE`: exact primary legal/provider API source, customer right or signed terms unavailable. Open a source-gap issue and develop fixtures/mock contracts only; no live usage.
- `DECISION_REQUIRED`: two legitimate architectural/product/commercial alternatives have material consequences; request owner choice and do not commit to a side.
- `BLOCKED_OWNER`: specific release, costs, bank/insurance activity, production integration, credential or irreversible change is prohibited until the owner signs off.
- `SAFETY_BLOCK`: potential user/driver/crew safety, personal-data breach or unauthorised live operation. Halt the affected slice immediately; no silent fallback.

## How Claude/Codex reports a blocker
Create a GitHub issue assigned to `vratadajcm-png` where permissions allow, using the `Owner decision` issue template or an issue with the exact fields below. Use short subject such as `[OWNER DECISION] TAR-001 — transform repository or create clean TAR?`. Do not write confidential partner terms, credentials, names of private mail recipients or personal data in the public AI repository.

Required issue fields:
1. **Product and stable decision ID**, severity: blocking now / later / source-gap.
2. **The one question** to be decided, phrased in Czech, with at most three concrete options.
3. **Recommendation** with why; measurable downside, privacy/safety implications and expected effect on monthly API/provider spend.
4. **What is confirmed** (link to canonical master paragraph + dated primary evidence/PR/commit) and **what is not verified** (contract, scope, credential, official API).
5. **What can continue safely** in autonomous dev while awaiting decision (mock interfaces, tests, independent approved modules).
6. **Definition of answered**: exact owner comment or accepted ADR/commit, not model inference or GitHub green check.
7. **Follow-up**: update owner decision log and product master, link implementation issue and tests; close issue only after read-back.

If the automated developer has no GitHub issue write token (intentional security measure), it must state `BLOCKED_OWNER` and this same structured request in the PR description, log/artifact or review result. A separate trusted publisher or daily issue audit can register the issue. **Never elevate the AI runner's privileges or give it a GitHub write token just to post a question.**

## Notification path to the owner
- **Primary**: a GitHub issue assigned to `vratadajcm-png`, with a clear `[OWNER DECISION]` title and a mention. The owner's GitHub app/e-mail notification requires the user to allow *Assigned / Participating* notifications; creation by the same logged-in user may not itself send push.
- **Fallback**: a scheduled read-only ChatGPT check of GitHub issue queues across the three DAJC product repositories, notifying only on newly opened/unanswered or materially changed blocking requests; do not repeat identical requests every day. The scheduled check is separate from writing documentation and does not resolve issues without owner input.
- **Nonurgent**: weekly review of source gaps and candidate integrations; do not interrupt the owner for ordinary code implementation decisions already bounded by masters/ADRs.
- **Critical**: safety, security, production access, new paid data/provider subscription, product scope, API disclosure, privacy/retention, actual customer contract and interproduct billing always need explicit owner confirmation.

## How the owner answers
A comment `SCHVALUJI možnost B, platí pro TAR-001, datum, omezení...` or clear equivalent can be attached to the issue. An AI recommendation, a thumbs-up without context or mere PR merge is not a signed agreement with an external vendor. The owning developer records decision in the *canonical* Google Drive master/ADR and in a dated codebase decision log, updates test contracts, then links the resolving PR. Never treat silence as acceptance.
