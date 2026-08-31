# DAJC Intelligence — DB / RLS Schema Proposal

Status: design-only M1 artifact. **Do not apply as a production migration.**

Authority: `DAJCPLAN003FULL.md` §7.12 + R4/R7, and `docs/INTELLIGENCE_PERSISTENCE_SECURITY_CONTRACT.md`.

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
- `organization_id uuid not null`
- `user_id uuid not null`
- `preferences jsonb not null`
- `revision bigint not null default 0`
- `created_at timestamptz not null`
- `updated_at timestamptz not null`

Suggested key: `(organization_id, user_id)`.

Required checks:
- preferences validated server-side and against a bounded JSON schema;
- revision increment is compare-and-swap / optimistic concurrency;
- user membership in `organization_id` is resolved server-side;
- no arbitrary organization ID accepted from client as authority.

### `intelligence_source_scopes`

Purpose: durable, explicit policy binding for each persisted source scope.

Suggested columns:
- `id uuid primary key`
- `source_id text not null`
- `policy_version text not null`
- `storage_scope text not null` (`public-shared`, `tenant-private`, `provider-customer-bound`)
- `organization_id uuid null`
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
- `organization_id uuid not null`
- `user_id uuid not null`
- `change_id text not null`
- `channel text not null`
- `dedupe_key text not null unique`
- `state text not null` (`pending`, `leased`, `delivered`, `failed`, `suppressed`, `dead-letter`)
- `attempt_count integer not null default 0`
- `available_at timestamptz not null`
- `lease_until timestamptz null`
- `last_error_code text null`
- timestamps

Do not store provider credentials or authorization headers.

### `intelligence_delivery_attempts`

Purpose: sanitized delivery audit.

Suggested columns:
- `id uuid primary key`
- `outbox_id uuid not null`
- `organization_id uuid not null`
- `user_id uuid not null`
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
1. session user maps to `user_id`;
2. session user currently belongs to `organization_id`;
3. server capability permits Intelligence preferences;
4. mutation passes revision check.

Organization membership alone must not permit user A1 to overwrite user A2 preferences.

### Public-shared source state

Public-shared source snapshots/history are not automatically browser-public. `public-shared` describes source storage scope, not UI/API visibility.

Browser access should occur through explicit server projections. Service processing identity may maintain public-shared source state.

### Tenant/private source state

Rows under a tenant/customer-bound `scope_id` are visible only to that organization through approved server projections. Direct browser write is denied.

Provider-customer-bound scope also requires the active customer/mandate binding recorded in the source policy; organization membership cannot invent provider consent.

### Outbox / delivery

End users may see a sanitized notification/history projection for themselves, but cannot claim, lease or mutate delivery worker state.

Delivery worker role receives the minimum outbox projection required for send + result update and cannot browse arbitrary tenant source/history data.

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
- stale membership denial;
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

This proposal may become an actual migration only after:
- R4 ownership/projection model is compatible with the chosen DAJC identity helpers;
- R7 supplies approved retention policy binding(s);
- exact Supabase helper functions/current organization-membership model are audited instead of guessed;
- SQL policies are tested against a dedicated non-production environment with real auth users;
- rollback/forward-fix is documented;
- schema types are regenerated and Application CI/security tests are green;
- production application receives explicit gate approval.
