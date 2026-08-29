# News automation

How the `/news` system on dajc.eu works: the content model, the daily EU
Oversize monitor, the Friday publication pipeline, and how to author a
DAJC Platform Update. The site itself is a static Astro build (see the
root `README.md`); this document covers the News-specific pieces added on
top of it.

## Architecture overview

```
config/oversize-sources/index.mjs   registry of European official sources (RSS/HTML)
config/driving-ban-calendars/       maintained official driving-ban/exceptional-
  index.mjs                        transport calendar layer (not RSS-dependent)
data/oversize/<ISO week>/           raw findings gathered during that week
  findings.json
scripts/
  oversize-monitor.mjs              daily: fetch sources -> data/oversize
  generate-weekly-article.mjs       friday: data/oversize + calendars -> content/news
  publish-gate-commit.mjs           friday: explicit "did we publish?" commit gate
  lib/
    findings.mjs                    finding shape, dedup key, status transitions
    fetch-source.mjs                RSS + official-HTML fetch, relevance + classification
    relevance-filter.mjs            shared "is this an operational restriction" gate
    select-candidates.mjs           pre-selection before verification/AI (cost control)
    driving-ban-calendar.mjs        resolves config/driving-ban-calendars for a target week
    verify-candidates.mjs           relevance + target-week dates + source reachability
    date-validation.mjs             deterministic validFrom/validTo vs. target-week checks
    openai-client.mjs               structured-output OpenAI call, hardened prompt
    mock-generator.mjs              free local stand-in for openai-client.mjs
    cross-validate.mjs              drops any development whose sourceUrl wasn't verified
    render-article.mjs              validated JSON -> frontmatter + Markdown
    quality-gate.mjs                pre-publish blocking checks (count, dedup, dates, ...)
    article-schema.mjs              zod schema mirroring src/content.config.ts
    publish-gate.mjs                publish-vs-data-only commit decision + week extraction
    store.mjs / week.mjs            file I/O and ISO-week helpers
src/content/news/eu-oversize/       published (and draft template) articles
src/content/news/platform/          published (and draft template) articles
src/content.config.ts               Astro content collection schema
.github/workflows/
  daily-oversize-monitor.yml
  publish-weekly-oversize.yml       Friday noon + Saturday catch-up, idempotent
```

The homepage renders `News` before `Integration ecosystem`, so current
operational intelligence is visible before the provider directory. The
system reuses the global DAJC styles and does not alter the hero or header.

## Editorial specification

EU Oversize Weekly is a **professional operational briefing** for European
heavy, oversized and special road transport operators, drivers and
dispatchers - not a general traffic-news feed, and it must never summarize
every item a source happens to publish. All content is written in
professional English.

- **10-12 lead reports plus a Rest-of-Europe roundup**, enforced by
  `scripts/lib/quality-gate.mjs`. The lead reports are the most consequential
  items by operational impact. Every other verified, useful item belongs in
  the Europe-wide roundup. A title or source may appear only once across the
  complete edition. If fewer than 10 verified lead-quality reports are
  available, the run does not publish; it never pads the edition with filler.
- **Editorial priority order** (most important first, see the system prompt
  in `scripts/lib/openai-client.mjs`): truck driving bans; special movement
  windows/bans for exceptional or oversized transport; permit-rule/system
  changes; escort/BF2-BF4/police-assistance requirements; border/transit
  restrictions; mandatory crossings/approved corridors; bridge/tunnel/
  height/width/axle-load/weight restrictions; long-term closures on
  strategic routes; weather only when it creates a specific operational
  restriction; significant equipment/regulatory/market changes as secondary
  items.
- **Whole-of-Europe scope without a fixed country list.** Countries are
  selected from verified evidence and may change every week. There are no
  quotas, preferred states, or habitual corridors. Romania, Lithuania,
  Turkey, Spain, the United Kingdom, Denmark and every other covered European
  market compete on the same operational-significance criteria. A specific
  route is named only when an official restriction actually affects it.
- **Every report states**: country; region/road/route where applicable;
  what applies or changed; affected vehicle category and weight/vehicle
  threshold (`vehicleScope`); exact date and **local time of the country
  concerned** (`timeWindow`); geographic/route scope (`where`); practical
  impact; a concrete `recommendedAction` for an operator/dispatcher (never a
  platitude); and important exemptions/permit-specific conditions
  (`exemptions`), if any.
- A general truck-driving ban, a restriction above a specific weight, a
  special restriction for exceptional/oversized transport, and a condition
  in an individual transport permit are always kept distinct - never
  conflated into one description.
- **Recurring weekend/seasonal driving bans** remain relevant even when no
  news source re-published them this week, but only when they are known to
  be valid for the target week's exact dates - see "Official driving-ban
  calendar layer" below, which exists specifically because RSS monitoring
  alone cannot guarantee this.

## Content model

Every article is a Markdown file with YAML frontmatter, validated by
`src/content.config.ts` (Astro Content Collections) at build time:

```yaml
title: string
description: string
slug: string
category: "eu-oversize" | "platform"
publishedAt: date
updatedAt: date            # optional
language: string            # default "en"
author: string               # default "DAJC"
status: "draft" | "published"
sources:                     # optional for platform, required for eu-oversize in practice
  - name: string
    url: string
tags: [string]                # optional
coverImage: string             # optional
```

Only `status: published` articles are shown on the site (`getCollection(...,
({data}) => data.status === 'published')` in every page that lists
articles). `draft` articles build fine but are invisible - that's how the
`example-template.md` files in each category work: copy one, fill it in,
flip `status` to `published`.

Files live under `src/content/news/eu-oversize/*.md` and
`src/content/news/platform/*.md`. The URL is derived from the frontmatter
`slug` field (not the filename), at `/news/eu-oversize/<slug>` or
`/news/platform/<slug>`.

## EU Oversize findings

A "finding" is one structured, sourced fact about a permit/ban/escort/
border/infrastructure/market change - the raw material the Friday article
is synthesized from. Stored per ISO week at
`data/oversize/<YYYY-Www>/findings.json`:

```json
{
  "week": "2026-W34",
  "updatedAt": "2026-08-18T10:09:05.000Z",
  "findings": [
    {
      "id": "a1b2c3d4e5f6a7b8",
      "country": "Germany",
      "region": null,
      "location": "A3",
      "type": "bridge_restriction",
      "title": "...",
      "summary": "...",
      "validFrom": null,
      "validTo": null,
      "impact": null,
      "recommendedAction": null,
      "sourceName": "...",
      "sourceUrl": "...",
      "confidence": "unverified",
      "status": "new",
      "firstSeenAt": "2026-08-17T06:00:11.000Z",
      "lastCheckedAt": "2026-08-18T06:00:07.000Z"
    }
  ]
}
```

Supported `type` values (`scripts/lib/findings.mjs`): `permit_change`,
`permit_system`, `driving_ban`, `escort_requirement`, `police_escort`,
`border_restriction`, `bridge_restriction`, `tunnel_restriction`,
`route_restriction`, `road_closure`, `roadworks`, `infrastructure`,
`operational_change`, `equipment`, `market`.

### Deduplication and status

Each finding's `id` is a stable hash of `country + region + location +
type + source` (`findingKey()` in `scripts/lib/findings.mjs`) - the same
underlying real-world change always maps to the same `id` across daily
runs, regardless of small wording changes in the title/summary. Every
daily run merges newly-fetched candidates into the existing week's map by
this key:

- not seen before -> `new`
- seen before, title/summary/validTo/impact changed -> `updated`
- seen before, unchanged -> `active`
- `validTo` date has passed -> `expired`

A finding never becomes multiple records just because it was re-scraped
on Monday, Wednesday and Friday - it's one record whose `status` and
`lastCheckedAt` evolve. `superseded` is reserved for a human/AI-identified
case where one finding fully replaces another (not yet automated - see
Troubleshooting).

### Relevance filtering

`scripts/lib/fetch-source.mjs` applies a relevance gate before anything
becomes a finding at all: an item must either match one of the specific
transport-restriction patterns (driving ban, escort, border, bridge/
tunnel, closure, roadworks, permit, route) or, if it only reaches the
generic "infrastructure" fallback, additionally mention clear heavy/
oversize-transport context (HGV, truck, freight, weight/height/axle
limit, toll, motorway...). This was tuned against real data during
development - several police feeds (`de-polizei-blaulicht`, `pl-policja`,
`uk-npcc`, `xk-kosovopolice`) turned out to publish almost entirely
unrelated content; don't be surprised if they contribute 0 findings on
most days.

The actual exclusion logic lives in `scripts/lib/relevance-filter.mjs`
(`checkOperationalRelevance`), shared between two independent call sites:

1. **Ingestion** (`fetch-source.mjs`, daily monitor) - the cheapest, first
   gate: a stuck-lorry incident or a procurement notice should never even
   enter `data/oversize/<week>/findings.json`.
2. **Weekly verification** (`verify-candidates.mjs`, Friday pipeline) - runs
   the same check again, independently, before a candidate can reach the
   OpenAI call. This exists because a candidate may already be sitting in
   `data/oversize` from before this filter existed (or under a looser
   version of it) - see "Incident: the first published W35 article" below.

Blocked as generic crime/administrative noise: weapons, arrests, court
proceedings, and similar. Blocked as "individually true but not an ongoing
restriction": one-off vehicle breakdowns/stuck vehicles, one-off accidents/
collisions, theft reports, procurement/tender notices, and unconfirmed
planned/future works (see `NON_RESTRICTION_PATTERNS` in
`relevance-filter.mjs` for the exact patterns and reasons).

## Source configuration

`config/oversize-sources/index.mjs` exports `oversizeSources`, an array of:

```js
{
  id: 'no-vegvesen',
  country: 'NO',                    // ISO 3166-1 alpha-2
  authority: 'Statens vegvesen',
  name: 'Statens vegvesen - Nyheter',
  url: 'https://www.vegvesen.no',
  feedUrl: 'https://www.vegvesen.no/rss',  // optional, set only when confirmed working
  htmlUrls: ['https://.../traffic'],        // optional preferred official HTML listings
  type: 'national-road-authority',   // see SourceType in the file for the full list
  priority: 1,                        // 1 = high, 3 = supplementary
}
```

This is a **curated pan-European discovery set** (currently 43 configured
official sources). RSS/Atom remains preferred when a verified `feedUrl`
exists, but RSS is no longer required. If a feed yields nothing useful or
is unavailable, `scripts/lib/fetch-source.mjs` fetches the authority's
official HTML page, extracts operationally relevant same-domain links, and
continues through the same relevance/classification pipeline. Optional
`htmlUrls` can point at a better official traffic/news listing than the
homepage (for example Autobahn GmbH's `Verkehrsmeldungen`). External-domain
links are rejected by the HTML adapter, so this fallback does not silently
turn into an unofficial aggregation layer.

### How to add a new source

1. Add the authority's official `url` to `config/oversize-sources/index.mjs`.
2. If a verified RSS/Atom feed exists, add `feedUrl`; if a dedicated official
   traffic/news listing is better than the homepage, add it to `htmlUrls`.
3. Run `npm run oversize:monitor` and confirm the source reports `via feed`
   or `via html` rather than `UNAVAILABLE`, with a sensible item count.
4. If the source is noisy, tighten the source URL and/or the shared relevance
   rules. Do not solve coverage gaps by adding unofficial aggregators when an
   official source exists.

**No Slovak (SK) source is configured yet.** A related prior audit found
the obvious candidate (NDS / `ndsas.sk`) unreliable - its feed's `pubDate`
tracks the CMS's `dateModified`, not the true publish date, so years-old
press releases can appear "fresh". Don't add it back without
independently re-checking that specific problem first.

## Official driving-ban calendar layer

Feed/HTML news monitoring alone cannot reliably surface a standing or seasonal driving
ban that no source happened to re-announce this particular week - the ban
is still fully in force, but invisible to `fetch-source.mjs`. This is a
distinct data source from `config/oversize-sources` (RSS/Atom feeds):
`config/driving-ban-calendars/index.mjs` is a small, curated registry of the
official rules themselves, resolved by `scripts/lib/driving-ban-calendar.mjs`
directly against the target week's date range - no news item required.

Each entry records: `country`; official `sourceUrl`/`sourceName`;
`legalBasis`; `vehicleScope` (vehicle/weight threshold); `routeScope`;
`exemptionNotes`; `lastVerified` date; and one of two `kind`s:

- **`standing-rule`** - a fixed legal rule (e.g. "every Saturday/Sunday from
  1 July to 31 August", or a year-round nightly ban) that needs no per-year
  maintenance. `resolve(weekStart, weekEnd)` computes that week's actual
  dates fresh every time.
- **`annual-calendar`** - an official body republishes a dated calendar
  every year (Germany's BALM summer-Saturday list, Poland's summer calendar,
  Italy's Ministerial Decree, Slovenia's tourist-season Saturday dates, and
  Austria's summer corridor order). `validYear` records which year's dates are seeded.
  **Resolving for any other year returns a `maintenanceError` instead of
  silently reusing a previous year's dates** - `generate-weekly-article.mjs`
  treats this as a hard configuration failure (non-zero exit), the same as
  a missing `OPENAI_API_KEY`. When a new year's official calendar is
  published (e.g. Italy's 2027 decree), add its dates to the relevant entry
  and bump `validYear` - see `scripts/lib/__tests__/driving-ban-calendar.test.mjs`
  for the expected behavior both before and after that update.

Coverage is intentionally split by legally distinct regimes rather than by
country count. For W35 2026 the resolver returns 14 verified calendar
findings. For W36 (31 August-6 September) it returns 11 before any news
monitor findings are considered, including: Czech general and Section 43(2)
special-vehicle restrictions; Slovakia's Section 39 Sunday window effective
from 1 September 2026; Italy's 6 September Decree 325/2025 ban; France's
general-HGV and separate exceptional-transport regimes; Slovenia's standing
Sunday rule and final 2026 tourist-season Saturday restriction; plus the
applicable German, Austrian and Swiss rules. This avoids making publication
quality depend on whether a standing ban happened to be re-announced in a
news feed that week.

`generate-weekly-article.mjs` merges `resolveDrivingBanFindings()`'s output
with the week's monitor-derived RSS/official-HTML findings before selection; calendar findings are
always included (never subject to `select-candidates.mjs`'s per-source cap)
and are still re-verified like any other candidate (relevance, target-week
dates, source reachability) before reaching the model.

## Daily monitoring

`scripts/oversize-monitor.mjs` (`npm run oversize:monitor`):

1. Computes the current ISO week (e.g. `2026-W34`).
2. Loads `data/oversize/2026-W34/findings.json` if it exists.
3. For every configured source, prefers a verified RSS/Atom endpoint and
   falls back to the authority's official HTML page/listing. Relevant HTML
   links are constrained to the same official host and enriched from their
   detail pages; a bounded worker pool scans up to six authorities in
   parallel. Unreachable sources are logged as `UNAVAILABLE`, never hidden
   behind a false successful check.
4. Classifies and relevance-filters each feed item or official-HTML detail
   into a candidate finding.
5. Merges candidates into the existing findings by dedup key
   (`mergeFindings`), then marks anything whose `validTo` has passed as
   `expired` (`markExpired`).
6. Writes the result back to `data/oversize/2026-W34/findings.json`.

Runs daily via `.github/workflows/daily-oversize-monitor.yml` (06:00 UTC)
and commits the data file only if it actually changed. Never touches
`content/news`.

### Run it manually

```bash
npm run oversize:monitor
```

Or trigger the GitHub Action from the Actions tab (`workflow_dispatch`) /
`gh workflow run daily-oversize-monitor.yml`.

## Vercel: skipping data-only deployments

The daily monitor commits straight to `main`, which Vercel's Git
integration watches for every project - by default, that commit would
trigger a full production build+deploy even though it only ever touches
`data/oversize/**`, a directory no page reads from at build time.

`scripts/vercel-ignore-build.sh` is written for exactly this: Vercel's
"Ignored Build Step" project setting runs a shell command before every
build and skips the deploy if that command exits `0` (any other exit code
lets the build proceed - this is Vercel's own convention, not something
this script invented). The script diffs the triggering commit against its
parent and exits `0` (skip) only when every changed path is under
`data/oversize/` - any other change (a real code/content push, e.g. from
the Friday publish workflow or a manual edit) proceeds with a normal
build and deploy.

**One-time setup (Vercel dashboard, not part of this repo's config):**
Project -> Settings -> Build & Development Settings -> Ignored Build Step
-> Command, set it to:

```
bash scripts/vercel-ignore-build.sh
```

Safe-by-default: if the script can't determine the diff for any reason
(e.g. an unexpectedly shallow clone), it exits non-zero and lets the
build proceed - a wasted build costs a little CI time, a wrongly-skipped
production deploy would silently leave the live site stale, which is far
worse. This is the only Vercel-side configuration this project needs;
everything else (build command, output directory, framework preset) uses
Vercel's standard Astro defaults.

## Weekly synthesis (Friday pipeline)

The primary publication target is **Friday at 12:00 Europe/Prague**. GitHub
Actions still needs two UTC cron expressions for CET/CEST, but the workflow
no longer checks the runner's current hour. Instead it selects the correct
Friday cron from the **Prague UTC offset and the cron identity**. Therefore
a GitHub delay that starts the runner at 23:00 still executes the intended
Friday publication instead of silently becoming a green no-op.

A separate **Saturday 06:00 UTC catch-up** trigger runs the same pipeline.
Before dependency installation or any OpenAI work,
`scripts/check-weekly-publication.mjs` checks the week-specific target
article. If Friday already published it, the catch-up/duplicate run exits as
an explicitly reported idempotent no-op; if the article is missing, it
retries the real publication flow. `workflow_dispatch` remains available
for manual dry-runs or emergency publication.

A successful scheduled run pushes the new article commit straight to
`main`, which the existing Vercel Git integration deploys automatically -
no separate deployment step exists or is needed in this repository (see
"Vercel: skipping data-only deployments" above for why a *data-only*
commit is prevented from triggering a wasted rebuild; a real article
commit always proceeds to a normal build+deploy).

`scripts/generate-weekly-article.mjs` (`npm run oversize:publish`):

1. Reads the **current** ISO week's monitor-derived findings (RSS and
   official HTML, gathered all week), and resolves the **official driving-ban calendar layer** for the
   **upcoming** week (`resolveDrivingBanFindings()` - see above). A missing
   annual calendar for the required year is a hard failure here, before any
   OpenAI cost is spent.
2. `selectCandidates()` narrows the monitor findings to a bounded, scored
   subset (freshness + specific-type bonus, capped per source) - the
   cost-control step: don't verify or pay to synthesize everything.
   Calendar findings bypass this cap and are always included.
3. `verifyCandidates()` runs three independent checks per candidate:
   operational relevance (`checkOperationalRelevance`, rejects one-off
   incidents/procurement notices/unconfirmed works even if the daily
   ingestion filter already let it through), target-week date overlap
   (`validateDevelopmentDateRange` - rejects anything whose already-known
   `validFrom`/`validTo` cannot overlap the target week), and source
   reachability (HEAD, falling back to GET). Every rejection is logged with
   its specific reason.
4. Calls OpenAI (`scripts/lib/openai-client.mjs`, structured JSON output,
   hardened system prompt - see "Hardened editorial prompt" below) to
   select, group and phrase the verified candidates into an article for the
   **upcoming** ISO week. The model is given the target week's exact ISO
   start/end dates (not just a human-readable label) and is instructed to
   copy `sourceUrl`/`sourceName` exactly from the input and never invent
   one.
5. **Cross-validates** every `sourceUrl` the model returned against the
   actual verified set (`scripts/lib/cross-validate.mjs`) - anything that
   doesn't match exactly is dropped before it can reach the article
   (defends against model drift/hallucination).
6. Renders the surviving developments into frontmatter + Markdown
   (`scripts/lib/render-article.mjs`) under **mutually exclusive**
   categories - `## Driving bans and exceptional-transport restrictions` /
   `## Infrastructure restrictions` / `## Other operational developments` -
   followed by `## Operator checklist`, `## Sources`, and
   `## Next EU Oversize Weekly`. Each development is rendered **exactly
   once**, in exactly one category (see "Duplicate rendering" below).
7. Runs the quality gate (below). Only on success is the file written to
   `src/content/news/eu-oversize/<slug>.md` - and only if that exact path
   doesn't already exist (see "Never overwrites published content" below).
8. Runs `npm run build` to confirm the whole site still builds with the
   new article. If it fails, the just-written file is deleted and the
   script exits non-zero - the repository is left exactly as it was found.

The article's title/date range targets the week *after* the one whose
data was read (e.g. an article generated Friday in ISO week 2026-W34
covers 2026-W35), matching a Friday briefing about the week ahead.

### Duplicate rendering (fixed)

The first published W35 article rendered every development under
`## Main developments` **and again** under `## Driving bans next week` or
`## Infrastructure watch`, because the old renderer treated
`isDrivingBan`/`isInfrastructure` as additive overlays instead of a single
category. `categorizeDevelopment()` in `render-article.mjs` now assigns
each development to exactly one of `bans` / `infrastructure` / `other`, in
that priority order, and each category is rendered as its own section at
most once. `scripts/lib/__tests__/render-article.test.mjs` asserts a
development's title+sourceUrl pair can never appear as a rendered report
twice, even when both flags are true.

### Hardened editorial prompt

`scripts/lib/openai-client.mjs`'s system prompt now states, as hard rules
the model must follow: only the exact target-week date range matters
(exclude anything ending before it starts or starting after it ends); never
turn an isolated accident, a stuck/broken-down vehicle, a theft report, or a
routine police incident into an "ongoing restriction"; a procurement/tender
notice is never a traffic restriction; planned/future works are not a
restriction without a confirmed traffic impact and specific dates; never
invent a bridge capacity, closure, diversion, width/height/weight limit, or
validity date not present in the supplied candidate text; return an empty
`developments` array rather than padding to a target count; a recurring
ban may be included only when the candidate data shows it is already valid
for the target week's exact dates; and every development must include a
concrete `recommendedAction`. The JSON schema also carries `vehicleScope`,
`timeWindow` and `exemptions` per development, and `operatorChecklist`
(array of strings) instead of a single closing paragraph.

None of this is trusted blindly - `verify-candidates.mjs` and
`quality-gate.mjs` re-check dates, relevance and structure independently in
plain code (see "Deterministic date validation" below), specifically
because a prompt-following failure must not be able to reintroduce the
class of error this fixes.

### Quality gate

Implemented in `scripts/lib/quality-gate.mjs`, called from
`generate-weekly-article.mjs` before anything is written to disk. Blocks
publication if:

- `title`, `description`, `publishedAt`, or a valid `category` is missing
  (enforced via the same zod schema shape as `src/content.config.ts`,
  duplicated in `scripts/lib/article-schema.mjs` so it can run outside
  Astro's build - keep the two in sync if the schema changes),
- `sources` is empty, or cites a URL no report in the body actually uses,
- any development item is missing a `sourceUrl`, an invalid-format
  `sourceUrl`, a `sourceName`, a `title`, or a meaningful
  `recommendedAction` (non-empty, not a placeholder like "n/a"),
- the article body is empty or under ~400 characters (suspiciously short),
- **fewer than 8 or more than 12 developments** survived cross-validation -
  the required 8-12 distinct operational reports (see "Editorial
  specification" above),
- **no development is a driving ban / exceptional-transport restriction** -
  at least one is required every week,
- **any development's `validFrom`/`validTo` doesn't overlap the target
  week** (`validateDevelopmentDateRange`, `scripts/lib/date-validation.mjs`)
  - an invalid ISO date, a reversed range, a `validTo` before the week
  starts, or a `validFrom` after the week ends, all block publication. This
  is deliberately independent of what the model was instructed to do.
- **a duplicate `sourceUrl` or duplicate (normalized) title** across
  developments - the same restriction must never be rendered as two
  reports. Two genuinely distinct restrictions that happen to share a
  country and weekend (e.g. Austria's general ban and its additional
  summer corridor restrictions) are *not* flagged as duplicates - only an
  exact source or title repeat is.

If the gate fails, or the subsequent `astro build` fails, **no file is
written or left behind** and the script exits with a non-zero code - the
previously published site is completely unaffected.

### Safety: never publish a low-quality article just because cron ran

Two distinct outcomes, deliberately different exit codes:

- **Genuinely nothing to check yet** - no RSS findings on file *and* no
  official driving-ban calendar applies to the target week, or nothing
  survives pre-selection - exits **0** (success, no article; the Actions
  run is green). This is normal, not an error: with the calendar layer
  seeded (see above), this case is now rare in practice, since a standing
  rule like Austria's or Switzerland's applies most weeks regardless of
  RSS activity.
- **Something was checked, but the result doesn't clear the editorial bar**
  - nothing survives verification or cross-validation, or the quality gate
  rejects the result (including having fewer than 8 or more than 12
  reports) - exits **1**, so it shows up as a **clearly failed** GitHub
  Actions run. This is a deliberate policy: once the pipeline has gone far
  enough to attempt a real article, coming up short is worth a human
  looking at the log, not a silently green "nothing happened" run.

Either way, the specific reason is always logged and written to
`$GITHUB_STEP_SUMMARY`, and **no partial or broken file is ever left
behind** under any of these outcomes.

### Never overwrites or deletes published content

This is a hard invariant, true under every failure mode, not just the
common ones:

- The script only ever targets one path:
  `src/content/news/eu-oversize/eu-oversize-weekly-<next ISO week>.md`.
  It never opens, modifies, or deletes any other file.
- Before doing any work, it checks whether that exact path already
  exists. If it does - meaning this week's article was already published,
  whether by a previous run or a manual commit - it aborts immediately
  (exit 0, logged clearly) without touching it. It never overwrites an
  existing article, so accidentally running the publish step twice in one
  week cannot silently replace or duplicate-cost-regenerate that week's
  article.
- On any failure *after* the file is written (build failure), only that
  same just-written file is deleted - never any other file.
- `--dry-run` never writes to the real target path at all, not even
  transiently: it writes to a separate, uniquely-named throwaway file
  (`_dry-run-<slug>-<timestamp>.md`, gitignored as a safety net) purely so
  `npm run build` can validate it, then deletes that throwaway file
  unconditionally before exiting - success or failure. This was
  specifically designed so that even running `--dry-run` in a week where
  the real article already exists cannot touch it (it aborts at the same
  existence check above, before ever writing anything).

### Dry run mode

`npm run oversize:publish -- --dry-run` (or the `dry_run` input on the
`publish-weekly-oversize.yml` manual trigger) runs the entire real
pipeline - final data refresh (done by the workflow's separate monitor
step), source re-verification, and, if `OPENAI_API_KEY` is set, a real
OpenAI call (dry run does **not** imply `--mock` - use both flags
together, `--dry-run --mock`, if you want a completely free test) -
through quality gate and `astro build`, prints the full article that
*would* have been published, then discards it. Nothing is written to a
real content path, nothing is committed, nothing is pushed.

This is the recommended way to test a real OpenAI call end-to-end before
trusting the Friday automation: `--mock` proves the pipeline's own logic
works, but only a real API call proves the model's actual JSON response
matches what `scripts/lib/openai-client.mjs` expects the schema to be.

## GitHub Secrets

| Secret | Required for | Why |
|---|---|---|
| `OPENAI_API_KEY` | `publish-weekly-oversize.yml` | Calls the OpenAI API to synthesize the Friday article. Not needed by the daily monitor (it never calls OpenAI). |

Set it under repository Settings -> Secrets and variables -> Actions ->
New repository secret.

No other secrets are needed: the site deploys via the existing Vercel
GitHub integration (deploys automatically on push to `main`), which is
unrelated to these workflows and is not configured here.

### Run the workflows manually

```bash
gh workflow run daily-oversize-monitor.yml
gh workflow run publish-weekly-oversize.yml                       # real publish
gh workflow run publish-weekly-oversize.yml -f dry_run=true        # safe test, no commit
```

Or from the GitHub UI: Actions tab -> select the workflow -> "Run
workflow" (the `dry_run` checkbox is there for `publish-weekly-oversize.yml`).
Manual runs always skip the Europe/Prague time check regardless of
`dry_run` (see the workflow file's comments for why the schedule itself
fires twice on Fridays) - only the commit step is gated on `dry_run`.

**Recommended first real test**: run with `dry_run=true` and a real
`OPENAI_API_KEY` configured. This exercises the entire pipeline - including
the actual OpenAI response - without any risk of committing or publishing
anything (see "Dry run mode" above).

## Local development / testing

```bash
npm install
npm run oversize:monitor                        # fetch sources, update data/oversize
npm run oversize:publish -- --mock               # free: generate+build without calling OpenAI, discard nothing written to disk unless it's dry
npm run oversize:publish -- --dry-run --mock     # free: same, but also discard the result (nothing left on disk)
npm run oversize:publish -- --dry-run            # real OpenAI call, still discards the result - see "Dry run mode" above
npm run oversize:publish                          # real publish - requires OPENAI_API_KEY in .env.local
npm run dev                                        # http://localhost:4321
```

`--mock` (or `OVERSIZE_MOCK=1`) replaces the OpenAI call with a
deterministic local generator (`scripts/lib/mock-generator.mjs`) that
builds a valid article directly from the verified candidates - useful for
testing the whole pipeline (selection, verification, quality gate, build)
for free before spending real API credits. A mock-generated article still
gets written to `src/content/news/eu-oversize/` and still triggers a real
build check, so **delete it (or leave `status: draft`)** before treating
it as real content - it says "(MOCK)" in the title as a reminder.

## Creating a DAJC Platform Update

Platform Updates are **not** automated (see the brief: publish only
manually-curated updates, never a raw commit log). To publish one:

1. Copy `src/content/news/platform/example-template.md` to a new file,
   e.g. `august-2026.md`.
2. Fill in the frontmatter (`title`, `description`, `slug`,
   `publishedAt`, etc.) and the body sections: What's new / Why it
   matters / Who it affects / What changes in the workflow / What's next.
3. Write for someone outside the dev team - translate technical changes
   into product/workflow meaning, don't restate commit messages.
4. Do **not** include: internal secrets, security details, internal
   architecture, unreleased roadmap, experimental/unshipped features,
   internal codenames, bugfix-only commits without public significance,
   or unannounced partnerships.
5. Set `status: published` and commit.

If/when a semi-automated flow is wanted later, the suggested model from
the brief is a `public-update` marker on qualifying commits/PRs, which a
future script could collect into a draft Platform Update for a human to
edit and publish - nothing like that exists yet, this is manual-only by
design for now.

## How to turn automation off

- **Stop daily monitoring**: disable `daily-oversize-monitor.yml` from
  the Actions tab ("..." -> Disable workflow), or delete/rename the file.
  `data/oversize` simply stops updating; nothing on the live site breaks.
- **Stop Friday publication**: disable `publish-weekly-oversize.yml` the
  same way. Already-published articles are unaffected either way - both
  workflows only ever add new files, they never modify or delete
  previously published articles.
- **Pause without disabling**: removing/rotating the `OPENAI_API_KEY`
  secret no longer pauses this quietly - a completely missing key now
  fails the "Pre-flight - verify OPENAI_API_KEY is configured" step
  (non-zero exit, red run) before any checkout, data refresh, or OpenAI
  usage happens, and `generate-weekly-article.mjs` has the same check as
  a second line of defense for direct/local invocations
  (`checkOpenAiKeyPreflight` in `scripts/lib/preflight.mjs`). This is
  intentional: a missing key is a configuration error, not a normal
  "nothing to publish this week" outcome, and must not look like one - see
  "Incident: the first live run" below. If you want to pause without a
  failing red run every Friday, disable the workflow instead (previous
  bullet). An invalid/revoked (as opposed to missing) key still fails
  inside the OpenAI call itself, is caught, and exits 1 without writing
  anything.

## Incident: the first live run (2026-08-21)

The first scheduled run committed
`content: publish EU Oversize Weekly 2026-W34` with no article - the diff
only contained the routine `data/oversize` refresh. Root cause:
`OPENAI_API_KEY` had never been added as a repository secret, so
`generate-weekly-article.mjs` hit its (then silent, exit-0) abort branch
after writing fresh findings but before generating anything, and the old
commit step staged+committed `data/oversize` and
`src/content/news/eu-oversize` together under one "publish" message
regardless of which one, if either, had actually changed.

Fixed by:
- A missing key on a real run is now a hard failure (exit 1), checked as
  a preflight both in the workflow (before checkout) and in the script
  itself - see the bullet above.
- The commit step now runs `scripts/publish-gate-commit.mjs`, which uses
  `decidePublishCommit` (`scripts/lib/publish-gate.mjs`, unit tested in
  `scripts/lib/__tests__/publish-gate.test.mjs`) as an explicit gate: only
  a real new file under `src/content/news/eu-oversize` produces a
  `content: publish EU Oversize Weekly <week>` commit. A data-only
  refresh, if it commits at all, uses
  `data: refresh oversize findings (no article published this run)` -
  never the word "publish".

## Incident: the first published W35 article (2026-08-21)

The first article the pipeline actually published -
`eu-oversize-weekly-2026-w35.md`, covering 24-30 August 2026 - passed the
(then-existing) quality gate but was editorially unacceptable: a one-off
"lorry got stuck" incident near Hildesheim was reported as an ongoing road
closure; a routine procurement/tender notice for Murrashi Bridge
rehabilitation works in Albania was reported as an active bridge
restriction; a Monaco item valid only 21-23 August (before the 24-30 August
target week even starts) was included; every development was rendered
twice (once under "Main developments", again under "Driving bans next
week"/"Infrastructure watch"); and the article covered only 3 low-value
items instead of the 8-12 substantive, driving-ban-prioritized reports this
briefing exists to provide.

Separately, the commit that published it was labeled
`content: publish EU Oversize Weekly 2026-W34` even though the article
itself targets W35 - `scripts/publish-gate-commit.mjs` computed the commit
message's week from `isoWeekLabel(new Date())` (the *data-collection*
week), independently of, and one week behind, the week
`generate-weekly-article.mjs` actually built the article for.

Fixed by:
- The relevance filter (`relevance-filter.mjs`) now rejects one-off
  incidents, procurement notices, and unconfirmed planned works, checked
  independently at both ingestion and weekly verification (see "Relevance
  filtering" above).
- `date-validation.mjs` deterministically rejects any development whose
  `validTo` is before the target week or `validFrom` is after it,
  independent of what the model does (see "Quality gate" above).
- `render-article.mjs` renders each development in exactly one of three
  mutually exclusive categories (see "Duplicate rendering" above).
- The quality gate now requires 8-12 distinct reports, at least one driving
  ban, no duplicate source/title, and a meaningful `recommendedAction` for
  every report (see "Quality gate" above).
- The maintained official driving-ban calendar layer
  (`config/driving-ban-calendars`) now guarantees driving-ban coverage
  every week regardless of RSS activity (see "Official driving-ban
  calendar layer" above) - the corrected W35 article's 10 reports are
  generated from this layer.
- `scripts/publish-gate-commit.mjs` no longer computes its own week - it
  derives the commit message's week from the actual newly-added article's
  filename (`extractArticleWeekFromStatus`, `scripts/lib/publish-gate.mjs`),
  failing loudly on an invalid or ambiguous filename instead of guessing.
  See `scripts/lib/__tests__/publish-gate.test.mjs` for the regression test
  (findings collected in W34, article targets W35, commit message reads
  `content: publish EU Oversize Weekly 2026-W35`).

## Troubleshooting

**"no feed reachable - skipped" for a source I expect to work.** The
script only tries `feedUrl` (if set in the registry) plus generic
`<url>/feed`, `<url>/feed/`, `<url>/rss` guesses. Many sites' real feed
lives elsewhere or doesn't exist at all (HTML-only). Find the real feed
URL manually and add it as `feedUrl` in `config/oversize-sources/index.mjs`.

**A source produces 0 items even though it clearly published news this
week.** Almost certainly the relevance filter (see "Relevance filtering"
above) - check `GENERAL_TRANSPORT_CONTEXT` / `EXCLUSION_PATTERNS` in
`scripts/lib/fetch-source.mjs` against the actual item text. This is
intentional for police/general-news aggregators; it may be too strict for
a genuinely oversize-transport-focused source you just added - loosen it
for that case rather than globally.

**The Friday run published nothing and I don't know why.** Check the
Action's log for `generate-weekly-article.mjs`'s output - every abort
path logs its specific reason (no findings / nothing pre-selected /
nothing verified / nothing survived cross-validation) before exiting 0.

**I want findings to expire even without an explicit `validTo`.**
Not implemented yet on purpose - `markExpired()` only expires findings
with a passed `validTo` date; absence from one day's crawl isn't proof a
restriction ended (a source could just be temporarily unreachable). A
"missing from N consecutive daily runs -> expire" rule would be a
reasonable future addition to `scripts/lib/findings.mjs` if this becomes
a real problem.

**`superseded` status.** Reserved in the schema/types but nothing sets it
automatically yet - would need a way to detect "finding B fully replaces
finding A" (e.g. via the AI editorial pass), which isn't implemented.
Currently a human editing `data/oversize/<week>/findings.json` by hand is
the only way to set it.

**I changed `src/content.config.ts`'s schema.** Update
`scripts/lib/article-schema.mjs` (`articleFrontmatterSchema`) to match -
it's a deliberate plain-Node duplicate (see the comment at the top of
that file for why) and the quality gate will otherwise validate against a
stale shape.
