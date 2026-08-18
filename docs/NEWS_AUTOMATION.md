# News automation

How the `/news` system on dajc.eu works: the content model, the daily EU
Oversize monitor, the Friday publication pipeline, and how to author a
DAJC Platform Update. The site itself is a static Astro build (see the
root `README.md`); this document covers the News-specific pieces added on
top of it.

## Architecture overview

```
config/oversize-sources/index.mjs   registry of European sources to monitor
data/oversize/<ISO week>/           raw findings gathered during that week
  findings.json
scripts/
  oversize-monitor.mjs              daily: fetch sources -> data/oversize
  generate-weekly-article.mjs       friday: data/oversize -> content/news
  lib/
    findings.mjs                    finding shape, dedup key, status transitions
    fetch-source.mjs                per-source fetch + relevance + classification
    select-candidates.mjs           pre-selection before verification/AI (cost control)
    verify-candidates.mjs           re-checks source URLs are still reachable
    openai-client.mjs               structured-output OpenAI call
    mock-generator.mjs              free local stand-in for openai-client.mjs
    render-article.mjs              validated JSON -> frontmatter + Markdown
    quality-gate.mjs                pre-publish blocking checks
    article-schema.mjs              zod schema mirroring src/content.config.ts
    store.mjs / week.mjs            file I/O and ISO-week helpers
src/content/news/eu-oversize/       published (and draft template) articles
src/content/news/platform/          published (and draft template) articles
src/content.config.ts               Astro content collection schema
.github/workflows/
  daily-oversize-monitor.yml
  publish-weekly-oversize.yml
```

Nothing here touches the homepage hero, header, footer, or global styles -
the News system only adds the `News` section above the footer and the
`/news` routes, reusing the same CSS custom properties (`--dajc-dark`,
`--dajc-orange`, etc.) defined in `src/styles/global.css`.

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
limit, toll, motorway...). A hard exclusion list also blocks generic
crime/administrative press-release noise (weapons, arrests, court
proceedings) that some police-press-aggregator sources publish alongside
the rare traffic-relevant item. This was tuned against real data during
development - several police feeds (`de-polizei-blaulicht`, `pl-policja`,
`uk-npcc`, `xk-kosovopolice`) turned out to publish almost entirely
unrelated content; don't be surprised if they contribute 0 findings on
most days.

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
  type: 'national-road-authority',   // see SourceType in the file for the full list
  priority: 1,                        // 1 = high, 3 = supplementary
}
```

This is a **curated starting set** (~23 sources), not exhaustive
pan-European coverage - the brief's full country list is a much larger
undertaking. Sources with a confirmed `feedUrl` produce real findings
today; sources without one are attempted via generic guesses
(`<url>/feed`, `<url>/rss`) at runtime and simply produce zero findings
until a working feed is found or a dedicated HTML-scraping adapter is
built for them (out of scope for this pass - `scripts/lib/fetch-source.mjs`
only knows how to read RSS/Atom).

### How to add a new source

1. Confirm a real RSS/Atom feed exists (`curl -I <candidate-url>`,
   check for `application/rss+xml` or `application/atom+xml`, or look for
   a `<link rel="alternate">` tag on the homepage).
2. Add an entry to `config/oversize-sources/index.mjs` with the verified
   `feedUrl`.
3. Run `npm run oversize:monitor` locally and confirm the new source
   shows up as `OK` with a sensible item count.
4. If the source is noisy (like the police aggregators above), consider
   whether `GENERAL_TRANSPORT_CONTEXT` / `EXCLUSION_PATTERNS` in
   `scripts/lib/fetch-source.mjs` need adjusting.

**No Slovak (SK) source is configured yet.** A related prior audit found
the obvious candidate (NDS / `ndsas.sk`) unreliable - its feed's `pubDate`
tracks the CMS's `dateModified`, not the true publish date, so years-old
press releases can appear "fresh". Don't add it back without
independently re-checking that specific problem first.

## Daily monitoring

`scripts/oversize-monitor.mjs` (`npm run oversize:monitor`):

1. Computes the current ISO week (e.g. `2026-W34`).
2. Loads `data/oversize/2026-W34/findings.json` if it exists.
3. For every configured source, tries to fetch and parse its feed
   (`scripts/lib/fetch-source.mjs`) - failures are logged and skipped,
   never fatal.
4. Classifies and relevance-filters each item into a candidate finding.
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

`scripts/generate-weekly-article.mjs` (`npm run oversize:publish`):

1. Reads the **current** ISO week's findings (the ones gathered all week).
2. `selectCandidates()` narrows ~100+ raw findings to a bounded, scored
   subset (freshness + specific-type bonus, capped per source) - this is
   the cost-control step: don't verify or pay to synthesize everything.
3. `verifyCandidates()` re-checks each selected candidate's `sourceUrl` is
   still reachable right now (HEAD, falls back to GET); anything
   unreachable is dropped.
4. Calls OpenAI (`scripts/lib/openai-client.mjs`, structured JSON output)
   to select, group and phrase the verified candidates into an article
   for the **upcoming** ISO week - the model is instructed to copy
   `sourceUrl`/`sourceName` exactly from the input and never invent one.
5. **Cross-validates** every `sourceUrl` the model returned against the
   actual verified set - anything that doesn't match exactly is dropped
   before it can reach the article (defends against model drift/
   hallucination; this is the concrete implementation of "AI never
   creates an operational restriction without a source").
6. Renders the surviving developments into frontmatter + Markdown
   (`scripts/lib/render-article.mjs`), grouped into Main developments /
   Driving bans next week / Infrastructure watch / What operators should
   watch next week / Sources, per the required article structure.
7. Runs the quality gate (below). Only on success is the file written to
   `src/content/news/eu-oversize/<slug>.md` - and only if that exact path
   doesn't already exist (see "Never overwrites published content" below).
8. Runs `npm run build` to confirm the whole site still builds with the
   new article. If it fails, the just-written file is deleted and the
   script exits non-zero - the repository is left exactly as it was found.

The article's title/date range targets the week *after* the one whose
data was read (e.g. an article generated Friday in ISO week 2026-W34
covers 2026-W35), matching a Friday briefing about the week ahead.

### Quality gate

Implemented in `scripts/lib/quality-gate.mjs`, called from
`generate-weekly-article.mjs` before anything is written to disk. Blocks
publication if:

- `title`, `description`, `publishedAt`, or a valid `category` is missing
  (enforced via the same zod schema shape as `src/content.config.ts`,
  duplicated in `scripts/lib/article-schema.mjs` so it can run outside
  Astro's build - keep the two in sync if the schema changes),
- `sources` is empty,
- any development item is missing a `sourceUrl` or `sourceName`,
- the article body is empty or under ~400 characters (suspiciously short),
- zero developments survived cross-validation.

If the gate fails, or the subsequent `astro build` fails, **no file is
written or left behind** and the script exits with a non-zero code - the
previously published site is completely unaffected.

### Safety: never publish a low-quality article just because cron ran

If there isn't enough verified, significant data in a given week - no
findings on file, nothing survives pre-selection, nothing survives
verification, or nothing survives cross-validation - the script logs the
specific reason and exits **0** (success, no article). This is treated as
normal, not an error: a quiet week genuinely may not have anything worth
publishing. The GitHub Actions commit step then sees no file changes and
does nothing. A real failure (OpenAI error, quality gate failure, build
failure) exits **1**, so it's visible in the Actions tab, but still never
leaves a partial/broken file behind.

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
- **Pause without disabling**: remove/rotate the `OPENAI_API_KEY` secret -
  `publish-weekly-oversize.yml` will then fail fast at the generation
  step (`abort('OPENAI_API_KEY is not set...')` only fires for a
  completely missing key at the script level; an invalid/revoked key
  fails inside the OpenAI call itself, is caught, and exits 1 without
  writing anything).

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
