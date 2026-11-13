import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const file = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

describe('DAJC public SEO consistency', () => {
  it('uses the canonical helper in layout and articles', () => {
    expect(file('src/layouts/BaseLayout.astro')).toContain('canonicalSiteUrl(Astro.url.pathname)');
    expect(file('src/components/ArticleDetail.astro')).toContain('canonicalSiteUrl(Astro.url.pathname)');
  });
  it('categorises regular weekly news without double-publishing Article metadata', () => {
    const content = file('src/components/ArticleDetail.astro');
    expect(content).toContain("entry.collection === 'eu-oversize' ? 'NewsArticle' : 'Article'");
    expect(content).toContain('mainEntityOfPage');
  });
  it('serializes a normalized public sitemap without private routes', () => {
    const config = file('astro.config.mjs');
    expect(config).toContain("value.pathname = value.pathname.replace(");
    expect(config).toContain("return !/^\\/(?:partners|integration-ecosystem|partner-portal|investor)");
    const robots = file('public/robots.txt');
    expect(robots).toContain('Allow: /platform/integrations');
    expect(robots).toContain('Disallow: /partner-portal/');
  });
});
