# SEO verification and measurable growth — DAJC.eu / DAJC.cz

**Status:** technical metadata improvements proposed in a draft PR; no claim of updated Google index or traffic. Main site remains DAJC.eu, with independent Czech landing DAJC.cz.

## Already present — do not duplicate
- Homepage WebSite/Organization schema; news pages already include Article JSON-LD.
- Existing Google Search Console verification support (`PUBLIC_GOOGLE_SITE_VERIFICATION`).
- Generated Astro sitemap and RSS, Vercel Web Analytics and first-party aggregated traffic measurement.
- Product landing and technical integrations pages for both Platform and TAR.

## P2 changes in this PR
- Standard canonical URL spelling without trailing slash for non-root pages, used in both HTML canonical/Open Graph and article JSON-LD.
- Sitemap serialization produces the same canonical URL spelling and retains article publication/modification metadata.
- EU Oversize Weekly pages use `NewsArticle`; development updates remain `Article`. Both have `mainEntityOfPage` matching the canonical URL.
- Regression tests for robots, Article types and shared canonical rules.

## Do not silently change
- Existing private `/partner-portal`, `/investor`, hidden provider paths and private document URLs must remain outside sitemap and behind actual access controls. `robots.txt` is not a security boundary.
- No unverified translation routes. Use `hreflang` only on genuinely corresponding pages and verify reciprocal annotations; the Czech site's content is not a full translation of every .eu page.
- No domain-wide redirect of dajc.cz to dajc.eu and no German localization until audience and search data support it.
- No unfounded claims about Core Web Vitals, rankings or link authority.

## Preview checklist
1. Compare `/platform`, `/platform/`, `/platform/integrations`, `/news`, a weekly article with and without slash. Check 200/3xx, canonical, Open Graph and sitemap agreement.
2. Open `/sitemap-index.xml`, sitemap child, `/robots.txt`; confirm robots does not block any included public URL and no gated URL appears.
3. Validate page-level JSON-LD (Google Rich Results test where applicable); inspect `NewsArticle`, publication date, publisher and mainEntityOfPage.
4. Run Lighthouse/PageSpeed on mobile and desktop with actual field data for LCP, CLS and INP, record date/device/network and separate lab and field measurements.
5. In Search Console, verify both domains and sitemap indexing, top queries, pages and countries. Collect a baseline and 28-day comparison. Use native Search Console if an external premium connector is unavailable.
6. Record actual conversions by product from consented research submissions and anonymized page views; no customer names or free-text answers in public dashboards.
7. Confirm weekly source editorial process and corrected publication timestamps; link newsletter distribution only after the separately gated double opt-in and delivery system are verified.
8. Owner approves merge and production deployment separately after CI and preview evidence.

## Baseline data
No verified Search Console baseline was available from the connected GSC Wizard during the 13 November audit: its connector rejected reads because its subscription/trial was inactive. Do not invent clicks, CTR, impressions or rankings. Google Search Console can be checked directly outside this connector at no need to purchase a third-party plan.
