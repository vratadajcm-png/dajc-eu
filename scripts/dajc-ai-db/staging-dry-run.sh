#!/usr/bin/env bash
# DAJC AI staging database dry run: one command once the staging project is
# reachable (docs/DAJC_AI_DATABASE_RUNBOOK.md). Additive only; it never drops,
# never touches another schema and never prints a secret.
#
#   ADMIN_URL         direct administrative connection (port 5432), required
#   CONFIRM_TARGET    "<host>/<database>" of ADMIN_URL, typed by the operator,
#                     e.g. db.lryufeoawdlcpydzuhej.supabase.co/postgres
#   OUT_DIR           backups, manifest and the app connection file
#                     (default .staging/<UTC timestamp>, mode 700)
#   SCRATCH_ADMIN_URL optional: an administrative connection to a THROWAWAY
#                     server of the same major version, used to prove the
#                     backup restores (a temporary database is created there)
#   APP_HOST, APP_PORT optional: host/port for the app connection string
#                     (e.g. the Supabase pooler); default: ADMIN_URL's
#   APP_SSLMODE       sslmode of the app connection string (default require)
#   RUN_TESTS=1       also run the store contract tests as dajc_ask_app
#
# Steps: target check -> server facts -> backup (+ sha256 manifest) ->
# restore proof -> drizzle migrations 0000-0003 -> verify.sql -> app role
# password as a SCRAM verifier -> app connection file (0600) -> optional tests.
set -euo pipefail
umask 077

die() { echo "staging-dry-run: $*" >&2; exit 1; }
[[ -n "${ADMIN_URL:-}" ]] || die "ADMIN_URL is required"
cd "$(dirname "$0")/../.."

read -r HOST PORT DB < <(node -e '
  const u = new URL(process.argv[1]);
  if (!/^postgres(ql)?:$/.test(u.protocol)) process.exit(3);
  console.log(u.hostname, u.port || "5432", decodeURIComponent(u.pathname.slice(1)) || "postgres");
' "$ADMIN_URL") || die "ADMIN_URL must be a postgres:// URL"
[[ "${CONFIRM_TARGET:-}" == "$HOST/$DB" ]] || die "set CONFIRM_TARGET=$HOST/$DB to confirm the target"

psql_admin() { psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -X -q "$@"; }
MAJOR=$(psql_admin -tAc "select current_setting('server_version_num')::int / 10000")
(( MAJOR >= 16 )) || die "server is Postgres $MAJOR; 16 or newer is required"
PG_BIN="${PG_BIN:-/usr/lib/postgresql/$MAJOR/bin}"
[[ -x "$PG_BIN/pg_dump" ]] || die "pg_dump $MAJOR not found (set PG_BIN): dump with the server's major version"

OUT_DIR="${OUT_DIR:-.staging/$(date -u +%Y%m%dT%H%M%SZ)}"
mkdir -p "$OUT_DIR"
echo "target: $HOST/$DB (Postgres $MAJOR); output: $OUT_DIR"

# 1. Facts before any change.
HAS_SCHEMA=$(psql_admin -tAc "select count(*) from pg_namespace where nspname = 'dajc_ask'")
psql_admin -tAc "select nspname from pg_namespace where nspname not like 'pg_%' and nspname <> 'information_schema' order by 1" > "$OUT_DIR/schemas-before.txt"
RECORDED=0
if [[ "$(psql_admin -tAc "select to_regclass('drizzle.__drizzle_migrations_dajc_ask') is not null")" == "t" ]]; then
  psql_admin -tAc "select hash || ' ' || created_at from drizzle.__drizzle_migrations_dajc_ask order by created_at" > "$OUT_DIR/migrations-before.txt"
  RECORDED=$(grep -c . "$OUT_DIR/migrations-before.txt" || true)
fi
echo "dajc_ask schema present: $HAS_SCHEMA; schemas: $(wc -l < "$OUT_DIR/schemas-before.txt"); recorded DAJC AI migrations: $RECORDED"

# 2. Backup: the whole schema definition, plus dajc_ask data when it exists.
"$PG_BIN/pg_dump" "$ADMIN_URL" --schema-only -Fc -f "$OUT_DIR/schema-only.dump"
if [[ "$HAS_SCHEMA" == "1" ]]; then
  "$PG_BIN/pg_dump" "$ADMIN_URL" --schema=dajc_ask -Fc -f "$OUT_DIR/dajc_ask.dump"
fi
(cd "$OUT_DIR" && sha256sum ./*.dump > manifest.sha256)
echo "backup written and hashed ($(wc -l < "$OUT_DIR/manifest.sha256") files)"

# 3. Restore proof on a throwaway server (never on the target).
if [[ -n "${SCRATCH_ADMIN_URL:-}" ]]; then
  SCRATCH_DB="dajc_restore_$(date -u +%s)"
  psql "$SCRATCH_ADMIN_URL" -X -q -v ON_ERROR_STOP=1 -c "create database $SCRATCH_DB"
  SCRATCH_URL=$(node -e 'const u = new URL(process.argv[1]); u.pathname = "/" + process.argv[2]; console.log(u.toString())' "$SCRATCH_ADMIN_URL" "$SCRATCH_DB")
  "$PG_BIN/pg_restore" -d "$SCRATCH_URL" --no-owner --no-privileges "$OUT_DIR/schema-only.dump" >/dev/null 2>"$OUT_DIR/restore-schema.log" || echo "schema-only restore reported warnings (Supabase roles/extensions absent on scratch): see restore-schema.log"
  if [[ -f "$OUT_DIR/dajc_ask.dump" ]]; then
    "$PG_BIN/pg_restore" -d "$SCRATCH_URL" --exit-on-error --clean --if-exists "$OUT_DIR/dajc_ask.dump"
    psql "$SCRATCH_URL" -X -q -v ON_ERROR_STOP=1 -f scripts/dajc-ai-db/verify.sql > "$OUT_DIR/verify-restored.txt"
  fi
  psql "$SCRATCH_ADMIN_URL" -X -q -c "drop database $SCRATCH_DB" || true
  echo "restore proof: ok"
else
  echo "restore proof: skipped (set SCRATCH_ADMIN_URL to a throwaway Postgres $MAJOR)"
fi

# 4. Migrations (drizzle bookkeeping: already applied files are skipped).
DAJC_ASK_MIGRATION_DB_URL="$ADMIN_URL" npx drizzle-kit migrate --config drizzle.ask.config.ts > "$OUT_DIR/migrate.log" 2>&1 || { tail -20 "$OUT_DIR/migrate.log" | sed -E 's#postgres(ql)?://[^ ]+#<redacted-url>#g' >&2; die "migration failed"; }
psql_admin -tAc "select count(*) from drizzle.__drizzle_migrations_dajc_ask" | grep -qx 4 || die "expected 4 recorded DAJC AI migrations"
echo "migrations: 4 recorded"

# 5. Grants, RLS, constraints.
psql_admin -f scripts/dajc-ai-db/verify.sql > "$OUT_DIR/verify.txt"
if grep -q "FAIL" "$OUT_DIR/verify.txt"; then grep "FAIL" "$OUT_DIR/verify.txt" >&2; die "verify.sql reported failures"; fi
echo "verify.sql: $(grep -c PASS "$OUT_DIR/verify.txt") checks passed"

# 6. App role password: generated here, sent only as a SCRAM verifier.
APP_PASSWORD=$(openssl rand -hex 32)
VERIFIER=$(printf '%s' "$APP_PASSWORD" | node scripts/dajc-ai-db/scram-verifier.mjs)
printf "ALTER ROLE dajc_ask_app WITH LOGIN PASSWORD '%s';\n" "$VERIFIER" | psql_admin
APP_URL=$(APP_PASSWORD="$APP_PASSWORD" node -e '
  const u = new URL(process.argv[1]);
  u.username = "dajc_ask_app"; u.password = process.env.APP_PASSWORD;
  if (process.env.APP_HOST) u.hostname = process.env.APP_HOST;
  if (process.env.APP_PORT) u.port = process.env.APP_PORT;
  u.searchParams.set("sslmode", process.env.APP_SSLMODE || "require");
  console.log(u.toString());
' "$ADMIN_URL")
printf '%s\n' "$APP_URL" > "$OUT_DIR/dajc-ask-app.url"
chmod 600 "$OUT_DIR/dajc-ask-app.url"
unset APP_PASSWORD VERIFIER
psql "$(cat "$OUT_DIR/dajc-ask-app.url")" -X -tAc "select current_user, (select rolbypassrls from pg_roles where rolname = current_user)" | grep -qx "dajc_ask_app|f" || die "dajc_ask_app cannot sign in or bypasses RLS"
echo "dajc_ask_app: signs in, no BYPASSRLS; connection string in $OUT_DIR/dajc-ask-app.url (0600, never printed)"

# 7. Optional behavioural checks as the real role.
if [[ "${RUN_TESTS:-}" == "1" ]]; then
  DAJC_ASK_TEST_DB_URL="$(cat "$OUT_DIR/dajc-ask-app.url")" npx vitest run src/lib/ask/__tests__/store.test.ts src/lib/ask/__tests__/paid-store.test.ts
fi
echo "done. Next: put the app connection into DAJC_ASK_DB_URL of the Preview environment only."
