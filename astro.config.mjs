import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import vercel from '@astrojs/vercel';

export default defineConfig({
  site: 'https://www.dajc.eu',
  // Stays 'static' (the default): every existing page keeps being
  // prerendered at build time exactly as before. The adapter below only
  // enables individual routes to opt OUT of prerendering (`export const
  // prerender = false`) - used exclusively by the DAJC Partner Portal
  // (src/pages/partner-portal/**), which needs real on-demand server
  // requests so its feature gate, sessions and DB access are enforced
  // server-side per request instead of baked into a static build. See
  // docs/PARTNER_PORTAL.md.
  output: 'static',
  adapter: vercel(),
  integrations: [
    sitemap({
      // The Partner Portal is a private, ungated-by-default governance
      // surface - it must never appear in the public sitemap regardless of
      // DAJC_PARTNER_PORTAL_ENABLED. See docs/PARTNER_PORTAL.md.
      filter: (page) => !page.includes('/partner-portal'),
    }),
  ],
});
