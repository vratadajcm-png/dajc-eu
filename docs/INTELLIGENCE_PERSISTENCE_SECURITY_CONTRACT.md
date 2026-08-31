# DAJC Intelligence — Durable Persistence Security Contract

Status: M1 design contract. No production database migration or production delivery is authorised by this document.

## Purpose

This contract defines the security, privacy, tenancy, data-rights and transaction boundaries that a future durable DAJC Intelligence datastore must satisfy before replacing the current in-memory/browser-only M1 implementations.

It is subordinate to `DAJCPLAN003FULL.md`, especially R4, R6, R7, §7.12, the Transport Data Fabric rules and the universal Definition-of-Done standard. It does not change the canonical DAJC Platform execution pointer.

## Canonical identity authority

DAJC Intelligence reuses DAJC Platform identity and organization authority. It must not create a parallel account/tenant system on dajc.eu.

Verified current Platform model:
- authenticated user identity: `auth.uid()` / `profiles.id`;
- organization identity: `organizations.id`;
- user organization binding: `profiles.org_id`;
- current tenant helper: `current_org_id()`;
- current server actor context: `requireProfile()` → `{ userId, orgId, role, canDrive }`.

Intelligence user-owned rows must bind to the canonical `userId` + `orgId` pair resolved server-side. Client-provided identity fields are data to validate, never authorization authority. Sensitive Platform profile fields including `org_id` are already protected from ordinary authenticated-client mutation and Intelligence must preserve that boundary.

## Non-negotiable boundaries

1. Browser state is never an authorization source. Authenticated persistence must resolve organization and user identity server-side.
2. Every tenant/user preference row is scoped by both `organization_id` and `user_id`. A valid user in organization A must not read or mutate organization B data, and another user in the same organization must not silently inherit user-private preferences.
3. Source data has an explicit storage scope: `public-shared`, `tenant-private`, or `provider-customer-bound`. Storage scope is derived from current provider evidence/capability policy, never inferred from technical accessibility.
4. `tenant-private` and `provider-customer-bound` source data requires an organization binding. Provider-customer-bound data additionally requires the evidenced customer/mandate binding required by the provider capability manifest.
5. Raw provider data, DAJC-normalized data and DAJC-derived intelligence remain distinguishable by provenance and rights metadata.
6. No source snapshot or history may be persisted when storage/history rights are unknown or denied. Unknown means fail closed.
7. No production retention duration is invented in code. Retention must reference an approved policy ID/configuration produced by the R7/legal decision process. Until then, destructive retention stays disabled/fail-closed and production persistence remains gated.
8. Public Driving Bans `.ics` remains a separate free acquisition surface. Premium Intelligence persistence does not turn that endpoint into an authenticated or paid API.
9. Billing/entitlement never substitutes for authorization. Payment state can enable a product capability, but organization/user identity, RLS, source data rights and purpose restrictions still apply.
10. No client secret, API key, access token or payment credential is stored in Intelligence data tables, payload history or delivery logs.

## Persistence domains

### 1. Intelligence preferences

Proposed logical object: `intelligence_preferences`

Required identity: canonical DAJC `organization_id`, `user_id`.

Required behavior:
- server-resolved actor identity from the DAJC Platform auth/profile model;
- RLS / equivalent tenant + user isolation;
- optimistic revision control;
- schema validation before write;
- audit of create/update/delete metadata without logging secrets;
- self-service deletion/offboarding behavior mapped to the approved R7 policy.

### 2. Source snapshots

Proposed logical object: `intelligence_source_snapshots`.

Required fields/metadata include:
- `source_id` and source adapter version;
- storage scope (`public-shared`, `tenant-private`, `provider-customer-bound`);
- organization/customer binding when required;
- source/provenance/license/distribution policy;
- fetched/observed time, validity/freshness metadata;
- stable item key/fingerprint;
- completeness state (`complete` / `partial`);
- transformation/mapping version where applicable.

A partial or failed snapshot must not remove unseen previous items. A missing item can become `cancelled` only after an explicitly complete snapshot for the same source scope.

### 3. Change history

Proposed logical object: `intelligence_change_history`.

History is append-only at the application contract level. Existing events are not rewritten to describe a later state. Corrections produce new events or explicit supersession metadata.

Required behavior:
- stable unique change ID/dedupe key;
- source scope inherited from the snapshot;
- previous/current fingerprints where applicable;
- provenance/source reference;
- observed/effective timestamps;
- history persistence allowed only when the source rights policy allows history/caching;
- tenant-bound history remains tenant-bound under RLS.

### 4. Alert outbox

Proposed logical object: `intelligence_alert_outbox`.

Required identity: canonical DAJC `organization_id`, `user_id`, change/event reference, channel and dedupe key.

Required behavior:
- enqueued only from authorized scoped preferences;
- unique dedupe key for idempotency;
- explicit states pending / leased / delivered / failed / suppressed / dead-letter;
- bounded retry and dead-letter/failure handling;
- no network send in the same unprotected code path that computes relevance;
- no cross-tenant recipient lookup;
- entitlement may suppress delivery but cannot broaden data access.

### 5. Delivery attempts / audit

Proposed logical object: `intelligence_delivery_attempts`.

Record only operational metadata necessary to prove delivery behavior: outbox reference, channel, provider/message reference when safe, timestamps, result class, retry count and sanitized failure code.

Do not persist full provider secrets, authorization headers or unnecessary message payload copies.

## Atomicity requirement

A durable implementation must expose one transaction boundary for a source processing cycle where technically appropriate:

1. lock/read the prior scoped snapshot state;
2. accept the validated new source snapshot;
3. calculate and append change-history events;
4. calculate scoped alert candidates;
5. enqueue outbox rows idempotently;
6. reconcile/replace the source snapshot only according to completeness rules;
7. commit together, or commit nothing.

A crash must not leave history stating that a change happened while the corresponding durable snapshot/outbox state silently failed, nor should retry duplicate alerts.

## RLS / authorization model

Minimum negative tests before any production migration can be activated:
- organization A cannot read/update preferences for organization B;
- user A1 cannot mutate user A2 private preferences merely because both are in organization A;
- tenant-bound source snapshot/history cannot be read by another tenant;
- guessing IDs/dedupe keys does not bypass access;
- stale/removed canonical profile/organization membership loses access;
- service processing roles cannot be used by browser/client code;
- delivery worker can read only the outbox projection required for delivery, not arbitrary tenant data;
- billing/entitlement changes do not modify RLS visibility.

## Data-rights gate

Every source adapter must supply a current policy describing at least:
- storage allowed: yes/no/unknown;
- history/caching allowed: yes/no/unknown;
- derived intelligence allowed: yes/no/unknown;
- redistribution allowed: yes/no/unknown;
- attribution requirement;
- purpose/tenant/customer binding;
- evidence reference/version.

`unknown` is not permission. For production durable persistence it is treated as denied until evidence is updated.

The maintained DAJC Driving Bans registry is the first M1 adapter and is treated as a DAJC-maintained public-source dataset for the current implementation. This does not generalize rights to any external provider and does not by itself establish commercial redistribution rights.

## Retention / deletion gate

Retention is deliberately policy-driven, not hard-coded here.

Before production persistence:
- R7 must approve the applicable policy IDs and retention behavior;
- user preference deletion/offboarding behavior must be implemented and tested;
- tenant-private/provider-customer-bound snapshots/history must have an approved deletion/anonymisation/retention path;
- outbox/delivery logs must have bounded retention appropriate to operational/audit needs;
- legal hold, if ever required, must be explicit and auditable;
- backups/caches must be included in the deletion/retention design.

Until these decisions are approved, schema/migration design may be prepared but production persistence remains disabled.

## Migration gate

A future DB migration is allowed only after all of the following are true:
- this contract is reflected in the schema design;
- organization/user ownership paths reuse the current canonical DAJC Platform identity authority;
- RLS policies and negative A-vs-B tests are written;
- source scope/rights fields cannot be omitted or default to permissive values;
- atomic processing/outbox transaction behavior is specified;
- retention policy binding exists and is fail-closed;
- migration rollback/forward-fix strategy exists;
- dedicated non-production validation succeeds;
- current R4/R7 constraints in the master plan are respected.

## M1 exit criteria for persistence design

M1 persistence design can be considered architecture-ready when:
- the application contracts compile and are covered by tests;
- the in-memory test store models tenant/user isolation, idempotency and transaction semantics sufficiently to verify business logic;
- at least the maintained Driving Bans adapter passes end-to-end source → snapshot → history → relevance → outbox tests;
- a DB schema/RLS proposal exists without applying a production migration;
- canonical DAJC Platform identity/RLS helpers have been audited and reflected in the proposal;
- Application CI and Vercel are green;
- master/status documentation matches the actual implementation and blockers.
