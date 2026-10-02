import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPreviousEditionSources, parseEditionFrontmatter } from '../previous-editions.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ARTICLES_DIR = path.resolve(__dirname, '..', '..', '..', 'src', 'content', 'news', 'eu-oversize');

describe('previous editions', () => {
  it('parses the generator frontmatter', () => {
    const parsed = parseEditionFrontmatter('---\ntitle: "T"\nslug: "eu-oversize-weekly-2026-w40"\npublishedAt: 2026-09-25T10:00:00.000Z\nsources:\n  - name: "A"\n    url: "https://a.example/x"\n---\n\nbody');
    expect(parsed).toEqual({ slug: 'eu-oversize-weekly-2026-w40', publishedAt: '2026-09-25T10:00:00.000Z', sourceUrls: ['https://a.example/x'] });
  });

  it('maps every cited source to its latest edition and skips the excluded slug', async () => {
    const map = await loadPreviousEditionSources({ articlesDir: ARTICLES_DIR, excludeSlugs: ['eu-oversize-weekly-2026-w41'] });
    expect(map.get('https://www.astra.admin.ch/de/newnsb/lXxVvBz-pCb1SILobeHmP')?.slug).toBe('eu-oversize-weekly-2026-w40');
    for (const entry of map.values()) expect(entry.slug).not.toBe('eu-oversize-weekly-2026-w41');
  });
});
