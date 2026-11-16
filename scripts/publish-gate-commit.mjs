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
import { appendFileSync, mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { nonOfficialSources, decidePublishCommit, extractArticleWeekFromStatus, isArticleReplacement, publicationBranchFor } from './lib/publish-gate.mjs';
import { saveAutomationData } from './lib/automation-data.mjs';
import { sourceTier } from './lib/source-policy.mjs';
import { loadWeekFindings } from './lib/store.mjs';
import { editionPlan } from './lib/edition-plan.mjs';
import { REJECTION_MARKER, findingsFingerprint } from './lib/weekly-recovery.mjs';
import { publicationApprovalValid } from './lib/publication-approval.mjs';

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
  /^data\/oversize\/\d{4}-W\d{2}\/publication\/\d+-\d+\.json$/,
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
const finalArticle = process.env.OVERSIZE_PREVIEW !== '1';
const autonomousFinal = process.env.DAJC_AUTONOMOUS_WEEKLY === '1' && finalArticle;
let autoMerge = autonomousFinal;
let receipt = null;
// Only a structured editorial veto may be automatically retried; API outages and
// other review failures always remain a human-visible hard block.
const structuredEditorialVeto = finalArticle && Boolean(process.env.RUNNER_TEMP) &&
  existsSync(path.join(process.env.RUNNER_TEMP || '', 'dajc-weekly-review-veto.json'));

if (articleAdded && finalArticle) {
  if (!process.env.RUNNER_TEMP) throw new Error('Trusted Claude receipt directory unavailable');
  const receiptPath = path.join(process.env.RUNNER_TEMP, 'dajc-weekly-review-approved.json');
  try {
    receipt = JSON.parse(readFileSync(receiptPath, 'utf8'));
  } catch {
    // No receipt: Claude vetoed the edition or the review failed. The edition
    // is still opened as a PR for human review instead of being lost.
  }
  if (!receipt) {
    autoMerge = false;
    summary('Claude did not approve this edition: its bytes will be archived in a blocked draft; no public article route will be committed.');
    console.log('::warning::Claude did not approve the edition; publication waits for human review.');
  }
}

if (articleAdded && receipt) {
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

// Durable evidence travels with the content through protected CI and main.
// A rejected candidate is archived as data, never as a publicly routable article.
const attemptId = `${process.env.GITHUB_RUN_ID || ''}-${process.env.GITHUB_RUN_ATTEMPT || '1'}`;
if (!/^\d+-\d+$/.test(attemptId)) throw new Error('Missing unique GitHub preparation identity');
const candidatePath = 'src/content/news/eu-oversize/' + extractArticleWeekFromStatus(articleStatusOutput).filename;
const candidateMarkdown = readFileSync(candidatePath, 'utf8');
let veto = null;
if (structuredEditorialVeto) veto = JSON.parse(readFileSync(path.join(process.env.RUNNER_TEMP, 'dajc-weekly-review-veto.json'), 'utf8'));
const editorialState = receipt ? 'EDITORIAL_APPROVED' : veto ? 'EDITORIAL_REJECTED' : 'BLOCKED';
const auditPath = `data/oversize/${week}/publication/${attemptId}.json`;
const plan = editionPlan({ now: process.env.OVERSIZE_NOW ? new Date(process.env.OVERSIZE_NOW) : new Date(), targetWeek: week });
const inputFindings = new Map();
for (const dataWeek of plan.findingsWeeks) for (const finding of (await loadWeekFindings(dataWeek)).values()) inputFindings.set(finding.sourceUrl, finding);
const sourceFingerprint = findingsFingerprint([...inputFindings.values()]);
const recoveryDir = path.join(process.env.RUNNER_TEMP || '', 'dajc-weekly-recovery');
let recovery = null;
if (existsSync(path.join(recoveryDir, 'manifest.json'))) {
  recovery = { manifest: JSON.parse(readFileSync(path.join(recoveryDir, 'manifest.json'), 'utf8')),
    versions: readdirSync(recoveryDir).filter(n => /^attempt-\d+\.(?:md)$/.test(n)).map(n => ({ name: n, candidateMarkdown: readFileSync(path.join(recoveryDir, n), 'utf8') })) };
}
const lifecycle = [{ state: 'PREPARING' }, { state: 'GENERATED' },
  ...(recovery ? recovery.manifest.attempts.flatMap(a => [ ...(a.startedAt ? [{ state: 'REPAIRING', at: a.startedAt, attempt: a.attempt }] : []), { state: a.state, ...(a.completedAt ? { at: a.completedAt } : {}), attempt: a.attempt }]) : []),
  { state: editorialState, ...(receipt?.approvedAt ? { at: receipt.approvedAt } : {}) }];
const audit = {
  schemaVersion: 1, attemptId, targetWeek: week, state: editorialState, sourceFingerprint, lifecycle, ...(recovery ? { recovery } : {}),
  articlePath: candidatePath, sha256: createHash('sha256').update(candidateMarkdown).digest('hex'),
  runUrl: `https://github.com/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`,
  preparedAt: new Date().toISOString(), ...(receipt || {}),
  ...(!receipt ? { candidateMarkdown, review: veto?.review || null, reason: veto ? 'Independent editorial rejection' : 'Independent review unavailable or failed' } : {}),
};
if (receipt && !publicationApprovalValid(audit, { articlePath: candidatePath, targetWeek: week, raw: candidateMarkdown })) throw new Error('Independent review receipt is incomplete or invalid; refusing publication');
mkdirSync(path.dirname(auditPath), { recursive: true });
writeFileSync(auditPath, JSON.stringify(audit, null, 2) + '\n', { flag: 'wx' });
if (finalArticle && !receipt) {
  if (git(['ls-files', '--', candidatePath]).trim()) git(['restore', '--staged', '--worktree', '--', candidatePath]);
  else rmSync(candidatePath);
  decision.addPaths = ['data/oversize'];
  decision.message = `editorial: archive blocked EU Oversize Weekly ${week} (${attemptId})`;
}

const repository = process.env.GITHUB_REPOSITORY;
if (!/^[\w.-]+\/[\w.-]+$/.test(repository || '') || !process.env.GH_TOKEN) throw new Error('GitHub publication PR access is not configured');
let branch = publicationBranchFor(week, { preview: process.env.OVERSIZE_PREVIEW === '1', correction: process.env.OVERSIZE_CORRECTION === '1' || articleReplaced });
// Preserve old closed/rejected publication PRs for audit. Never force-push
// or silently reuse their branch; make a fresh review branch for regeneration.
if (git(['ls-remote', '--heads', 'origin', 'refs/heads/' + branch]).trim()) {
  const run = process.env.GITHUB_RUN_ID;
  if (!/^[0-9]+$/.test(run || '')) throw new Error('Cannot safely name regenerated publication branch');
  branch += '-retry-' + run + '-' + (process.env.GITHUB_RUN_ATTEMPT || '1');
}
git(['switch', '-c', branch]);
for (const addPath of decision.addPaths) git(['add', addPath]);
// Include both sides of a rename, so a staged source deletion cannot hide
// behind an allowed article/data destination.
const stagedPaths = git(['diff', '--cached', '--no-renames', '--name-only', '-z']).split('\0').filter(Boolean);
if (stagedPaths.some((relative) => !approvedPath(relative))) throw new Error('Publication commit contains an unapproved staged path');
git(['commit', '-m', decision.message]);
git(['push', 'origin', `HEAD:refs/heads/${branch}`]);
const prHead = git(['rev-parse', 'HEAD']).trim();

// A standard PR respects the main rules; this script never approves or
// merges it. GitHub holds the pull_request CI of a PR opened by
// github-actions[bot] until a user with write access approves it, and the
// main ruleset counts only that CI: workflow_dispatch runs never satisfy it
// (W45, 29 October 2026). A PR opened with the owner's DAJC_WEEKLY_PR_TOKEN
// runs its CI at once, so the release step can merge it unattended. Without
// the token, or if GitHub rejects it, the bot opens the PR and both trusted CI
// workflows are dispatched on the content branch as an early signal for the
// human reviewer.
const prToken = process.env.DAJC_WEEKLY_PR_TOKEN || '';
const temporary = mkdtempSync(path.join(tmpdir(), 'dajc-publication-pr-'));
try {
  const bodyFile = path.join(temporary, 'body.md');
  const openPr = (env, releasedUnattended) => {
    const state = receipt ? 'EDITORIAL_APPROVED' : editorialState;
    writeFileSync(bodyFile, `EU Oversize Weekly ${week}: ${state}.\n\n${receipt ? 'Claude approved the exact article bytes; protected application and news CI must pass before merge. The site releases it at its Friday 12:00 Europe/Prague slot.' : 'Publication is BLOCKED. The rejected/unreviewed article is archived only as JSON evidence; no article route is included. A replacement requires new source verification and independent approval.'}\n\nAudit: ${auditPath}\nAttempt: ${attemptId}\nSHA-256: ${audit.sha256}\n\n<!-- DAJC_WEEKLY_STATE:${state} -->\n<!-- DAJC_WEEKLY_ATTEMPT:${attemptId} -->\n<!-- DAJC_WEEKLY_SOURCES:${sourceFingerprint} -->\n${receipt ? '<!-- DAJC_WEEKLY_LIFECYCLE:CI_PENDING -->\n' : ''}${!receipt && structuredEditorialVeto ? '\n' + REJECTION_MARKER + '\n' : ''}`);
    const args = ['pr', 'create', '--repo', repository, '--base', 'main', '--head', branch, '--title', decision.message, '--body-file', bodyFile];
    if (finalArticle && !receipt) args.push('--draft');
    return execFileSync('gh', args, { encoding: 'utf8', env }).trim();
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
  // Preserve rejected history until a fully approved replacement is reviewable.
  const replaced = process.env.OVERSIZE_REPLACES_PR;
  if (receipt && replaced) {
    if (!new RegExp('^https://github\\.com/' + repository.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '/pull/\\d+$').test(replaced)) throw new Error('Invalid superseded PR URL');
    const prior = JSON.parse(execFileSync('gh', ['pr', 'view', replaced, '--repo', repository, '--json', 'body,state,headRefName'], { encoding: 'utf8' }));
    if (prior.state === 'OPEN' && String(prior.body || '').includes(REJECTION_MARKER) &&
        String(prior.headRefName || '').startsWith(publicationBranchFor(week))) {
      const message = `Superseded by independently approved replacement ${prUrl}. Original rejected bytes and source review remain archived on this PR; it was never published.`;
      execFileSync('gh', ['pr', 'close', replaced, '--repo', repository, '--comment', message], { stdio: 'inherit' });
    }
  }
  summary(`### EU Oversize Weekly - prepared\n\n${prUrl}\n\n${unattended ? 'Claude-approved: the release step merges it after required CI.' : autoMerge ? 'Claude-approved, but opened by github-actions[bot]: approve the pending workflows and merge to publish. Article published this run: **no**.' : 'Publication BLOCKED. Candidate bytes and reasons are archived in a draft PR without any public article route. Article published this run: **no**.'}`);
  // The workflow's release step merges an approved edition once the required
  // checks pass, within the main ruleset (owner decision, 24 October 2026:
  // the Weekly publishes autonomously every Friday at 12:00).
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `pr_url=${prUrl}\npr_head=${prHead}\nstate=${editorialState}\naudit_path=${auditPath}\nauto_merge=${autoMerge ? 'true' : 'false'}\nunattended=${unattended ? 'true' : 'false'}\n`);
  }
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
