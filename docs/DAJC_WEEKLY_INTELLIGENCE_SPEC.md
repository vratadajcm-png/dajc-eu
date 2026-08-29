# DAJC European Oversize & Special Transport Intelligence — production rules

This document is the editorial/automation contract for the weekly DAJC.eu European oversize intelligence publication.

## Coverage

- Research/audit scope: the complete `config/europe-coverage.mjs` matrix (85 states, territories and transport-relevant jurisdictions).
- The absence of a jurisdiction from the article must never mean it was silently skipped.
- `data/oversize/<ISO-WEEK>/coverage.json` records the weekly status for every jurisdiction.
- A source failure must remain visible as `checked-source-availability-limited`; it must never be silently converted to `no change`.

## Publication schedule

- Primary publication: Friday 12:00 Europe/Prague (DST-safe dual UTC cron with timezone gate).
- Catch-up: Saturday if the target article is missing.
- Publication is idempotent: an existing week file is never overwritten automatically.
- The Friday edition is generated for the upcoming Monday–Sunday week.

## Editorial selection

- Target: normally 20–30 substantive lead developments when enough verified material exists.
- Around Europe: normally 10–20 additional useful short updates, preferably spanning at least six jurisdictions when the evidence supports it.
- Never pad to a target count.
- Do not stop research because enough stories have been found.
- Operational significance outranks country size or English-language source availability.

## Driving-ban rule

Do **not** repeat unchanged year-round Sunday bans.

A driving-ban item is publishable when it is new, changed, seasonal, holiday-specific, exceptional/emergency/weather-related, regionally temporary, changes the time/vehicle scope or exemptions, introduces enforcement, or has a specific abnormal/oversize consequence.

A normal Sunday ban may be mentioned only to explain a material interaction with another current change.

## Infrastructure rule

Do not repeat the same unchanged long-term closure every week. Re-report it only when it begins, changes, is extended, ends, changes the authorised route/diversion, changes dimensional/weight capacity, or materially changes operational impact.

Ordinary short roadworks are normally excluded unless they critically affect abnormal transport. As a rule of thumb, generic road closures should normally last more than 30 days to qualify unless they affect an important abnormal-load corridor or create exceptional width/height/weight/manoeuvring consequences.

## Verification

- Primary/official sources are preferred for permits, bans, legal rules, escorts, bridges/tunnels and route restrictions.
- Secondary sources are mainly discovery sources.
- Never infer that a general HGV restriction automatically applies to abnormal transport.
- Never infer that a general exemption automatically applies to abnormal transport.
- Use exact dates and local times.
- Every item must contain a concrete operational impact and action.
- Every generated source URL is cross-validated against the verified candidate set before publication.

## Article structure

Publication-ready English article containing:

1. SEO title, exact publication date and covered week.
2. Standfirst / executive summary.
3. Top developments.
4. Individual main reports with Where / When / What changed / Impact / Action.
5. Around Europe — Short Updates.
6. Critical European Corridors when materially relevant.
7. What Changes Next — 30-Day Outlook.
8. Practical dispatcher/driver checklist.
9. Source list.

## Editorial test

Every published item must answer:

> Why does this matter to someone planning or executing heavy, abnormal, oversized or special transport in Europe?

If there is no meaningful answer, exclude it.
