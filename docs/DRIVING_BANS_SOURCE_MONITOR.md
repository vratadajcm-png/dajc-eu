# Driving Bans official-source monitor (18 November 2026)

Implementation map, subordinate to [DRIVING_BANS_CANONICAL.md](DRIVING_BANS_CANONICAL.md).
It describes what is **implemented and tested**, not a completed legal review.

## Pipeline and who decides

| Step | Component | Automatic? |
|---|---|---|
| Official source | `canonical.json` `sources[]` with `role: PRIMARY` (60 of 70) | – |
| Legal retrieval | `safeFetch` (https, allowlisted official hosts, no private IPs, bounded size, manual redirects) or the official RIS OGD document mirror | yes |
| Normalisation | `normalizeDocumentText` (scripts/styles/navigation/whitespace removed; PDFs compared by bytes) | yes |
| Comparison | reviewed `content_sha256` → committed text baseline → previous run (data branch) | yes |
| Legal-change detection | `CHANGED`, `CHANGED_SINCE_LAST_RUN` → `reverification-queue.json` | yes |
| Legal verification and approval | human/legal reviewer (Thursday sweep routine + owner) through the canonical registry PR | **no** |
| Canonical registry → JSON/ICS/web | `getDrivingBansSnapshot()` feeds `/api/driving-bans.json`, `/api/driving-bans.ics` and `/driving-bans` | yes, after merge |

The monitor never edits `canonical.json`, never refreshes `last_verified`,
`last_checked` or a review window, and never produces `NO_BAN`. A failed
retrieval keeps the last reviewed data, which stays visible only within its
reviewed span. `expired_evidence` decreases only after a reviewed canonical
change extends review windows with real primary-source verification.

## Result states

`UNCHANGED` (bytes equal the reviewed hash), `UNCHANGED_TEXT` (only page chrome
differs from a committed baseline that itself repeats the reviewed hash),
`CHANGED` (differs from the reviewed evidence: legal review), `NO_BASELINE`,
`SOURCE_UNAVAILABLE`, `ACCESS_BLOCKED` (bot protection/provider block, never
bypassed; also an HTTP 200 interstitial whose `<title>` or short body is a bot
challenge or WAF rejection), `DEFERRED_PROVIDER_TERMS`, `REJECTED` (unsafe URL/content type).
`SOURCE_UNAVAILABLE`, `ACCESS_BLOCKED`, `DEFERRED_PROVIDER_TERMS` and `REJECTED` never replace the last good
fingerprint (`last_retrieved`); retrieved states (`UNCHANGED`, `UNCHANGED_TEXT`, `CHANGED`, `NO_BASELINE`) become
the next run's comparison point. An interstitial needs short visible text (at most 1,500 characters) and a
challenge title or vendor marker; bytes equal to the reviewed hash are never treated as one. The monitor CLI writes `latest.json`/history only after the report and markdown exist.
`since_last_run` is `FIRST_RUN`, `STABLE` or `CHANGED_SINCE_LAST_RUN`.

Queue kinds: `DATASET_WINDOW_EXPIRED`, `EVIDENCE_UNCHANGED_READY_FOR_LEGAL_REVIEW`
(precondition only; a reviewer still confirms the instrument governs the whole
active window, including unpromulgated annual calendars),
`SOURCE_CHANGED_LEGAL_REVIEW_REQUIRED`, `EVIDENCE_NOT_REFRESHABLE`,
`SOURCE_CONTENT_CHANGED_SINCE_LAST_RUN`.

## Schedule, history and alerts

`.github/workflows/driving-bans-thursday.yml`, job `source-monitor`: Thursday
00:37 UTC and 19:37 UTC (both outside Austrian office hours) plus manual
dispatch. History (`latest.json` and one record per run, hashes and states
only) is persisted on the data branch `automation/driving-bans-monitor`
through `scripts/automation-data.mjs` (main only, non-force push, fixed JSON
paths), only when the monitor succeeded without needing an alert or the alert
step succeeded; a cancelled or skipped monitor never persists, and a partial run
(`--only`, `--max-sources`) is refused with `--state-dir`. Sources that were unavailable,
blocked or deferred keep their last good fingerprint (`last_retrieved`), and a
comparison is made only against the same URL and normaliser version
(`NORMALIZER_VERSION`; normalisation removes only scripts, styles, templates,
comments and markup, never visible form/header/navigation text, and short
texts are compared by bytes). A changed official source, a success rate below
0.6, any failure of the monitor job or a failed Thursday gate adds a new
comment to the single issue `[Driving Bans] monitoring alert` (earlier alerts
are never overwritten). The fetch allowlist contains only PRIMARY source hosts,
configured authority domains and the RIS OGD mirror.
Artifacts: `source-monitor.json`, `source-monitor.md`, `reverification-queue.json`,
`text-baseline.proposed.json` (90 days).

## Provider access, licences and BLOCKED items

| Source/host | Status | Reason / next step |
|---|---|---|
| `ogd.ris.bka.gv.at` (AT) | implemented | Official OGD mirror, CC BY 4.0 (attribution: RIS). Terms read 18 Nov 2026: ≤0.5 req/s, no parallel connections, automated access 20:00–05:00 Vienna or weekends; enforced (`DEFERRED_PROVIDER_TERMS` otherwise). Single manual retrieval on 18 Nov 2026: `at-stvo42` and `at-cal` OGD bytes equal the reviewed hashes; the monitor itself defers RIS during office hours. |
| `www.ris.bka.gv.at` web (6 AT sources without an OGD document URL) | **BLOCKED** | Bot "Security Check" (HTTP 503). Needs the reviewer to record the OGD `Dokumente/...` URL in `retrieval_method`; never bypassed. |
| `legifrance.gouv.fr` (`fr-arrete-hydrocarbures-20260924`) | **BLOCKED** | HTTP 403 to automated clients. The official PISTE API requires an account and acceptance of its terms: `OWNER_DECISION_REQUIRED` before any use. |
| `saarland.de` | **BLOCKED** | HTTP 403 to automated clients (owner rule of 2 Nov 2026). |
| GR FEK blob storage (`gr-fek-912b-2026`) | `REJECTED` | Served as `application/octet-stream`; the shared safe fetcher accepts only declared document types. Follow-up: accept octet-stream only with a verified `%PDF-` signature. |
| Dynamic HTML pages (e.g. BOE, zakonyprolidi, njt.jog.gov.hu) | noisy `CHANGED` | Reviewed raw hashes include page chrome. After a reviewer re-confirms the text, the next run's `STABLE`/`CHANGED_SINCE_LAST_RUN` comparison and a refreshed baseline remove the noise. |
| Paid or licence-restricted providers | not used | No paid integration is enabled by this monitor. |

## Commands

```bash
node scripts/driving-bans-source-monitor.mjs --output artifacts/driving-bans \
  --previous data/driving-bans-monitor/latest.json --state-dir data/driving-bans-monitor [--only AT,DE] [--fail-on-change]
```

Exit 2: official text changed since the last run (with `--fail-on-change`);
exit 3: retrieval success rate below the minimum. Tests:
`src/lib/driving-bans/source-monitor.test.ts`.
