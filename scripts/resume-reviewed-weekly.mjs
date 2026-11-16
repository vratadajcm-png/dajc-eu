#!/usr/bin/env node
// Resume an approved preparation after an interrupted/timed-out release. Read
// the PR as git objects only; execute exclusively this reviewed main checkout.
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { editionPlan } from './lib/edition-plan.mjs';
import { publicationApprovalValid } from './lib/publication-approval.mjs';
import { assertTrustedApproval } from './lib/trusted-weekly-approval.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ALLOWED_PATHS = [
  /^data\/oversize\/\d{4}-W\d{2}\/(?:findings|coverage)\.json$/,
  /^data\/oversize\/\d{4}-W\d{2}\/publication\/\d+-\d+\.json$/,
  /^src\/content\/news\/eu-oversize\/eu-oversize-weekly-\d{4}-w\d{2}\.md$/,
];

export function validateResumablePr(pr, { repository, prUrl, expectedHead, targetWeek }) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository || '') || !/^[a-f0-9]{40}$/.test(expectedHead || '') ||
      !(typeof prUrl === 'string' && prUrl.startsWith(`https://github.com/${repository}/pull/`) && /^[0-9]+$/.test(prUrl.slice(`https://github.com/${repository}/pull/`.length)))) throw new Error('RESUME: invalid repository, PR URL or pinned head');
  if (pr.url !== prUrl || pr.state !== 'OPEN' || pr.baseRefName !== 'main' || pr.isDraft || pr.isCrossRepository || pr.headRefOid !== expectedHead ||
      !/^[a-f0-9]{40}$/.test(pr.baseRefOid || '') || !new RegExp('^automation/weekly-' + targetWeek.toLowerCase() + '(?:-retry-[0-9]+(?:-[0-9]+)?)?$').test(pr.headRefName || '')) {
    throw new Error('RESUME: pending PR identity, protected base or approved head changed');
  }
  const states = [...String(pr.body || '').matchAll(/<!-- DAJC_WEEKLY_STATE:([A-Z_]+) -->/g)];
  const attempts = [...String(pr.body || '').matchAll(/<!-- DAJC_WEEKLY_ATTEMPT:([0-9]+-[0-9]+) -->/g)];
  if (states.length !== 1 || states[0][1] !== 'EDITORIAL_APPROVED' || attempts.length !== 1) throw new Error('RESUME: missing unique independent editorial approval/attempt markers');
  return attempts[0][1];
}

export function validateResumedEdition({ pr, repository, prUrl, expectedHead, targetWeek, raw, audit, changedPaths }) {
  const attemptId = validateResumablePr(pr, { repository, prUrl, expectedHead, targetWeek });
  const articlePath = `src/content/news/eu-oversize/eu-oversize-weekly-${targetWeek.toLowerCase()}.md`;
  const auditPath = `data/oversize/${targetWeek}/publication/${attemptId}.json`;
  if (!Array.isArray(changedPaths) || !changedPaths.includes(articlePath) || !changedPaths.includes(auditPath) ||
      changedPaths.some(p => !ALLOWED_PATHS.some(pattern => pattern.test(p)) ||
        p.startsWith('src/content/') && p !== articlePath || p.includes('/publication/') && p !== auditPath)) {
    throw new Error('RESUME: PR contains unexpected paths or lacks its exact article/audit');
  }
  if (audit?.attemptId !== attemptId || !publicationApprovalValid(audit, { articlePath, targetWeek, raw })) throw new Error('RESUME: exact article bytes do not have a complete independent approval');
  return { articlePath, auditPath, attemptId };
}

function main() {
  const repository = process.env.GITHUB_REPOSITORY;
  const prUrl = process.env.PR_URL;
  const expectedHead = process.env.EXPECTED_PR_HEAD;
  const targetWeek = editionPlan({ targetWeek: process.env.OVERSIZE_TARGET_WEEK || process.env.TARGET_WEEK || '' }).targetWeek;
  const gh = args => JSON.parse(execFileSync('gh', args, { encoding: 'utf8', timeout: 30000 }));
  const git = args => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', timeout: 60000, maxBuffer: 8 * 1024 * 1024 });
  const pr = gh(['pr', 'view', prUrl, '--repo', repository, '--json', 'url,state,baseRefName,baseRefOid,headRefName,headRefOid,isDraft,isCrossRepository,body']);
  const attemptId = validateResumablePr(pr, { repository, prUrl, expectedHead, targetWeek });
  // Fetch immutable commits, never checkout PR code or run a script from it.
  git(['fetch', '--no-tags', 'origin', expectedHead, pr.baseRefOid]);
  const articlePath = `src/content/news/eu-oversize/eu-oversize-weekly-${targetWeek.toLowerCase()}.md`;
  const auditPath = `data/oversize/${targetWeek}/publication/${attemptId}.json`;
  const raw = git(['show', `${expectedHead}:${articlePath}`]);
  const audit = JSON.parse(git(['show', `${expectedHead}:${auditPath}`]));
  const changedPaths = git(['diff', '--name-only', '--no-renames', `${pr.baseRefOid}...${expectedHead}`]).trim().split('\n').filter(Boolean);
  const deletions = git(['diff', '--name-only', '--diff-filter=D', '--no-renames', `${pr.baseRefOid}...${expectedHead}`]).trim();
  if (deletions) throw new Error('RESUME: publication PR deletes existing paths');
  validateResumedEdition({ pr, repository, prUrl, expectedHead, targetWeek, raw, audit, changedPaths });
  assertTrustedApproval(audit, { repo: repository, articlePath, targetWeek, raw });
  // A previously approved candidate is never re-generated or re-billed here.
  // The existing merge helper rechecks CI and main protection atomically.
  execFileSync(process.execPath, [path.join(ROOT, 'scripts/merge-reviewed-weekly.mjs')], {
    cwd: ROOT, stdio: 'inherit', env: { ...process.env, PR_URL: prUrl, EXPECTED_PR_HEAD: expectedHead, UNATTENDED: 'true' },
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error('::error::APPROVED PUBLICATION RESUME BLOCKED: ' + error.message); process.exitCode = 1; }
}
