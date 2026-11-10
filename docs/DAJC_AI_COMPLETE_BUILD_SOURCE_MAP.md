# DAJC AI — complete build, official-data adapters and source of truth
**Rev:** 2026-11-10 documentation candidate · **product:** standalone DAJC AI · **status:** proposed, not production release

## 0. Authority and non-negotiable product decisions
- Canonical proposed master: **DAJC-AI-PLAN-001 v0.1 (2026-11-08)**, stored privately on DAJC's managed Drive. This public GitHub file deliberately does **not** publish internal planning emails or credentials and does not supersede the master. If unapproved, state remains DRAFT; new requirements are decisions, not auto-approved entitlements.
- DAJC AI is an individual email-account product. **3 questions per user per calendar day free** in its approved initial phase. Voluntary contribution at [DAJC support](https://www.dajc.eu/support) **never unlocks** another question, paid credit, subscription or enterprise licence. Historic €15/month proposals are not approved current offers.
- Independent DB/billing/identity/lifecycle from DAJC Platform, DAJC TAR and Ferda. Platform's internal Driver Intelligence/AI and TAR's own support knowledge are **not** automatically DAJC AI subscription/identity or data access. Reuse only public/licensed evidence and explicitly authorised versioned contracts, not another product's tenants.
- Fail closed on **UNKNOWN/UNVERIFIED** legal source, time-specific effect, route, permit, ADR, weight threshold, congestion or parking. Never invent an authority approval, legal exception or current operational clearance.
- Primary AI ambition is January 2027, not a cleared production release date. Development and PR passes are NOT production readiness.

## 1. Full-system architecture and acceptance
| Component | Complete behaviour and evidence | Gate |
|---|---|---|
| Individual Identity | verified individual email account, secure session and revocation, no firm membership dependency | own auth, privacy/retention |
| Quota | atomic 3 questions/day with replay-safe idempotency, concurrency tests, displayed reset timezone | OWNER_DECISION AI-OPEN-01 before release |
| Query Router | infer topic/jurisdiction/date/vehicle/trailer/weight/type/ADR and ask targeted follow-up for missing facts | no unsupported global threshold |
| Official Source Discovery | official legislation, authority notices, NAP/DATEX feeds, customs/tachograph/ADR sources; each with allowed reuse | primary publisher rights per source |
| Evidence Library | original source document, hash, acquisition, licence, effective date, jurisdiction, supersession, structured passages, provenance | rights and QA before retrieval |
| Data Store & Index | isolated Neon-backed metadata and records (subject to current schema/credentials review); fulltext/vector retrieval versioning | schema, backup/restore, RLS/tenant or user isolation |
| Retrieval / RAG | temporal/rule-aware exact passage citations with confidence and conflict states; direct official source locator | no fabricated citations |
| Provider Gateway | replaceable OpenAI, Anthropic, Gemini, xAI, Mistral adapters ONLY when configured/approved; privacy routing, cost ceiling and retries | spend/permission provider gate |
| Answer Validator | source-to-claim audit, valid-at date check, overrides for regulations/ADR/oversize-specific permit status, independent reviewer where needed | tested refusal on missing evidence |
| Web UI | Ask DAJC · FAQ entry, login, quota status, question/answer citation and support link without payment entitlement | accessibility, localisation and legal review |
| Observability | p95, token/cost per request, model version, retrieval version, citation pass, freshness, abort/retry, budget guard, incident response | no prompts/secrets in logs |
| Release | migration and restore rehearsal, verified content coverage, GDPR/AI Act checks, operator approval, rollback and safe failure | owner signoff required |

**Truth source hierarchy:** authority primary data and signed source evidence → DAJC normalised evidence passages with source metadata → model explanation. Model memory and third-party blogs are discovery hints, never legal authority. Scraped public availability is not blanket licence for storage or model training.

## 2. Integration/data catalogue
See [DAJC_AI_SOURCE_INTEGRATION_REGISTER.json](DAJC_AI_SOURCE_INTEGRATION_REGISTER.json). Contents are suitable for a public development repo: official provider endpoints, permitted integration families and **unknown** terms expressly marked. No private partner communication or internal Google Drive document IDs belong in this public register.

Priority:
- **UK legislation**: official [legislation.gov.uk OpenAPI](https://www.legislation.gov.uk/openapi) publishes search/document/identifier/effects resources. Versioned legislation citation, UK territorial extent, in-force date, paginated search, URL safety and amendment checks; official [XML/feed guide](https://legislation.github.io/data-documentation/api/overview.html).
- **EU**: EUR-Lex and relevant EU transport regulation/Commission and DG MOVE official sources; 561/2006 driver hours, EU tachograph, eCMR/eFTI, ADR via competent authorities.
- **National law & transport**: official state/region legislation, road restrictions, NAP DATEX II; match legal applicability by jurisdiction, direction, vehicle/scope, time and authorised exception; **not all** 50 watched bans jurisdictions are legally verified.
- **Customs/roads**: national customs official pages, authoritatively effective conditions for EU/non-EU corridors, road/bridge/height/axle, permits and seasonal bans.
- **Parking/weather**: official road agency and met office sources with freshness/confidence; no implied guarantee of parking availability.
- **Cross-product Driving Bans**: only a versioned, publicly shareable published data product / official citations may be imported; no direct read access to Platform/TAR DB or private user data.
- **External AI APIs**: model providers remain independently interchangeable and measured. Account spend limits for autonomous **development** are not automatically production inference limits.

## 3. Implementation delivery sequencing
The canonical master sets phases 0–6; implement one focused, testable change per autonomous cycle. First audit live code, upstream AI PRs and Neon dev branch; avoid claiming production. Then official source catalogue → rights/version/ingestion → retrieval/citation → identity and quota → provider router/budget/prompt injection defenses → end-to-end safety eval → preproduction legal and ops gates → owner-go/no-go.

Every adapter must be represented in registry, with verified official URL, data format, source publisher/authority, applicable scope, rights for cache/index/display, change feed, effective dates, freshness, dedup and hashing, failure fallback, legal acceptance. Evidence from a web page may change; the last successful HTTP response is not authority to use a particular version commercially.

## 4. Open decisions (non-blocking for independent code unless indicated)
- **AI-OPEN-01 (release blocker)**: daily reset timezone (Europe/Prague or UTC) and handling technical failures/unverified answers in the daily quota.
- **AI-OPEN-02 (release blocker)**: minimum verified countries/topics at first public release; 50 monitored bans sources do not mean complete coverage.
- **AI-OPEN-03 (infrastructure)**: confirm current Neon schema, per-user auth, source object-store rights, backup and restore, index approach and isolation.
- **AI-OPEN-04 (privacy)**: user-query retention and whether future model improvement is permitted; no silent training or cross-product reuse.
- **AI-OPEN-05 (product)**: precise Ask DAJC FAQ entry point and no confusion with Driving Bans/Intelligence.
- **AI-OPEN-06 (operations)**: allowed providers and fallback, production inference/day budget and spend alerts.
Decisions are raised as **owner-assigned GitHub issues** with ID, options, recommendation, impact, what may progress, and a link to source/PR/acceptance. See [owner-decision routing](OWNER_DECISIONS.md). The autonomous Claude Code workflow may change only approved source paths; new feature scope/release/provider spending requires separate human approval.

## 5. Evidence rules for autonomous Claude Code
Read this document, the JSON registry, existing CI/source docs and current PR before researching or coding; owner-only Google Drive/mailbox documents are not automatically available to the GitHub Action. When missing documentation, create an explicit SOURCE_GAP / OWNER_DECISION in PR report or GitHub issue; **do not pretend** to have read mail or sign a contract. Record official stable URL and access date for each accepted source, canonical original hash and article citation, validate rights and historical applicability. Keep customer-private evidence out of public repo.
Tests must cover malformed official feed ID, path traversal, changed legislation, repeal/extent/commencement, source outage, stale cache, prompt injection in retrieved documents, mismatch citations, user-to-user leaks, atomic quota, expensive retry storms and provider-off fallback.
