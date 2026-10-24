#!/usr/bin/env node
// Cheap, dependency-free idempotency check for the weekly publisher.
// Runs immediately after checkout, before npm ci and before any OpenAI
// preflight/call. A delayed Friday trigger or Saturday catch-up therefore
// becomes a clear no-op once the target week's article already exists.

import { appendFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

import { isoWeekLabel } from './lib/week.mjs';
import { publicationSlotFor, targetWeekDateFor } from './lib/next-publication.mjs';
import { classifyEditionPulls, publicationBranchFor } from './lib/publish-gate.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

function targetFor(now = new Date()) {
  // Same target as generate-weekly-article.mjs: the week after this run's
  // Friday 12:00 Europe/Prague publication slot.
  const nextWeekLabel = isoWeekLabel(targetWeekDateFor(publicationSlotFor(now)));
  const slug = `eu-oversize-weekly-${process.env.OVERSIZE_PREVIEW === '1' ? 'preview-' : ''}${nextWeekLabel.toLowerCase()}`;
  const relativePath = path.join('src', 'content', 'news', 'eu-oversize', `${slug}.md`);
  return { nextWeekLabel, relativePath, absolutePath: path.join(ROOT, relativePath) };
}

async function main() {
  const now = process.env.OVERSIZE_NOW ? new Date(process.env.OVERSIZE_NOW) : new Date();
  const target = targetFor(now);
  const exists = existsSync(target.absolutePath);
  // A manual correction run regenerates the current target edition even if
  // it exists; the generator replaces it only if the new edition passes.
  const correction = process.env.OVERSIZE_CORRECTION === '1';
  let needed = !exists || correction;
  let pendingPr = null;
  let stalePrs = [];
  if (process.env.GITHUB_ACTIONS === 'true') {
    if (!process.env.GH_TOKEN || !/^[\w.-]+\/[\w.-]+$/.test(process.env.GITHUB_REPOSITORY || '')) throw new Error('Publication PR access is not configured');
    const branch = publicationBranchFor(target.nextWeekLabel, { preview: process.env.OVERSIZE_PREVIEW === '1', correction });
    const pulls = JSON.parse(execFileSync('gh', ['pr', 'list', '--repo', process.env.GITHUB_REPOSITORY, '--base', 'main', '--state', 'open', '--limit', '100', '--json', 'url,headRefName'], { encoding: 'utf8' }));
    const editionPulls = classifyEditionPulls(pulls, { branch, targetWeek: target.nextWeekLabel });
    stalePrs = editionPulls.stale.map((pull) => pull.url);
    for (const url of stalePrs) console.log(`::warning::Edition PR for a week that has already passed is still open: ${url}`);
    if (needed && editionPulls.pending) {
      needed = false;
      pendingPr = editionPulls.pending.url;
      console.log(`Edition already awaits review in ${pendingPr}; no regeneration or additional AI spend.`);
    }
  }
  // The edition is overdue when its Friday 12:00 slot has passed while its PR
  // still waits for review: the site shows nothing for the week.
  const overdue = Boolean(pendingPr) && process.env.OVERSIZE_PREVIEW !== '1' && now.getTime() >= publicationSlotFor(now).getTime();
  if (overdue) console.log(`::error::EU Oversize Weekly ${target.nextWeekLabel} is past its Friday 12:00 Europe/Prague slot but its PR is not merged: ${pendingPr}`);

  console.log(`Target weekly article: ${target.relativePath}`);
  if (pendingPr) {
    console.log('Publication is not complete until the PR is approved, CI passes, and the PR is merged.');
  } else if (exists && correction) {
    console.log('Correction requested: the existing article will be regenerated and replaced only if the new edition passes every check.');
  } else {
    console.log(needed
      ? 'Publication needed: target article does not exist.'
      : 'Publication not needed: target article already exists; this run is an idempotent no-op.');
  }

  if (process.env.GITHUB_OUTPUT) {
    await appendFile(
      process.env.GITHUB_OUTPUT,
      `needed=${needed ? 'true' : 'false'}\npending_pr=${pendingPr ? 'true' : 'false'}\noverdue=${overdue ? 'true' : 'false'}\nstale_prs=${stalePrs.join(' ')}\ntarget=${target.relativePath}\nweek=${target.nextWeekLabel}\n`
    );
  }

  if (process.env.GITHUB_STEP_SUMMARY && !needed) {
    await appendFile(
      process.env.GITHUB_STEP_SUMMARY,
      pendingPr
        ? `### EU Oversize Weekly - awaiting review\n\n${pendingPr}\n\nNo article was published by this run; no generation was repeated.\n`
        : `### EU Oversize Weekly - already published\n\nTarget \u0060${target.relativePath}\u0060 already exists. This delayed/duplicate/catch-up run correctly did no publication work.\n`
    );
  }
}

main().catch((err) => {
  console.error('Weekly publication idempotency check failed:', err);
  process.exitCode = 1;
});
