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
import { publicationBranchFor } from './lib/publish-gate.mjs';

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
  if (needed && process.env.GITHUB_ACTIONS === 'true') {
    if (!process.env.GH_TOKEN || !/^[\w.-]+\/[\w.-]+$/.test(process.env.GITHUB_REPOSITORY || '')) throw new Error('Publication PR access is not configured');
    const branch = publicationBranchFor(target.nextWeekLabel, { preview: process.env.OVERSIZE_PREVIEW === '1', correction });
    const pulls = JSON.parse(execFileSync('gh', ['pr', 'list', '--repo', process.env.GITHUB_REPOSITORY, '--base', 'main', '--head', branch, '--state', 'open', '--limit', '1', '--json', 'url'], { encoding: 'utf8' }));
    if (pulls.length) {
      needed = false;
      pendingPr = pulls[0].url;
      console.log(`Edition already awaits review in ${pendingPr}; no regeneration or additional AI spend.`);
    }
  }

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
      `needed=${needed ? 'true' : 'false'}\npending_pr=${pendingPr ? 'true' : 'false'}\ntarget=${target.relativePath}\nweek=${target.nextWeekLabel}\n`
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
