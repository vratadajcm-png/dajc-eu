# Dependency advisories — assessment (2026-11-05)

Source: `npm audit` on branch `claude/blissful-cori-vo1iyy` (PR #102), before
and after this change. GitHub reported 13 (6 high, 7 moderate).

Method: only semver-compatible updates inside the existing ranges (no
`npm audit fix --force`, no major upgrades). `npm audit fix` and `npm update`
crash in npm 10.9 (`Cannot read properties of null (reading 'edgesOut')`,
arborist peer-set bug with vitest's optional browser peers), so the targeted
updates were made with npm 11 and verified with `npm ci` on npm 10 (as CI).

| Package (path) | Advisory | Before → after | Runtime | DAJC exposure | Status |
| --- | --- | --- | --- | --- | --- |
| `vite` (astro, vitest) | GHSA-9jrq-w75r-8gcw, -rq7h-c2jc-7f22, -vfpm-58rq-9qcg, launch-editor (3) | 8.2.1 → 8.3.6 | dev server only | none in production; dev server on a developer machine | **fixed** |
| `vitest`, `@vitest/mocker` | GHSA-qxg6-89mg-rqv8, GHSA-xp26-3454-mjgp | 4.1.11 → 4.1.12 | tests only | none in production | **fixed** |
| `undici` (astro → unifont) | 8 advisories (DoS, TLS option drop, redirect cache poisoning) | 8.11.2 → 8.12.4 | build time (font fetching) | low | **fixed** |
| `fast-uri` (@astrojs/check → ajv) | 4 advisories (URI parsing) | 3.1.8 → 3.1.9 | typecheck only | none in production | **fixed** |
| `@vercel/functions` → `@vercel/oidc` → `@vercel/cli-config` | via zod | 3.9.9/3.8.9/0.3.0 → 3.10.6/4.0.6/0.3.6 | server runtime (adapter) | low | **fixed** |
| `zod` nested in `astro`, `@astrojs/sitemap`, `@vercel/cli-config` | GHSA-mrhx-c7xc-m3w5 (`$ZodArray` memory exhaustion) | 4.6.5/4.4.3/4.1.11 → 4.6.7 | build + adapter | low | **fixed** |
| `zod` (direct, `^3.24.1`) | GHSA-mrhx-c7xc-m3w5 (range `<4.6.6`) | 3.25.76 (unchanged) | server runtime | **not reachable**: the vulnerable `$ZodArray.handleArrayResult` exists only in the bundled `zod/v4` core; DAJC imports the classic `zod` (v3) API only. Guarded by `src/config/__tests__/dependency-guards.test.ts`. Ask/paid routes also cap request bodies (8 KB – 4.4 MB) and array schemas carry `.max()`. | **not affected**; migrate to zod 4.6.7 in a dedicated change (22 files, legal-critical schemas) |
| `glob`, `minimatch` (via `@vercel/nft` ← `@astrojs/vercel`) | GHSA-3g3m-2fjr-6pw4, GHSA-g3hv-75wg-m249 | 13.0.6 / 10.2.6 (unchanged) | build time only (file tracing of the build output) | **not exploitable**: patterns and paths come from the repository, not from users | **accepted**; the only offered fix is downgrading `@astrojs/vercel` to 8.1.0 (major, breaks the Astro 7 build). Re-check when `@vercel/nft` moves to glob ≥ 14.0.2 |

Result: 13 → 5 reported (1 high = direct zod, not reachable; 4 moderate =
glob/minimatch chain, build only). No production-reachable advisory remains.

Verification after the update: full CI equivalent (lints, Driving Bans audit,
`astro check`, all unit tests, Postgres integration, build, client-bundle
secret scan) — see the PR description for the counts.
