// Deterministic, credential-free social drafts from already-public DAJC News.
// This file prepares copy only. Publishing requires separately authorised channel integrations.
import { frontmatterFields, SITE_ORIGIN } from './x-publishing.mjs';

const safeSlug = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DAY = 86_400_000;
const MAX_X_CODEPOINTS = 260;

const shorten = (value, maximum) => {
  const chars = Array.from(String(value ?? '').trim());
  return chars.length <= maximum ? chars.join('') : chars.slice(0, Math.max(0, maximum - 1)).join('').trimEnd() + '…';
};

export function newsEntryFromMarkdown(markdown, category, now = new Date(), maxAgeDays = 8) {
  if (!['platform', 'eu-oversize'].includes(category)) throw new Error('Unsupported news category');
  const fields = frontmatterFields(markdown);
  if (fields.category !== category || fields.status !== 'published' || !safeSlug.test(fields.slug || '') || !fields.title || !fields.description) return null;
  const publishedAt = new Date(fields.publishedAt);
  const age = now.getTime() - publishedAt.getTime();
  if (!Number.isFinite(age) || age < 0 || age > maxAgeDays * DAY) return null;
  return {
    slug: fields.slug,
    category,
    title: fields.title,
    description: fields.description,
    publishedAt: publishedAt.toISOString(),
    url: `${SITE_ORIGIN}/news/${category}/${fields.slug}`,
    sections: markdown.split(/\r?\n/).filter((line) => line.startsWith('## ')).map((line) => line.slice(3).trim()).filter(Boolean).slice(0, 3),
  };
}

export function makeSocialDrafts(article) {
  const prefix = '🚛 ';
  const suffix = `\n\n${article.url}`;
  const room = MAX_X_CODEPOINTS - Array.from(prefix + suffix).length;
  if (room < 45) throw new Error('Article URL too long for safe X preview');
  const headline = shorten(article.title, Math.min(100, room - 25));
  const description = shorten(article.description, Math.max(0, room - Array.from(headline).length - 3));
  const x = `${prefix}${headline}\n\n${description}${suffix}`;
  if (Array.from(x).length > MAX_X_CODEPOINTS) throw new Error('X draft exceeded safe length');
  const sectionSummaries = article.sections.length
    ? '\n\nIn this article:\n' + article.sections.map((section) => `• ${section}`).join('\n')
    : '';
  const linkedin = `${article.title}\n\n${article.description}${sectionSummaries}\n\nRead the full article: ${article.url}\n\n#DAJC #HeavyHaulage #OversizeTransport`;
  return { x, linkedin };
}
