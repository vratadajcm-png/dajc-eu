# DAJC AI — European library of official legal documents (knowledge base)

Status on 2026-11-08. The library is **off** by default (`DAJC_KB_ENABLED`);
paid features, payments and ABRA are not involved.

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
| Import and human review | `src/lib/kb/importer.mjs`, `scripts/kb-import.mjs`, `scripts/kb-review.mjs` | one transaction, nothing is deleted |
| Search | `src/lib/kb/search.mjs`, `scripts/kb-search.mjs` | exact full text + filters; vectors only later, as candidate proposals |
| DAJC AI integration | `src/lib/ask/library.ts`, `pipeline.ts` | before the paid web search; not for driving bans |
| Schema and permissions | `drizzle-kb/0000_dajc_kb_library.sql` | own migration history, no collision with #102 |
| Import into Neon `dev` | `.github/workflows/kb-import-dev.yml` | started only by the owner (label `kb-import-dev`) |

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

What DAJC AI may cite (view `answerable_provisions` + checks in the code): an
IN_FORCE / NOT_YET_IN_FORCE version valid on the asked day, with a text layer,
without restricted reuse terms, with an article/§/annex (never a preamble) and
with an allowed provenance state. In production only HUMAN_VERIFIED versions;
AUTO_CHECKED only for internal tests (`DAJC_KB_ALLOW_AUTO_CHECKED`, outside
Vercel production) and always as PARTIAL.

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

| Source | Verification state on 2026-11-08 |
|---|---|
| **EUR-Lex** (`eur-lex.europa.eu`) | **terms verified** on its legal notice: reuse allowed (Decision 2011/833/EU), consolidated texts CC BY 4.0 with attribution; only the Official Journal is authentic. The validity of 6 acts checked on EUR-Lex ("In force", latest consolidation). |
| e-Sbírka (CZ), Slov-Lex (SK), Gesetze im Internet (DE) | reachable from the development environment; reuse terms not read (legal basis for free use of official works noted, to be confirmed by a lawyer). gesetze-im-internet.de refuses automated downloads (HTTP 503 for the importer); the protection was not circumvented. |
| ISAP / Dziennik Ustaw (PL), RIS (AT), UNECE (ADR/AETR) | **blocked** for the development environment (HTTP 403/503 from their own servers) |
| Other national gazettes (FR, IT, ES, NL, BE, LU, HU, SI, HR, RO, BG, DK, SE, FI, EE, LV, LT, IE, PT, GR, CH, LI, NO, UK, MT), ministries and road authorities | in the registry as NOT_CHECKED; an import stops until the reuse terms are verified |

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
  manual workflow `kb-import-dev` (label on the PR, secret
  `DAJC_KB_DEV_IMPORT_DB_URL`, procedure in `DAJC_AI_NEON.md` § 4, step 6).
