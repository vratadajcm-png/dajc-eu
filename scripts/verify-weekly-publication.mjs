#!/usr/bin/env node
// Read-only watchdog: durable editorial approval -> merged PR -> successful
// Vercel Production deployment -> public index, article and RSS (or no early leak).
import { readFile, readdir, appendFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { editionPlan } from './lib/edition-plan.mjs';
import { assertTrustedApproval } from './lib/trusted-weekly-approval.mjs';
import { publicationSlotFor, targetWeekDateFor } from './lib/next-publication.mjs';
import { isoWeekLabel } from './lib/week.mjs';
import { articleMetadata, approvedPublicationReceipt, approvedMergedPr, validatePublicationChecks, checkPublicDelivery, verifyWithRetry } from './lib/publication-verification.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const gh = args => JSON.parse(execFileSync('gh', args, { encoding: 'utf8', timeout: 30000 }));

export function latestDueWeek(now = new Date()) {
  let slot = publicationSlotFor(now);
  if (slot > now) slot = publicationSlotFor(new Date(slot.getTime() - 7 * 86400000));
  return isoWeekLabel(targetWeekDateFor(slot));
}

async function main() {
  const now = process.env.OVERSIZE_NOW ? new Date(process.env.OVERSIZE_NOW) : new Date();
  const argIndex = process.argv.indexOf('--target-week');
  if (argIndex >= 0 && !process.argv[argIndex + 1]) throw new Error('Missing --target-week YYYY-Www value');
  const targetWeek = argIndex >= 0 ? process.argv[argIndex + 1] : process.env.OVERSIZE_TARGET_WEEK || process.env.TARGET_WEEK || latestDueWeek(now);
  const plan = editionPlan({ now, targetWeek });
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `week=${plan.targetWeek}\n`);
  const articlePath = `src/content/news/eu-oversize/eu-oversize-weekly-${plan.targetWeek.toLowerCase()}.md`;
  let raw;
  try { raw = await readFile(path.join(ROOT, articlePath), 'utf8'); }
  catch { throw new Error(`ARTICLE_MISSING: ${plan.targetWeek} has no merged article at ${articlePath}`); }
  const metadata = articleMetadata(raw, plan.targetWeek);
  if (metadata.publishedAt < plan.publicationSlot) throw new Error('ARTICLE_TIME: approved date is before its Friday 12:00 Europe/Prague slot');
  const folder = path.join(ROOT, 'data', 'oversize', plan.targetWeek, 'publication');
  const receipts = [];
  try {
    for (const file of (await readdir(folder)).filter(name => /^[0-9]+-[0-9]+\.json$/.test(name))) {
      receipts.push(JSON.parse(await readFile(path.join(folder, file), 'utf8')));
    }
  } catch (error) { throw new Error(`EDITORIAL_APPROVAL: cannot read durable audit: ${error.message}`); }
  const receipt = approvedPublicationReceipt(receipts, metadata, plan.targetWeek);
  const repo = process.env.GITHUB_REPOSITORY;
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo || '') || !process.env.GH_TOKEN) throw new Error('GITHUB_ACCESS: repository/token required to prove protected merge and deployment');
  assertTrustedApproval(receipt, { repo, articlePath, targetWeek: plan.targetWeek, raw });
  const pulls = gh(['pr', 'list', '--repo', repo, '--base', 'main', '--state', 'merged', '--limit', '100', '--json', 'url,body,state,mergedAt,mergeCommit,statusCheckRollup']);
  const merged = approvedMergedPr(pulls, receipt);
  validatePublicationChecks(merged);
  const open = gh(['pr', 'list', '--repo', repo, '--base', 'main', '--state', 'open', '--limit', '100', '--json', 'url,headRefName']);
  const unresolved = open.filter(pr => {
    const match = pr.headRefName.match(/^automation\/weekly-(\d{4})-w(\d{2})(?:-|$)/);
    return match && `${match[1]}-W${match[2]}` <= plan.targetWeek;
  });
  if (unresolved.length) throw new Error('STALE_PRS: unresolved edition PRs: ' + unresolved.map(x => x.url).join(', '));

  const result = await verifyWithRetry(async attempt => {
    const deployments = gh(['api', `repos/${repo}/deployments?per_page=100`]);
    const deployment = deployments.find(d => /^production$/i.test(d.environment) && d.creator?.login === 'vercel[bot]');
    if (!deployment) throw new Error('VERCEL_DEPLOYMENT: no Vercel Production deployment found');
    const statuses = gh(['api', `repos/${repo}/deployments/${deployment.id}/statuses?per_page=10`]);
    if (statuses[0]?.state !== 'success') throw new Error(`VERCEL_DEPLOYMENT: latest Production deployment ${deployment.id} is ${statuses[0]?.state || 'unknown'}`);
    if (deployment.sha !== merged.mergeCommit.oid) {
      const comparison = gh(['api', `repos/${repo}/compare/${merged.mergeCommit.oid}...${deployment.sha}`]);
      if (!['ahead', 'identical'].includes(comparison.status)) throw new Error('VERCEL_COMMIT: deployed commit does not contain the approved merged article');
    }
    const base = 'https://www.dajc.eu';
    const fetchPage = async route => {
      const url = new URL(route, base);
      url.searchParams.set('weekly-verification', `${process.env.GITHUB_RUN_ID || 'manual'}-${Date.now()}-${attempt}`);
      const response = await fetch(url, { headers: { 'cache-control': 'no-cache, no-store', pragma: 'no-cache' }, signal: AbortSignal.timeout(20000), redirect: 'follow' });
      if (!['www.dajc.eu', 'dajc.eu'].includes(new URL(response.url).hostname)) throw new Error('PUBLIC_DOMAIN: response redirected away from DAJC.eu');
      return { status: response.status, text: await response.text() };
    };
    const [article, news, rss] = await Promise.all([
      fetchPage(`/news/eu-oversize/${metadata.slug}`), fetchPage('/news'), fetchPage('/news/rss.xml'),
    ]);
    // Use real wall time on each retry; a pre-slot check may cross the release
    // boundary while Vercel finishes. OVERSIZE_NOW exists only for simulations.
    const checkedAt = process.env.OVERSIZE_NOW ? now : new Date();
    return { ...checkPublicDelivery({ article, news, rss }, metadata, { now: checkedAt, publicationSlot: plan.publicationSlot }),
      targetWeek: plan.targetWeek, mergedPr: merged.url, mergeCommit: merged.mergeCommit.oid,
      deploymentId: deployment.id, deployedCommit: deployment.sha, deploymentUrl: statuses[0].environment_url,
      verifiedAt: checkedAt.toISOString(), publicUrl: `${base}/news/eu-oversize/${metadata.slug}` };
  }, {
    attempts: Number(process.env.WEEKLY_VERIFY_ATTEMPTS || 8),
    delayMs: Number(process.env.WEEKLY_VERIFY_DELAY_MS || 20000),
    onRetry: ({ attempt, error }) => console.log(`Verification ${attempt}: ${error.message}; bounded retry follows.`),
  });
  console.log(JSON.stringify(result, null, 2));
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY,
    `\n### Weekly ${result.targetWeek}: ${result.state}\n\nPR: ${result.mergedPr}\n\nVercel Production: ${result.deploymentUrl} (${result.deployedCommit})\n\nPublic article: ${result.publicUrl}\n\nIndex, direct URL, RSS and release time checked at ${result.verifiedAt}; ${result.attempts} attempt(s).\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error('::error::WEEKLY PUBLICATION BLOCKED: ' + error.message); process.exitCode = 1; });
}
