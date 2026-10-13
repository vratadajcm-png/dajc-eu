# Main protection and publication automation

Code and public articles reach `main` only through PRs with required CI.
The owner reviews changes before manually merging them. Neither
`GITHUB_TOKEN` nor a publication bot receives a bypass for main.

## Applied protection — 13 October 2026

Both public repositories have an active `DAJC main — PR and CI` ruleset,
matching `refs/heads/main` only. PRs, resolved review conversations and an
up-to-date branch with passing checks are required. Force pushes and branch
deletion are blocked. The bypass lists are empty, including for the owner.

| Repository | Required checks from GitHub Actions | Required approving reviews |
|---|---|---|
| `dajc-eu` | `application-validate`, `news-validate` | 0 — independent reviewer still needed |
| `dajc-cz` | `cz-validate` | 0 — independent reviewer still needed |

**The one-review requirement is not active yet.** Both repositories currently
have no independent collaborator with write access, and an author cannot
approve their own PR. Once the owner selects and authorizes an independent
reviewer, require one approving review without adding an owner or bot bypass.
Until then, owner review before manual merge is the release procedure; it
must not be reported as an enforced approving-review gate.

Actions PR creation is enabled for `dajc-eu`; the default token remains
read-only, with explicit job permissions where writes are needed. Repair
PRs `dajc-eu#35` and `dajc-cz#2` are merged with passing CI. X authentication,
profile completion and the private HaulBoard protection gate remain open.

## Automation paths

| Work | Destination | Review before public release |
|---|---|---|
| Daily raw findings | `automation/oversize-data` | Imported by the weekly generator; never deployed as public content |
| Prepared weekly article/correction/preview | `automation/weekly-<week>[-preview][-correction]` PR into `main` | Required |
| X reservation and confirmation | `automation/x-publications`, `data/x-publications.json` only | No code/main write; ambiguous attempts need owner reconciliation |

The data importer accepts fixed regular JSON files only. It never runs code
from a data branch. Each write verifies the branch snapshot loaded by the
runner and performs a non-force push. A concurrent update aborts instead of
overwriting a reservation or findings. Main's original data is used only
to bootstrap a branch that does not yet exist; an invalid existing X ledger
never falls back to the empty bootstrap ledger.

## Repository settings (administrator access required)

Apply after this change is merged and the new CI check names exist:

1. Settings → Actions → General → Workflow permissions: allow GitHub Actions
   to create pull requests. Workflows grant only the `contents`,
   `pull-requests` and `actions` permissions needed by their jobs.
2. Create an **active branch ruleset matching `main` only**. Require PRs,
   resolve review conversations, block force pushes and deletion, and
   require the branch to be up to date with passing `application-validate`
   and `news-validate` checks from GitHub Actions. Both workflows run for
   every PR and have unique job names, so path-filtered absent checks cannot
   leave a PR stuck waiting.
3. After an independent reviewer is available, require one approving review
   and dismiss stale approvals. Confirm that
   an independent reviewer with write access is available for owner-authored
   code PRs: GitHub does not allow authors to approve their own PRs. The owner
   can approve the publication PRs created by `github-actions[bot]`.
4. Do not add a broad admin/app bypass. Keep the data branches outside the
   main rule. A matching rule for every branch would also block durable
   data reservations and must not be substituted for the main-only rule.

The weekly automation opens a PR and explicitly dispatches Application CI
and News Pipeline CI on that content branch. GitHub places `pull_request`
runs created using `GITHUB_TOKEN` in an approval-required state; explicit
`workflow_dispatch` starts these trusted checks without waiting for that
separate workflow-approval banner.
It never submits its own approving review or merges its own article.
Scheduled retries see the open PR and skip before making additional AI calls.
A prepared PR is reported as **awaiting review**, never as a published article.

If PR creation is disabled, the run fails after preserving the generated
edition on its content branch. Enable the setting and open that existing
branch's PR; do not regenerate it just to recover the PR-creation step.

## Other repositories

For `dajc-cz`, discover its actual available CI checks before selecting
required status checks. Do not require a check that never runs.

For private `HaulBoard`, confirm the account plan supports enforced private
branch protection. If GitHub refuses this under the current plan, record it
as an unresolved production-release gate. Do not make the repository public,
purchase a plan, merge its stacked PRs, or deploy Platform as a workaround.

## Verification and release gates

- Local integration tests use a Git server that rejects every main push.
  They verify data persistence, pending-attempt recovery, stale-writer
  rejection, remote push failure, JSON/path restrictions, PR creation,
  explicit CI dispatch and the no-regeneration review state.
- Read back the active ruleset after applying it. Verify a direct main push
  is prohibited by the rule without making a production write.
- Keep X publication disabled until the account check returns `@DAJCeu`,
  the profile is complete, and the owner's spending conditions are verified.
- Green CI is not an approval to merge/deploy HaulBoard or migrate production.

References: [GitHub protected branches](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches),
[GITHUB_TOKEN-triggered workflow rules](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow#triggering-a-workflow-from-a-workflow).
