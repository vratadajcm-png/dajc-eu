# Driving Bans contract-test migration

The first real Application/News CI runs found a page type error, an endpoint request-context mismatch, 25 legacy-calendar contract checks and a weekly-news coupling regression. The page type was fixed separately. This change fixes the request boundary and prevents incomplete country reviews from crashing unrelated news generation; warnings and incomplete status remain explicit, and a genuinely broken resolver still raises a maintenance error.

The original Driving Bans tests are retained under docs/driving-bans-legacy, not silently erased. Their assumptions conflict with the new authorized contract: a 13-month feed; warning pseudo-VEVENTs; old curated seeds accepted as fresh verification; unrestricted extrapolation to 2031; and exception-only records treated as bans. The active tests now exercise the canonical contract, historical evidence fixtures, unknown-country fail-closed behavior, precise event times, real recurrence/lifecycle IDs, input validation and separation of weekly news from the dedicated HGV reference. No tests are skipped or marked todo to obtain a passing result.

vitest.config.ts explicitly includes the new 48-case canonical suite, which the previous include pattern did not discover. The existing portal/config/news suites remain enabled. src/portal/__tests__/driving-bans-feed.test.ts tests only the DAJC.eu public endpoint; no DAJC Platform application functionality is changed.

A passing test suite does NOT certify complete legal coverage. All 104 jurisdiction-wide reviews remain incomplete at this migration.
