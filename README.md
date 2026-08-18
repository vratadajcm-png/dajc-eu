# dajc.eu

Landing page + News system for **DAJC** — a pan-European coordination platform for heavy and oversized freight transport. Served at [dajc.eu](https://dajc.eu) (hosted on Vercel).

Built with [Astro](https://astro.build) as a static site (no server runtime). The homepage hero is a conservative migration of the original single-file "coming soon" page - same copy, colors, typography and layout, now split into reusable components.

## Local development

```bash
npm install
npm run dev       # http://localhost:4321
npm run build     # outputs static site to dist/
npm run preview   # serve the production build locally
```

## News system

See [`docs/NEWS_AUTOMATION.md`](docs/NEWS_AUTOMATION.md) for the full architecture: content model, the daily EU Oversize monitor, the Friday publication pipeline, and how to author a DAJC Platform Update.
