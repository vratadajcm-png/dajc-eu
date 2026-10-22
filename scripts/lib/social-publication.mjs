// Only already-public, recently released news may be sent to a social account.
// DAJC Platform Updates additionally require explicit socialPublish: true frontmatter.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { newsEntryFromMarkdown, makeSocialDrafts } from './social-posts.mjs';

export const FIRST_ELIGIBLE_PUBLICATION = '2026-10-22T00:00:00+02:00';

export function candidateKey(article) {
  return article.category === 'eu-oversize' ? article.slug : article.category + '/' + article.slug;
}

export function collectSocialCandidates(root, now = new Date(), minimum = FIRST_ELIGIBLE_PUBLICATION) {
  const floor = new Date(minimum);
  if (!Number.isFinite(floor.getTime())) throw new Error('Invalid minimum social publication date');
  const found = [];
  for (const category of ['eu-oversize', 'platform']) {
    const directory = path.join(root, 'src', 'content', 'news', category);
    for (const filename of readdirSync(directory).filter((file) => file.endsWith('.md'))) {
      const markdown = readFileSync(path.join(directory, filename), 'utf8');
      if (category === 'platform' && !/^socialPublish:\s*true\s*$/m.test(markdown.split(/^---\s*$/m).slice(1, 2)[0] ?? '')) {
        continue; // company announcements require positive editorial approval
      }
      const article = newsEntryFromMarkdown(markdown, category, now);
      if (article && new Date(article.publishedAt).getTime() >= floor.getTime()) {
        found.push({ ...article, ...makeSocialDrafts(article) });
      }
    }
  }
  return found.sort((a, b) => a.publishedAt.localeCompare(b.publishedAt) || candidateKey(a).localeCompare(candidateKey(b)));
}

export function selectNextSocialArticle(articles, ledger) {
  if (ledger?.schemaVersion !== 1 || !ledger.posts || typeof ledger.posts !== 'object' || Array.isArray(ledger.posts)) {
    throw new Error('Invalid social publication ledger');
  }
  if (Object.values(ledger.posts).some((record) => record?.status === 'pending')) {
    throw new Error('Pending social publication requires manual reconciliation; no new posts may be attempted');
  }
  for (const article of articles) {
    const record = ledger.posts[candidateKey(article)];
    if (record !== undefined) {
      if (record?.status === 'published' || record?.status === 'submitted') continue;
      throw new Error('Unknown or unfinished social ledger record; refusing a duplicate');
    }
    return article;
  }
  return null;
}
