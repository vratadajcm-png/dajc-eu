# DAJC AI — Autonomous Claude Development Pipeline

**Status: DRAFT / INACTIVE.** Configuration staged in a draft PR, with no
live API calls, paid run, release, merge or production change performed.

## Product and repository boundaries

- Product: **DAJC AI only** (Ask DAJC and official-source knowledge base).
- Repository: `vratadajcm-png/dajc-eu`.
- Initial work is stacked on the current DAJC AI knowledge-base draft PR #111,
  which itself follows #108. Merge/rebase the AI chain **with verified CI
  and owner approval** before considering pipeline activation on `main`.
- Other products, marketing/public publication, Platform and TAR are untouched.
- Current commercial model: **three free questions per user per day; optional
  support via /support gives no extra questions**. No paid entitlement is approved.

## Architecture

1. `dajc-ai-autonomous-claude.yml` can be manually dispatched by a repository
   maintainer or scheduled on weekdays at **03:30 UTC**. Scheduled runs remain
   disabled until repository variable `DAJC_CLAUDE_AUTONOMY_ENABLED=true`.
2. A read-only-permission **Claude Code development job** runs one bounded cycle,
   with no GitHub write token or production/Neon credentials. Its only permitted
   source edit paths are DAJC AI internals in `src/lib/{ask,ai,kb}/` and
   `src/pages/api/ask/`.
3. The job emits a patch artifact. A distinct job checks exact base HEAD, patch
   size, changed paths and symlinks. Invalid patches **fail closed**. Valid
   candidates go into an isolated `claude/autonomous-ai-<run>-<attempt>`
   **draft** PR; no merge or deployment.
4. Next scheduled cycle checks out a single existing autonomous draft PR as a
   durable checkpoint. If more than one such draft is open, it stops rather
   than guessing which to continue.
5. The publishing job explicitly dispatches the existing `application-ci.yml`
   on the candidate branch (unit tests, typecheck, build, bundle secret scan)
   and a separate independent Codex review on the same draft PR.
6. Codex reviews the **exact GitHub diff** using trusted default-branch prompt
   and a strict JSON result schema. Its publisher sets commit status
   `DAJC AI / independent Codex review` and leaves a PR comment.
   Errors/incomplete review fail closed. AI review is advisory, never release
   approval.
7. Human approval is required for merge, release, production deploy, feature
   flag flips, new billing, new services and database migrations.

## Necessary manual configuration — NOT done in this PR

- GitHub Actions secret `ANTHROPIC_API_KEY`: dedicated development API key,
  **not** a claude.ai subscription limit.
- GitHub Actions secret `OPENAI_API_KEY`: separate independent Codex reviewer.
- Optional repository variable `DAJC_CLAUDE_DEV_MODEL`: defaults to the
  published `claude-sonnet-5-5` model ID; set to override.
- Optional repository variable `DAJC_CODEX_REVIEW_MODEL`: when unset the
  Codex Action selects its supported default model.
- Repository variable `DAJC_CLAUDE_AUTONOMY_ENABLED`: leave unset or false
  until a **supervised manually triggered run** passes and owner explicitly
  approves recurring API spend.
- The repository must permit GitHub Actions to create draft pull requests
  using the workflow token (enable specifically after review).
- Set independent spending caps and alerts in Anthropic Console, OpenAI API
  and GitHub Actions. A 45-minute job timeout and --max-turns 12 are **not**
  monetary spending caps.
- Enforce branch rulesets for main: reject direct pushes, require the relevant
  application CI checks, independent review and **human** approval. Check the
  actual check/context names before locking rules.
- Do not expose Neon production, Vercel, payment gateway or private-source
  credentials to autonomous jobs.

## Limits, restart and failure behavior

This pipeline does **not** observe or reset a five-hour claude.ai or Claude
Code subscription quota. It uses separate API billing and rate limits.
If an API request fails (e.g. HTTP 429), the run fails; the next scheduled
run can attempt another bounded cycle after limits or credit recover. The
workflow does not dynamically schedule itself at the exact reset timestamp.
The durable draft PR preserves committed work, not the exact private model
conversation context.

GitHub scheduled jobs operate in UTC, may be delayed, and run only when
the workflow exists on the repository's default branch.

Existing separate KB import/AI verification workflows retain their
owner-label/manual approval and development-only credentials. This pipeline
neither starts them nor bypasses those controls.

## Verification and next steps

Before enabling:
1. Review upstream DAJC AI PR #108 and PR #111, reconcile dependencies,
   and review this draft PR.
2. Run deterministic local/static CI. Resolve any issues without bypasses.
3. Set dedicated keys/model choices and budgets, confirm Action permissions.
4. Perform **one supervised paid manual Actions trial** and inspect the draft,
   CI results, Codex review and consumption.
5. Only then enable the schedule; continue monitoring costs, security,
   reviewer quality and open PR accumulation.

No live run has been executed as part of staging this configuration.

## Recovery and activation blockers — 2026-11-10

- Autonomous manual run `42677240647` produced a candidate, but the publishing job correctly rejected an extra generated `output.txt` artifact. Only the audited source change was recovered as draft PR #117: https://github.com/vratadajcm-png/dajc-eu/pull/117.
- Resolve PR #117's application/news CI failures on its exact head SHA; do not bypass source-only artifact validation or treat a successful developer step as a successful autonomous cycle. Confirm the candidate can be safely resumed without duplicate draft PRs.
- Bootstrap #114 has a workflow on `main`, but its safety changes have not been reconciled with this PR #112. Compare and port hardened baseline SHA, review TOCTOU and branch validation before enabling recurring schedules.
- Dedicated provider keys and enforced API budgets are not verified through the current connector. Do not set `DAJC_CLAUDE_AUTONOMY_ENABLED=true` or run paid manual trials until an authorized owner verifies the spend caps and approves a bounded test.
