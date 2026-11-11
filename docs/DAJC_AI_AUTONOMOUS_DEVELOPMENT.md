# DAJC AI — Autonomous Claude Development Pipeline

**Current runtime status (10 Nov 2026): REGISTERED ON MAIN, SCHEDULE OFF.**
Bootstrap PR #114, Claude action model fix #115 and output.txt publisher fix
#116 are merged. First three manual trials rejected an old ignored CLI model
input with HTTP 404 and 0 tokens; supervised manual run #4 successfully called
`claude-sonnet-5-5` (reported USD 0.2453265) but the publisher rejected the
action-generated `output.txt`. Fixed in #116; run #4 source test was recovered
into draft PR #117. **Post-fix successful publisher + independent review not
yet verified.** No autonomous release or schedule activation is approved.
For overall product design and sources read
[AI Build Source Map](DAJC_AI_BUILD_SOURCE_MAP.md) and
[Official Source Registry](DAJC_AI_SOURCE_AND_CONNECTOR_REGISTRY.md).

**The remaining text is the original pipeline design record and is
historical where it calls the workflow "staged" or "not tested".**

## Operating controls — 11 Nov 2026

| Control | Where | Effect |
|---|---|---|
| Schedule kill switch | repo variable `DAJC_CLAUDE_AUTONOMY_ENABLED` | Only `true` lets the weekday 03:30 UTC schedule run; unset/`false` stops it at once. Disabling the workflow in Actions also stops manual runs. Independent of Platform's `DAJC_AUTONOMY_ENABLED`. |
| Weekly paid-run cap | `DAJC_CLAUDE_WEEKLY_RUN_CAP` (default 6) | Counts runs in the last 7 days whose Claude step actually started; at the cap the job fails before any provider call. |
| No paid re-runs | `github.run_attempt == 1` | "Re-run" never repeats the Claude developer call or the Codex review; start a new run deliberately. |
| Per-run bounds | workflow | 30 turns (16 were exhausted by reading in run 42965067963, USD 0.35, no patch), action timeout 20 min, step timeout 25 min, job 45 min, one run at a time (concurrency group). |
| Usage evidence | job summary + artifact `dajc-ai-claude-usage` (90 days) | Cost and turns reported by Claude Code. Provider billing stays authoritative. |
| Owner documents | `.dajc-main-reference/` | Read-only copies of `AGENTS.md` and the AI source/decision docs from `main`, because the development branch lacks them. Deleted before the patch is exported. |
| Codex reviewer isolation | `safety-strategy: unprivileged-user` | codex-action v1.13 `drop-sudo` fails on hosted runners (`/run/dbus/system_bus_socket`). Codex now runs as a separate account without sudo and with read-only ACL access to the checkout. The runner writes `review.json` from the action output. |

| No deployments from autonomous work | `vercel.json` | `claude/autonomous-ai-*` branches never create a Vercel deployment (`git.deploymentEnabled`). An infrastructure-only commit whose message contains `[vercel skip]` is not built (`ignoreCommand`, opt-in per commit); every other commit, including all content and site changes, deploys exactly as before. |

These limits do not cap spend in dollars. Hard monthly limits must be set in
the Anthropic Console and OpenAI project settings; this workflow could not
verify them.

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


## Main-branch workflow registration

The workflow-only bootstrap PR is based on `main`, separate from the long
DAJC AI feature PR chain. Until those feature branches are integrated and
approved, development candidates are stacked on
`claude/dajc-ai-neon-knowledge-base`, not merged directly into main.
Change repository variable `DAJC_AI_AUTONOMY_BASE=main` only after that
upstream branch is safely integrated. The instructions file is always loaded
from trusted `main` in the development job.
