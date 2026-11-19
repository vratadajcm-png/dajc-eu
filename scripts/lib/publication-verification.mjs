// Independent, read-only delivery checks. No existence check alone proves publication.
import { createHash } from 'node:crypto';
import { publicationApprovalValid } from './publication-approval.mjs';

export function articleMetadata(raw, targetWeek) {
  const front = String(raw).match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!front) throw new Error('ARTICLE: missing frontmatter');
  const field = key => {
    const value = front[1].match(new RegExp('^' + key + ':\\s*(.+)$', 'm'))?.[1]?.trim();
    return value?.startsWith('"') ? JSON.parse(value) : value;
  };
  const slug = `eu-oversize-weekly-${targetWeek.toLowerCase()}`;
  const publishedAt = new Date(field('publishedAt'));
  if (field('slug') !== slug || field('status') !== 'published' || !Number.isFinite(publishedAt.getTime())) {
    throw new Error('ARTICLE: wrong slug, status or publication date');
  }
  return { raw, slug, title: field('title'), publishedAt, sha256: createHash('sha256').update(raw).digest('hex'),
    articlePath: `src/content/news/eu-oversize/${slug}.md`,
    sources: [...front[1].matchAll(/^\s+url:\s*"([^"]+)"\s*$/gm)].map(x => x[1]) };
}

export function approvedPublicationReceipt(receipts, metadata, targetWeek) {
  const approved = receipts.filter(r => publicationApprovalValid(r, { articlePath: metadata.articlePath, targetWeek, raw: metadata.raw }));
  if (approved.length !== 1) throw new Error('EDITORIAL_APPROVAL: expected one durable Claude receipt matching exact article bytes');
  return approved[0];
}

export function approvedMergedPr(pulls, receipt) {
  const marker = `<!-- DAJC_WEEKLY_ATTEMPT:${receipt.attemptId} -->`;
  const matches = pulls.filter(p => p.state === 'MERGED' && p.mergedAt && p.mergeCommit?.oid &&
    p.body?.includes(marker) && p.body.includes('<!-- DAJC_WEEKLY_STATE:EDITORIAL_APPROVED -->'));
  if (matches.length !== 1) throw new Error('MERGE: approved attempt has no unique merged PR');
  return matches[0];
}

export function validatePublicationChecks(pull) {
  for (const name of ['application-validate', 'news-validate']) {
    const runs = (pull.statusCheckRollup || []).filter(check => check.name === name);
    if (!runs.length || runs.some(check => check.status !== 'COMPLETED' || check.conclusion !== 'SUCCESS')) {
      throw new Error(`GITHUB_CI: ${name} is missing, pending or failed on the merged article PR`);
    }
  }
}

const decode = text => String(text || '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
const pathOf = value => { try { return new URL(decode(value), 'https://www.dajc.eu').pathname.replace(/\/$/, ''); } catch { return ''; } };

export function checkPublicDelivery({ article, news, rss }, metadata, { now, publicationSlot }) {
  const wantedPath = `/news/eu-oversize/${metadata.slug}`;
  // A card has two links. Count cards/headings, not all anchors, so ordinary
  // title + Read more links do not masquerade as duplicate editions.
  const cards = [...String(news.text || '').matchAll(/<article\b[^>]*>([\s\S]*?)<\/article>/gi)]
    .filter(x => [...x[1].matchAll(/href=["']([^"']+)["']/g)].some(a => pathOf(a[1]) === wantedPath));
  const rssItems = [...String(rss.text || '').matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)]
    .filter(x => pathOf(x[1].match(/<link>([\s\S]*?)<\/link>/i)?.[1]) === wantedPath);
  const due = now >= metadata.publishedAt;
  const scheduled = now < publicationSlot;
  if (scheduled || !due) {
    if (article.status !== 404 || cards.length || rssItems.length) throw new Error('EARLY_PUBLICATION: article is visible before its approved publication time');
    if (news.status !== 200 || rss.status !== 200) throw new Error('PUBLIC_ENDPOINTS: news or RSS unavailable before release');
    return { state: 'PUBLICATION_SCHEDULED', articleUrl: wantedPath, articleCards: 0, rssItems: 0 };
  }
  if (article.status !== 200) throw new Error(`DIRECT_URL: expected HTTP 200, received ${article.status}`);
  if (news.status !== 200) throw new Error(`NEWS_INDEX: expected HTTP 200, received ${news.status}`);
  if (rss.status !== 200) throw new Error(`RSS: expected HTTP 200, received ${rss.status}`);
  if (cards.length !== 1) throw new Error(`NEWS_INDEX: expected one article card, received ${cards.length}`);
  if (rssItems.length !== 1) throw new Error(`RSS: expected one article item, received ${rssItems.length}`);
  const structured = [...String(article.text || '').matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)]
    .flatMap(x => { try { const data = JSON.parse(x[1]); return Array.isArray(data) ? data : [data]; } catch { return []; } });
  const entry = structured.find(x => x['@type'] === 'NewsArticle' && pathOf(x.url) === wantedPath);
  if (!entry || entry.headline !== metadata.title || new Date(entry.datePublished).getTime() !== metadata.publishedAt.getTime()) {
    throw new Error('DIRECT_CONTENT: structured headline, canonical URL or publication date differs from approved article');
  }
  if (metadata.sources.some(url => !decode(article.text).includes(url))) throw new Error('DIRECT_CONTENT: approved source citation missing from public article');
  if (new Date(rssItems[0][1].match(/<pubDate>(.*?)<\/pubDate>/)?.[1]).getTime() !== metadata.publishedAt.getTime()) {
    throw new Error('RSS: publication date differs from approved article');
  }
  return { state: 'PUBLISHED_VERIFIED', articleUrl: wantedPath, articleCards: cards.length, rssItems: rssItems.length };
}

export async function verifyWithRetry(check, { attempts = 8, delayMs = 20000, wait = ms => new Promise(resolve => setTimeout(resolve, ms)), onRetry = () => {} } = {}) {
  if (!Number.isInteger(attempts) || attempts < 1 || attempts > 24 || !Number.isFinite(delayMs) || delayMs < 0 || delayMs > 30000) throw new Error('Invalid bounded verification retry settings');
  let failure;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try { return { ...(await check(attempt)), attempts: attempt }; }
    catch (error) {
      failure = error;
      // Early exposure is an incident, never an eventually-consistent success.
      if (String(error.message).startsWith('EARLY_PUBLICATION:')) throw error;
      if (attempt < attempts) { onRetry({ attempt, error }); await wait(delayMs); }
    }
  }
  throw new Error(`BLOCKED after ${attempts} verification attempts: ${failure.message}`);
}
