import { createHash } from 'node:crypto';

export function publicationApprovalValid(record, { articlePath, targetWeek, raw }) {
  if (!record || record.schemaVersion !== 1 || record.state !== 'EDITORIAL_APPROVED' ||
      record.articlePath !== articlePath || record.targetWeek !== targetWeek ||
      record.sha256 !== createHash('sha256').update(raw).digest('hex') ||
      record.researchProvider !== 'perplexity-search' || !/^claude-/.test(record.claudeModel || '') ||
      !Number.isFinite(Date.parse(record.approvedAt)) || !/^\d+-\d+$/.test(record.attemptId || '')) return false;
  const review = record.review;
  const front = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] || '';
  const urls = [...front.matchAll(/^\s+url:\s*"([^"]+)"\s*$/gm)].map(m => m[1]);
  if (!urls.length || new Set(urls).size !== urls.length || record.sourceCount !== urls.length ||
      review?.verdict !== 'approve' || !Array.isArray(review.blockingReasons) || review.blockingReasons.length ||
      !Array.isArray(review.sourceChecks) || review.sourceChecks.length !== urls.length) return false;
  const checks = new Set();
  for (const check of review.sourceChecks) {
    if (check.supported !== true || typeof check.reason !== 'string' || check.reason.trim().length < 4 ||
        !urls.includes(check.url) || checks.has(check.url)) return false;
    checks.add(check.url);
  }
  return checks.size === urls.length;
}

export function protectedMergeState(pr, requiredChecks, expectedHead) {
  if (!/^[a-f0-9]{40}$/.test(expectedHead || '') || pr.headRefOid !== expectedHead) return { status: 'blocked', reason: 'PR head changed since exact-byte editorial approval' };
  if (pr.baseRefName !== 'main' || pr.state !== 'OPEN' || pr.isDraft || !String(pr.body || '').includes('<!-- DAJC_WEEKLY_STATE:EDITORIAL_APPROVED -->')) return { status: 'blocked', reason: 'PR is not an open, independently approved final edition into main' };
  if (!Array.isArray(requiredChecks) || !requiredChecks.length) return { status: 'blocked', reason: 'No required branch checks found; refusing an unprotected merge' };
  if (!['application-validate', 'news-validate'].every(name => requiredChecks.some(c => c.name === name))) return { status: 'blocked', reason: 'Required application-validate/news-validate protection is missing' };
  const all = [...requiredChecks, ...(pr.statusCheckRollup || []).map(c => ({ bucket: c.conclusion ? ({ SUCCESS: 'pass', NEUTRAL: 'pass', SKIPPED: 'pending' }[c.conclusion] || 'fail') : c.state === 'SUCCESS' ? 'pass' : c.state === 'FAILURE' || c.state === 'ERROR' ? 'fail' : 'pending' }))];
  if (all.some(c => ['fail', 'cancel'].includes(c.bucket))) return { status: 'blocked', reason: 'GitHub CI or deployment check failed' };
  if (all.some(c => c.bucket !== 'pass') || ['BEHIND', 'BLOCKED', 'UNKNOWN', 'DIRTY', 'DRAFT'].includes(pr.mergeStateStatus)) return { status: 'pending', reason: 'Required checks or main protection have not passed yet' };
  return { status: 'ready', reason: 'Exact approved head passed required checks' };
}
