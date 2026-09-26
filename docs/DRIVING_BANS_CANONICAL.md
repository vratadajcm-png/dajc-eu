# DAJC Driving Bans — canonical contract and unfinished review

Scope: dajc.eu only. This repair is NOT a claim that the 104-jurisdiction legal review is complete.

## Single runtime authority

Edit `data/driving-bans/canonical.json`. Its sources, profiles, rules and jurisdiction reviews are one maintained dataset. Identity is taken, unchanged, from `config/europe-coverage.mjs` (104) and matched with Change Register Coverage. Never invent or silently merge its identities.

`config/driving-ban-calendars/canonical.mjs` hydrates explicit UNKNOWN/UNVERIFIED records for missing reviews and validates the dataset. `runtime.mjs` and `index.mjs` are compatibility exports, not independent data. Web, JSON, ICS and Intelligence consume this boundary. Retired source files are retained under `docs/driving-bans-legacy` for historical review only. `tests/fixtures` is an immutable regression fixture, never a runtime input.

The public period is the CURRENT whole calendar month plus NEXT whole calendar month, chosen in Europe/Prague. Event times use the actual jurisdiction IANA timezone and are converted to UTC for ICS. Default ICS contains ongoing/future real events; `history=1` includes ended events within the same publication window. A carry-in or overnight spill-out is preserved as a real interval. An empty calendar is never NO_BAN evidence. NO_BAN and warnings do not create VEVENTs.

## Evidence and publication gates

TRACKED != VERIFIED. UNKNOWN, UNVERIFIED and SOURCE_UNAVAILABLE never become NO_BAN. Whole-jurisdiction verification is separate from individual verified rules. Complete jurisdiction coverage and NO_BAN require PRIMARY_VERIFIED evidence for all 12 scope checks, the entire window, primary source IDs, verification date and an explicit reviewed NO_BAN finding where applicable. Refresh the complete period at month rollover; never roll an old NO_BAN forward.

Maintain exact weight operators, kg thresholds and vehicle categories, roads/regions/direction, times, exceptions, ADR/special-transport scope, rule/source versions, legal validity, cancellation/supersession, immutable ban/occurrence IDs and increasing sequence on corrections. A lost source revokes current trust but is NOT a legal cancellation. Unchanged timestamps or an HTTP 200 response are not semantic legal proof.

## Known unfinished work at initial migration (26 September 2026)

104 tracked; 0 fully primary-verified jurisdictions; 0 verified NO_BAN; 6 with individually verified bans (AT, LI, LU, ME, ES, BG); remaining 98 UNKNOWN. All 104 have incomplete full-scope verification. The authoritative complete list and per-row evidence/gaps are exported by `npm run driving-bans:audit`.

AT still needs full holidays and regional/night/environmental/secondary-road scope; LI full holiday enumeration and local/special scope; LU all applicable holiday/directional exemptions and special scope; ME complete regional and special-transport scope; ES full Annex II/Annex V and independent regional authority calendars, not just the encoded October rows; BG full September/October orders, seasonal/regional limits and exact road-specific exceptions. The remaining 98 require individual primary-source investigation; no primary checks are claimed for them.

RIS and the API/BTA source were partly reviewed through indexed official text when direct retrieval failed; this retrieval method is recorded, not disguised as a successful direct download. TrafficBan and WKO checks are recorded. The older May Montenegro report loses to the June replacement order. CESMAD public summaries/handbook were located, but member-only country detail was not accessed; full secondary cross-check remains open. No purchase or access-control bypass was performed.

## Thursday operation and urgent exceptions

The existing DAJC Daily Intelligence automation owns the semantic review. Its HGV branch is Thursday-only, Europe/Prague; other daily DAJC topics are unchanged. Each Thursday it must read all 104 identities, determine the full two-month window, review current primary legislation/amendments and relevant secondary sources, update canonical reviews/rules with evidence, compare old/new states, run all quality gates, publish only supported changes and verify deployment. Outside Thursday only a sourced urgent recheck of one already-published jurisdiction/rule is allowed.

`assertSweepRequest` enforces those scope/day rules. `npm run driving-bans:audit -- --mode full` exports the Thursday work/evidence manifest; it DOES NOT fetch or interpret external sources and must never be reported as a completed legal sweep. `--mode urgent --jurisdiction CODE --published-ban-id ID --urgent-source HTTPS_URL` validates targeted scope. Default `--mode validate` is a technical CI check, not a full sweep, and may run any day. `--previous path/to/previous-canonical.json` produces deterministic changes without duplicate no-op entries. `--require-complete` fails when the legal coverage remains incomplete.

## Quality and deployment

Run `npm run lint:driving-bans`, `npm run typecheck`, `npm test`, `npm run build`, and `npm run driving-bans:audit`. Application CI includes data/tests/script paths and uploads reproducible evidence. The scoped lint checks syntax, real production provenance and canonical import boundaries; no repository-wide ESLint setup is claimed.

A green build permits a fail-closed technical release with visible UNKNOWN coverage, not a claim of complete source verification. Never merge a failing build. After release compare live `/driving-bans`, `/api/driving-bans.json`, `/api/driving-bans.ics`, dataset version, all 104 identities and actual UIDs/UTC times. Confirm unrelated homepage/news pages remain reachable. Update HGV-specific Change Register fields without overwriting unrelated topic coverage; preserve history and use a single deduplicated change record for this migration.
