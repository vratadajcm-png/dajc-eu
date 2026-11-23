#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { protectedMergeState } from './lib/publication-approval.mjs';
const { PR_URL, EXPECTED_PR_HEAD } = process.env;
if (process.env.UNATTENDED !== 'true') throw new Error('Autonomous merge BLOCKED: DAJC_WEEKLY_PR_TOKEN did not open the PR with unattended CI permission');
if (!/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+$/.test(PR_URL || '') || !/^[a-f0-9]{40}$/.test(EXPECTED_PR_HEAD || '')) throw new Error('Missing pinned publication PR/head');
const gh = args => execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
for (let attempt = 1; attempt <= 50; attempt++) {
  const pr = JSON.parse(gh(['pr', 'view', PR_URL, '--json', 'headRefOid,baseRefName,state,isDraft,body,statusCheckRollup,mergeStateStatus']));
  let required;
  try { required = JSON.parse(gh(['pr', 'checks', PR_URL, '--required', '--json', 'bucket,name'])); }
  catch (error) {
    // gh exits 8 while checks are pending, but still emits the JSON.
    try { required = JSON.parse(error.stdout); } catch { throw new Error('Cannot read main required checks'); }
  }
  const result = protectedMergeState(pr, required, EXPECTED_PR_HEAD);
  if (result.status === 'blocked') throw new Error(result.reason);
  if (result.status === 'ready') {
    // GitHub rechecks rules and the expected head atomically; never --admin.
    gh(['pr', 'merge', PR_URL, '--squash', '--match-head-commit', EXPECTED_PR_HEAD]);
    console.log(`Merged independently approved edition through main protection: ${PR_URL} (${EXPECTED_PR_HEAD})`);
    process.exit(0);
  }
  console.log(`Merge pending ${attempt}/50: ${result.reason}`);
  if (attempt < 50) await new Promise(resolve => setTimeout(resolve, 30_000));
}
throw new Error('Protected merge timed out; publication remains blocked');
