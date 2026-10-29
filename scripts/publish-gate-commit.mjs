#!/usr/bin/env node
// Commit step for .github/workflows/publish-weekly-oversize.yml, run only
// after "Generate weekly article" has succeeded (a failed generate step -
// including the ANTHROPIC_API_KEY preflight failure - already stops the job
// before this runs, via GitHub Actions' implicit `success()` on the step's
// `if:` condition).
//
// This is the explicit gate that decides whether this run actually
// published a new EU Oversize Weekly article, or only refreshed
// data/oversize - see decidePublishCommit in scripts/lib/publish-gate.mjs
// for the pure decision logic and why this exists.

import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { nonOfficialSources, decidePublishCommit, extractArticleWeekFromStatus, isArticleReplacement, publicationBranchFor } from './lib/publish-gate.mjs';
import { saveAutomationData } from './lib/automation-data.mjs';
import { sourceTier } from './lib/source-policy.mjs';

function git(args) {
  return execFileSync('git', args, { encoding: 'utf-8' });
}

function gitCleanDiff(args) {
  try {
    execFileSync('git', args);
    return true;
  } catch {
    return false;
  }
}

function summary(line) {
  console.log(line);
  const summaryFile = process.env.GITHUB_STEP_SUMMARY;
  if (!summaryFile) return;
  try {
    appendFileSync(summaryFile, `${line}\n`);
  } catch {
    // best-effort only - never fail the run because the summary couldn't be written
  }
}

git(['config', 'user.name', 'dajc-bot']);
git(['config', 'user.email', 'bot@users.noreply.github.com']);

const ALLOWED_AUTOMATION_PATHS = [
  /^data\/oversize\/\d{4}-W\d{2}\/(?:findings|coverage)\.json$/,
  /^src\/content\/news\/eu-oversize\/eu-oversize-weekly-(?:preview-)?\d{4}-w\d{2}\.md$/,
];
const approvedPath = (relative) => ALLOWED_AUTOMATION_PATHS.some((pattern) => pattern.test(relative));

function pathFromPorcelainLine(line) {
  const raw = line.slice(3).trim();
  const renameTarget = raw.includes(' -> ') ? raw.split(' -> ').at(-1) : raw;
  return renameTarget.replace(/^"|"$/g, '');
}

const workspaceStatus = git(['status', '--porcelain', '--untracked-files=all']);
const unexpectedChanges = workspaceStatus
  .split('\n')
  .filter(Boolean)
  .map(pathFromPorcelainLine)
  .filter((relative) => !approvedPath(relative));

if (unexpectedChanges.length > 0) {
  console.error('::error::Publication automation modified files outside the approved content/data paths.');
  for (const path of unexpectedChanges) console.error(`  - ${path}`);
  summary('### EU Oversize Weekly publish gate - BLOCKED\n\nAutomation attempted to modify files outside the approved content/data paths.');
  process.exit(1);
}

const articleStatusOutput = git(['status', '--porcelain', '--untracked-files=all', '--', 'src/content/news/eu-oversize']);
const articleAdded = articleStatusOutput.trim().length > 0;

git(['add', 'data/oversize']);
const dataChanged = !gitCleanDiff(['diff', '--cached', '--quiet', '--', 'data/oversize']);

// The commit message's week must come from the article's own filename, not
// from an independently recomputed "current week" - see
// extractArticleWeekFromStatus in scripts/lib/publish-gate.mjs for the
// incident this fixes (a W35 article committed as "...2026-W34").
let week = null;
if (articleAdded) {
  const extraction = extractArticleWeekFromStatus(articleStatusOutput);
  if (!extraction.ok) {
    console.error(`::error::Cannot determine the published article's week: ${extraction.reason}`);
    summary(`### EU Oversize Weekly publish gate - FAILED\n\nCannot determine the published article's week: ${extraction.reason}`);
    process.exit(1);
  }
  week = extraction.week;
}

const articleReplaced = articleAdded && isArticleReplacement(articleStatusOutput);
const autonomousFinal = process.env.DAJC_AUTONOMOUS_WEEKLY === '1' &&
  process.env.OVERSIZE_PREVIEW !== '1' && process.env.OVERSIZE_CORRECTION !== '1' && !articleReplaced;
let autoMerge = autonomousFinal;

if (articleAdded && autonomousFinal) {
  if (!process.env.RUNNER_TEMP) throw new Error('Trusted Claude receipt directory unavailable');
  const receiptPath = path.join(process.env.RUNNER_TEMP, 'dajc-weekly-review-approved.json');
  let receipt = null;
  try {
    receipt = JSON.parse(readFileSync(receiptPath, 'utf8'));
  } catch {
    // No receipt: Claude vetoed the edition or the review failed. The edition
    // is still opened as a PR for human review instead of being lost.
  }
  if (!receipt) {
    autoMerge = false;
    summary('Claude did not approve this edition: it is opened for human review and will not be released automatically.');
    console.log('::warning::Claude did not approve the edition; publication waits for human review.');
  }
}

if (articleAdded && autoMerge) {
  const receipt = JSON.parse(readFileSync(path.join(process.env.RUNNER_TEMP, 'dajc-weekly-review-approved.json'), 'utf8'));
  const pathFromStatus = 'src/content/news/eu-oversize/' + extractArticleWeekFromStatus(articleStatusOutput).filename;
  const hash = createHash('sha256').update(readFileSync(pathFromStatus)).digest('hex');
  if (receipt.articlePath !== pathFromStatus || receipt.targetWeek !== week ||
      receipt.sha256 !== hash || receipt.researchProvider !== 'perplexity-search' ||
      !receipt.claudeModel || receipt.leadCount < 1 || receipt.sourceCount < 1) {
    throw new Error('Claude review receipt missing or differs from exact article bytes');
  }
  summary('Claude editorial review approved exact article SHA-256: ' + hash.slice(0, 12));
  const trade = nonOfficialSources(readFileSync(pathFromStatus, 'utf8'), sourceTier);
  if (trade.length > 0) summary(`Industry-report sources approved by Claude: ${trade.join(', ')}`);
}
const decision = decidePublishCommit({ articleAdded, articleReplaced, dataChanged, week });

if (!decision.commit) {
  summary(
    'Nothing to publish this run (no article was generated, and no data changed) - not an error, see the previous step\'s log for why.'
  );
  process.exit(0);
}

if (!articleAdded) {
  saveAutomationData('findings');
  summary('### EU Oversize Weekly - data refreshed only\n\nNo article was generated or published. Findings were saved to automation/oversize-data.');
  process.exit(0);
}

// The findings behind a prepared edition belong on the data branch too. Until
// W44 they lived only on the PR branch, so closing a rejected PR discarded
// them (the N307 report found on Friday was missing from Saturday's retry).
if (dataChanged) {
  try {
    saveAutomationData('findings');
  } catch (err) {
    console.log(`::warning::Findings were not persisted on automation/oversize-data: ${err.message || err}. They remain on the publication PR branch.`);
  }
}

const repository = process.env.GITHUB_REPOSITORY;
if (!/^[\w.-]+\/[\w.-]+$/.test(repository || '') || !process.env.GH_TOKEN) throw new Error('GitHub publication PR access is not configured');
let branch = publicationBranchFor(week, { preview: process.env.OVERSIZE_PREVIEW === '1', correction: process.env.OVERSIZE_CORRECTION === '1' || articleReplaced });
// Preserve old closed/rejected publication PRs for audit. Never force-push
// or silently reuse their branch; make a fresh review branch for regeneration.
if (git(['ls-remote', '--heads', 'origin', 'refs/heads/' + branch]).trim()) {
  const run = process.env.GITHUB_RUN_ID;
  if (!/^[0-9]+$/.test(run || '')) throw new Error('Cannot safely name regenerated publication branch');
  branch += '-retry-' + run;
}
git(['switch', '-c', branch]);
for (const addPath of decision.addPaths) git(['add', addPath]);
// Include both sides of a rename, so a staged source deletion cannot hide
// behind an allowed article/data destination.
const stagedPaths = git(['diff', '--cached', '--no-renames', '--name-only', '-z']).split('\0').filter(Boolean);
if (stagedPaths.some((relative) => !approvedPath(relative))) throw new Error('Publication commit contains an unapproved staged path');
git(['commit', '-m', decision.message]);
git(['push', 'origin', `HEAD:refs/heads/${branch}`]);

// A standard PR respects the main rules; this script never approves or
// merges it. GitHub holds the pull_request CI of a PR opened by
// github-actions[bot] until a user with write access approves it, and the
// main ruleset counts only that CI: workflow_dispatch runs never satisfy it
// (W45, 29 October 2026). A PR opened with the owner's DAJC_WEEKLY_PR_TOKEN
// runs its CI at once, so the release step can merge it unattended. Without
// the token, or if GitHub rejects it, the bot opens the PR and both trusted CI
// workflows are dispatched on the exact content branch
// as an early signal for the human reviewer.
const prToken = process.env.DAJC_WEEKLY_PR_TOKEN || '';
const temporary = mkdtempSync(path.join(tmpdir(), 'dajc-publication-pr-'));
try {
  const bodyFile = path.join(temporary, 'body.md');
  const openPr = (env, releasedUnattended) => {
    writeFileSync(bodyFile, `Prepared EU Oversize Weekly ${week} after the source, editorial and build gates.\n\n${releasedUnattended ? 'Claude approved the exact final article. The workflow merges it once application-validate and news-validate pass; the site shows it from its Friday 12:00 Europe/Prague slot. ' : autoMerge ? 'Claude approved the exact final article. Waiting for human review: approve the pending workflows, then merge to publish. This run has not published the article. ' : 'Waiting for human review: merge to publish. This run has not published the article. '}Only approved article/data paths are changed.\n`);
    return execFileSync('gh', ['pr', 'create', '--repo', repository, '--base', 'main', '--head', branch, '--title', decision.message, '--body-file', bodyFile], { encoding: 'utf8', env }).trim();
  };
  let prUrl = '';
  let unattended = false;
  if (prToken) {
    try {
      prUrl = openPr({ ...process.env, GH_TOKEN: prToken }, autoMerge);
      unattended = autoMerge;
    } catch {
      console.log('::warning::DAJC_WEEKLY_PR_TOKEN could not open the PR (expired or missing permission); opening it with the job token for human review.');
    }
  }
  if (!prUrl) {
    prUrl = openPr(process.env, false);
    for (const workflow of ['application-ci.yml', 'news-ci.yml']) execFileSync('gh', ['workflow', 'run', workflow, '--repo', repository, '--ref', branch], { stdio: 'inherit' });
  }
  summary(`### EU Oversize Weekly - prepared\n\n${prUrl}\n\n${unattended ? 'Claude-approved: the release step merges it after required CI.' : autoMerge ? 'Claude-approved, but opened by github-actions[bot]: approve the pending workflows and merge to publish. Article published this run: **no**.' : 'Opened for human review: merge to publish. Article published this run: **no**.'}`);
  // The workflow's release step merges an approved edition once the required
  // checks pass, within the main ruleset (owner decision, 24 October 2026:
  // the Weekly publishes autonomously every Friday at 12:00).
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `pr_url=${prUrl}\nauto_merge=${autoMerge ? 'true' : 'false'}\nunattended=${unattended ? 'true' : 'false'}\n`);
  }
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
