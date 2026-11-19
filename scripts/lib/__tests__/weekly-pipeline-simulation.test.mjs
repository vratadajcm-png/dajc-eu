// Offline contract simulation across the real publication boundaries. API,
// GitHub and public HTTP replies are fixtures; no network, push or merge occurs.
// The generator/recovery subprocess suites separately exercise their CLI loops.
import { describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { editionPlan } from '../edition-plan.mjs';
import { isoWeekEnd } from '../week.mjs';
import { selectCandidates } from '../select-candidates.mjs';
import { renderArticleMarkdown, toFrontmatterYaml } from '../render-article.mjs';
import { runQualityGate } from '../quality-gate.mjs';
import { parseCandidateArticle, reviewApproved, withOriginalPages } from '../../claude-weekly-review.mjs';
import { publicationApprovalValid, protectedMergeState } from '../publication-approval.mjs';
import { approvedPublicationReceipt, approvedMergedPr, articleMetadata, validatePublicationChecks, checkPublicDelivery, verifyWithRetry } from '../publication-verification.mjs';
import { selectRejectedSourceUrls, shouldReplaceBlockedEditionPr, REJECTION_MARKER, findingsFingerprint } from '../weekly-recovery.mjs';
import { classifyEditionPulls, publicationBranchFor } from '../publish-gate.mjs';

const now = new Date('2026-11-12T09:00:00Z');
const week = '2026-W47';
const head = 'a'.repeat(40);
const finding = n => ({
  id: `simulation-${n}`, country: 'Germany', jurisdiction: 'DE', type: 'permit_change',
  title: `Exceptional transport permit procedure ref${n}`,
  summary: `The authority changes the application procedure for exceptional transport permit ref${n}.`,
  sourceUrl: `https://authority.example/dated-notice-${n}`, sourceName: 'Synthetic authority',
  publishedAt: '2026-11-11', firstSeenAt: '2026-11-11T08:00:00Z', lastCheckedAt: now.toISOString(), status: 'active',
});
const report = f => ({
  country: f.country, title: f.title, whatChanged: f.summary, where: 'Federal road network',
  vehicleScope: 'Exceptional combinations over 12 t; emergency vehicles are exempt.',
  timeWindow: '', validFrom: null, validTo: null,
  impact: 'The specified application procedure changes; the permit remains mandatory.',
  recommendedAction: 'Use the authority procedure and confirm permit conditions before dispatch.',
  exemptions: 'Emergency vehicles are exempt.', sourceUrl: f.sourceUrl, sourceName: f.sourceName,
  isDrivingBan: false, isInfrastructure: false,
});

async function prepare(findings, reviewer, { at = now, targetWeek = week, attemptId = '123-1' } = {}) {
  const plan = editionPlan({ now: at, targetWeek });
  const context = { now: at, weekStart: plan.targetDate, weekEnd: isoWeekEnd(plan.targetDate), previousEditions: new Map() };
  const { selected } = selectCandidates(findings, context);
  const developments = selected.map(report);
  const rendered = renderArticleMarkdown({
    seoTitle: `EU Oversize Weekly ${targetWeek}`, metaDescription: 'Verified exceptional transport changes for operators.',
    intro: 'Operational updates for commercial freight vehicles and combinations from 3.5 t inclusive using a tachograph; exceptional transport remains the priority.',
    developments, europeRoundup: [], operatorChecklist: ['Confirm the permit and its exact conditions before dispatch.'],
  }, {
    slug: `eu-oversize-weekly-${targetWeek.toLowerCase()}`, publishedAt: plan.publishedAt,
    targetWeek, preparedAt: plan.preparedAt, scheduledPublicationAt: plan.publicationSlot.toISOString(),
    late: plan.late, weekEnd: context.weekEnd.toISOString().slice(0, 10), nextPublicationLabel: null,
  });
  const gate = runQualityGate({ ...rendered, developments, europeRoundup: [], ...context,
    candidatesByUrl: new Map(selected.map(f => [f.sourceUrl, f])), eligibilityContext: context });
  if (!gate.ok) throw new Error('DETERMINISTIC: ' + gate.errors.join('; '));
  const raw = `${toFrontmatterYaml(rendered.frontmatter)}\n\n${rendered.body}`;
  const articlePath = `src/content/news/eu-oversize/${rendered.frontmatter.slug}.md`;
  const article = parseCandidateArticle(articlePath, raw, at, targetWeek);
  const evidence = await withOriginalPages(selected.map(f => ({ url: f.sourceUrl })), async url => ({
    ok: true, text: `<html><article><h1>Dated authority permit notice</h1><p>${url}: exceptional transport application procedure over 12 t; emergency vehicles exempt.</p></article></html>`,
  }));
  const review = await reviewer(article, evidence);
  const receipt = reviewApproved(review, article.links) ? {
    schemaVersion: 1, state: 'EDITORIAL_APPROVED', articlePath, targetWeek, attemptId,
    sha256: createHash('sha256').update(raw).digest('hex'), researchProvider: 'perplexity-search',
    claudeModel: 'claude-test-fixture', approvedAt: at.toISOString(), sourceCount: article.links.length, review,
  } : null;
  return { plan, raw, articlePath, article, receipt, review, selected, metadata: articleMetadata(raw, targetWeek) };
}
const approve = async article => ({ verdict: 'approve', blockingReasons: [], sourceChecks: article.links.map(url => ({ url, supported: true, reason: 'Original authority notice confirms exact claims and exemptions.' })) });
const reject = async article => ({ verdict: 'reject', blockingReasons: ['Unsupported or stale associated claim.'], sourceChecks: article.links.map(url => ({ url, supported: url !== article.links.at(-1), reason: url === article.links.at(-1) ? 'Claim absent from original dated notice.' : 'Claim confirmed.' })) });
const ci = [ { name: 'application-validate', bucket: 'pass' }, { name: 'news-validate', bucket: 'pass' } ];
function pull(receipt, overrides = {}) {
  return { headRefOid: head, baseRefName: 'main', state: 'OPEN', isDraft: false, mergeStateStatus: 'CLEAN',
    body: `<!-- DAJC_WEEKLY_STATE:EDITORIAL_APPROVED -->\n<!-- DAJC_WEEKLY_ATTEMPT:${receipt.attemptId} -->`,
    statusCheckRollup: ci.map(c => ({ name: c.name, status: 'COMPLETED', conclusion: 'SUCCESS' })), ...overrides };
}
function publicReplies(edition) {
  const url = `https://www.dajc.eu/news/eu-oversize/${edition.metadata.slug}`;
  return {
    article: { status: 200, text: `<script type="application/ld+json">${JSON.stringify({ '@type': 'NewsArticle', url, headline: edition.metadata.title, datePublished: edition.metadata.publishedAt.toISOString() })}</script>${edition.metadata.sources.map(s => `<a href="${s}">Source</a>`).join('')}` },
    news: { status: 200, text: `<article><a href="${url}">Title</a><a href="${url}">Read more</a></article>` },
    rss: { status: 200, text: `<rss><channel><item><link>${url}</link><pubDate>${edition.metadata.publishedAt.toUTCString()}</pubDate></item></channel></rss>` },
  };
}
function proveMerge(edition, pr = pull(edition.receipt), checks = ci) {
  const receipt = approvedPublicationReceipt([edition.receipt], edition.metadata, week);
  const decision = protectedMergeState(pr, checks, head);
  if (decision.status !== 'ready') throw new Error(`MERGE_${decision.status.toUpperCase()}: ${decision.reason}`);
  const merged = { ...pr, state: 'MERGED', mergedAt: '2026-11-12T10:00:00Z', mergeCommit: { oid: head }, url: 'https://github.example/pull/123' };
  const result = approvedMergedPr([merged], receipt);
  validatePublicationChecks(result);
  return result;
}

describe('offline full publication contract simulation', () => {
  it('prepares Thursday, validates independent approval and protected CI, stays hidden, then verifies Friday index/direct/RSS', async () => {
    const edition = await prepare([finding(1), finding(2), finding(3), finding(4)], approve);
    expect(edition.selected).toHaveLength(4); // no artificial quota
    expect(publicationApprovalValid(edition.receipt, { articlePath: edition.articlePath, targetWeek: week, raw: edition.raw })).toBe(true);
    expect(proveMerge(edition).mergeCommit.oid).toBe(head);
    const hidden = { article: { status: 404, text: '' }, news: { status: 200, text: '' }, rss: { status: 200, text: '<rss />' } };
    expect(checkPublicDelivery(hidden, edition.metadata, { now, publicationSlot: edition.plan.publicationSlot }).state).toBe('PUBLICATION_SCHEDULED');
    const delivered = await verifyWithRetry(async () => checkPublicDelivery(publicReplies(edition), edition.metadata, {
      now: new Date('2026-11-13T11:01:00Z'), publicationSlot: edition.plan.publicationSlot,
    }), { attempts: 3, delayMs: 0 });
    expect(delivered).toMatchObject({ state: 'PUBLISHED_VERIFIED', articleCards: 1, rssItems: 1, attempts: 1 });
  });

  it('vetoes unsupported source, rebuilds from the remaining evidence and requires a new exact-byte approval', async () => {
    const original = await prepare([finding(1), finding(2)], reject);
    expect(original.receipt).toBeNull();
    const rejected = selectRejectedSourceUrls(original.review, original.article.links);
    expect(rejected).toEqual([finding(2).sourceUrl]);
    const repaired = await prepare(original.selected.filter(f => !rejected.includes(f.sourceUrl)), approve, { attemptId: '123-2' });
    expect(repaired.raw).not.toContain(finding(2).sourceUrl);
    expect(repaired.raw).toContain('over 12 t; emergency vehicles are exempt.');
    expect(repaired.receipt.sha256).not.toBe(original.metadata.sha256);
    expect(publicationApprovalValid(repaired.receipt, { articlePath: original.articlePath, targetWeek: week, raw: original.raw })).toBe(false);
    expect(proveMerge(repaired).body).toContain('123-2');
  });

  it('a second factual rejection cannot produce a valid receipt or reach merge', async () => {
    const original = await prepare([finding(1), finding(2), finding(3)], reject);
    const excluded = selectRejectedSourceUrls(original.review, original.article.links);
    const second = await prepare(original.selected.filter(f => !excluded.includes(f.sourceUrl)), reject, { attemptId: '123-2' });
    expect(second.receipt).toBeNull();
    expect(() => approvedPublicationReceipt([], second.metadata, week)).toThrow('EDITORIAL_APPROVAL');
    const forged = { ...(await prepare([finding(1), finding(2)], approve)).receipt, review: second.review, state: 'EDITORIAL_REJECTED' };
    expect(publicationApprovalValid(forged, { articlePath: second.articlePath, targetWeek: week, raw: second.raw })).toBe(false);
  });

  it('an AI API outage stops before approval and an earlier receipt cannot authorize changed bytes', async () => {
    const failedReviewer = vi.fn(async () => { throw new Error('Reviewer API failed with HTTP 503'); });
    await expect(prepare([finding(1)], failedReviewer)).rejects.toThrow('HTTP 503');
    expect(failedReviewer).toHaveBeenCalledTimes(1);
    const approved = await prepare([finding(1)], approve);
    expect(publicationApprovalValid(approved.receipt, { articlePath: approved.articlePath, targetWeek: week, raw: approved.raw + '\nchanged claim' })).toBe(false);
  });

  it('recognizes a stuck rejected PR, preserves its archive and deduplicates pending approved publication', () => {
    const branch = publicationBranchFor(week);
    const rejected = { headRefName: branch, url: 'https://github.example/pull/130', body: REJECTION_MARKER, createdAt: '2026-11-12T08:00:00Z', updatedAt: '2026-11-12T08:00:00Z' };
    const retry = { headRefName: `${branch}-retry-124`, url: 'https://github.example/pull/131', body: '<!-- DAJC_WEEKLY_STATE:EDITORIAL_APPROVED -->' };
    expect(shouldReplaceBlockedEditionPr(rejected, [rejected], new Date('2026-11-13T08:00:00Z'))).toBe(true);
    expect(shouldReplaceBlockedEditionPr(retry, [rejected, retry], new Date('2026-11-13T08:00:00Z'))).toBe(false);
    expect(classifyEditionPulls([retry], { branch, targetWeek: week }).pending.url).toBe(retry.url);
    expect(findingsFingerprint([finding(1)])).toBe(findingsFingerprint([{ ...finding(1), lastCheckedAt: '2026-11-14T10:00:00Z' }]));
    expect(findingsFingerprint([finding(1)])).not.toBe(findingsFingerprint([{ ...finding(1), summary: 'New authority evidence changes applicable conditions.' }]));
  });

  it('failed GitHub CI and a changed PR head block the protected merge', async () => {
    const edition = await prepare([finding(1)], approve);
    expect(() => proveMerge(edition, pull(edition.receipt), [{ name: 'news-validate', bucket: 'fail' }])).toThrow('MERGE_BLOCKED');
    expect(() => proveMerge(edition, pull(edition.receipt, { headRefOid: 'b'.repeat(40) }))).toThrow('head changed');
    expect(() => validatePublicationChecks({ statusCheckRollup: [{ name: 'news-validate', status: 'COMPLETED', conclusion: 'FAILURE' }] })).toThrow('GITHUB_CI');
  });

  it('deployment failure and an inaccessible article exhaust bounded verification without reporting publication', async () => {
    const edition = await prepare([finding(1)], approve);
    proveMerge(edition);
    const deployment = vi.fn(async () => { throw new Error('VERCEL_DEPLOYMENT: latest Production deployment is failure'); });
    await expect(verifyWithRetry(deployment, { attempts: 3, delayMs: 0 })).rejects.toThrow('BLOCKED after 3');
    expect(deployment).toHaveBeenCalledTimes(3);
    const pages = publicReplies(edition);
    pages.article.status = 404;
    const request = vi.fn(async () => checkPublicDelivery(pages, edition.metadata, { now: new Date('2026-11-13T12:00:00Z'), publicationSlot: edition.plan.publicationSlot }));
    await expect(verifyWithRetry(request, { attempts: 2, delayMs: 0 })).rejects.toThrow('DIRECT_URL');
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('duplicate public cards and early exposure are blocking incidents', async () => {
    const edition = await prepare([finding(1)], approve);
    const pages = publicReplies(edition);
    pages.news.text += pages.news.text;
    expect(() => checkPublicDelivery(pages, edition.metadata, { now: new Date('2026-11-13T12:00:00Z'), publicationSlot: edition.plan.publicationSlot })).toThrow('expected one article card');
    const early = vi.fn(async () => checkPublicDelivery(publicReplies(edition), edition.metadata, { now, publicationSlot: edition.plan.publicationSlot }));
    await expect(verifyWithRetry(early, { attempts: 3, delayMs: 0 })).rejects.toThrow('EARLY_PUBLICATION');
    expect(early).toHaveBeenCalledTimes(1);
  });

  it('a delayed W47 recovery keeps the original slot and transparently dates the actual late preparation', async () => {
    const late = new Date('2026-11-16T16:00:00Z');
    const edition = await prepare([{ ...finding(1), publishedAt: '2026-11-16' }], approve, { at: late });
    expect(edition.plan.publicationSlot.toISOString()).toBe('2026-11-13T11:00:00.000Z');
    expect(edition.metadata.publishedAt.toISOString()).toBe(late.toISOString());
    expect(edition.raw).toContain('prepared after its scheduled release');
    expect(edition.article.week).toBe(week);
  });
});
