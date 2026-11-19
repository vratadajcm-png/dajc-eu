#!/usr/bin/env node
// Runs after the source refresh and before paid synthesis. A new collection
// timestamp alone does not permit rerolling an editorially rejected edition.
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { editionPlan } from './lib/edition-plan.mjs';
import { loadWeekFindings } from './lib/store.mjs';
import { findingsFingerprint, REJECTION_MARKER } from './lib/weekly-recovery.mjs';

export function identicalRejectedPreparation(pulls, targetWeek, fingerprint) {
  const prefix = 'automation/weekly-' + targetWeek.toLowerCase();
  return pulls.find(pr => {
    const branch = String(pr.headRefName || '');
    if (branch !== prefix && !new RegExp('^' + prefix + '-retry-\\d+(?:-\\d+)?$').test(branch)) return false;
    const body = String(pr.body || '');
    const previous = body.match(/DAJC_WEEKLY_SOURCES:\s*([a-f0-9]{64})/)?.[1];
    const blocked = body.includes(REJECTION_MARKER) || /DAJC_WEEKLY_STATE:\s*(?:EDITORIAL_REJECTED|BLOCKED)/.test(body);
    return blocked && previous === fingerprint;
  }) || null;
}

async function main() {
  const now = process.env.OVERSIZE_NOW ? new Date(process.env.OVERSIZE_NOW) : new Date();
  const plan = editionPlan({ now, targetWeek: process.env.OVERSIZE_TARGET_WEEK || '' });
  const findings = new Map();
  for (const week of plan.findingsWeeks) for (const item of (await loadWeekFindings(week)).values()) findings.set(item.sourceUrl, item);
  const fingerprint = findingsFingerprint([...findings.values()]);
  const pulls = JSON.parse(execFileSync('gh', ['pr', 'list', '--repo', process.env.GITHUB_REPOSITORY || 'vratadajcm-png/dajc-eu',
    '--state', 'all', '--limit', '1000', '--json', 'number,url,body,headRefName'], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }));
  const rejected = identicalRejectedPreparation(pulls, plan.targetWeek, fingerprint);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `source_fingerprint=${fingerprint}\nneeded=${!rejected}\n`);
  if (rejected) {
    const message = `BLOCKED: ${plan.targetWeek} has unchanged source evidence from rejected preparation ${rejected.url}. No paid generation repeated. A later run may start a new bounded preparation after actual source facts change.`;
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, '\n### Editorial preparation blocked\n\n' + message + '\n');
    throw new Error(message);
  }
  console.log(`PREPARING ${plan.targetWeek}: ${findings.size} source records, semantic fingerprint ${fingerprint}.`);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
