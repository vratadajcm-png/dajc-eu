import { describe, expect, it } from 'vitest';
import { articleMetadata, approvedPublicationReceipt, approvedMergedPr, validatePublicationChecks, checkPublicDelivery, verifyWithRetry } from '../publication-verification.mjs';
import { latestDueWeek } from '../../verify-weekly-publication.mjs';
import { editionPlan } from '../edition-plan.mjs';

const source = 'https://authority.example/notice-47';
const raw = `---\ntitle: "EU Oversize Weekly 2026-W47"\nslug: "eu-oversize-weekly-2026-w47"\nstatus: published\npublishedAt: "2026-11-13T11:00:00.000Z"\nsources:\n  - name: "Authority"\n    url: "${source}"\n---\nVerified article.\n`;
const metadata = articleMetadata(raw, '2026-W47');
const path = `/news/eu-oversize/${metadata.slug}`;
const slot = new Date('2026-11-13T11:00:00Z');
const after = new Date('2026-11-13T11:01:00Z');
const receipt = { schemaVersion: 1, state: 'EDITORIAL_APPROVED', targetWeek: '2026-W47', articlePath: metadata.articlePath, sha256: metadata.sha256,
  researchProvider: 'perplexity-search', claudeModel: 'claude-sonnet-test', approvedAt: '2026-11-12T10:00:00Z', attemptId: '123-1', sourceCount: 1, review: { verdict: 'approve', blockingReasons: [], sourceChecks: [{ url: source, supported: true, reason: 'Authority confirms this claim' }] } };
function live() {
  return {
    article: { status: 200, text: `<html><h1>${metadata.title}</h1><script type="application/ld+json">${JSON.stringify({ '@type': 'NewsArticle', url: `https://www.dajc.eu${path}`, headline: metadata.title, datePublished: metadata.publishedAt.toISOString() })}</script><a href="${source}">Source</a></html>` },
    news: { status: 200, text: `<article class="news-card"><a href="${path}">Title</a><a href="${path}">Read more</a></article>` },
    rss: { status: 200, text: `<rss><channel><item><link>https://www.dajc.eu${path}/</link><pubDate>${metadata.publishedAt.toUTCString()}</pubDate></item></channel></rss>` },
  };
}
const verify = (responses, now = after) => checkPublicDelivery(responses, metadata, { now, publicationSlot: slot });

describe('independent weekly public watchdog', () => {
  it('proves scheduled publication through index, direct content and RSS', () => {
    expect(verify(live())).toMatchObject({ state: 'PUBLISHED_VERIFIED', articleCards: 1, rssItems: 1 });
  });
  it('checks current due edition separately from upcoming Thursday preparation', () => {
    expect(latestDueWeek(new Date('2026-11-16T12:00:00Z'))).toBe('2026-W47');
    expect(latestDueWeek(new Date('2026-11-19T12:00:00Z'))).toBe('2026-W47');
    expect(latestDueWeek(new Date('2026-11-20T10:59:59Z'))).toBe('2026-W47');
    expect(latestDueWeek(new Date('2026-11-20T11:00:00Z'))).toBe('2026-W48');
    expect(editionPlan({ now: new Date('2026-11-19T12:00:00Z') }).targetWeek).toBe('2026-W48');
  });
  it('keeps correct CET/CEST release boundaries including year rollover', () => {
    expect(latestDueWeek(new Date('2026-03-27T10:59:59Z'))).toBe('2026-W13');
    expect(latestDueWeek(new Date('2026-03-27T11:00:00Z'))).toBe('2026-W14');
    expect(latestDueWeek(new Date('2026-04-03T10:00:00Z'))).toBe('2026-W15');
    expect(latestDueWeek(new Date('2026-10-30T10:59:59Z'))).toBe('2026-W44');
    expect(latestDueWeek(new Date('2026-10-30T11:00:00Z'))).toBe('2026-W45');
    expect(latestDueWeek(new Date('2027-01-01T11:00:00Z'))).toBe('2027-W01');
  });
  it('requires exact-byte independent durable editorial approval', () => {
    expect(approvedPublicationReceipt([receipt], metadata, '2026-W47')).toBe(receipt);
    for (const change of [{ state: 'EDITORIAL_REJECTED' }, { sha256: '0'.repeat(64) }, { researchProvider: '' }, { targetWeek: '2026-W48' }, { approvedAt: null }, { attemptId: 'unsafe' }]) {
      expect(() => approvedPublicationReceipt([{ ...receipt, ...change }], metadata, '2026-W47')).toThrow(/EDITORIAL_APPROVAL/);
    }
  });
  it('requires one merged PR matching the independently approved attempt', () => {
    const pr = { state: 'MERGED', mergedAt: '2026-11-12T12:00:00Z', mergeCommit: { oid: 'abc' }, body: '<!-- DAJC_WEEKLY_STATE:EDITORIAL_APPROVED -->\n<!-- DAJC_WEEKLY_ATTEMPT:123-1 -->' };
    expect(approvedMergedPr([pr], receipt)).toBe(pr);
    for (const pulls of [[], [{ ...pr, state: 'OPEN' }], [{ ...pr, body: '<!-- DAJC_WEEKLY_STATE:EDITORIAL_REJECTED -->' }], [pr, pr]]) expect(() => approvedMergedPr(pulls, receipt)).toThrow(/MERGE:/);
  });
  it('fails for missing, pending or failed required GitHub CI', () => {
    const checks = ['application-validate', 'news-validate'].map(name => ({ name, status: 'COMPLETED', conclusion: 'SUCCESS' }));
    expect(() => validatePublicationChecks({ statusCheckRollup: checks })).not.toThrow();
    for (const rollup of [[], checks.slice(1), [checks[0], { ...checks[1], conclusion: 'FAILURE' }], [checks[0], { ...checks[1], status: 'IN_PROGRESS' }]]) {
      expect(() => validatePublicationChecks({ statusCheckRollup: rollup })).toThrow(/GITHUB_CI/);
    }
  });
  it('proves the prepared article remains hidden until Friday noon', () => {
    const hidden = { article: { status: 404, text: 'Not found' }, news: { status: 200, text: '' }, rss: { status: 200, text: '<rss />' } };
    expect(verify(hidden, new Date('2026-11-12T12:00:00Z')).state).toBe('PUBLICATION_SCHEDULED');
    expect(() => verify(live(), new Date('2026-11-13T10:59:59Z'))).toThrow(/EARLY_PUBLICATION/);
    expect(() => verify(hidden)).toThrow(/DIRECT_URL/);
  });
  it('rejects wrong public content, missing source and wrong dates', () => {
    for (const [from, to] of [[metadata.title, 'Other edition'], [metadata.publishedAt.toISOString(), '2026-11-12T11:00:00Z'], [source, 'https://unrelated.example/']]) {
      const pages = live(); pages.article.text = pages.article.text.replaceAll(from, to);
      expect(() => verify(pages)).toThrow(/DIRECT_CONTENT/);
    }
    const pages = live(); pages.rss.text = pages.rss.text.replace(metadata.publishedAt.toUTCString(), new Date('2026-11-12').toUTCString());
    expect(() => verify(pages)).toThrow(/RSS/);
  });
  it('detects duplicate index cards and duplicate RSS items', () => {
    const pages = live(); pages.news.text += pages.news.text;
    expect(() => verify(pages)).toThrow(/NEWS_INDEX.*received 2/);
    const feed = live(); feed.rss.text += feed.rss.text;
    expect(() => verify(feed)).toThrow(/RSS.*received 2/);
  });
  it('retries delayed deployment/cache but stops bounded after failed Vercel or missing article', async () => {
    const waits = [];
    const recovered = await verifyWithRetry(async attempt => { if (attempt < 3) throw new Error('VERCEL_DEPLOYMENT: building'); return verify(live()); }, { attempts: 3, delayMs: 0, wait: async ms => waits.push(ms) });
    expect(recovered.attempts).toBe(3); expect(waits).toHaveLength(2);
    await expect(verifyWithRetry(async () => { throw new Error('VERCEL_DEPLOYMENT: error'); }, { attempts: 2, delayMs: 0 })).rejects.toThrow(/BLOCKED after 2.*VERCEL_DEPLOYMENT/);
    await expect(verifyWithRetry(async () => verify({ ...live(), article: { status: 404, text: '' } }), { attempts: 2, delayMs: 0 })).rejects.toThrow(/BLOCKED after 2.*DIRECT_URL/);
  });
  it('never retries away evidence of an early publication incident', async () => {
    let attempts = 0;
    await expect(verifyWithRetry(async () => { attempts++; return verify(live(), new Date('2026-11-13T10:59:59Z')); }, { attempts: 3, delayMs: 0 })).rejects.toThrow(/EARLY_PUBLICATION/);
    expect(attempts).toBe(1);
  });
});
