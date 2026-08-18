import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://www.dajc.eu',
  output: 'static',
  integrations: [sitemap()],
});
