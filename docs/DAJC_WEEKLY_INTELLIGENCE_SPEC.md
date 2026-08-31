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

## 2. Source discovery

- RSS/Atom is **not** complete coverage and must never be the only discovery channel.
- For every configured authority, the monitor checks available RSS/Atom **and** official HTML/news/traffic/legislation pages.
- Feed and web results are merged, detail pages are enriched, and results are deduplicated by official source URL.
- Primary/official sources are required for permits, legal rules, escorts, route/weight/dimension limits and other high-impact regulatory claims whenever available.
- Generic landing pages, image-only URLs, stale archive pages, unrelated permits/administration and non-operational statistics are excluded.

## 3. Publication format — hard counts

A publishable normal weekly edition contains:

- **20–30 substantive lead reports. Minimum: 20. Maximum: 30.**
- **Rest of Europe: 10–20 concise short updates. Minimum: 10.**
- Rest of Europe must span **at least 6 distinct countries/territories/jurisdictions**.

These are hard quality gates. Never satisfy them with filler. If fewer than 20 genuine lead topics or fewer than 10 genuine roundup items / 6 jurisdictions survive verification, the run fails instead of padding the article.

The Rest-of-Europe items are deliberately short: country/jurisdiction, what changed, where/when relevant, operator action and official source.

## 4. Critical-news floor

Fresh verified high-signal changes directly affecting exceptional/oversized transport are **required coverage**, including:

- permit rules or permit systems,
- private/police escort rules,
- exceptional-transport movement conditions,
- border/transit restrictions,
- weight/width/height/axle limits,
- route authorisations,
- directly relevant toll/digital procedures.

Required critical items are reserved before normal shortlist ranking. If a verified critical source is absent from both lead reports and Rest of Europe, publication is blocked.

The Swiss ASTRA exceptional-transport/private-escort change identified in August 2026 is the reference incident this rule is designed to prevent from recurring.

## 5. Driving-ban rule from 1 September 2026

Do **not** repeat unchanged year-round Sunday/weekend bans.

Publish a driving-ban item only when it is new, changed, seasonal, holiday-specific, exceptional/emergency/weather-related, regionally temporary, changes times/vehicle scope/exemptions/enforcement, or has a specific abnormal/oversize consequence.

A routine Sunday rule may only be mentioned when necessary to explain a material interaction with a current change.

## 6. Road/motorway closure rule

A road or motorway closure is publishable only when official evidence proves a **planned duration longer than 30 days**.

- Exactly 30 days: exclude.
- Shorter than 30 days: exclude.
- Unknown/undated duration: exclude.
- No "important corridor" exception to this duration rule.

Other non-closure restrictions such as weight, width, height, axle, permit, escort or route-authorisation changes are evaluated on their own operational significance and are not subject to the 30-day closure threshold.

## 7. Relevance and verification

Every published item must demonstrably relate to heavy, abnormal, oversized or special road transport, freight routing, relevant tolling, vehicle/route limits, escorts, borders, ports/ferries/project cargo, heavy-haul equipment, or another directly operational DAJC intelligence topic.

Exclude:
- driver-licence/auto-school administration,
- environmental/water-law permits unrelated to transport,
- crime/theft/accident/breakdown incidents,
- procurement/tender noise,
- generic authority pages,
- toll revenue/statistics without an operational rule change,
- stale historical archive material,
- ordinary short roadworks/closures.

Every source URL is cross-validated against the verified candidate set. Every report contains a concrete operator/dispatcher action.

## 8. Publication schedule and preview

- Normal final edition: Friday at **12:00 Europe/Prague**, covering the upcoming Monday–Sunday week.
- Saturday catch-up runs only if the final week article is missing.
- Final publication is idempotent; an existing final week file is not automatically overwritten.
- A manually requested **preview** uses the same research, verification, counts, quality gates and article layout, but a separate preview slug. It never consumes or blocks Friday's final slug.
- Friday's final edition is always rebuilt from the complete monitoring data available by Friday.

## 9. Article structure

1. SEO title, publication date and covered week.
2. Standfirst / executive summary.
3. 20–30 substantive lead reports with What changed / Where / When / Impact / Action.
4. Rest of Europe — minimum 10 concise reports from minimum 6 jurisdictions.
5. Critical European corridors when materially relevant.
6. 30-day outlook when materially relevant.
7. Dispatcher/operator checklist.
8. Full source list.
9. Next scheduled publication.

## 10. Editorial test

Every item must answer:

> Why does this matter to someone planning or executing heavy, abnormal, oversized or special transport?

If there is no meaningful answer, exclude it.
