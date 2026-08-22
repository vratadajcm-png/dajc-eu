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
import { appendFileSync } from 'node:fs';
import { decidePublishCommit, extractArticleWeekFromStatus } from './lib/publish-gate.mjs';

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

const decision = decidePublishCommit({ articleAdded, dataChanged, week });

if (!decision.commit) {
  summary(
    'Nothing to publish this run (no article was generated, and no data changed) - not an error, see the previous step\'s log for why.'
  );
  process.exit(0);
}

for (const addPath of decision.addPaths) git(['add', addPath]);
git(['commit', '-m', decision.message]);
git(['push']);

summary('### EU Oversize Weekly publish gate');
summary(`- Article published this run: **${articleAdded ? 'yes' : 'no'}**`);
summary(`- Commit message: \`${decision.message}\``);
