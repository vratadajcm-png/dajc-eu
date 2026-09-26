# DAJC Driving Bans — canonical contract and unfinished review

Scope: dajc.eu only. This repair is NOT a claim that the 104-jurisdiction legal review is complete.

## Single runtime authority

Edit `data/driving-bans/canonical.json`. Its sources, profiles, rules and jurisdiction reviews are one maintained dataset. Identity is taken, unchanged, from `config/europe-coverage.mjs` (104, matched with Change Register Coverage) minus the owner-approved exclusions in `config/driving-ban-calendars/scope.mjs` (28 overseas, remote or disputed territories without a verifiable primary source; decision of 26 September 2026). Driving Bans therefore tracks 76 identities. An exclusion is NOT a NO_BAN finding: no status is published for those territories, the page lists them separately, and ICS rejects them. Re-adding one means removing it from the exclusion list and giving it a review. Never invent or silently merge identities.

`config/driving-ban-calendars/canonical.mjs` hydrates explicit UNKNOWN/UNVERIFIED records for missing reviews and validates the dataset. `runtime.mjs` and `index.mjs` are compatibility exports, not independent data. Web, JSON, ICS and Intelligence consume this boundary. Retired source files are retained under `docs/driving-bans-legacy` for historical review only. `tests/fixtures` is an immutable regression fixture, never a runtime input.

The public period is the CURRENT whole calendar month plus NEXT whole calendar month, chosen in Europe/Prague. `window` in the dataset is the *reviewed span*; it may be longer than the public period (the 26 September 2026 sweep reviewed 1 September-30 November so that the 1 October rollover stays verified). A jurisdiction keeps its verification only while the reviewed span fully contains the active public period; otherwise it is shown UNVERIFIED with `ACTIVE_WINDOW_NOT_REVERIFIED`. Event times use the actual jurisdiction IANA timezone and are converted to UTC for ICS. Default ICS contains ongoing/future real events; `history=1` includes ended events within the same publication window. A carry-in or overnight spill-out is preserved as a real interval. An empty calendar is never NO_BAN evidence. NO_BAN and warnings do not create VEVENTs.

`weight_threshold` records the exact legal applicability: `any_of` / `all_of` groups; numeric leaves in `kg`, `m` or `axles`; `{"operator": "any"}` for a category with no mass threshold (for example tractors in CH/LI or any trailer behind a truck in DE). Never approximate a criterion with an invented number, and never rewrite >3.5t, >12t or axle/height criteria as >7.5t.

## Evidence and publication gates

TRACKED != VERIFIED. UNKNOWN, UNVERIFIED and SOURCE_UNAVAILABLE never become NO_BAN. Whole-jurisdiction verification is separate from individual verified rules. Complete jurisdiction coverage and NO_BAN require PRIMARY_VERIFIED evidence for all 12 scope checks, the entire window, primary source IDs, verification date and an explicit reviewed NO_BAN finding where applicable. Refresh the complete period at month rollover; never roll an old NO_BAN forward.

Maintain exact weight operators, kg thresholds and vehicle categories, roads/regions/direction, times, exceptions, ADR/special-transport scope, rule/source versions, legal validity, cancellation/supersession, immutable ban/occurrence IDs and increasing sequence on corrections. A lost source revokes current trust but is NOT a legal cancellation. Unchanged timestamps or an HTTP 200 response are not semantic legal proof.

## State after the 26 September 2026 sweep (dataset 2026-09-26.r2-sweep)

Reviewed span 2026-09-01..2026-11-30. After the scope decision 76 tracked (104 Coverage minus 28 exclusions); 12 jurisdictions fully PRIMARY_VERIFIED for all 12 scope checks (CH, CZ, DE, FR, HR, HU, IT, LI, LU, PL, SI, SK); 18 HAS_BAN (the 12 plus AT, BG, ES, GR, ME, PT with individually verified rules but incomplete jurisdiction scope); 0 NO_BAN; 58 UNKNOWN/UNVERIFIED with explicit `coverage_failures`. No NO_BAN was set because no jurisdiction had an explicit primary statement covering all 12 scope checks; absence of search results is never used.

Corrected errors: AT 26 October holiday missing and Tyrol A12 IG-L night ban missing; LI 8 September (Maria Geburt) missing; LU France-bound 11 November added; ES held only 14 of the Annex II rows (6 September, full 8-12 October, 30 October-2 November and 27-29 November tables now encoded, GP Valencia moved per BOE-A-2026-13892, legacy rows SUPERSEDED); BG 18 and 22 September Independence Day restrictions missing. Newly encoded from primary law: DE, FR (incl. Ile-de-France), IT, CH, CZ, SK (2026: 1 Sep, 15 Sep, 28 Oct, 17 Nov are NOT days of rest), PL (>12t), HU, SI, HR, PT (Porto VCI from 15 Sep 2026, >3.5t with >=3 axles and >=1.1 m height), GR (>3.5t, ΦΕΚ Β΄ 912/2026).

Open items are listed per jurisdiction in `coverage_failures` (e.g. AT Laender secondary-road orders, ES Annex V exceptional/ADR events, GR permanent 2017 network decision, BG ad-hoc orders, RO CNAIR texts, CAT/BAS own resolutions, French overseas application). `regional` scope means statutory national/regional calendars; individually signposted local restrictions are not enumerated and are stated as such.

## Thursday operation and urgent exceptions

The existing DAJC Daily Intelligence automation owns the semantic review. Its HGV branch is Thursday-only, Europe/Prague; other daily DAJC topics are unchanged. Each Thursday it must read all 104 identities, determine the full two-month window, review current primary legislation/amendments and relevant secondary sources, update canonical reviews/rules with evidence, compare old/new states, run all quality gates, publish only supported changes and verify deployment. Outside Thursday only a sourced urgent recheck of one already-published jurisdiction/rule is allowed.

The scheduled Claude routine "DAJC HGV Driving Bans Thursday sweep" (Thursday 06:47 Europe/Prague) performs the semantic sweep on this repository and pushes a reviewed branch; `.github/workflows/driving-bans-thursday.yml` then runs on Thursday as a technical gate (`--mode full --max-sweep-age-days 8`) and fails when the reviewed span no longer contains the active window or the last sweep is stale. `assertSweepRequest` enforces those scope/day rules. `npm run driving-bans:audit -- --mode full` exports the Thursday work/evidence manifest; it DOES NOT fetch or interpret external sources and must never be reported as a completed legal sweep. `--mode urgent --jurisdiction CODE --published-ban-id ID --urgent-source HTTPS_URL` validates targeted scope. Default `--mode validate` is a technical CI check, not a full sweep, and may run any day. `--previous path/to/previous-canonical.json` produces deterministic changes without duplicate no-op entries. `--require-complete` fails when the legal coverage remains incomplete.

## Quality and deployment

Run `npm run lint:driving-bans`, `npm run typecheck`, `npm test`, `npm run build`, and `npm run driving-bans:audit`. Application CI includes data/tests/script paths and uploads reproducible evidence. The scoped lint checks syntax, real production provenance and canonical import boundaries; no repository-wide ESLint setup is claimed.

A green build permits a fail-closed technical release with visible UNKNOWN coverage, not a claim of complete source verification. Never merge a failing build. After release compare live `/driving-bans`, `/api/driving-bans.json`, `/api/driving-bans.ics`, dataset version, all 104 identities and actual UIDs/UTC times. Confirm unrelated homepage/news pages remain reachable. Update HGV-specific Change Register fields without overwriting unrelated topic coverage; preserve history and use a single deduplicated change record for this migration.
