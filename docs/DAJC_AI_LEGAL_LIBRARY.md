# DAJC AI — European library of official legal documents (knowledge base)

Status on 2026-11-09. The library is **off** by default (`DAJC_KB_ENABLED`);
paid features, payments and ABRA are not involved. Since 2026-11-09 a document
version no longer needs a person's approval: it becomes **AI_VERIFIED** through
the automated verification of § 2b (owner decision). AI_VERIFIED is never a
human, official or legally binding approval.

Principle: **the existence of an official document does not by itself mean a
correct legal interpretation.** The library supplies verifiable passages with
article and page; the existing DAJC AI pipeline builds the answer from them with
its deterministic and independent checks. This does not eliminate
hallucinations; it reduces their risk and makes them measurable
(`dajc_ask.metrics`, distribution of answer levels).

## 1. Architecture

```
official source (EUR-Lex, law gazette, ministry …)   ← registered domains only, HTTPS also after redirects
        │  scripts/kb-import.mjs  (manifest: metadata, validity and the date it was checked)
        ▼
archive of originals (archive.mjs)       catalogue + index (Neon, schema dajc_kb)
  local:<dir> | S3-compatible              documents → document_versions (URL, SHA-256, validity, provenance)
  (Cloudflare R2 EU / AWS S3 …)            → pages (text per page) → provisions (article/§/annex, pages,
  key = <country>/<document>/<lang>/<sha256>  tsvector, mass band)
        │                                          │ view answerable_provisions (valid and checked only)
        │                                          ▼
        └──────── scripts/kb-review.mjs ──► DAJC AI (src/lib/ask/library.ts → pipeline)
                  (person: HUMAN_VERIFIED / REJECTED)   exact full text → citation → guard → independent check
```

| Layer | File | Note |
|---|---|---|
| Vocabulary (topics, categories, thresholds, applicability) | `src/lib/kb/taxonomy.mjs` | 12 topics, oversize transport first |
| Registry of legal sources | `src/lib/kb/legal-sources.mjs` | country × topics × categories, reuse terms, what was verified |
| Archive | `src/lib/kb/archive.mjs` | memory, local directory, S3-compatible (SigV4 per the AWS test suite) |
| PDF | `src/lib/kb/pdf-text.mjs` | pdf.js without eval/fonts/scripting, size, page and time limits |
| Provisions | `src/lib/kb/provisions.mjs` | anchors on their own line, references never split, headers and EUR-Lex markers removed |
| Import and human review | `src/lib/kb/importer.mjs`, `scripts/kb-import.mjs`, `scripts/kb-review.mjs` | one transaction, nothing is deleted; import and review are separate roles (§ 2a) |
| Connection safety | `src/lib/kb/db-guard.mjs` | masks and redacts connection strings; refuses a wrong role or branch |
| Verification | `src/lib/kb/verify.mjs`, `scripts/kb-verify.mjs`, `config/legal-library/verification.json` | read-only check of every imported version (§ 5a) |
| Search | `src/lib/kb/search.mjs`, `scripts/kb-search.mjs` | exact full text + filters; vectors only later, as candidate proposals |
| DAJC AI integration | `src/lib/ask/library.ts`, `pipeline.ts` | before the paid web search; not for driving bans |
| Schema and permissions | `drizzle-kb/0000_dajc_kb_library.sql`, `drizzle-kb/0001_dajc_kb_import_review_separation.sql` | own migration history, no collision with #102 |
| Import into Neon `dev` | `.github/workflows/kb-import-dev.yml` | started only by the owner (label `kb-import-dev`) and approved by the owner (GitHub environment `kb-import-dev`) |

Moving between stores (R2 ↔ S3 ↔ another S3-compatible service) only changes
`DAJC_KB_ARCHIVE` and `DAJC_KB_S3_*`. Object keys are content-addressed, so
objects can be copied unchanged.

**Cloudflare R2 is a proposal only.** No bucket or account was created. Before
deployment: the owner's approval, a Cloudflare account and the EU jurisdiction
(endpoint `https://<account>.eu.r2.cloudflarestorage.com`).

## 2. Record of every document

| Requirement | Where |
|---|---|
| title, country, issuing body, legal category | `documents` (+ localised version title in `version_label`) |
| original official URL | `document_versions.official_url` |
| issue, entry into force, repeal / replacement | `issued_on`, `effective_from`, `effective_to`, `superseded_by`, `validity` |
| date of last verification | `validity_checked_on`, `last_verified_at`, `verified_by`; evidence in `notes` (URL of the status at the publisher) |
| language and version | `language`, `version_label` |
| SHA-256 | `sha256` (also in the archive key; the archive checks content on read) |
| check of provenance and validity | `provenance` UNVERIFIED → AUTO_CHECKED → HUMAN_VERIFIED / REJECTED, `review_log` |
| authenticity | `authenticity` (e.g. an EUR-Lex consolidated text = documentation tool) |
| terms of download, storage, use | `reuse_status` (from the source); an import with UNKNOWN/RESTRICTED stops before downloading |
| link to articles, annexes and pages | `provisions` (anchor type and number, `page_from`–`page_to`), `pages` |
| scanned PDF | `text_extraction = NEEDS_OCR` + `ocr_queue`; no text is indexed without the approved OCR path |
| history | older versions are marked SUPERSEDED with `effective_to`; never deleted (the importer has no `DELETE`) |

## 2a. Who may write what (security of the import)

The import runs in GitHub Actions of a **public** repository, so its connection
string is the most exposed credential of the library. It therefore belongs to a
role that cannot make anything answerable in production
(`drizzle-kb/0001_dajc_kb_import_review_separation.sql`, tested in
`src/lib/kb/__tests__/kb-db.test.ts` against a Neon-like cluster):

| Action | `dajc_kb_importer` (import CI secret) | `dajc_kb_ai_verifier` (AI verification CI secret) | `dajc_kb_reviewer` (a person, optional) | `dajc_ask_app` (DAJC AI) |
|---|---|---|---|---|
| add a new version (UNVERIFIED / AUTO_CHECKED) with its pages and provisions | yes, once per version | no | no | no |
| record a verification run with evidence | no | yes, append-only, evidence quoted verbatim from the stored text | no | no |
| make a version AI_VERIFIED / CONFLICTED / revoke it | **no** | only through `dajc_kb.apply_ai_verification(run)`, which the database checks | no | no |
| record HUMAN_VERIFIED / REJECTED | **no** (by update or insert) | no (and never overrides them) | yes; the database stamps the time | no |
| change pages, provisions or metadata of a stored version | **no** | **no** | mass bands only | no |
| add pages or provisions to an existing or verified version | **no** | no | no | no |
| close an older version when a newer one of the same document and language enters into force | yes, nothing else | no | no | no |
| revive a superseded version, repeal, change dates otherwise | **no** | no | no | no |
| change a document's title, topics or category | **no** (the import stops; the owner decides) | no | no | no |
| approve OCR | no | no | yes | no |
| write `review_log` | `IMPORT` / `SUPERSEDE` only | `AI_VERIFICATION` only, by the database function | `REVIEW` only | no |
| update or delete runs, claims or `review_log` | no | no | no | no (append-only triggers, also for the owner) |
| delete anything | no | no | no | no |
| read | tables, answerable view, inventory | tables, runs, claims, views | tables, runs, views | answerable view and text-free inventory only |

Before writing, the CI import checks that it runs as `dajc_kb_importer` without
administrative attributes or role memberships, and that the marker row
`dajc_kb.deployment` says `dev`; otherwise it stops (exit 2). The owner writes
the marker once per branch (`INSERT INTO dajc_kb.deployment (environment)
VALUES ('dev')`); a production branch gets `production`. In GitHub Actions the
host and password are masked, and every error message is redacted.

## 2b. Automated AI verification (replaces mandatory human review)

States of a version: `UNVERIFIED` → `AUTO_CHECKED` (official source, HTTPS,
SHA-256, format, publisher metadata) → **`AI_VERIFIED`** (all five layers below
passed, decided by the database) or **`CONFLICTED`** (material disagreement,
kept out). `HUMAN_VERIFIED` and `REJECTED` remain for a person and are never
overridden by the AI. Validity is separate: `IN_FORCE`, `NOT_YET_IN_FORCE`,
`SUPERSEDED`, `REPEALED`, `UNKNOWN`. Candidates before import
(`config/legal-library/candidates-status.json`): `DISCOVERED` →
`SOURCE_CONFIRMED` → `MANIFESTED` (→ imported), or `BLOCKED`.

| Layer | What must hold (`src/lib/kb/ai-verify/`) |
|---|---|
| 1 deterministic | all checks of § 5a (source, validity at EUR-Lex, SHA-256 of the archived and the official original, re-extracted content, production search where a curated question exists, citation) |
| 2 extraction | model A extracts the normative statements of **every** citable provision, each with a verbatim quote (located in the stored text, stored exactly as it stands there) and its quantities |
| 3 independent | model B of **another vendor** judges every claim against the provision text with its own verbatim quote and its own reading of the quantities; A and B also read act type, territory and consolidation date blind |
| 4 conflicts | deterministic: any contradiction, any difference in quantities, act type, territory or consolidation date, two versions in force at once, or a stored mass band not named by a supported threshold → CONFLICT; never a majority vote |
| 5 applicability | questions generated in the version's language must find their provision through the production search among the 4 sources the model receives, with a complete citation; the version must not answer for the day before it applied nor for a jurisdiction where it does not apply |

The database decides (`drizzle-kb/0002`): a run must name the stored SHA-256
and the database's own digest of the stored provisions; claims are accepted
only verbatim and only in their run's transaction; `apply_ai_verification`
requires the newest run (< 24 h), PASS in all five layers, two vendors and only
supported evidence. FAIL revokes an earlier AI_VERIFIED; ERROR (provider down,
no credit, budget exhausted) changes nothing; every decision goes to the
append-only `review_log` with the note "automated, not a human or official
approval". DAJC AI answers VERIFIED from AI_VERIFIED or HUMAN_VERIFIED versions
and then always shows that the verification was automated (cs/en).

Run: workflow `kb-ai-verify-dev` (owner label, environment approval, verifier
role secret, AI keys, `DAJC_KB_AI_RUN_BUDGET_USD`, default $12). Every call is
priced before it is sent; token usage and list-price cost are stored per run.
`scripts/kb-ai-verify.mjs --estimate` prices the worst case without any AI call:
**$10.93 for the 20 stored versions** with `gpt-6-sol` + `claude-sonnet-5-5`
($2/$10 per 1M tokens), about $0.45-0.90 per version. Unchanged AI_VERIFIED
versions are skipped (content-addressed: their SHA-256 cannot change).

Tests: `kb-ai-verify-db.test.ts` (forged approvals refused: import role,
direct updates, wrong SHA-256 or content, invented quotes, late claims,
incomplete PASS, one vendor, human decisions, stale runs, append-only audit),
`kb-ai-engine.test.ts` (decision logic with scripted test providers; these are
not an AI verification of any real document).

What DAJC AI may cite (view `answerable_provisions` + checks in the code): an
IN_FORCE / NOT_YET_IN_FORCE version valid on the asked day, with a text layer,
without restricted reuse terms, with an article/§/annex (never a preamble) and
with an allowed provenance state. In production AI_VERIFIED and HUMAN_VERIFIED
versions; AUTO_CHECKED only for internal tests (`DAJC_KB_ALLOW_AUTO_CHECKED`,
outside Vercel production) and always as PARTIAL; CONFLICTED and REJECTED never.

## 3. Scope: jurisdictions and topics

- **Jurisdictions:** the single source of truth stays `config/europe-coverage.mjs`
  (50 codes), plus `EU` and `INT`. Extension = a new country in
  `europe-coverage.mjs` (bumps `COVERAGE_VERSION`) and its sources in
  `legal-sources.mjs`; `legislationCoverageGaps()` lists countries without a
  legislation source; a test validates the registry.
- **Topics:** oversize and heavy transport; permits, exemptions, escorts and
  special conditions; weights, dimensions, axles; driving bans; driving and
  rest times; tachographs; rules for goods vehicles over 2.5 t and higher
  thresholds; ADR; roadside checks and documents; tolls, charges and
  environmental restrictions; cross-border transport and cabotage; official
  closures.
- **Mass thresholds (2.5 t, 3.5 t, 7.5 t, 12 t, …):** a provision mentioning
  tonnes only gets a hint (`mass_mentions`); the band a rule applies to is set
  by a named reviewer (`massBands` in the manifest, check in the database).
  Without a confirmed band → UNREVIEWED → the answer is at most PARTIAL. A rule
  of another band (MISMATCH) is never used.
- **Applicability of EU law:** EU regulations apply directly in member states;
  a directive → check the national transposition; EEA states (NO, IS, LI) →
  check incorporation into the EEA Agreement; UK, Switzerland and countries
  outside the EU/EEA → EU law is **not used**; international agreements (ADR,
  AETR) → check the contracting party.
- **Driving bans:** the only authority for DAJC AI stays the Driving Bans
  registry; the library may keep official documents on bans for its review
  layer, but DAJC AI does not answer driving-ban questions from it.

## 4. Official sources (registry) and what was actually verified

`src/lib/kb/legal-sources.mjs` lists **68 official sources; every one of the 50
jurisdictions has at least one official legislation source** (national gazette
or legislation portal of the state itself), plus regional sources where regions
legislate themselves (BA: FBiH, Republika Srpska, Brčko; BE: Flanders,
Wallonia; DE: Bayern, NRW, Baden-Württemberg). AT, ES, PT and UK publish their
regional legislation in the national source. Commercial databases, blogs,
forums and AI answers are never a source of the library.

| What | State on 2026-11-09 |
|---|---|
| **EUR-Lex** (`eur-lex.europa.eu`) | **terms verified** on its legal notice: reuse allowed (Decision 2011/833/EU), consolidated texts CC BY 4.0 with attribution; only the Official Journal is authentic. robots.txt allows the PDF and status pages used, with **Crawl-delay 10 s** - now enforced. |
| Reachability and robots.txt of all sources | `scripts/kb-sources-check.mjs` → `config/legal-library/source-checks.json` (from the development sandbox): 54 reachable, 4 with robots.txt disallowing automated access (ISAP and Dziennik Ustaw PL, Lovdata NO, VEMAGS DE), 22 refused the sandbox with 403/5xx. The sandbox's own network can cause such refusals, so they count only when seen from the GitHub runner (the monthly audit workflow `kb-monthly-audit` repeats the check there). |
| Reuse terms of national sources | not read yet (`reuse.status: UNKNOWN`): the importer refuses such a source until its terms are verified and recorded |

**robots.txt and automated access** (`src/lib/kb/robots.mjs`, RFC 9309):
every download - import, verification, discovery, monitoring - first checks the
publisher's robots.txt for the library's user agent and waits for the host's
crawl delay (at least 1 s). A robots.txt that cannot be read because of a server
or network error blocks the host (fail closed); CAPTCHAs, blocks and terms are
never circumvented. Where automated retrieval is not allowed, only metadata may
be recorded and the cell is SOURCE_UNAVAILABLE.

## 5. Processed documents (local development database, not production)

Downloaded from EUR-Lex on 2026-11-08, archived locally (content-addressed),
state AUTO_CHECKED — **no person has verified them yet**.

| Act (consolidation) | Languages | Pages | Provisions (cs/de/en/pl/sk) | Version in force from |
|---|---|---|---|---|
| Regulation (EC) No 561/2006 — driving and rest times | cs, de, en, pl, sk | 26 | 38 / 39 / 38 / 39 / 38 | 31 Dec 2024 |
| Regulation (EU) No 165/2014 — tachographs | cs, de, en, pl, sk | 49 | 59 / 64 / 62 / 64 / 60 | 31 Dec 2024 |
| Directive 96/53/EC — weights and dimensions | cs, de, en, pl, sk | 29 | 30 / 35 / 37 / 31 / 32 | 14 Aug 2019 |
| Regulation (EC) No 1072/2009 — market access, cabotage | cs, de, en, pl, sk | 24 | 35 / 37 / 35 / 28 / 27 | 21 Feb 2022 |

20 versions; SHA-256 and version IDs are in the import output and in the
database. The StVO (DE) could not be imported (see above). On Neon
(`dev-kb-tests`) there is only a sample of 3 provisions of Regulation 561/2006
(CS) to verify compatibility; the full import into Neon runs through the
workflow `kb-import-dev` (`DAJC_AI_NEON.md` § 4, step 6).

**Second batch (2026-11-09, local, discovered on EUR-Lex):** 12 more acts in
force with a current consolidation - Regulation (EC) No 1071/2009, Directives
2006/22/EC, 2006/126/EC, 2008/68/EC, 2014/47/EU, 2014/45/EU, 1999/62/EC,
2009/103/EC, 2004/54/EC, 2006/1/EC, (EU) 2015/413 and Regulation (EU)
2020/1056 - in cs/de/en/pl/sk (60 manifest entries). Imported locally as
`dajc_kb_importer`: **51 new versions** (all with a text layer, AUTO_CHECKED),
71 of 80 manifest versions stored; the offline verification (archived
originals, re-extraction, catalogue, citations) passes for all 71. The other
9 (2006/1/EC de/en/pl/sk, (EU) 2015/413 all languages) were **not imported**:
after about 100 downloads that day, EUR-Lex's CloudFront answered the
development sandbox with an AWS WAF bot challenge (`x-amzn-waf-action:
challenge`, HTTP 202, no content). The importer refused the non-PDF answer; the
challenge was not circumvented. Since then a challenge or HTTP 429 stops every
further request to that host for the run, imports skip versions already stored
(delta import), and the import workflow verifies online only what it imported.
Three candidates have no consolidated version on EUR-Lex (2002/15/EC, (EU)
2020/1057, (EU) 2022/2561) and stay SOURCE_CONFIRMED until their dates of
application are checked.

### 5a. Verification of every imported version

`scripts/kb-verify.mjs` (read-only; logic in `src/lib/kb/verify.mjs`, plan in
`config/legal-library/verification.json`) checks each manifest entry and runs
in the import workflow right after the import:

| Check | What must hold |
|---|---|
| catalogue | exactly one stored version for the official URL and language; machine-checked or human-verified; text layer; pages and citable provisions; every provision inside the document's pages |
| source | HTTPS on the registered official source of the entry; reuse terms allow storing and quoting; URL and label equal the manifest |
| validity | status and dates equal the manifest; in force on the check day; not superseded; status checked within 31 days; **online:** EUR-Lex shows the act *In force* and lists exactly the stored text as the *current consolidated version* |
| integrity | the archived original exists with the catalogue's SHA-256 and size; **online:** the official URL still serves exactly these bytes, so a citation link opens the stored text |
| content | pages and provisions re-extracted from the original equal the stored ones |
| search | a driver's question in the version's language, sent exactly as DAJC AI sends it (terms + question, Ask topic, country CZ), finds the named article among the 4 sources the model receives |
| citation | that hit has the version label, article and page, the official URL with `#page=N` inside the document, the version's SHA-256, and its text is on the cited pages |

Local result on 2026-11-08 (Neon-like cluster, as `dajc_kb_importer`, online):
**20/20 versions passed every check**; the expected article was the first
source in 18 cases and the second in 2. EUR-Lex lists all four acts as in force
and the stored consolidations (561/2006 and 165/2014: 31 Dec 2024; 96/53/EC:
14 Aug 2019; 1072/2009: 21 Feb 2022) as current. The first run failed
honestly in two places, which were fixed in the check, not in the data: EUR-Lex
amendment markers (▼M1) on the pages broke the "text on the cited page"
comparison, and searches without the Ask topic filter ranked Article 3 of
Directive 96/53/EC too low in cs/sk/pl (in Polish not at all) — with the topic
DAJC AI actually sends it ranks first or second. Retrieval in cs/sk/pl
therefore depends on the classifier choosing the right topic.

## 5b. Coverage matrix: 50 jurisdictions × legal areas

`src/lib/kb/legal-areas.mjs` splits the five areas of the brief into 49
sub-areas (A drivers and operators 9, B vehicles and loads 9, C oversize 11,
D traffic restrictions 9, E other areas 11), each mapped to the library's search
topics. `src/lib/kb/coverage.mjs` evaluates every cell of **50 jurisdictions
(only `config/europe-coverage.mjs`) × 49 sub-areas = 2,450 cells**:

| Status | Rule |
|---|---|
| COVERED | only from an audit in `config/legal-library/coverage-evidence.json` with official evidence, naming documents that are all stored, in force and AI- or person-verified |
| PARTIAL | at least one stored official document that applies there; the cell lists why it is incomplete (directive transposition, EEA incorporation, no national act, not verified, regional legislation) |
| CONFLICTED | an applicable version is CONFLICTED, or an audit recorded a conflict |
| NOT_APPLICABLE | only from an audit with official legal evidence - never "nothing was found" |
| SOURCE_UNAVAILABLE | nothing stored and automated access to every national legislation source is not allowed (robots.txt, restricted terms) or refused when checked from the runner |
| NOT_YET_RESEARCHED | everything else |

A jurisdiction is complete only when every cell is COVERED or NOT_APPLICABLE;
**none is complete today**. `scripts/kb-coverage.mjs` writes JSON, Markdown
and an internal HTML dashboard (`noindex`, not part of the website) from the
database (`dajc_kb.library_inventory`, a text-free view) or an exported
inventory. Snapshot: `docs/DAJC_AI_LEGAL_COVERAGE.md`.

## 6. Search and answer

1. Classification of the driver's question (existing Ask): country, topic,
   dates, vehicle mass, keywords in the official language and in English.
2. Library (not for driving bans): exact full text in the selected languages
   (question language, official languages of the countries, English) with
   filters on jurisdiction including EU applicability, the day in force, topic
   and allowed provenance; for cs/sk/pl by stem prefix (PostgreSQL has no
   stemmer for them); a match of the whole term ranks first (PostgreSQL has no
   word rarity).
3. Citability check: article/§/annex, page, `#page=N`, SHA-256, valid on the
   day, no other mass band, applicable in the country.
4. A country answered directly by the library is **not searched on the web
   (paid)**.
5. Draft only from the passages, verbatim quote, numbers must be in the quote,
   deterministic check (including the ban on confirming passability, permits
   or exceptions) and independent check by another provider — not switched off
   to save money.
6. Display: *document · article · page*, link to the official PDF at the page,
   date of verification, fixed notices (a quotation is not an interpretation; a
   consolidated text is not binding; for an unverified version, uncertain
   applicability or mass band the answer admits uncertainty — at most PARTIAL).

**Questions in five languages (local library, role `dajc_ask_app` through the pooler, 2026-11-08):**

| Language | Query | First result |
|---|---|---|
| cs | přestávka v řízení po čtyřech a půl hodinách | Nařízení (ES) č. 561/2006 · Článek 7 · s. 7 |
| pl | dzienny okres odpoczynku | Rozporządzenie (WE) nr 561/2006 · Artykuł 4 / Artykuł 8 · str. 4–10 |
| en (IE) | cabotage operations international carriage | Regulation (EC) No 1072/2009 · Article 8 · p. 7–9 |
| sk | tachograf karta vodiča | Nariadenie (EÚ) č. 165/2014 · Článok 2 · s. 3–5 |
| de | Fahrtunterbrechung, Lenkdauer viereinhalb Stunden | 561/2006 Artikel 4 (definitions), Artikel 7 right after it |
| en (UK) | daily rest period driver | **nothing** (EU law not applied to the UK) |
| en (NO) | weekly rest period | 561/2006 Article 8 as "check EEA incorporation" |
| cs (2019-01-01) | přestávka v řízení | **nothing** (version in force only from 31 Dec 2024) |

Complete AI answers could not be tried (no provider keys); the pipeline is
tested with fake models on real excerpts of Article 7 in cs/en/de/pl/sk
(`src/lib/ask/__tests__/library.test.ts`).

**Regression tests:** outdated and replaced version, wrong mass band (3.5 t vs
7.5 t), incomplete citation (preamble, missing page or hash), wrong exception
("the exemption applies here"), numbers outside the quote, unverified and
rejected version, UK/EEA/directive, library outage.

## 6a. Discovery, imports in batches and change monitoring

* **Discovery** (`scripts/kb-eurlex-discover.mjs`, candidates in
  `config/legal-library/eurlex-candidates.json`): reads each act's own EUR-Lex
  status page and writes manifest entries only for an act shown *In force*
  with a current consolidated version; dates and labels come from that page and
  from the Official Journal's naming rules, never from a guess. Other
  candidates keep their reason in `config/legal-library/candidates-status.json`.
* **Monitoring** (`scripts/kb-monitor.mjs`, the single `monthly` tier in
  `config/legal-library/monitor.json`): for every stored EUR-Lex act reports
  UNCHANGED, NEW_CONSOLIDATION, NO_LONGER_IN_FORCE or UNREADABLE (never taken
  as "unchanged"). `--write` adds a new consolidation to the manifest; the next
  import supersedes the older version and keeps it for historical questions; the
  next AI verification revokes an AI_VERIFIED state that relies on an outdated
  text (layer 1 fails). The only scheduled legislative check is the monthly workflow `kb-monthly-audit`
  (runner, no secret, active only from the default branch): it repeats the source
  check, re-acquires one probe document per connector (SHA-256 delta, robots.txt
  and crawl delay shared per run), queues changed documents for AI verification
  and discovers new acts where an API is implemented (PL). There are no daily or
  weekly legislative checks.
* National legislation: the registry and the matrix are ready; national
  imports need, per source, readable reuse terms, robots.txt permission and a
  verified way to the official document (PDF or structured text), source by
  source.

## 7. Operating costs (3 questions per day, 30 days; an estimate, not a measurement)

Assumptions: model prices as in `docs/DAJC_AI_B2C_LAUNCH.md` (classification
0.20/1.25; draft 0.75/4.50; independent check 2/10 USD per 1M tokens ≈ Claude
Sonnet 5.5; search 0.005 USD; 0.92 EUR/USD). An answer from the library sends
≤ 4 provisions (≈ 4,000 tokens) to the model instead of downloaded web pages
(≈ 10,000 tokens) and does not call Perplexity.

| Question path | AI cost per question |
|---|---|
| via the web (Perplexity + pages) | ≈ €0.023 |
| from the library (no Perplexity) | ≈ €0.014 (**−38 %**) |
| from the library + check by Claude Haiku 5.5 | ≈ €0.007 (quality to be verified) |

| Drivers (questions/month) | AI web only | AI 50 % library | AI 80 % library | Neon (Launch) | R2 archive | Import and indexing | **Total at 50 % library*** |
|---|---|---|---|---|---|---|---|
| 100 (9,000) | €207 | €167 | €144 | ≈ €15 | €0 | €0 | **≈ €200** |
| 500 (45,000) | €1,035 | €833 | €720 | ≈ €18 | €0 | €0 | **≈ €890** |
| 1,000 (90,000) | €2,070 | €1,665 | €1,440 | ≈ €23 | €0 | €0 | **≈ €1,720** |

\* including Vercel Pro ≈ €18 and Resend (€0 / €18 / €18) from `DAJC_AI_B2C_LAUNCH.md`.

- **Neon:** Launch estimated from active time at 0.25–0.5 CU ≈ 110–240
  CU-hours (12–26 USD) + storage ~1 GB (0.35 USD) + history (0.20 USD/GB).
  The Free plan (100 CU-hours, suspension) is enough for an internal test, not
  for daily availability.
- **R2 archive:** a Europe-wide library ≈ 1–5 GB of PDFs (≈ 750 national acts ×
  ~1 MB + EU acts in 24 languages) — within the free 10 GB-month; egress is
  free; PDFs are not read at question time (the text is in the database).
  Above the free tier 0.015 USD/GB-month. Needs a Cloudflare account and
  approval.
- **Import and indexing:** no AI (pdf.js + PostgreSQL full text), seconds per
  document; can run locally or in GitHub Actions within the free minutes. No
  vector embeddings.
- **The real main cost of the library is human review** (HUMAN_VERIFIED, mass
  bands, reuse terms), not infrastructure.
- **Library vs. Perplexity:** every question answered from the library saves
  ≈ €0.009; at a 50 % share ≈ €40 / €200 / €400 per month for 100 / 500 /
  1,000 drivers. The saving grows with the library's coverage.

Budget caps (`DAJC_ASK_DAILY_BUDGET_EUR`, `…MONTHLY…`) and the safe pause stay
unchanged; recommended values in `DAJC_AI_B2C_LAUNCH.md` § 5.

## 8. Known limitations

- PostgreSQL has no stemmer for Czech, Slovak or Polish: stem-prefix search is
  coarse, precision comes from ranking and the checks; definition articles
  (e.g. Art. 4 of Regulation 561/2006) rank high.
- EUR-Lex PDFs contain words hyphenated at line ends; a quote across such a
  place is dropped by the check (safe, but fewer usable citations).
- The page range of a long article split into chunks is the article's whole
  range (a citation never points before the text).
- The OCR path is a queue only; OCR itself is neither implemented nor
  approved.
- On Neon there is only a sample so far; the full import runs through the
  manual workflow `kb-import-dev` (label on the PR, approval of the GitHub
  environment `kb-import-dev`, environment secret `DAJC_KB_DEV_IMPORT_DB_URL`;
  procedure in `DAJC_AI_NEON.md` § 4, step 6). It covers the 20 EUR-Lex
  versions; StVO (DE) stays out until its source allows automated download and
  the in-force date of its last amendment is checked.

## Official acquisition into Neon dev (kb-acquire)

`scripts/kb-acquire.mjs` runs Discovery → Acquisition → Text extraction → SHA-256 →
archive (private Neon Object Storage bucket `dajc-kb-originals-dev`, S3-compatible
`S3CompatibleArchive`, credentials only as environment secrets) → PostgreSQL → read-back
of both stores → audit record. Workflow `kb-acquire-dev` (owner label/dispatch and
environment approval, like `kb-import-dev`). Idempotent: the archive is content-addressed
and immutable, the database write is one transaction keyed on (document, language,
SHA-256), older legal versions are superseded, never rewritten.

| Jurisdiction | Route | State on 2026-11-09 |
|---|---|---|
| DE | Gesetze im Internet catalogue `gii-toc.xml` + `xml.zip` | implemented and unit-tested; live run from the Claude sandbox ended `ROBOTS_UNAVAILABLE` (robots.txt answers Node requests with HTTP 503, temporary, retried, not circumvented); first real import must run from the GitHub runner |
| AT | RIS OGD API v2.6 incl. history, 0.5 req/s serial | client implemented, UNTESTED_LIVE: `data.bka.gv.at/robots.txt` disallows generic agents (`Disallow: /`), so it runs only with an access arrangement from the publisher (`DAJC_KB_AT_RIS_AUTHORIZATION_REF`) |
| HR | Narodne novine sitemaps + ELI → JSON-LD, 3 req/s serial | discovery client implemented; **no import**: reuse terms not verified |

HTTP failures are classified: `ROBOTS_DISALLOWED`, `ROBOTS_UNAVAILABLE` (temporary),
`PERMANENT_HTTP`, `TRANSIENT_EXHAUSTED` (e.g. a persistent 503), `WAF_BLOCKED`.
