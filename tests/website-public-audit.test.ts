import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

describe('public site audit regressions', () => {
  it('does not publish superseded testing start dates on current EU pages', () => {
    const pages = [
      'src/pages/index.astro',
      'src/pages/testing.astro',
      'src/pages/demo-guide.astro',
      'src/pages/investors.astro',
      'src/pages/press.astro',
    ];
    for (const page of pages) {
      expect(source(page), page).not.toMatch(/(?:testing|testování)[^\n]{0,90}(?:from|starts?|begins?|starting)[^\n]{0,40}4\s+(?:January|Jan)\s+2027/i);
      expect(source(page), page).not.toMatch(/4\s+(?:January|Jan)\s+2027/i);
    }
    expect(source('src/pages/demo-guide.astro')).toContain('Q3 2027');
  });

  it('allows the public Platform product pages while keeping unpublished routes excluded', () => {
    const robots = source('public/robots.txt');
    expect(robots).toContain('Disallow: /platform/');
    expect(robots).toContain('Allow: /platform/$');
    expect(robots).toContain('Allow: /platform/integrations');
    expect(robots).not.toMatch(/^Disallow:\s*\/platform\s*$/m);
    expect(source('astro.config.mjs')).toContain("const publicPlatform = pathname === '/platform' || pathname === '/platform/integrations'");
  });

  it('does not point updates visitors to a nonexistent Czech contact route', () => {
    expect(source('src/pages/updates.astro')).not.toContain('dajc.cz/kontakt');
  });
});
