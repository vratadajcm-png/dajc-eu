#!/usr/bin/env node
// Convert recent, already-public DAJC News into platform-specific *drafts*.
// No API keys, network calls, social posts, commits or production changes.
import { readdirSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { newsEntryFromMarkdown, makeSocialDrafts } from './lib/social-posts.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const directory = path.join(root, 'artifacts', 'social');
const now = new Date();
const manifest = [];

for (const category of ['platform', 'eu-oversize']) {
  const folder = path.join(root, 'src', 'content', 'news', category);
  for (const file of readdirSync(folder).filter((filename) => filename.endsWith('.md'))) {
    const raw = readFileSync(path.join(folder, file), 'utf8');
    const article = newsEntryFromMarkdown(raw, category, now);
    if (!article) continue;
    const { x, linkedin } = makeSocialDrafts(article);
    mkdirSync(directory, { recursive: true });
    const basename = `${category}--${article.slug}`;
    writeFileSync(path.join(directory, `${basename}--x.txt`), x + '\n');
    writeFileSync(path.join(directory, `${basename}--linkedin.txt`), linkedin + '\n');
    manifest.push({ slug: article.slug, category, url: article.url, publishedAt: article.publishedAt, status: 'draft-only', xFile: `${basename}--x.txt`, linkedinFile: `${basename}--linkedin.txt` });
  }
}

mkdirSync(directory, { recursive: true });
writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify({ generatedAt: now.toISOString(), count: manifest.length, items: manifest }, null, 2) + '\n');
console.log(`Prepared ${manifest.length} public-news article(s) as X and LinkedIn drafts. Nothing posted.`);
