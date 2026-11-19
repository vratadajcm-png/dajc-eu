// Content in a PR cannot attest its own independent approval. Bind the durable
// record to the immutable artifact of the main-only publishing workflow.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { publicationApprovalValid } from './publication-approval.mjs';

export function trustedReceiptMatches(record, receipt, run) {
  if (run.head_branch !== 'main' || !['schedule', 'workflow_dispatch'].includes(run.event) ||
      run.path !== '.github/workflows/publish-weekly-oversize.yml' ||
      `${run.id}-${run.run_attempt}` !== record.attemptId) return false;
  const fields = ['articlePath', 'sha256', 'targetWeek', 'approvedAt', 'publishedAt', 'scheduledPublicationAt',
    'researchProvider', 'claudeModel', 'sourceCount', 'leadCount', 'restCount', 'review'];
  return fields.every(field => isDeepStrictEqual(record[field], receipt?.[field]));
}

export function assertTrustedApproval(record, { repo, articlePath, targetWeek, raw, gh = args => execFileSync('gh', args, { encoding: 'utf8', timeout: 60000 }) }) {
  if (!publicationApprovalValid(record, { articlePath, targetWeek, raw })) throw new Error('Invalid exact-byte approval');
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo || '')) throw new Error('Missing trusted approval repository');
  const [runId, attempt] = record.attemptId.split('-');
  const run = JSON.parse(gh(['api', `repos/${repo}/actions/runs/${runId}/attempts/${attempt}`]));
  const folder = mkdtempSync(path.join(tmpdir(), 'dajc-trusted-approval-'));
  try {
    gh(['run', 'download', runId, '--repo', repo, '--name', `weekly-approval-${runId}-${attempt}`, '--dir', folder]);
    const receipt = JSON.parse(readFileSync(path.join(folder, 'dajc-weekly-review-approved.json'), 'utf8'));
    if (!trustedReceiptMatches(record, receipt, run)) throw new Error('PR approval differs from trusted main workflow artifact');
  } finally { rmSync(folder, { recursive: true, force: true }); }
}
