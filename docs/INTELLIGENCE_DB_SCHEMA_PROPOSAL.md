# DAJC Intelligence — DB / RLS Schema Proposal

Status: design-only M1 artifact. **Do not apply as a production migration.**

Authority: `DAJCPLAN003FULL.md` §7.12 + R4/R7, and `docs/INTELLIGENCE_PERSISTENCE_SECURITY_CONTRACT.md`.

## Canonical DAJC identity mapping — verified 2026-08-31

Intelligence must reuse the existing DAJC Platform authentication and organization model from `vratadajcm-png/HaulBoard`; it must not create a second account, organization or membership authority on dajc.eu.

Verified current canonical model:
- `organizations.id` is the organization primary key;
- `profiles.id` references `auth.users(id)` and is the authenticated DAJC user identity;
- `profiles.org_id` references `organizations.id` and is the user's canonical organization binding;
- current RLS helper `current_org_id()` resolves `profiles.org_id` for `auth.uid()`;
- current `requireProfile()` server actor context returns `{ userId, orgId, role, canDrive }` from the authenticated user/profile;
- later profile hardening explicitly prevents normal authenticated clients from updating sensitive identity/authorization columns such as `org_id`, `role` and platform-admin state.

Therefore the proposed Intelligence model uses:
- `organization_id` → canonical `organizations.id`;
- `user_id` → canonical `profiles.id` / `auth.users.id`;
- user/org ownership resolved from the existing authenticated actor context, never from client-supplied authority fields;
- existing `current_org_id()` semantics as the starting RLS tenant boundary where suitable, with user-private rows additionally requiring `user_id = auth.uid()`;
- no standalone `intelligence_users`, `intelligence_organizations` or duplicate membership tables.

Current evidence still represents a single canonical `profiles.org_id` organization binding per authenticated user. If the Platform later introduces a multi-organization membership authority, Intelligence must migrate to that canonical authority rather than inventing its own abstraction.

Verified implementation evidence used for this design:
- `HaulBoard/supabase/migrations/20260709120001_core_tables.sql` — `organizations`, `profiles`, `profiles.org_id`;
- `HaulBoard/supabase/migrations/20260709120008_rls_helper_functions.sql` — `current_org_id()` and role/access helpers;
- `HaulBoard/supabase/migrations/20260709120009_rls_organizations_profiles_invitations.sql` — organization/profile RLS;
- `HaulBoard/supabase/migrations/20260719071500_lock_profiles_sensitive_columns.sql` — sensitive profile columns, including `org_id`, cannot be freely client-mutated;
- `HaulBoard/lib/auth/require-profile.ts` — canonical server actor context `{ userId, orgId, role, canDrive }`.

## Design goals

- explicit organization/user ownership;
- fail-closed source rights and retention binding;
- append-only change history;
- idempotent alert outbox;
- one atomic processing transaction;
- browser/client cannot obtain service-processing privileges;
- public-source data and tenant/customer-bound provider data are not conflated;
- no billing logic in RLS.

## Proposed logical tables

### `intelligence_preferences`

Purpose: saved jurisdictions/corridors/vehicle profile/alert mode per user.

Suggested columns:
- `organization_id uuid not null references organizations(id)`
- `user_id uuid not null references profiles(id)`
- `preferences jsonb not null`
- `revision bigint not null default 0`
- `created_at timestamptz not null`
- `updated_at timestamptz not null`

Suggested key: `(organization_id, user_id)`.

Required checks:
- preferences validated server-side and against a bounded JSON schema;
- revision increment is compare-and-swap / optimistic concurrency;
- authenticated ownership is resolved from the canonical DAJC actor context (`auth.uid()` + profile/org binding);
- `organization_id` must equal the actor's canonical `profiles.org_id` / `current_org_id()` result;
- `user_id` must equal `auth.uid()` for user-private preference access;
- no arbitrary organization/user ID accepted from client as authority.

### `intelligence_source_scopes`

Purpose: durable, explicit policy binding for each persisted source scope.

Suggested columns:
- `id uuid primary key`
- `source_id text not null`
- `policy_version text not null`
- `storage_scope text not null` (`public-shared`, `tenant-private`, `provider-customer-bound`)
- `organization_id uuid null references organizations(id)`
- `customer_binding_id text null`
- `storage_decision text not null`
- `history_decision text not null`
- `derived_decision text not null`
- `redistribution_decision text not null`
- `retention_policy_id text not null`
- `evidence_reference text not null`
- `purpose text not null`
- `active boolean not null default false`
- timestamps

Required constraints:
- `public-shared` requires `organization_id is null`;
- tenant/customer-bound scopes require `organization_id is not null`;
- provider-customer-bound additionally requires `customer_binding_id is not null`;
- rights decisions have no permissive default;
- `active=true` only when storage/history/retention gates needed by the use case are approved.

### `intelligence_source_snapshots`

Purpose: current reconciled source state.

Suggested columns:
- `scope_id uuid not null`
- `item_key text not null`
- `fingerprint text not null`
- `jurisdiction text not null`
- `topic text not null`
- `materiality text not null`
- `effective_from timestamptz null`
- `effective_to timestamptz null`
- `summary text not null`
- `normalized_payload jsonb not null`
- `source_url text null`
- `source_label text null`
- `observed_at timestamptz not null`
- `adapter_version text not null`
- timestamps

Suggested unique key: `(scope_id, item_key)`.

Raw provider payload should not be duplicated here unless current source rights explicitly allow raw storage and the raw fields are needed. Prefer normalized operational fields plus provenance pointers.

### `intelligence_snapshot_runs`

Purpose: audit each source evaluation and protect cancellation semantics.

Suggested columns:
- `id uuid primary key`
- `scope_id uuid not null`
- `observed_at timestamptz not null`
- `complete boolean not null`
- `warning_count integer not null`
- `warnings jsonb null` (sanitized)
- `source_item_count integer not null`
- `adapter_version text not null`
- `result text not null`
- timestamps

Cancellation/removal is allowed only from a successful `complete=true` run for the same scope.

### `intelligence_change_history`

Purpose: append-only normalized changes.

Suggested columns:
- `change_id text primary key`
- `scope_id uuid not null`
- `item_key text not null`
- `change_type text not null`
- `jurisdiction text not null`
- `topic text not null`
- `materiality text not null`
- `previous_fingerprint text null`
- `current_fingerprint text null`
- `observed_at timestamptz not null`
- `effective_from timestamptz null`
- `effective_to timestamptz null`
- `summary text not null`
- provenance reference fields
- `created_at timestamptz not null`

Application contract: no UPDATE/DELETE for ordinary processing. Corrections are new events or explicit supersession records.

### `intelligence_alert_outbox`

Purpose: durable notification queue.

Suggested columns:
- `id uuid primary key`
- `organization_id uuid not null references organizations(id)`
- `user_id uuid not null references profiles(id)`
- `change_id text not null`
- `channel text not null`
- `dedupe_key text not null unique`
- `state text not null` (`pending`, `leased`, `delivered`, `failed`, `suppressed`, `dead-letter`)
- `attempt_count integer not null default 0`
- `available_at timestamptz not null`
- `lease_until timestamptz null`
- `last_error_code text null`
- timestamps

The current M1 application implementation already models these states plus bounded exponential retry, lease expiry recovery and dead-letter behavior. All concrete production delivery adapters remain disabled; the state machine is architecture/testing only until the persistence/privacy/security gate is closed.

Do not store provider credentials or authorization headers.

### `intelligence_delivery_attempts`

Purpose: sanitized delivery audit.

Suggested columns:
- `id uuid primary key`
- `outbox_id uuid not null`
- `organization_id uuid not null references organizations(id)`
- `user_id uuid not null references profiles(id)`
- `channel text not null`
- `provider_reference text null`
- `attempt_number integer not null`
- `result text not null`
- `sanitized_error_code text null`
- `attempted_at timestamptz not null`

Full message body copies are not a default requirement and should not be persisted unless an approved operational/legal purpose requires them.

## RLS / access proposal

### Preferences

Authenticated user may read/write only when:
1. `user_id = auth.uid()`;
2. `organization_id = current_org_id()`;
3. the canonical profile still exists and belongs to that organization;
4. server capability permits Intelligence preferences;
5. mutation passes revision check.

Organization membership alone must not permit user A1 to overwrite user A2 preferences. Ordinary client updates must never mutate the canonical `profiles.org_id` merely to reach different Intelligence rows.

### Public-shared source state

Public-shared source snapshots/history are not automatically browser-public. `public-shared` describes source storage scope, not UI/API visibility.

Browser access should occur through explicit server projections. Service processing identity may maintain public-shared source state.

### Tenant/private source state

Rows under a tenant/customer-bound `scope_id` are visible only to the canonical `current_org_id()` organization through approved server projections. Direct browser write is denied.

Provider-customer-bound scope also requires the active customer/mandate binding recorded in the source policy; organization membership cannot invent provider consent.

### Outbox / delivery

End users may see a sanitized notification/history projection for themselves when both `organization_id = current_org_id()` and `user_id = auth.uid()`, but cannot claim, lease or mutate delivery worker state.

Delivery worker role receives the minimum outbox projection required for send + result update and cannot browse arbitrary tenant source/history data. It must not be exposed to browser/client code.

## Atomic processing transaction

A future repository operation should approximately behave as one database transaction:

1. resolve and lock active `intelligence_source_scopes` row;
2. verify rights + approved retention policy;
3. read current scoped snapshot;
4. insert snapshot run record;
5. calculate/insert append-only change events with conflict-safe dedupe;
6. calculate/insert user/org-scoped outbox rows with unique dedupe keys;
7. upsert/reconcile current snapshot only under complete/partial rules;
8. commit.

On any error, rollback the entire cycle.

Delivery occurs in a separate worker transaction and never inside source fetch/change-detection execution.

## Mandatory negative tests before migration activation

- org A versus org B preference read/write denial;
- user A1 versus A2 preference mutation denial;
- stale/missing canonical profile denial;
- attempted client manipulation of `organization_id` / `profiles.org_id` does not broaden access;
- guessed source scope ID denial;
- tenant-bound source/history cross-org denial;
- provider-customer-bound scope without active binding denial;
- browser/client use of processing-service role denial;
- unknown storage/history rights denial;
- pending/disabled retention policy denial;
- duplicate source cycle does not duplicate history/outbox;
- partial snapshot does not cancel unseen prior items;
- complete snapshot can create cancellation deterministically;
- failed transaction leaves no partial history/outbox/snapshot mutation;
- billing entitlement change does not broaden RLS data visibility.

## Migration readiness checklist

This proposal remains non-executable. No SQL from this document may be applied merely because M1 application tests are green.

It may become an actual migration only after:
- R4 ownership/projection model remains compatible with the verified canonical `profiles.id/auth.uid()` + `profiles.org_id/organizations.id` identity boundary;
- R7 supplies approved retention policy binding(s);
- exact production helper/function versions are re-read immediately before SQL implementation rather than copied from a stale snapshot;
- SQL policies are tested against a dedicated non-production environment with real auth users from at least two organizations and two users in one organization;
- rollback/forward-fix is documented;
- schema types are regenerated and Application CI/security tests are green;
- production application receives explicit gate approval.
