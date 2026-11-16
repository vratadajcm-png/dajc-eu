#!/usr/bin/env node
// Cheap, dependency-free idempotency check for the weekly publisher.
// Runs immediately after checkout, before npm ci and before any paid API
// preflight/call. A delayed Friday trigger or Saturday catch-up therefore
// becomes a clear no-op once the target week's article already exists.

import { appendFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

import { editionPlan } from './lib/edition-plan.mjs';
import { publicationSlotFor, targetWeekDateFor } from './lib/next-publication.mjs';
import { isoWeekLabel } from './lib/week.mjs';
import { classifyEditionPulls, publicationBranchFor } from './lib/publish-gate.mjs';
import { shouldReplaceBlockedEditionPr } from './lib/weekly-recovery.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

function targetFor(now = new Date()) {
  // Same target as generate-weekly-article.mjs: the week after this run's
  // Friday 12:00 Europe/Prague publication slot.
  const argIndex = process.argv.indexOf('--target-week');
  if (argIndex >= 0 && !process.argv[argIndex + 1]) throw new Error('Missing --target-week YYYY-Www value');
  let explicitWeek = argIndex >= 0 ? process.argv[argIndex + 1] : process.env.OVERSIZE_TARGET_WEEK || '';
  if (!explicitWeek && process.env.OVERSIZE_CHECK_MODE === 'watchdog') {
    let dueSlot = publicationSlotFor(now);
    if (dueSlot > now) dueSlot = publicationSlotFor(new Date(dueSlot.getTime() - 7 * 86400000));
    explicitWeek = isoWeekLabel(targetWeekDateFor(dueSlot));
  }
  const plan = editionPlan({ now, targetWeek: explicitWeek });
  const nextWeekLabel = plan.targetWeek;
  const slug = `eu-oversize-weekly-${process.env.OVERSIZE_PREVIEW === '1' ? 'preview-' : ''}${nextWeekLabel.toLowerCase()}`;
  const relativePath = path.join('src', 'content', 'news', 'eu-oversize', `${slug}.md`);
  return { nextWeekLabel, relativePath, absolutePath: path.join(ROOT, relativePath), publicationSlot: plan.publicationSlot };
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
  let replacesPr = '';
  let approvedPr = '';
  let approvedPrHead = '';
  if (process.env.GITHUB_ACTIONS === 'true') {
    if (!process.env.GH_TOKEN || !/^[\w.-]+\/[\w.-]+$/.test(process.env.GITHUB_REPOSITORY || '')) throw new Error('Publication PR access is not configured');
    const branch = publicationBranchFor(target.nextWeekLabel, { preview: process.env.OVERSIZE_PREVIEW === '1', correction });
    const allPulls = JSON.parse(execFileSync('gh', ['pr', 'list', '--repo', process.env.GITHUB_REPOSITORY, '--base', 'main', '--state', 'all', '--limit', '100', '--json', 'url,headRefName,headRefOid,body,createdAt,updatedAt,state,isDraft'], { encoding: 'utf8' }));
    const pulls = allPulls.filter((pull) => !pull.state || pull.state === 'OPEN');
    const editionPulls = classifyEditionPulls(pulls, { branch, targetWeek: target.nextWeekLabel });
    stalePrs = editionPulls.stale.map((pull) => pull.url);
    for (const url of stalePrs) console.log(`::warning::Edition PR for a week that has already passed is still open: ${url}`);
    if (needed && editionPulls.pending) {
      const candidate = editionPulls.pending;
      const refresh = shouldReplaceBlockedEditionPr(candidate, allPulls, now);
      if (refresh && process.env.OVERSIZE_RECOVERY_ALLOWED === '1') {
        replacesPr = candidate.url;
        console.log(`EDITORIAL_REJECTED: ${candidate.url} is an audit, not a prepared publication. Source-fingerprint deduplication must pass before a new generation.`);
      } else if (refresh && process.env.OVERSIZE_RECOVERY_ALLOWED !== '1') {
        // The watchdog is read-only: the primary publisher creates and verifies a replacement.
        console.log(`Rejected edition PR is eligible for a new safe attempt: ${candidate.url}`);
      } else {
        needed = false;
        pendingPr = candidate.url;
        const approvalMarkers = [...String(candidate.body || '').matchAll(/<!-- DAJC_WEEKLY_STATE:([A-Z_]+) -->/g)];
        const attemptMarkers = [...String(candidate.body || '').matchAll(/<!-- DAJC_WEEKLY_ATTEMPT:([0-9]+-[0-9]+) -->/g)];
        if (!correction && process.env.OVERSIZE_PREVIEW !== '1' && !candidate.isDraft &&
            approvalMarkers.length === 1 && approvalMarkers[0][1] === 'EDITORIAL_APPROVED' &&
            attemptMarkers.length === 1 && /^[a-f0-9]{40}$/.test(candidate.headRefOid || '')) {
          approvedPr = candidate.url;
          approvedPrHead = candidate.headRefOid;
          console.log(`Independently approved pending edition can resume protected merge without generation: ${approvedPr}`);
        }
        console.log(`Edition already awaits review in ${pendingPr}; no regeneration or additional AI spend.`);
      }
    }
  }
  // A missing article is overdue after its own edition slot even without a PR.
  // File existence still needs the separate independent delivery verification.
  const publicDue = process.env.OVERSIZE_PREVIEW !== '1' && now.getTime() >= target.publicationSlot.getTime();
  const overdue = !exists && publicDue;
  if (overdue) console.log(`::error::EU Oversize Weekly ${target.nextWeekLabel} is past its Friday 12:00 Europe/Prague slot but its article is not merged: ${pendingPr || replacesPr || 'no publication PR'}`);

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
      `needed=${needed ? 'true' : 'false'}\napproved_pr=${approvedPr}\npr_head=${approvedPrHead}\nreplaces_pr=${replacesPr}\npending_pr=${pendingPr ? 'true' : 'false'}\npublic_due=${publicDue ? 'true' : 'false'}\narticle_exists=${exists ? 'true' : 'false'}\noverdue=${overdue ? 'true' : 'false'}\nstale_prs=${stalePrs.join(' ')}\ntarget=${target.relativePath}\nweek=${target.nextWeekLabel}\n`
    );
  }

  if (process.env.GITHUB_STEP_SUMMARY && !needed) {
    await appendFile(
      process.env.GITHUB_STEP_SUMMARY,
      pendingPr
        ? `### EU Oversize Weekly - awaiting review\n\n${pendingPr}\n\nNo article was published by this run; no generation was repeated.\n`
        : `### EU Oversize Weekly - already prepared in main\n\nTarget \u0060${target.relativePath}\u0060 already exists in main. Public delivery requires the independent watchdog; this check proves only idempotency.\n`
    );
  }
}

main().catch((err) => {
  console.error('Weekly publication idempotency check failed:', err);
  process.exitCode = 1;
});
