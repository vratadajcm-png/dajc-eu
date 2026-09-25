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

Research coverage remains Europe-wide, but the published lead order is operator-first. Among substantively comparable verified items, lead with the wider Central-European transport core: **Czechia, Germany, Austria, Slovakia, Poland, Hungary, Switzerland and Slovenia**. Then place directly connected high-value transit corridors and the rest of Europe. Peripheral territories such as Madeira, Guernsey, Jersey or Monaco belong later in the article / Rest of Europe unless a genuinely critical exceptional-transport event justifies elevation. Geographic preference must never make weak material publishable or outrank a materially more important verified change.

## 2. Source discovery

- RSS/Atom is **not** complete coverage and must never be the only discovery channel.
- For every configured authority, the monitor checks available RSS/Atom **and** official HTML/news/traffic/legislation pages.
- Feed and web results are merged, detail pages are enriched, and results are deduplicated by official source URL.
- Where an authority publishes restrictions only as structured data, a dedicated adapter reads it. Germany: the Autobahn GmbH traffic API (`verkehr.autobahn.de`) supplies motorway roadworks with an explicit gross-weight limit or a passage width of at most 3.0 m (e.g. A4 Köln "BW Eifeltor", 3.25 m / 44 t), one finding per project and motorway (`scripts/lib/autobahn-restrictions.mjs`).
- Primary/official sources are required for permits, legal rules, escorts, route/weight/dimension limits and other high-impact regulatory claims whenever available.
- Generic landing pages, image-only URLs, stale archive pages, unrelated permits/administration and non-operational statistics are excluded.
- **Discovery date is not publication freshness.** A page first discovered this week is not a new development merely because the crawler found it now. Completed civic/school projects, old archive pages, generic infrastructure achievements and historical announcements without a current operational consequence are excluded.

## 3. Publication format — counts are targets, never blockers

A full weekly edition aims for:

- **20–30 substantive lead reports** (maximum 30).
- **Rest of Europe: 10–20 concise short updates** (maximum 20), as geographically broad as the verified material allows.

The number of reports **never blocks publication**. A week with little genuine material is still published with what exists — for example 5 lead reports and 1 Rest-of-Europe item. Only an edition with no verified report at all is not published. Never satisfy a count with filler.

Below 20 lead reports, **ongoing** structured restrictions (e.g. motorway width/weight limits whose current phase began earlier and has not changed) may supplement the edition. At 20 or more lead reports, only new or changed restrictions are published.

The Rest-of-Europe items are deliberately short: country/jurisdiction, what changed, where/when relevant, operator action and official source.

## 4. Critical-news floor

Fresh verified high-signal changes directly affecting exceptional/oversized transport are **required coverage**, including permit rules or permit systems, private/police escort rules, exceptional-transport movement conditions, border/transit restrictions, weight/width/height/axle limits, route authorisations, and directly relevant toll/digital procedures.

Required critical items are reserved before normal shortlist ranking. If a verified critical source is absent from both lead reports and Rest of Europe, publication is blocked.

## 5. Driving bans — separate from the Weekly

General HGV/truck driving bans (Sunday, weekend, public-holiday, seasonal, summer and transit bans) are published in the separate **DAJC Driving Bans calendar** (`/driving-bans`) and are **not** repeated in the Weekly — not even when they are new, seasonal or holiday-specific. Every edition links to the calendar instead.

The Weekly includes a ban or movement restriction only when its title, description or vehicle scope explicitly limits it to exceptional, oversize, abnormal or special transport (e.g. the French convoi exceptionnel weekend movement ban, Croatian extraordinary-transport motorway stoppages). A mention of exceptional transport only in a general ban's exemption or impact notes does not qualify. Enforced by `scripts/lib/weekly-driving-ban-policy.mjs` at candidate selection, on model output and in the quality gate.

## 6. Road/motorway closure rule

A road or motorway closure is publishable only when official evidence proves a **planned duration longer than 30 days**.

- Exactly 30 days: exclude.
- Shorter than 30 days: exclude.
- Unknown/undated duration: exclude.
- No "important corridor" exception to this duration rule.

Other non-closure restrictions such as weight, width, height, axle, permit, escort or route-authorisation changes are evaluated on their own operational significance and are not subject to the 30-day closure threshold.

## 7. Relevance, freshness and verification

Every published item must demonstrably relate to heavy, abnormal, oversized or special road transport, freight routing, relevant tolling, vehicle/route limits, escorts, borders, ports/ferries/project cargo, heavy-haul equipment, or another directly operational DAJC intelligence topic.

Exclude driver-licence/auto-school administration, environmental/water-law permits unrelated to transport, crime/theft/accident/breakdown incidents, procurement/tender noise, generic authority pages, toll revenue/statistics without an operational rule change, stale historical archive material, ordinary short roadworks/closures, completed school/public-building renovations, generic completed civic projects, and infrastructure announcements whose only claimed relevance is a theoretical future logistics benefit.

Every source URL is cross-validated against the verified candidate set. Every report contains a concrete operator/dispatcher action. Unknown or undated generic infrastructure material must not be used to fill an edition.

## 8. Publication schedule and preview

- Normal final edition: Friday at **12:00 Europe/Prague**, covering the upcoming Monday–Sunday week.
- The edition is prepared on Thursday and committed with `publishedAt` set to Friday 12:00 Europe/Prague; the site shows it only from that instant. Thursday/Friday-morning retries, the watchdog and a Saturday catch-up are idempotent recovery layers that run only if the final week article is missing.
- Final publication is idempotent; an existing final week file is not automatically overwritten.
- A manually requested **preview** uses the same research, verification, counts, quality gates and article layout, but a separate preview slug. It never consumes or blocks Friday's final slug.
- The final edition is built from the complete monitoring data available at Thursday preparation.

## 9. Article structure

1. SEO title, publication date and covered week.
2. Standfirst / executive summary.
3. Link to the DAJC Driving Bans calendar for general HGV bans.
4. Lead reports (target 20–30), ordered Central Europe first among substantively comparable items, with What changed / Where / When / Impact / Action.
5. Rest of Europe — concise reports (target 10–20).
6. Critical European corridors when materially relevant.
7. 30-day outlook when materially relevant.
8. "What to check before you move" — practical checks for planners and dispatchers.
9. Full source list.
10. Next scheduled publication.

## 10. Editorial test

Every item must answer:

> Why does this matter **now** to someone planning or executing heavy, abnormal, oversized or special transport?

If there is no meaningful current operational answer, exclude it. A newly discovered old page is not news.
