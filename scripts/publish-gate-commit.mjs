#!/usr/bin/env node
// Commit step for .github/workflows/publish-weekly-oversize.yml, run only
// after "Generate weekly article" has succeeded (a failed generate step -
// including the OPENAI_API_KEY preflight failure - already stops the job
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
import { decidePublishCommit, extractArticleWeekFromStatus, isArticleReplacement, publicationBranchFor } from './lib/publish-gate.mjs';
import { saveAutomationData } from './lib/automation-data.mjs';

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

if (articleAdded && autonomousFinal) {
  if (!process.env.RUNNER_TEMP) throw new Error('Trusted Claude receipt directory unavailable');
  const receipt = JSON.parse(readFileSync(path.join(process.env.RUNNER_TEMP, 'dajc-weekly-review-approved.json'), 'utf8'));
  const pathFromStatus = 'src/content/news/eu-oversize/' + extractArticleWeekFromStatus(articleStatusOutput).filename;
  const hash = createHash('sha256').update(readFileSync(pathFromStatus)).digest('hex');
  if (receipt.articlePath !== pathFromStatus || receipt.targetWeek !== week ||
      receipt.sha256 !== hash || !['perplexity-sonar', 'perplexity-search'].includes(receipt.researchProvider) ||
      !receipt.claudeModel || receipt.leadCount < 1 || receipt.sourceCount < 1) {
    throw new Error('Claude review receipt missing or differs from exact article bytes');
  }
  summary('Claude editorial review approved exact Sonar article SHA-256: ' + hash.slice(0, 12));
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

const repository = process.env.GITHUB_REPOSITORY;
if (!/^[\w.-]+\/[\w.-]+$/.test(repository || '') || !process.env.GH_TOKEN) throw new Error('GitHub publication PR access is not configured');
const branch = publicationBranchFor(week, { preview: process.env.OVERSIZE_PREVIEW === '1', correction: process.env.OVERSIZE_CORRECTION === '1' || articleReplaced });
git(['switch', '-c', branch]);
for (const addPath of decision.addPaths) git(['add', addPath]);
// Include both sides of a rename, so a staged source deletion cannot hide
// behind an allowed article/data destination.
const stagedPaths = git(['diff', '--cached', '--no-renames', '--name-only', '-z']).split('\0').filter(Boolean);
if (stagedPaths.some((relative) => !approvedPath(relative))) throw new Error('Publication commit contains an unapproved staged path');
git(['commit', '-m', decision.message]);
git(['push', 'origin', `HEAD:refs/heads/${branch}`]);

// A standard PR respects the main rules. Never approve or merge our own PR.
// GITHUB_TOKEN-created PR checks need workflow approval before starting,
// so dispatch both trusted CI workflows on the exact content branch.
const temporary = mkdtempSync(path.join(tmpdir(), 'dajc-publication-pr-'));
try {
  const bodyFile = path.join(temporary, 'body.md');
  writeFileSync(bodyFile, `Prepared EU Oversize Weekly ${week} after the source, editorial and build gates.\n\nThe final Sonar article was reviewed by Claude; protected application-validate and news-validate checks and GitHub merge are required before any public release. This run has not published the article. Only approved article/data paths are changed.\n`);
  const prUrl = execFileSync('gh', ['pr', 'create', '--repo', repository, '--base', 'main', '--head', branch, '--title', decision.message, '--body-file', bodyFile], { encoding: 'utf8' }).trim();
  summary(`### EU Oversize Weekly - prepared for review\n\n${prUrl}\n\nArticle published this run: **no**. Final weekly content may auto-merge only after Claude approval and protected CI.`);
  for (const workflow of ['application-ci.yml', 'news-ci.yml']) execFileSync('gh', ['workflow', 'run', workflow, '--repo', repository, '--ref', branch], { stdio: 'inherit' });
  if (autonomousFinal) {
    // GitHub protects main; auto-merge does not bypass CI or branch rules.
    // This is not confirmation of deployment or public visibility.
    execFileSync('gh', ['pr', 'merge', prUrl, '--repo', repository, '--auto', '--squash'], { stdio: 'inherit' });
    summary('Protected auto-merge requested following Claude approval; live publication still unconfirmed.');
  }
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
