// Database security of the Ask schema, seen from the application role itself.
// Runs only when DAJC_ASK_TEST_DB_URL points at a database migrated with
// drizzle-ask/ and connects AS dajc_ask_app (session user = app role), ideally
// through a transaction-mode pooler (Neon's PgBouncer pooler, pool_mode=
// transaction). CI has no database, so there it is skipped like store.test.ts.
//
// What it proves (docs/DAJC_AI_NEON.md):
//   - the app role is not a superuser, cannot bypass RLS and is member of no role,
//     so it cannot become the table owner (on Neon the owner has BYPASSRLS);
//   - it cannot read measurements, change table definitions, disable RLS,
//     truncate, create objects or read the migration bookkeeping;
//   - the free daily limit and the cost caps hold under parallel requests
//     through the pooler (atomic SQL, transaction-level advisory locks).

import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import type { AskStore } from '../store/types';

const TEST_DB_URL = process.env.DAJC_ASK_TEST_DB_URL;

describe.skipIf(!TEST_DB_URL)('Ask database security as the application role', () => {
  let sqlClient: any;
  let store: AskStore;
  const ends: Array<() => Promise<void>> = [];

  async function client() {
    if (!sqlClient) {
      const { default: postgres } = await import('postgres');
      sqlClient = postgres(TEST_DB_URL!, { max: 8, prepare: false, onnotice: () => undefined });
      ends.push(() => sqlClient.end());
      const [{ PostgresAskStore }, { drizzle }, schema] = await Promise.all([
        import('../store/postgres'), import('drizzle-orm/postgres-js'), import('../db/schema'),
      ]);
      store = new PostgresAskStore(drizzle(sqlClient, { schema }));
    }
    return sqlClient;
  }

  afterAll(async () => {
    for (const end of ends) await end();
  });

  async function denied(statement: string, pattern: RegExp) {
    const sql = await client();
    await expect(sql.unsafe(statement)).rejects.toThrow(pattern);
  }

  it('is the least-privileged app role: no superuser, no BYPASSRLS, member of no role', async () => {
    const sql = await client();
    const [me] = await sql`
      select current_user as role, session_user as session, r.rolsuper, r.rolbypassrls, r.rolcreaterole, r.rolcreatedb,
             (select count(*)::int from pg_auth_members m where m.member = r.oid) as memberships
      from pg_roles r where r.rolname = current_user`;
    expect(me).toMatchObject({ role: 'dajc_ask_app', session: 'dajc_ask_app', rolsuper: false, rolbypassrls: false, rolcreaterole: false, rolcreatedb: false, memberships: 0 });
  });

  it('cannot become the table owner (who has BYPASSRLS on Neon)', async () => {
    const sql = await client();
    const [{ owner }] = await sql`select tableowner as owner from pg_tables where schemaname = 'dajc_ask' and tablename = 'users'`;
    expect(owner).not.toBe('dajc_ask_app');
    await denied(`set role "${owner}"`, /permission denied/);
  });

  it.each([
    ['read measurements', 'select count(*) from dajc_ask.metrics', /permission denied for table metrics/],
    ['delete measurements', 'delete from dajc_ask.metrics', /permission denied for table metrics/],
    ['disable RLS', 'alter table dajc_ask.daily_usage disable row level security', /must be owner/],
    ['drop a policy', 'drop policy dajc_ask_app_rw on dajc_ask.daily_usage', /must be owner/],
    ['truncate the budget', 'truncate dajc_ask.budget', /permission denied for table budget/],
    ['create a table in dajc_ask', 'create table dajc_ask.evil (x int)', /permission denied for schema dajc_ask/],
    ['create a table in public', 'create table public.evil (x int)', /permission denied for schema public/],
    ['read migration bookkeeping', 'select * from drizzle.__drizzle_migrations_dajc_ask', /permission denied for schema drizzle/],
    ['empty the review queue', 'delete from dajc_ask.review_queue', /permission denied for table review_queue/],
    ['create a role', 'create role evil login', /permission denied to create role/],
  ])('cannot %s', async (_name, statement, pattern) => {
    await denied(statement, pattern);
  });

  it('stores only fingerprints: the users table has no e-mail address column', async () => {
    const sql = await client();
    const columns = (await sql`select column_name from information_schema.columns where table_schema = 'dajc_ask' and table_name = 'users'`).map((r: any) => r.column_name);
    expect(columns).toEqual(expect.arrayContaining(['email_hmac']));
    expect(columns.some((c: string) => /^email$|address/.test(c))).toBe(false);
  });

  it('keeps the free daily limit exact under 20 parallel questions through the pooler', async () => {
    await client();
    const userId = await store.upsertUser(`sec-${randomUUID()}`, new Date('2026-11-08T10:00:00Z'));
    const decisions = await Promise.all(Array.from({ length: 20 }, () => store.consumeDailyQuestion(userId, '2026-11-08', 3)));
    expect(decisions.filter(Boolean)).toHaveLength(3);
    expect(await store.getDailyUsage(userId, '2026-11-08')).toBe(3);
    // The next Prague day is free again.
    expect(await store.consumeDailyQuestion(userId, '2026-11-09', 3)).toBe(true);
  });

  it('never reserves past the daily cost cap under parallel reservations', async () => {
    await client();
    const key = randomUUID().slice(0, 8);
    const caps = { monthKey: `T-${key}`, dayKey: `T-${key}-d`, monthlyCapMicro: 100_000_000, dailyCapMicro: 1_000_000 };
    const results = await Promise.all(Array.from({ length: 12 }, () => store.reserveBudget(caps, 240_000)));
    // 4 x 0.24 EUR fit under a 1 EUR daily cap, the 5th would not.
    expect(results.filter(Boolean)).toHaveLength(4);
    const status = await store.getBudget(caps);
    expect(status.dayReservedMicro).toBe(960_000);
    expect(status.dayReservedMicro).toBeLessThanOrEqual(caps.dailyCapMicro);
  });
});
