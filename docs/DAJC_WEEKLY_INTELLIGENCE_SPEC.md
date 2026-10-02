# DAJC European Oversize & Special Transport Intelligence — canonical production rules

This is the **single editorial authority** for the automated DAJC.eu weekly European oversize/special-transport publication. Implementation notes in `NEWS_AUTOMATION.md` must conform to this document.

## 1. Geographic research coverage

- Every research cycle checks the complete canonical matrix in `config/europe-coverage.mjs`.
- The matrix includes the full DAJC-approved state/territory list, MPZ aliases and additional transport-relevant sub-jurisdictions retained by DAJC.
- A country/territory does not need to appear in the published article when no material development exists.
- Absence from the article must mean **checked — no material development found**, never **not searched**.
- `data/oversize/<ISO-WEEK>/coverage.json` records the status of every jurisdiction.
- Unreachable sources remain visible as `checked-source-availability-limited`; never silently convert them to "no change".
- Direct local official sources are preferred. Where none is available, an explicit administering-country fallback is allowed and remains visible in the coverage audit.

### Published lead order — Central Europe first

Research coverage remains Europe-wide, but the published lead order is operator-first and **deterministic** (`scripts/lib/edition-order.mjs`): importance first (required critical development → directly exceptional/abnormal-transport change → other heavy-transport intelligence), then geography — the wider Central-European transport core in the order **Czechia, Germany, Austria, Slovakia, Poland, Hungary, Switzerland, Slovenia**, then directly connected corridors (France, Benelux, Italy, Croatia, Romania), then the rest of Europe, with peripheral jurisdictions such as Madeira, Guernsey, Jersey or Monaco last. Lead reports are published as one list in exactly this order. Geography is an ordering preference only: it never makes weak material publishable, and a critical development from a peripheral jurisdiction still leads a weaker Central-European item.

## 2. Source discovery

- RSS/Atom is **not** complete coverage and must never be the only discovery channel.
- For every configured authority, the monitor checks available RSS/Atom **and** official HTML/news/traffic/legislation pages.
- Feed and web results are merged, detail pages are enriched, and results are deduplicated by official source URL.
- Primary/official sources are required for permits, legal rules, escorts, route/weight/dimension limits and other high-impact regulatory claims whenever available.
- Generic landing pages, image-only URLs, stale archive pages, unrelated permits/administration and non-operational statistics are excluded.
- **Discovery date is not publication freshness.** A page first discovered this week is not a new development merely because the crawler found it now. Completed civic/school projects, old archive pages, generic infrastructure achievements and historical announcements without a current operational consequence are excluded.
- The monitor records, for every finding, the date the **official source published it** (`publishedAt`: page `datePublished`/publication metadata, feed date, a labelled or leading date in the text, or a date in the URL) and keeps the real first-discovery time across ISO weeks. Without such evidence the date is unknown — never "today".

## 3. Publication format — QUALITY > COUNT

A well-supplied week has room for:

- **Lead reports: typically 20–30, maximum 30.**
- **Rest of Europe: typically 10–15 concise short updates, maximum 15.**

These numbers are **capacities, never quotas**. An edition contains exactly the items that pass every rule in this specification — 17 + 8, 9 + 0 or 25 + 12 are all correct editions. There is **no minimum** number of lead reports, no Rest-of-Europe minimum and no country/jurisdiction quota.

Never satisfy a number with filler. The pipeline has no supplement, repair or retry step that asks for "more" items, never moves items between sections to reach a count, and never relaxes a rule because an edition is short. If nothing qualifies, no edition is published that week — a weak edition is never published instead.

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

Every published item must demonstrably relate to heavy, abnormal, oversized or special road transport, freight routing, relevant tolling, vehicle/route limits, escorts, borders, ports/ferries/project cargo, heavy-haul equipment, or another directly operational DAJC intelligence topic.

Exclude driver-licence/auto-school administration, environmental/water-law permits unrelated to transport, crime/theft/accident/breakdown incidents, procurement/tender noise, generic authority pages, toll revenue/statistics without an operational rule change, stale historical archive material, ordinary short roadworks/closures, completed school/public-building renovations, generic completed civic projects, and infrastructure announcements whose only claimed relevance is a theoretical future logistics benefit.

Every published item must also prove that it is current:

- **Freshness — discovery is not news.** The pipeline distinguishes DISCOVERY date (`firstSeenAt`, never a freshness signal), SOURCE PUBLICATION date (`publishedAt`), EFFECTIVE date (`validFrom`/`validTo`, read only from explicit wording) and TARGET-WEEK relevance. An item is current only if (a) the official source published it within the **14 days** before the edition's Thursday preparation, (b) it takes effect or ends inside the target week, (c) explicit start and end dates show it is in force during the target week, or (d) it takes effect within the **30-day outlook** after the target week. Otherwise it is excluded; undated material without such evidence is never published.
- **Hard exclusions:** completed projects and openings without a current restriction, pedestrian/cycling facilities, school/civic/public-space projects, PR/event items, market/financial news, statistics, accidents, breakdowns, crime, procurement, generic landing/roadworks pages and anything without proven heavy/oversize/special-transport relevance. A generic mention of road, bridge, tunnel, vehicle or transport is not enough.
- **One specific development:** homepages, listing/landing pages, project/programme pages, FAQ pages, organisation pages and bare topic titles are not developments.
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
- The final edition is built from the complete monitoring data available at Thursday preparation.

## 9. Article structure

1. SEO title, publication date and covered week.
2. Standfirst / executive summary.
3. Substantive lead reports (up to 30; as many as genuinely qualify) as one list in the deterministic operator-first order (§1), each with a category label and What changed / Where / When / Impact / Action; outlook items carry an explicit "takes effect" date.
4. Rest of Europe — concise reports (up to 15; omitted when none qualify).
5. Critical European corridors when materially relevant.
6. 30-day outlook when materially relevant.
7. Dispatcher/operator checklist.
8. Full source list.
9. Next scheduled publication.

## 10. Editorial test

Every item must answer:

> Why does this matter **now** to someone planning or executing heavy, abnormal, oversized or special transport?

If there is no meaningful current operational answer, exclude it. A newly discovered old page is not news. A short edition is a correct edition; a padded edition is not.
