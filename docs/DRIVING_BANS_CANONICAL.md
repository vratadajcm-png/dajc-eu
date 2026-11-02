# DAJC Driving Bans — canonical contract and unfinished review

Scope: dajc.eu only. This repair is NOT a claim that the central-registry legal review is complete.

## Single runtime authority

Edit `data/driving-bans/canonical.json`. Its sources, profiles, rules and jurisdiction reviews are one maintained dataset. Active identity is taken from `config/europe-coverage.mjs` (50 approved codes) and matched with Change Register Coverage. Never invent identities. Regional reorganization retains exact territorial applicability; see `GEOGRAPHIC_COVERAGE_MIGRATION.md`.

`config/driving-ban-calendars/canonical.mjs` hydrates explicit UNKNOWN/UNVERIFIED records for missing reviews and validates the dataset. `runtime.mjs` and `index.mjs` are compatibility exports, not independent data. Web, JSON, ICS and Intelligence consume this boundary. Retired source files are retained under `docs/driving-bans-legacy` for historical review only. `tests/fixtures` is an immutable regression fixture, never a runtime input.

The public period is the CURRENT whole calendar month plus NEXT whole calendar month, chosen in Europe/Prague. `window` in the dataset is the *reviewed span*; it may be longer than the public period (the 26 September 2026 sweep reviewed 1 September-30 November so that the 1 October rollover stays verified). A jurisdiction keeps its verification only while the reviewed span fully contains the active public period; otherwise it is shown UNVERIFIED with `ACTIVE_WINDOW_NOT_REVERIFIED`. Event times use the actual jurisdiction IANA timezone and are converted to UTC for ICS. Default ICS contains ongoing/future real events; `history=1` includes ended events within the same publication window. A carry-in or overnight spill-out is preserved as a real interval. An empty calendar is never NO_BAN evidence. NO_BAN and warnings do not create VEVENTs.

`weight_threshold` records the exact legal applicability: `any_of` / `all_of` groups; numeric leaves in `kg`, `m` or `axles`; `{"operator": "any"}` for a category with no mass threshold (for example tractors in CH/LI or any trailer behind a truck in DE). Never approximate a criterion with an invented number, and never rewrite >3.5t, >12t or axle/height criteria as >7.5t.

## Evidence and publication gates

TRACKED != VERIFIED. UNKNOWN, UNVERIFIED and SOURCE_UNAVAILABLE never become NO_BAN. Whole-jurisdiction verification is separate from individual verified rules. Complete jurisdiction coverage and NO_BAN require PRIMARY_VERIFIED evidence for all 12 scope checks, the entire window, primary source IDs, verification date and an explicit reviewed NO_BAN finding where applicable. Refresh the complete period at month rollover; never roll an old NO_BAN forward.

Maintain exact weight operators, kg thresholds and vehicle categories, roads/regions/direction, times, exceptions, ADR/special-transport scope, rule/source versions, legal validity, cancellation/supersession, immutable ban/occurrence IDs and increasing sequence on corrections. A lost source revokes current trust but is NOT a legal cancellation. Unchanged timestamps or an HTTP 200 response are not semantic legal proof.

## State after the 26 September 2026 sweep (dataset 2026-09-26.r2-sweep)

Reviewed span 2026-09-01..2026-11-30. Historical pre-delta assessment: 50 retained jurisdictions; 12 jurisdictions fully PRIMARY_VERIFIED for all 12 scope checks (CH, CZ, DE, FR, HR, HU, IT, LI, LU, PL, SI, SK); 18 HAS_BAN (the 12 plus AT, BG, ES, GR, ME, PT with individually verified rules but incomplete jurisdiction scope); 0 NO_BAN; 32 UNKNOWN/UNVERIFIED with explicit `coverage_failures`. No NO_BAN was set because no jurisdiction had an explicit primary statement covering all 12 scope checks; absence of search results is never used.

Corrected errors: AT 26 October holiday missing and Tyrol A12 IG-L night ban missing; LI 8 September (Maria Geburt) missing; LU France-bound 11 November added; ES held only 14 of the Annex II rows (6 September, full 8-12 October, 30 October-2 November and 27-29 November tables now encoded, GP Valencia moved per BOE-A-2026-13892, legacy rows SUPERSEDED); BG 18 and 22 September Independence Day restrictions missing. Newly encoded from primary law: DE, FR (incl. Ile-de-France), IT, CH, CZ, SK (2026: 1 Sep, 15 Sep, 28 Oct, 17 Nov are NOT days of rest), PL (>12t), HU, SI, HR, PT (Porto VCI from 15 Sep 2026, >3.5t with >=3 axles and >=1.1 m height), GR (>3.5t, ΦΕΚ Β΄ 912/2026).

Open items are listed per jurisdiction in `coverage_failures` (e.g. AT Laender secondary-road orders, ES Annex V exceptional/ADR events, GR permanent 2017 network decision, BG ad-hoc orders, RO CNAIR texts, Catalonia/Basque Country resolutions under ES; overseas territories are excluded from monitoring). `regional` scope means statutory national/regional calendars; individually signposted local restrictions are not enumerated and are stated as such.

## Delta of 1 October 2026 (dataset 2026-10-01.r3-fr-de-delta)

Rollover to the 1 October-30 November window; the 26 September reviewed span (1 Sep-30 Nov) still contains it. Stored reviews: 11 PRIMARY_VERIFIED / 93 UNVERIFIED; 18 HAS_BAN / 0 NO_BAN / 86 UNKNOWN. In the active window BG has no verified event (its reviewed bans were 18 and 22 September), so the runtime shows 17 HAS_BAN / 87 UNKNOWN.

FR: Arrêté du 24 septembre 2026 (NOR TRAT2625304A, JORF 25 September) lifts the bans of articles 1-3 of the 16 April 2021 arrêté, incl. Île-de-France, until 12 October 2026 10:00 only for >7.5t vehicles supplying hydrocarbon products to service stations and their empty return. Encoded as an exception; ban events are unchanged and FR stays fully verified.

DE: temporary Länder low-water exemptions (targeted review 30 September, NRW rechecked 1 October): BW, RP and NRW through 31 October; BE/BB ended 30 September; RP GST/44t easing not restated after 30 September; Saarland only secondarily reported. Federal §30 StVO events stay published; DE is downgraded from full PRIMARY_VERIFIED with explicit `coverage_failures`.

## Priority review of 27 October 2026 (dataset 2026-10-27.r4-nov-dec-priority.geo50)

Reviewed span extended to 1 September-31 December 2026 for the November-December public window. Not a full-registry sweep (`review_log[].full_registry_sweep: false`). Evidence log with URL, HTTP status, SHA-256 and retrieval time per document: `data/driving-bans/source-reviews/2026-10-27-nov-dec.json`; human summary and the 50-jurisdiction matrix: `DRIVING_BANS_NOV_DEC_2026_REVIEW.md`.

Full-scope primary review through 31 December: CH, CZ, FR, HR, HU, IT, LI, LU, PL, SI, SK (11 complete at 1 November). Individual rules only, jurisdiction stays incomplete: AT (StVO §42 in the BGBl. I 17/2026 version, holidays, night, A12 IG-L winter regime) and DE (§30 StVO 25-26 December; Länder low-water exemptions after 31 October unconfirmed). The other 37 identities carry `NOV_DEC_2026_PRIORITY_REVIEW_NOT_PERFORMED` and publish no December events because their rules keep a 30 November review window.

Legal edge cases encoded from the text: CH 26 December is no ban day when Christmas is a Friday (VRV Art. 91(1)); PL 24 December is a day off since 2025 but not a ban day and has no eve restriction; SK Sundays are days of rest, so the 24-27 December block ends on Sunday; HU bans continuously from 24 December 22:00 to 27 December 22:00; HR moves the last-holiday-day restriction to Sunday 27 December 12:00-23:00; A12 holiday nights start at 23:00.

Corrected defects: LI, LU and AT weekend/night rules had published windows ending 31 October although the law applies all year; extended with an increased `sequence`. AT weekend exceptions updated to the current §42(2a), (3) and (3a). Sources now carry `content_sha256` of the retrieved document.

## Thursday operation and urgent exceptions

The existing DAJC Daily Intelligence automation owns the semantic review. Its HGV branch is Thursday-only, Europe/Prague; other daily DAJC topics are unchanged. Each Thursday it must read all identities from the shared registry, determine the full two-month window, review current primary legislation/amendments and relevant secondary sources, update canonical reviews/rules with evidence, compare old/new states, run all quality gates, prepare supported changes for review; publishing and deployment require explicit approval. Outside Thursday only a sourced urgent recheck of one already-published jurisdiction/rule is allowed.

The scheduled Claude routine "DAJC HGV Driving Bans Thursday sweep" (Thursday 06:47 Europe/Prague) performs the semantic sweep on this repository and pushes a reviewed branch; `.github/workflows/driving-bans-thursday.yml` then runs on Thursday as a technical gate (`--mode full --max-sweep-age-days 8`) and fails when the reviewed span no longer contains the active window or the last sweep is stale. `assertSweepRequest` enforces those scope/day rules. `npm run driving-bans:audit -- --mode full` exports the Thursday work/evidence manifest; it DOES NOT fetch or interpret external sources and must never be reported as a completed legal sweep. `--mode urgent --jurisdiction CODE --published-ban-id ID --urgent-source HTTPS_URL` validates targeted scope. Default `--mode validate` is a technical CI check, not a full sweep, and may run any day. `--previous path/to/previous-canonical.json` produces deterministic changes without duplicate no-op entries. `--require-complete` fails when the legal coverage remains incomplete.

## Quality and deployment

Run `npm run lint:driving-bans`, `npm run typecheck`, `npm test`, `npm run build`, and `npm run driving-bans:audit`. Application CI includes data/tests/script paths and uploads reproducible evidence. The scoped lint checks syntax, real production provenance and canonical import boundaries; no repository-wide ESLint setup is claimed.

A green build permits a fail-closed technical release with visible UNKNOWN coverage, not a claim of complete source verification. Never merge a failing build. After release compare live `/driving-bans`, `/api/driving-bans.json`, `/api/driving-bans.ics`, dataset version, all current registry identities and actual UIDs/UTC times. Confirm unrelated homepage/news pages remain reachable. Update HGV-specific Change Register fields without overwriting unrelated topic coverage; preserve history and use a single deduplicated change record for this migration.

## Geographic migration (22 October 2026)

The active scope is the 50-code central registry. See `GEOGRAPHIC_COVERAGE_MIGRATION.md` for the exact retained/removed identities, backup, regional semantics and rollout boundary. The migration does not refresh legal review dates. At the pinned audit clock 2026-10-22 10:00 UTC: 17 HAS_BAN, 0 NO_BAN, 33 UNKNOWN, 11 full-scope verification records; the freshness gate still fails because the evidence is stale.

## Official web checks and road scope (22 October 2026 follow-up)

AT, DE, ES, BE, UK and PT must be checked on official legislation, road-authority,
ministry and police websites. The same primary-evidence standard remains applicable
to the other tracked countries. Associations and press reports are discovery leads.
`config/driving-ban-calendars/verification.mjs` generates the full work plan from the
central registry and current+next month, using official source seeds from the
targeted evidence log `data/driving-bans/source-reviews/2026-10-22.json`.
The technical audit exports `verification-plan.json` and `targeted-source-review.json`.
Neither this export nor a targeted check refreshes the full-sweep timestamp.

KZ/RU/TR monitor motorways and main roads in the approved European and connecting
international freight scope, including bridges, tunnels and border sections on
those roads. Keep a sourced road identifier/section and category (`motorway` or
`main_road`); local/secondary roads do not become additional monitoring coverage.
National laws are relevant where they apply to this network. A source reviewer
records the applicability; the user's approval of road categories is not evidence
for an individual prohibition. Findings carry `corridorEvidence.roadClass` and
`roadOrSection`; calendar rules carry `corridor_scope.road_classes` and `roads`.

See `DRIVING_BANS_OFFICIAL_WEB_REVIEW.md` for the targeted findings and remaining
work. These observations have not been converted into executable calendar events;
the existing 182 rules and their legal-verification timestamps are preserved.
