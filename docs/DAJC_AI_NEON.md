# DAJC AI — Neon PostgreSQL database (instead of Supabase)

Status on 2026-11-08. Supabase is unchanged (no projects or data were deleted).

## 1. Actual state

| Item | State (checked through the Neon MCP connector in this session) |
|---|---|
| Access | The Neon connector is connected to the Claude Code session. The Neon API is reachable from the sandbox; **the sandbox does not allow direct TCP connections to port 5432** — all database work went through the Neon MCP connector (SQL runs on Neon's side); no connection string or password passed through the sandbox. |
| Organisation | "Miroslav" (`org-winter-glitter-59519495`), **Free** plan, no payment card |
| Project | **`dajc-ai`** (`lively-shadow-23612355`), region **`aws-eu-central-1` (Frankfurt)**, PostgreSQL **17.11**, UTF8 / `C.UTF-8` |
| Branch `production` (default) | empty, no migrations — reserved for the future production |
| Branch `dev` | migrations `drizzle-ask` 0000+0001 and `drizzle-kb` 0000, drizzle migration bookkeeping (same SHA-256 as the files) |
| Branch `dev-security-tests` | test data of the security tests (1 fingerprint, counters, budget, a metric) |
| Branch `dev-kb-tests` | library sample: 3 provisions of Regulation 561/2006 (CS) to verify search |
| Data API | not enabled (404) — the schemas are not exposed over HTTP |
| Free plan | 100 projects, 10 branches/project, 100 CU-hours/project/month, 1 GB/project (20 GB per account), suspend after 5 min of inactivity (cannot be disabled), no card |

The test branches can be deleted when no longer needed (owner's decision;
Claude does not delete them).

## 2. Compatibility (verified on Neon and on a local Neon-like cluster)

| Property | Result |
|---|---|
| Database owner (`dajc_owner`) | **not a superuser**, but has `CREATEROLE`, `CREATEDB`, **`BYPASSRLS`** (member of `neon_superuser`) → the application **must not** use the owner |
| Role created by the migration (`dajc_ask_app`) | no superuser, no `BYPASSRLS`, not in `neon_superuser`, member of no role; the owner sets its password outside the repository (Neon requires ≥ 60 bits of entropy) |
| RLS | enabled on all 8 tables of `dajc_ask`; the app role cannot read metrics |
| Library roles | `dajc_kb_importer` (CI import: adds machine-checked versions only) and `dajc_kb_reviewer` (a person: HUMAN_VERIFIED / REJECTED); separation enforced by grants and triggers (`drizzle-kb/0001`, `DAJC_AI_LEGAL_LIBRARY.md` § 2a) |
| Drizzle ORM + postgres-js | `prepare: false` (already in the code) — compatible with Neon's PgBouncer in `transaction` mode |
| Transactions, `pg_advisory_xact_lock` | work (the lock is transaction-level, not session-level — exactly what the pooler supports) |
| `gen_random_uuid`, `unaccent`, generated `tsvector`, `regconfig` | work on PG 17.11 |
| Czech/Slovak/Polish full text | correct (`ridic`, `prestavku` …) thanks to `C.UTF-8` + `unaccent`; PostgreSQL has no stemmer for them → the library searches by stem prefix |

Local Neon-like cluster (PG 16, `UTF8`/`C.UTF-8`, owner without superuser but
with `CREATEROLE`/`BYPASSRLS`, **PgBouncer 1.22 `pool_mode=transaction`**):
migrations as the owner, tests as `dajc_ask_app` through the pooler.

## 3. Database test results

**On Neon (`dev-security-tests`, PG 17.11, as `dajc_ask_app`):**
- daily limit: 1 → 2 → 3, the fourth question refused, the next day 1 again;
- a budget reservation over the daily cap refused; writing a metric allowed;
  `pg_advisory_xact_lock` works;
- refused by permissions: reading metrics, `DISABLE ROW LEVEL SECURITY`
  ("must be owner"), `TRUNCATE budget`, `CREATE TABLE` in `dajc_ask` and
  `public`, reading the migration bookkeeping, `DELETE review_queue`;
- `dajc_ask_app` is a member of no role and cannot switch to the owner or
  `neon_superuser` (`pg_has_role … SET` = false).
  Note: a test through MCP runs as the owner with `SET ROLE`; PostgreSQL checks
  `SET ROLE` against the session user, so escalation to the owner role was
  verified with `pg_has_role` and, on the local cluster, with a real login as
  the app role.

**On the local Neon-like cluster through PgBouncer (transaction mode), logged in as `dajc_ask_app`:**
- `src/lib/ask/__tests__/db-security.test.ts` 15/15 (including 20 parallel
  questions → exactly 3 allowed; 12 parallel reservations → never over the cap);
- the whole Ask suite with the database 247/247, the library 58/58 (including
  the permissions of `dajc_kb_importer` and `dajc_ask_app`).

**On Neon (`dev-kb-tests`, as `dajc_ask_app`):** the exact library query
"přestávka řízení" → *Nařízení (ES) č. 561/2006 · Článek 7 · s. 7* first; the
application reads only the view `answerable_provisions`, not the tables.

**Remaining risk (owner's decision):** the application role may change its own
counters and budget (it needs this to give a question back after an error).
Whoever obtained its password could overwrite the limits in the database.
Hardening: `SECURITY DEFINER` functions for `consume/refund/reserve/settle` and
removing direct `UPDATE`; proposed after #102 is merged (its migrations
0002/0003 would otherwise collide in numbering).

## 4. Connection and deployment procedure (no passwords in the conversation)

All connection strings and passwords stay in the Neon Console and in Vercel
only; they never go into the repository, GitHub or a conversation.

1. **Neon Console → project `dajc-ai` → Connect.** For the application choose
   the branch, the database `dajc` and enable **Connection pooling** (host with
   `-pooler`, `sslmode=require`); for migrations disable pooling (direct
   connection).
2. **Role passwords** (SQL Editor in the Neon Console, as `dajc_owner`),
   generate ≥ 24 random characters:
   `ALTER ROLE dajc_ask_app WITH LOGIN PASSWORD '<password>';` and for the
   import `ALTER ROLE dajc_kb_importer WITH LOGIN PASSWORD '<password>';`
3. **Migrations on the production branch** (only after approval): from a
   machine with access to Neon,
   `DAJC_ASK_MIGRATION_DB_URL=<owner direct connection> npx drizzle-kit migrate --config drizzle.ask.config.ts`, then
   `DAJC_KB_MIGRATION_DB_URL=<same> npx drizzle-kit migrate --config drizzle.kb.config.ts` (the order matters).
   Check: `DAJC_ASK_TEST_DB_URL=<pooled dajc_ask_app> npx vitest run src/lib/ask`
   — **only on `dev`/a test branch**, the tests write data.
4. **Vercel → Environment Variables → Production**: `DAJC_ASK_DB_URL` = the
   pooled string of the role `dajc_ask_app`. For Preview use the branch `dev`
   (a different string).
5. Do not enable the Neon Data API; neither `dajc_ask` nor `dajc_kb` may be
   exposed.
6. **Full library import into the branch `dev`** (the Claude Code sandbox
   cannot open TCP connections to Neon; the repository is public, so the
   import credential is kept as narrow as possible — `DAJC_AI_LEGAL_LIBRARY.md`
   § 2a):
   - prepared on `dev` through the Neon connector, without any password:
     migration `drizzle-kb` 0001, marker row `dajc_kb.deployment = 'dev'`,
     `ALTER ROLE dajc_kb_importer LOGIN`;
   - **Neon Console → project `dajc-ai` → branch `dev` → Roles →
     `dajc_kb_importer` → Reset password.** Neon generates the password and
     shows it once. Do not type a password into the SQL editor: it keeps a
     query history;
   - **Connect** → branch `dev`, database `dajc`, role `dajc_kb_importer`,
     connection pooling off → copy the connection string;
   - **GitHub → Settings → Environments → New environment `kb-import-dev`**:
     *Required reviewers* = the owner (leave *Prevent self-review* off: the
     owner both starts and approves the run); *Deployment branches and tags* =
     no restriction (a pull-request run is not on a named branch — the
     required reviewer is the protection); **Environment secrets → Add
     secret** `DAJC_KB_DEV_IMPORT_DB_URL` = the copied string. Never create a
     *repository* secret with this name: every workflow on every branch could
     read it;
   - add the label **`kb-import-dev`** to PR #111 → *Review deployments* →
     approve `kb-import-dev` → the workflow imports the 20 EUR-Lex versions
     (AUTO_CHECKED, no AI, free) and keeps the original PDFs as an artifact for
     14 days;
   - after the test the owner may rotate the password (Reset password again)
     or switch the role back to `NOLOGIN`.

## 5. Production environment plan

| Item | Free (internal test) | Production (recommended) |
|---|---|---|
| Plan | Free: 100 CU-hours/month and suspension cannot be disabled; when used up, compute stops until the end of the month → conflicts with "free every day" | **Launch** (no monthly minimum): $0.106/CU-hour, $0.35/GB-month, instant restore $0.20/GB-month, protected branches |
| Branches | `dev` for development, test branches short-lived | protected `production`, `dev` for Preview |
| Backups | 6-hour history | history up to 7 days (Launch) |
| Capacity | 0.25 CU is enough | 0.25–0.5 CU with autoscaling; keep suspension (cold start of a few hundred ms) |

Database operating estimate: `docs/DAJC_AI_LEGAL_LIBRARY.md` § 7.
