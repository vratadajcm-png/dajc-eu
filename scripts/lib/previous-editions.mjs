// Sources already cited by earlier EU Oversize articles. The Weekly does not
// repeat unchanged information (docs/DAJC_WEEKLY_INTELLIGENCE_SPEC.md §7), so
// every candidate is checked against this map before it can be published.

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const NON_EDITION_FILES = new Set(['example-template.md']);

/** Minimal frontmatter reader for the generator's own YAML output. */
export function parseEditionFrontmatter(markdown) {
  const match = String(markdown || '').match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return null;
  const yaml = match[1];
  const unquote = (value) => {
    const trimmed = String(value || '').trim();
    if (/^".*"$/.test(trimmed)) {
      try {
        return JSON.parse(trimmed);
      } catch {
        return trimmed.slice(1, -1);
      }
    }
    return trimmed.replace(/^'(.*)'$/, '$1');
  };
  const slug = unquote(yaml.match(/^slug:\s*(.+)$/m)?.[1] || '');
  const publishedAt = unquote(yaml.match(/^publishedAt:\s*(.+)$/m)?.[1] || '');
  const sourceUrls = [...yaml.matchAll(/^\s+url:\s*(.+)$/gm)].map((m) => unquote(m[1])).filter(Boolean);
  return { slug, publishedAt, sourceUrls };
}

/**
 * @param {{ articlesDir: string, excludeSlugs?: string[] }} options
 * @returns {Promise<Map<string, { slug: string, publishedAt: string }>>} sourceUrl -> latest citing edition
 */
export async function loadPreviousEditionSources({ articlesDir, excludeSlugs = [] }) {
  const excluded = new Set(excludeSlugs);
  const bySourceUrl = new Map();
  let files = [];
  try {
    files = await readdir(articlesDir);
  } catch (err) {
    if (err.code === 'ENOENT') return bySourceUrl;
    throw err;
  }
  for (const file of files) {
    if (!file.endsWith('.md') || file.startsWith('_') || NON_EDITION_FILES.has(file)) continue;
    const edition = parseEditionFrontmatter(await readFile(path.join(articlesDir, file), 'utf-8'));
    if (!edition) continue;
    const slug = edition.slug || file.replace(/\.md$/, '');
    if (excluded.has(slug)) continue;
    for (const url of edition.sourceUrls) {
      const known = bySourceUrl.get(url);
      if (!known || String(edition.publishedAt) > String(known.publishedAt)) {
        bySourceUrl.set(url, { slug, publishedAt: String(edition.publishedAt) });
      }
    }
  }
  return bySourceUrl;
}
