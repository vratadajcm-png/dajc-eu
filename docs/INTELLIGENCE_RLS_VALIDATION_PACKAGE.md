# DAJC Intelligence — Non-Production RLS Validation Package

Status: design/test package only. **Not a migration. Do not execute against production.**

Authority: `DAJCPLAN003FULL.md` §7.12 + R4/R7, `INTELLIGENCE_PERSISTENCE_SECURITY_CONTRACT.md`, `INTELLIGENCE_DB_SCHEMA_PROPOSAL.md`.

## Objective

Prove that the proposed DAJC Intelligence persistence model can reuse the canonical DAJC Platform identity boundary without creating a parallel tenant system and without allowing cross-organization or cross-user access.

This package defines test identities, expected authorization outcomes and transaction invariants. It intentionally does not contain production-ready DDL, service-role credentials or a production migration number.

## Canonical identity assumptions to re-read immediately before any executable SQL is prepared

Current verified baseline (2026-08-31):
- user identity = `auth.uid()` / `profiles.id`;
- organization = `organizations.id`;
- user organization = `profiles.org_id`;
- tenant helper = `current_org_id()`;
- server actor = `requireProfile()` → `{ userId, orgId, role, canDrive }`;
- ordinary authenticated clients cannot freely mutate sensitive profile columns such as `org_id`.

If any of those assumptions has changed in HaulBoard, this package must be updated before testing.

## Required dedicated non-production actors

Use synthetic identities only.

- `org-a`
  - `user-a1` — regular authenticated member
  - `user-a2` — second authenticated member in the same org
- `org-b`
  - `user-b1` — regular authenticated member
- one dedicated processing worker identity/role available only to server-side test execution

Do not use a founder/admin production account as a substitute for negative RLS testing.

## Required seed scopes

1. `public-shared` source scope
   - source: synthetic public authority source
   - no organization binding
   - storage/history/derived = allowed
   - redistribution = unknown
   - approved test-only retention binding

2. `tenant-private` scope for `org-a`
   - storage/history/derived = allowed
   - redistribution = denied

3. `tenant-private` scope for `org-b`

4. `provider-customer-bound` scope for `org-a`
   - with explicit synthetic customer binding

5. `provider-customer-bound` scope missing customer binding
   - expected to remain inactive / denied

6. source scope with `storage=unknown`

7. source scope with `history=unknown`

8. source scope with retention status `pending-legal`

## Preference RLS matrix

| Actor | Target row | Expected |
| --- | --- | --- |
| user-a1 | org-a/user-a1 | allow read/write with valid revision |
| user-a1 | org-a/user-a2 | deny write; deny private preference read unless an explicit product requirement later authorizes a projection |
| user-a2 | org-a/user-a1 | deny write |
| user-a1 | org-b/user-b1 | deny read/write |
| user-b1 | org-a/user-a1 | deny read/write |
| anonymous | any preference | deny |
| stale/deleted profile | previous own row | deny |

## Source/history RLS matrix

| Actor | Scope | Expected |
| --- | --- | --- |
| normal browser user | public-shared raw/current source table | deny direct write; direct read only if an explicit projection exists |
| user-a1 | org-a tenant-private projection | allow only approved projection |
| user-a1 | org-b tenant-private | deny |
| user-b1 | org-a tenant-private | deny |
| user-a1 | org-a provider-customer-bound with valid binding | allow only approved projection |
| user-a1 | provider-customer-bound missing binding | deny |
| processing worker | active source scope required for processing | allow minimal processing operations only |
| browser impersonating/guessing worker capability | any worker operation | deny |

## Required negative tests

### RLS-INT-001 — organization A cannot read organization B preferences

Authenticated as `user-a1`, query a known `org-b/user-b1` preference row by exact IDs.

Expected: zero visible rows / authorization denial. No data leakage in error details.

### RLS-INT-002 — same-org users remain private at preference level

Authenticated as `user-a1`, attempt to update `user-a2` preferences while keeping `organization_id=org-a`.

Expected: denial. Organization membership alone is insufficient.

### RLS-INT-003 — client-supplied organization ID is not authority

Authenticated as `user-a1`, submit a mutation payload claiming `organization_id=org-b`.

Expected: server/RLS resolves canonical org-a and rejects the mismatch.

### RLS-INT-004 — stale profile loses access

Remove/deactivate the test profile or organization binding using the same lifecycle mechanism used by DAJC Platform. Reuse the old authenticated session where technically possible.

Expected: Intelligence access fails closed.

### RLS-INT-005 — guessed source scope ID cannot cross tenant

Authenticated as `user-b1`, query known org-a tenant-private scope/history identifiers.

Expected: denial / zero rows.

### RLS-INT-006 — provider-customer-bound requires binding

Attempt activation/persistence for a provider-customer-bound source without `customer_binding_id`.

Expected: schema/policy/application contract rejection before source data is persisted.

### RLS-INT-007 — unknown storage rights stop persistence

Use a source policy with `storage=unknown`.

Expected: no snapshot, history or outbox writes.

### RLS-INT-008 — unknown history rights stop history persistence

Storage allowed, history unknown.

Expected: source processing cannot persist history under the durable production path. It must not silently downgrade to history storage.

### RLS-INT-009 — pending retention stops durable persistence

Use `retention.status=pending-legal`.

Expected: durable snapshot/history persistence denied. No guessed fallback duration.

### RLS-INT-010 — partial source snapshot cannot cancel unseen items

Seed prior complete snapshot with A+B. Process a partial snapshot containing only A.

Expected: B remains current; no `cancelled` change for B.

### RLS-INT-011 — complete snapshot may cancel confirmed disappearance

Seed A+B. Process a complete snapshot containing only A.

Expected: exactly one cancellation for B and at most one deduplicated alert per matching user/channel.

### RLS-INT-012 — duplicate processing is idempotent

Replay the same observed snapshot/change cycle.

Expected: no duplicate history change ID and no duplicate outbox dedupe key.

### RLS-INT-013 — atomic rollback

Inject a deterministic failure after history calculation but before transaction completion.

Expected after rollback:
- previous snapshot remains unchanged;
- no new history row;
- no new outbox row;
- no delivery attempt.

Repeat with failure after candidate/outbox preparation and before snapshot reconciliation. Same expected result.

### RLS-INT-014 — billing cannot broaden data visibility

Toggle a synthetic entitlement from free→paid for `user-b1` while targeting org-a data.

Expected: RLS visibility remains denied. Entitlement affects feature availability only.

### RLS-INT-015 — worker role is not browser-accessible

Attempt worker-only claim/lease operations from an ordinary authenticated browser context.

Expected: deny.

### RLS-INT-016 — outbox ownership is user + organization scoped

Authenticated as user-a1, attempt to inspect/alter user-a2 and user-b1 outbox rows.

Expected: deny. User-facing notification projections, if exposed later, are read-only and sanitized.

### RLS-INT-017 — redistribution remains dual-gated

Use snapshot provenance `redistribution-allowed` but source-rights `redistribution=unknown`, then reverse the combination.

Expected: both denied. Only explicit allow + explicit allow may pass the application rights gate; RLS still does not create an external API permission.

## Transaction validation contract

The eventual non-production repository/RPC should prove one transaction boundary for:

1. lock active source scope;
2. validate rights and retention;
3. read current snapshot;
4. register source run/completeness;
5. append deduplicated change history;
6. enqueue deduplicated alert outbox rows;
7. reconcile current snapshot according to complete/partial semantics;
8. commit.

Any exception before step 8 must leave all durable state at the prior committed cycle.

## Delivery-worker validation

Production delivery adapters remain disabled during this gate. A fake deterministic delivery adapter may be used only in non-production tests.

Validate:
- pending → leased;
- lease expiry → failed/available again;
- retryable failure uses bounded retry;
- max attempts → dead-letter;
- permanent failure → dead-letter immediately;
- suppressed entitlement/channel → suppressed, no network call;
- delivered dedupe key is never re-enqueued;
- sanitized audit contains no authorization headers, tokens or provider credentials.

## Evidence required to close this validation gate

For each test record:
- test ID;
- exact git commit / migration candidate SHA;
- non-production environment identifier;
- actor used;
- SQL/API action performed;
- observed row count/result;
- pass/fail;
- sanitized log or CI evidence;
- reviewer/date.

Do not use screenshots alone as the only proof for RLS behavior.

## Exit criteria

This package is ready for execution only when:
- R4 canonical ownership/projection model is sufficiently stable for these tables;
- R7 has approved the retention policy IDs needed for the test migration candidate;
- exact current Platform helpers/policies are re-read immediately before writing SQL;
- a dedicated non-production Supabase environment and synthetic actors exist;
- migration candidate is explicitly marked non-production and has rollback/forward-fix notes.

Passing this package does **not** activate production persistence. Production still requires the explicit gate in `DAJCPLAN003FULL.md` and the normal DAJC release/security process.
