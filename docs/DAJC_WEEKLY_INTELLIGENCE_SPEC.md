# DAJC European Oversize & Special Transport Intelligence — canonical production rules

This is the **single editorial authority** for the automated DAJC.eu weekly European oversize/special-transport publication. It is the only document that states the rules; `NEWS_AUTOMATION.md` describes how they are implemented and links here instead of repeating them. In code the rules live in `scripts/lib/weekly-eligibility.mjs` (deterministic checks), `scripts/lib/quality-gate.mjs` (final gate) and the model prompt in `scripts/lib/openai-client.mjs`; a rule change must update this document and those files together.

## 0. Scope

The Weekly covers **commercial road freight and the practical work of European truck drivers, dispatchers, fleets and transport companies**. Vehicles over 12 t (N3) remain the operational core. **Oversize, abnormal and special transport has priority**: it is searched first, ranked first, placed first in the edition (§1) and is the required-coverage floor (§4). Other material road-freight developments follow: truck/route restrictions, tolls, border/customs, ports, freight ferries, plus drivers' working conditions, professional safety, truck parking, training, operational tools, dispatch/routing/telematics, fleet/vehicle services, insurance, fuel/operating costs and transport-company changes that materially affect the job. General consumer car news and unsupported PR are excluded.

## 1. Geographic research coverage

- Every research cycle checks the complete canonical matrix in `config/europe-coverage.mjs`.
- The matrix includes the full DAJC-approved state/territory list, MPZ aliases and additional transport-relevant sub-jurisdictions retained by DAJC.
- A country/territory does not need to appear in the published article when no material development exists.
- Absence from the article must mean **checked — no material development found**, never **not searched**.
- `data/oversize/<ISO-WEEK>/coverage.json` records the status of every jurisdiction.
- Unreachable sources remain visible as `checked-source-availability-limited`; never silently convert them to "no change".
- Direct local official sources are preferred. Where none is available, an explicit administering-country fallback is allowed and remains visible in the coverage audit.

### Published lead order — Central Europe first

Research coverage remains Europe-wide, but the published lead order is operator-first and **deterministic** (`scripts/lib/edition-order.mjs`): importance first (required critical development → directly exceptional/abnormal-transport change → other developments for goods vehicles over 12 t), then geography — the wider Central-European transport core in the order **Czechia, Germany, Austria, Slovakia, Poland, Hungary, Switzerland, Slovenia**, then directly connected corridors (France, Benelux, Italy, Croatia, Romania), then the rest of Europe, with peripheral jurisdictions such as Madeira, Guernsey, Jersey or Monaco last. Lead reports are published as one list in exactly this order. Geography is an ordering preference only: it never makes weak material publishable, and a critical development from a peripheral jurisdiction still leads a weaker Central-European item.

## 2. Source discovery

- **Two-stage open-web discovery** (`scripts/lib/web-search.mjs`, OpenAI web search): official primary authority sources first for each geographical research group; if fewer than **3** eligible *primary discovery hits* are found in a group, search broadly across **all discoverable European freight, heavy-haul/oversize, driver/dispatcher, trade, fleet, operator, OEM and professional transport websites** without an exhaustive publisher whitelist. Search in local languages, oversize first. The threshold is only a *search-expansion trigger*, not a required published report count.
- **DAJC's own sites (dajc.eu, dajc.cz) are never a source.** They are excluded from every search request, rejected before any page fetch and rejected again by the eligibility rules (`isOwnPublication`, `scripts/lib/source-policy.mjs`). In the W44 run about 40 % of all Search hits were DAJC editions.
- **The Perplexity Search API receives short keyword queries in the group's local languages** (`buildSearchQueries`, `buildSearchRequest`), never the long LLM prompt. The official-first pass is restricted to the group's public authority domains (`config/official-authority-domains.mjs` plus the configured official sources); the open-web pass excludes DAJC and general driving-ban aggregators, is limited to the group's languages plus English and to pages from the last 30 days.
- The search model only finds links. Every hit is fetched and the finding is built from **the page itself** (heading, text, publication date). A date the model reports is kept only when the page text shows it. Unreachable pages, PDFs, and pages whose own text shows no freight-vehicle (>12 t) or oversize context are dropped and logged.
- The previous crawler of configured official authority pages (`config/oversize-sources`, `scripts/lib/fetch-source.mjs`) remains available with `OVERSIZE_DISCOVERY=official` (or `both`).
- **Official sources always have priority.** Industry news can be included on the evidence of its own readable, dated article without separate official corroboration for routine professional, fleet, driver or company news. It must be clearly attributed as an **industry report**. **No unconfirmed media claim may be stated as an officially binding permit, escort, axle/weight, legal or route restriction**; these claims must be clearly labelled as requiring confirmation with the responsible authority. Repetition of an existing official item does not count as separate news.
- Generic landing pages, image-only URLs, stale archive pages, unrelated permits/administration, promotional copy and non-operational statistics are excluded. An opened original article (not only an AI-generated snippet), date evidence and concrete professional relevance remain mandatory, but no separate official corroboration is required for ordinary industry reporting.
- **Discovery date is not publication freshness.** A page first discovered this week is not a new development merely because the crawler found it now. Completed civic/school projects, old archive pages, generic infrastructure achievements and historical announcements without a current operational consequence are excluded.
- The monitor records, for every finding, the date the **official source published it** (`publishedAt`: page `datePublished`/publication metadata, feed date, a labelled or leading date in the text, or a date in the URL) and keeps the real first-discovery time across ISO weeks. Without such evidence the date is unknown — never "today".

## 3. Publication format — QUALITY > COUNT

A well-supplied week has room for:

- **Lead reports: typically 20–30, maximum 30.**
- **Rest of Europe: typically 10–15 concise short updates, maximum 15.**

These numbers are **capacities, never quotas**. An edition contains exactly the items that pass every rule in this specification — 17 + 8, 9 + 0 or 25 + 12 are all correct editions. There is **no minimum** number of lead reports, no Rest-of-Europe minimum and no country/jurisdiction quota.

Never satisfy a number with filler. The pipeline has no supplement, repair or retry step that asks for "more" items, never moves items between sections to reach a count, and never relaxes a rule because an edition is short. If nothing qualifies *after official and broader media searches*, no edition is published that week — a weak edition is never published instead.

The Rest-of-Europe items are deliberately short: country/jurisdiction, what changed, where/when relevant, operator action and official source. If at least one item qualifies, the most important items are lead reports; the Rest-of-Europe section is omitted when it has no item.

## 4. Critical-news floor

Fresh verified high-signal changes directly affecting exceptional/oversized transport are **required coverage**, including permit rules or permit systems, private/police escort rules, exceptional-transport movement conditions, border/transit restrictions, weight/width/height/axle limits, route authorisations, and directly relevant toll/digital procedures.

"Fresh" means the official source published the change within the freshness window (§7) — never that DAJC discovered the page this week. Several official pages about one change form one required development. Required developments are reserved before normal shortlist ranking and must be written as normal reports (never as raw source text); if one is still absent from both lead reports and Rest of Europe, publication is blocked.

## 5. Driving bans are out of scope

General HGV/truck driving bans — weekend, Sunday, public-holiday, seasonal, summer, night, transit or holiday-traffic bans, annually repeated bans and standard >7.5 t restrictions, whether new, changed or recurring — belong to the separate **DAJC Driving Bans** system and are **not** part of EU Oversize Weekly. "Trucks >7.5 t prohibited on Sunday" is not Weekly news; "Ausnahmetransporte prohibited …" is.

- The Weekly never imports the DAJC Driving Bans calendar (`config/driving-ban-calendars`, `data/driving-bans`) as a source of topics.
- A movement restriction is eligible only when the official evidence explicitly scopes it to exceptional/abnormal/oversize/special transport, permit-specific movement, escort/police escort, an abnormal-load corridor or dimension/weight/axle limits relevant to such transport. It is then labelled "Exceptional-transport movement restriction".
- General bans are recognised from their wording too (Sunday/holiday/weekend/night + ban/prohibited/verboten/zákaz …), not only from a category flag.

## 6. Road/motorway closure rule

A road or motorway closure is publishable only when official evidence proves a **planned duration longer than 30 days**.

- Exactly 30 days: exclude.
- Shorter than 30 days: exclude.
- Unknown/undated duration: exclude.
- No "important corridor" exception to this duration rule.
- The same rule applies to roadworks (resurfacing, lane closures, reconstruction works): short or undated roadworks are excluded.

Other non-closure restrictions such as weight, width, height, axle, permit, escort or route-authorisation changes are evaluated on their own operational significance and are not subject to the 30-day closure threshold.

## 7. Relevance, freshness and verification

Every published item must demonstrably relate to European commercial road freight work, preferably heavy vehicles over 12 t and above all oversize/abnormal transport, including driver/dispatcher/company/fleet topics with demonstrable operational significance, routing, permits, costs, working conditions, equipment, borders, project cargo or similar practical intelligence.

Exclude driver-licence/auto-school administration, environmental/water-law permits unrelated to transport, crime/theft/accident/breakdown incidents, procurement/tender noise, generic authority pages, toll revenue/statistics without an operational rule change, stale historical archive material, ordinary short roadworks/closures, completed school/public-building renovations, generic completed civic projects, and infrastructure announcements whose only claimed relevance is a theoretical future logistics benefit.

Every published item must also prove that it is current:

- **Freshness — discovery is not news.** The pipeline distinguishes DISCOVERY date (`firstSeenAt`, never a freshness signal), SOURCE PUBLICATION date (`publishedAt`), EFFECTIVE date (`validFrom`/`validTo`, read only from explicit wording) and TARGET-WEEK relevance. An item is current only if (a) the source published it within the **7 days** before the edition's Thursday preparation (one week back), (b) it takes effect or ends inside the target week, (c) explicit start and end dates show it is in force during the target week, or (d) it takes effect within **one month (30 days) after the Thursday preparation** (outlook; `FRESHNESS_WINDOW_DAYS`, `FORWARD_HORIZON_DAYS` in `weekly-eligibility.mjs`), or (e) **catch-up:** the previous week's final edition was not published, and the change took effect during that skipped week and is still in force (W43 was never published, so the N307 limit in force since 21 October would otherwise have fallen between two editions). Otherwise it is excluded; undated material without such evidence is never published.
- **Hard exclusions:** completed projects and openings without a current restriction, pedestrian/cycling facilities, school/civic/public-space projects, PR/event items, financial/market stories with no concrete freight business or driver/dispatcher operational impact, statistics, accidents, breakdowns, crime, procurement, generic landing/roadworks pages and anything without proven relevance for freight vehicles over 12 t or oversize/special transport. A generic mention of road, bridge, tunnel, vehicle or transport is not enough.
- **One specific development:** homepages, listing/landing pages, project/programme pages, FAQ pages, organisation pages and bare topic titles are not developments. Neither are evergreen guides and explainers re-dated every season ("Winter Rules for Trucks in Europe 2026/27", "Oversize load permit in Hungary (2026): authority, fees", "Transport to Italy"), nor blog, knowledge-base, country-guide or permit-guide pages of non-official sites.
- **No repetition:** a source already cited by an earlier edition is not published again unless the source republished it after that edition or the change takes effect or ends in the target week.
- **Source suitability:** police press feeds contribute only announced enforcement campaigns, never single incidents or one-off local movements.
- **One report per real-world development:** several pages about one change are reported once.

These rules are deterministic (`scripts/lib/weekly-eligibility.mjs`) and are applied before verification, to every item the model returns, and again in the final quality gate. Every source URL is cross-validated against the verified candidate set. Every report contains a concrete operator/dispatcher action.

## 8. Publication schedule and preview

- Normal final edition: Friday at **12:00 Europe/Prague**, covering the upcoming Monday–Sunday week.
- The edition is prepared on Thursday and committed with `publishedAt` set to Friday 12:00 Europe/Prague; the site shows it only from that instant. Thursday/Friday-morning retries, the watchdog and a Saturday catch-up are idempotent recovery layers that run only if the final week article is missing.
- Final publication is idempotent; an existing final week file is not automatically overwritten.
- A manual **correction** run (workflow input `correction`) regenerates the current target edition from source data and replaces the published file atomically — only after the regenerated edition has passed every gate and the build, stamped with `updatedAt`. If the regenerated edition does not qualify, the published edition is left untouched and the run fails with the blocker.
- A manually requested **preview** uses the same research, verification, counts, quality gates and article layout, but a separate preview slug. It never consumes or blocks Friday's final slug.
- The final edition is built from the complete monitoring data available at Thursday preparation. The findings behind a prepared edition are also persisted on `automation/oversize-data`, so closing a rejected PR never discards them.
- The watchdog fails loudly when an edition PR is still unmerged after its Friday 12:00 slot, and while any edition PR for an already passed week remains open.

## 9. Article structure

1. SEO title, publication date and covered week.
2. Standfirst / executive summary.
3. Substantive lead reports (up to 30; as many as genuinely qualify) as one list in the deterministic operator-first order (§1), each with a category label and What changed / Where / When / Impact / Action; outlook items carry an explicit "takes effect" date.
4. Rest of Europe — concise attributed reports (up to 15; omitted when none qualify).
5. Critical European corridors when materially relevant.
6. One-month outlook when materially relevant.
7. Dispatcher/operator checklist — one line per published report, built from the reports themselves. Title, description and intro never name a country without a published report; such model text is replaced deterministically (`scripts/lib/edition-summary.mjs`).
8. Full source list.
9. Next scheduled publication.

## 10. Editorial test

Every item must answer:

> Why does this matter **now** to someone planning or executing road freight transport with vehicles over 12 t — and above all oversize, abnormal or special transport?

If there is no meaningful current operational answer, exclude it. A newly discovered old page is not news. A short edition is a correct edition; a padded edition is not.

## 11. Permanent official-first, open-European-media fallback (23 October 2026)

This is a **standing** rule. The 50 approved DAJC jurisdictions remain the geographic scope; research covers all publicly discoverable European websites relevant to commercial road freight and heavy/oversize work, without a hard media-domain whitelist. Research **cannot guarantee exhaustive crawling of every website**. Official notices lead; the second open-web pass runs for a group when fewer than 3 primary-source hits survive first-page evidence checks. The 3-hit trigger is **not** a news quota and must not induce padding. An ordinary industry report is allowed without independent primary authority confirmation as long as its direct dated article supports what DAJC attributes to it, and its provenance is labelled; legal/route safety claims remain unconfirmed until checked against the competent authority. All source dates, geographic scope, no duplicate reports, no general Driving Bans, and quality-before-count protections remain mandatory.

## 12. Autonomous Sonar / Claude editorial and social distribution (23 October 2026)

This is a permanent rule: **Perplexity Sonar research and article synthesis → Claude editorial veto/approval → protected GitHub PR and CI → verified public website → Claude-tailored X and LinkedIn copy → existing Buffer social publishing adapter.** No second weekly publishing pipeline.

- Sonar discovers links in the existing official-first open-European-media search and synthesizes an English article only from verified source candidates. Hard checks on dates, geography, ISO week, duplicate stories, binding weight/permit limits, source provenance and the no-general-Driving-Bans exclusion remain.
- Claude checks the exact article plus original source excerpts **and the publisher's own current page text, host and source tier**, and emits one structured approve/reject verdict with blocking reasons and coverage of every cited URL. It rejects weight/permit/legal/route claims resting on second- or third-hand relays, general-interest outlets or evergreen guides. A missing/rejecting verdict, unsupported source or altered SHA-256 receipt fails closed.
- The final article alone may request ordinary GitHub auto-merge of a content-only PR after required CI, **and only when every cited source is an official authority**. An edition citing any industry or relayed source always waits for human review (W44: Claude approved a Russian-language 24tv.ua relay of a Swedish proposal). Corrections, previews, code, security and workflow changes do not auto-merge.
- Public release means the actual accessible DAJC.eu article; a green CI run or prepared PR is not publication.
- Once an article is verified public, Claude prepares distinct factual English short copy for X and an industry-oriented post for the DAJC LinkedIn company page, each with the exact URL. The existing persistent ledger blocks duplicate attempts. Buffer is used only with explicitly connected/authorized company channels.
- Never post unpublished Platform / Integration Ecosystem material. Platform updates require explicit socialPublish=true.
- Activation requires funded API credentials and spending limits: PERPLEXITY_API_KEY, ANTHROPIC_API_KEY, and for Buffer, BUFFER_API_KEY with exact X and LinkedIn channel IDs and enabled publishing flags.


## 13. Permanent platform-specific editions and distribution (24 October 2026)

The publication chain is **Perplexity Search API (source discovery only) → Claude (source-grounded synthesis, editorial checking, and per-channel copy) → protected DAJC.eu publication → X / LinkedIn company channels**. The tested Search endpoint is `https://api.perplexity.ai/search`. Sonar Chat Completions are not a required part of this design; their HTTP 403 must not be silently treated as zero news. Search results are **leads only**, never evidence until the actual source page has been opened, dated and checked by the existing deterministic verifier.

Every output channel has an independent editorial format, derived from the same approved factual source set:
- **DAJC.eu:** the complete English Weekly with SEO, lead reports, Rest of Europe, cited source URLs, operator checklist and correct ISO week.
- **DAJC.cz:** a complete, natural Czech-language localization with the same verified facts and source links. No literal machine-translation of legal terms; do not publish a Czech edition until the separate locale and route are implemented and validated.
- **X (DAJC company account):** a short standalone English post with a concrete operator takeaway and the exact canonical public URL, at most 260 Unicode characters under the current DAJC policy. A thread is a future opt-in feature, not automatic.
- **LinkedIn (DAJC company page):** a distinct professional English B2B post emphasizing consequences for dispatchers, carriers and drivers, with the exact canonical URL. Never silently use a personal LinkedIn profile.

The channel adaptations must not invent any dates, weights, restrictions, source citations or safety claims. A social publication can happen only after independent confirmation that the linked article is actually public. Duplicate protection and account authorization remain mandatory. A missing/failed Search or Claude API call is a hard stop; do not switch to an unreviewed publishing path. QUALITY > COUNT, official-first priority, 50 jurisdictions and Driving Bans exclusions remain.

This policy does not by itself activate the new Search/Claude producer or DAJC.cz route. Production feature flags and external channel authorizations require a separate validated deployment; the existing working publisher stays in place until then.

### Social traffic objective (24 October 2026)

**X and LinkedIn are discovery channels, not mirrors of the full article.** Their primary objective is to attract genuinely interested readers to the complete, public DAJC.eu Weekly. Claude must write separate, accurate teasers with one or two substantiated highlights, relevant professional impact, and a clear call to read the full article, linking to the exact canonical DAJC.eu URL once. Never reproduce the entire article or all headlines on social platforms. No fabricated urgency, withheld safety-critical facts, misleading clickbait, unverified numbers or generic promotional filler. X should be exceptionally concise; LinkedIn should be a short, substantive professional invitation. Keep company identity and anti-duplicate safeguards unchanged. Measure link clicks and visits when authorized analytics become available, but do not invent traffic figures.


## 14. Permanent social click-through and locale policy (24 October 2026)

**Primary goal of X and LinkedIn: bring qualified readers to the complete DAJC article.** Social posts are distinct factual teasers, not complete reproductions of the Weekly. Each teaser must offer a concrete reason to open the article, a clear call to read the full briefing, and the **exact, already publicly accessible canonical URL** for its language.

- English X and company LinkedIn posts link to **dajc.eu** English article.
- Czech X and company LinkedIn posts link to **dajc.cz** Czech article.
- Both social channels may carry both languages, but only when their matching public article exists; never link a Czech teaser to an English-only article, invent a DAJC.cz slug, or send duplicate cross-language posts for one article without the configured channel policy.
- X is brief and curiosity-building without misleading clickbait. LinkedIn is a short professional teaser focused on why the full report matters for dispatchers, drivers and transport companies. Neither post should disclose the whole article or invent facts, restrictions, dates, or claims.
- Social posts are scheduled **after** each language's own public website article is confirmed live. Existing social-account authorization and anti-duplicate ledgers remain mandatory. Czech localization and dual-language social posting are not activated until separately implemented and verified.

## 15. Final canonical publishing decision (24 October 2026)

**DAJC.eu is the sole news publisher and archive.** All Weekly editions, articles, original source citations and canonical URLs live exclusively on DAJC.eu/news. DAJC.cz is a Czech-language entry site with a static visible link to the English DAJC.eu/news archive; it must not generate, duplicate, translate-and-publish or index separate Weekly articles. This decision supersedes earlier proposed dual-domain article publication and Czech full-article localization.

X and company LinkedIn are acquisition channels, not independent news archives. Each posts an independently adapted, accurate teaser linking to the exact live DAJC.eu article. English posts are standard; if Czech teasers are added, explicitly disclose that the full linked article is in English. Never invent a DAJC.cz article URL or mirror content to dajc.cz.

Source research: use the tested Perplexity Search API to discover candidate URLs, then Claude to classify and draft from original-source-verified records, followed by independent final editorial review and protected GitHub CI. Production activation requires end-to-end evidence and a spend budget; source failure must not silently publish unreviewed content.
