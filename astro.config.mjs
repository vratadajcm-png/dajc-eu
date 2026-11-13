import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import vercel from '@astrojs/vercel';
import { readdirSync, readFileSync } from 'node:fs';

const SITE = 'https://www.dajc.eu';

// EU Oversize articles are rendered on demand (see
// src/pages/news/eu-oversize/[slug].astro), so the sitemap integration no
// longer discovers them - list the ones already public at build time here.
// An article prepared for an upcoming Friday joins the sitemap on the next
// deploy after its release. Platform articles are prerendered and found
// automatically; both get their publication/correction date as lastmod.
function publicNewsArticles(collection, now = new Date()) {
  const dir = new URL(`./src/content/news/${collection}/`, import.meta.url);
  return readdirSync(dir)
    .filter((file) => file.endsWith('.md'))
    .flatMap((file) => {
      const text = readFileSync(new URL(file, dir), 'utf8');
      const field = (name) => text.match(new RegExp(`^${name}:\\s*"?([^"\\n]+)"?\\s*$`, 'm'))?.[1];
      const slug = field('slug');
      const publishedAt = new Date(field('publishedAt') ?? '');
      const updatedAt = field('updatedAt') ? new Date(field('updatedAt')) : null;
      const isPublic = field('status') === 'published' && publishedAt.getTime() <= now.getTime();
      return slug && isPublic ? [{ url: `${SITE}/news/${collection}/${slug}`, lastmod: (updatedAt ?? publishedAt).toISOString() }] : [];
    });
}

const newsArticles = [...publicNewsArticles('eu-oversize'), ...publicNewsArticles('platform')];
const newsLastmod = new Map(newsArticles.map(({ url, lastmod }) => [url, lastmod]));

export default defineConfig({
  site: SITE,
  // Stays 'static' (the default): every existing page keeps being
  // prerendered at build time exactly as before. The adapter below only
  // enables individual routes to opt OUT of prerendering (`export const
  // prerender = false`) - used by the DAJC Partner Portal and investor
  // routes, which need real on-demand server
  // requests so private routes enforce sessions and access per request
  // server-side per request instead of baked into a static build. See
  // docs/PARTNER_PORTAL.md and docs/INVESTOR_DOCUMENTS.md.
  output: 'static',
  adapter: vercel({
    includeFiles: [
      './private/investor/pitch-deck-en.pdf.enc',
      './private/investor/pitch-deck-en.pptx.enc',
    ],
    webAnalytics: {
      enabled: true,
    },
  }),
  integrations: [
    sitemap({
      // The Partner Portal is a private, ungated-by-default governance
      // surface - it must never appear in the public sitemap regardless of
      // DAJC_PARTNER_PORTAL_ENABLED. See docs/PARTNER_PORTAL.md.
      filter: (page) => {
        const pathname = new URL(page).pathname.replace(/\/+$/, '') || '/';
        const publicPlatform = pathname === '/platform' || pathname === '/platform/integrations';
        if (/^\/platform(?:\/|$)/i.test(pathname) && !publicPlatform) return false;
        return !/^\/(?:partners|integration-ecosystem|partner-portal|investor)(?:\/|$)/i.test(pathname);
      },
      // On-demand public pages are not discovered automatically.
      customPages: [`${SITE}/driving-bans`, `${SITE}/platform`, `${SITE}/tar`, `${SITE}/integrations`, `${SITE}/platform/integrations`, `${SITE}/tar/integrations`, ...newsArticles.filter(({ url }) => url.includes('/news/eu-oversize/')).map(({ url }) => url)],
      // Sitemap addresses must agree with BaseLayout and ArticleDetail canonical URLs.
      serialize: (item) => {
        const value = new URL(item.url);
        if (value.pathname !== '/') value.pathname = value.pathname.replace(/\/+$/, '');
        const url = value.toString();
        return newsLastmod.has(url) ? { ...item, url, lastmod: newsLastmod.get(url) } : { ...item, url };
      },
    }),
  ],
});
), '');
        const url = value.toString();
        return newsLastmod.has(url) ? { ...item, url, lastmod: newsLastmod.get(url) } : { ...item, url };
      },
    }),
  ],
});
