import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import vercel from '@astrojs/vercel';
import { readdirSync, readFileSync } from 'node:fs';

const SITE = 'https://www.dajc.eu';

// EU Oversize articles are rendered on demand (see
// src/pages/news/eu-oversize/[slug].astro), so the sitemap integration no
// longer discovers them - list the ones already public at build time here.
// An article prepared for an upcoming Friday joins the sitemap on the next
// deploy after its release.
function publicEuOversizeArticleUrls(now = new Date()) {
  const dir = new URL('./src/content/news/eu-oversize/', import.meta.url);
  return readdirSync(dir)
    .filter((file) => file.endsWith('.md'))
    .flatMap((file) => {
      const text = readFileSync(new URL(file, dir), 'utf8');
      const field = (name) => text.match(new RegExp(`^${name}:\\s*"?([^"\\n]+)"?\\s*$`, 'm'))?.[1];
      const slug = field('slug');
      const publishedAt = new Date(field('publishedAt') ?? '');
      const isPublic = field('status') === 'published' && publishedAt.getTime() <= now.getTime();
      return slug && isPublic ? [`${SITE}/news/eu-oversize/${slug}/`] : [];
    });
}

export default defineConfig({
  site: SITE,
  // Stays 'static' (the default): every existing page keeps being
  // prerendered at build time exactly as before. The adapter below only
  // enables individual routes to opt OUT of prerendering (`export const
  // prerender = false`) - used exclusively by the DAJC Partner Portal
  // (src/pages/partner-portal/**), which needs real on-demand server
  // requests so its feature gate, sessions and DB access are enforced
  // server-side per request instead of baked into a static build. See
  // docs/PARTNER_PORTAL.md.
  output: 'static',
  adapter: vercel({
    webAnalytics: {
      enabled: true,
    },
  }),
  integrations: [
    sitemap({
      // The Partner Portal is a private, ungated-by-default governance
      // surface - it must never appear in the public sitemap regardless of
      // DAJC_PARTNER_PORTAL_ENABLED. See docs/PARTNER_PORTAL.md.
      filter: (page) => !page.includes('/partner-portal'),
      // On-demand public pages are not discovered automatically.
      customPages: [`${SITE}/driving-bans`, ...publicEuOversizeArticleUrls()],
    }),
  ],
});
