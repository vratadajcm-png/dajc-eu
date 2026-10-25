// One contract for both stores. The in-memory store always runs; the
// Postgres store runs only when DAJC_ASK_TEST_DB_URL points at a database
// migrated with drizzle-ask/ and is connected as the dajc_ask_app role
// (CI has no database, so there it is skipped - no network in CI).

import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { MemoryAskStore } from '../store/memory';
import type { AskStore } from '../store/types';

const NOW = new Date('2026-10-25T10:00:00Z');
const TEST_DB_URL = process.env.DAJC_ASK_TEST_DB_URL;

function contract(name: string, makeStore: () => AskStore | Promise<AskStore>) {
  describe(`${name} store contract`, () => {
    const unique = () => randomUUID().replace(/-/g, '');

    it('login tokens are single use and expire', async () => {
      const store = await makeStore();
      const hash = unique();
      await store.createLoginToken({ tokenHash: hash, emailHmac: `e-${hash}`, expiresAt: new Date(NOW.getTime() + 60_000) });
      const results = await Promise.all([store.consumeLoginToken(hash, NOW), store.consumeLoginToken(hash, NOW)]);
      expect(results.filter(Boolean)).toEqual([`e-${hash}`]);
      const expired = unique();
      await store.createLoginToken({ tokenHash: expired, emailHmac: 'e', expiresAt: new Date(NOW.getTime() - 1) });
      expect(await store.consumeLoginToken(expired, NOW)).toBeNull();
    });

    it('users and sessions', async () => {
      const store = await makeStore();
      const emailHmac = unique();
      const id = await store.upsertUser(emailHmac, NOW);
      expect(await store.upsertUser(emailHmac, NOW)).toBe(id);
      const tokenHash = unique();
      await store.createSession({ tokenHash, userId: id, expiresAt: new Date(NOW.getTime() + 60_000) });
      expect((await store.getSession(tokenHash, NOW))?.userId).toBe(id);
      expect(await store.getSession(tokenHash, new Date(NOW.getTime() + 120_000))).toBeNull();
      await store.deleteSession(tokenHash);
      expect(await store.getSession(tokenHash, NOW)).toBeNull();
    });

    it('daily usage is atomic under concurrency and refundable', async () => {
      const store = await makeStore();
      const userId = await store.upsertUser(unique(), NOW);
      const results = await Promise.all(Array.from({ length: 8 }, () => store.consumeDailyQuestion(userId, '2026-10-25', 3)));
      expect(results.filter(Boolean)).toHaveLength(3);
      expect(await store.getDailyUsage(userId, '2026-10-25')).toBe(3);
      await store.refundDailyQuestion(userId, '2026-10-25');
      expect(await store.getDailyUsage(userId, '2026-10-25')).toBe(2);
      expect(await store.getDailyUsage(userId, '2026-10-26')).toBe(0);
    });

    it('budget reservations never exceed the monthly or daily cap', async () => {
      const store = await makeStore();
      const caps = { monthKey: `T-${unique()}`, dayKey: `T-${unique()}`, monthlyCapMicro: 1_000, dailyCapMicro: 600 };
      const results = await Promise.all(Array.from({ length: 10 }, () => store.reserveBudget(caps, 200)));
      expect(results.filter(Boolean)).toHaveLength(3);
      await store.settleBudget(caps, 600, 90);
      expect(await store.getBudget(caps)).toEqual({ monthSpentMicro: 90, monthReservedMicro: 0, daySpentMicro: 90, dayReservedMicro: 0 });
      expect(await store.reserveBudget({ ...caps, dailyCapMicro: null }, 900)).toBe(true);
      expect(await store.reserveBudget({ ...caps, dailyCapMicro: null }, 20)).toBe(false);
    });

    it('rate limits per bucket and window', async () => {
      const store = await makeStore();
      const key = `test:${unique()}`;
      const results = [];
      for (let i = 0; i < 4; i++) results.push(await store.hitRateLimit(key, 3600, 3, NOW));
      expect(results).toEqual([true, true, true, false]);
      expect(await store.hitRateLimit(key, 3600, 3, new Date(NOW.getTime() + 2 * 3600_000))).toBe(true);
    });

    it('records metrics and queues review URLs without user data', async () => {
      const store = await makeStore();
      await store.recordMetric({ day: '2026-10-25', level: 'UNKNOWN', language: 'cs', path: 'web', costMicro: 1234, latencyMs: 4567 });
      const url = `https://www.gov.pl/test/${unique()}`;
      await store.enqueueReviewUrls([{ url, jurisdiction: 'PL', topic: 'driving_ban', day: '2026-10-25' }]);
      await store.enqueueReviewUrls([{ url, jurisdiction: 'PL', topic: 'driving_ban', day: '2026-10-26' }]);
      await store.purgeExpired(NOW);
    });
  });
}

contract('memory', () => new MemoryAskStore());

describe.skipIf(!TEST_DB_URL)('postgres', () => {
  let shared: { store: AskStore; end: () => Promise<void> } | null = null;
  afterAll(async () => {
    await shared?.end();
  });
  contract('postgres', async () => {
    if (!shared) {
      const [{ PostgresAskStore }, { drizzle }, { default: postgres }, schema] = await Promise.all([
        import('../store/postgres'), import('drizzle-orm/postgres-js'), import('postgres'), import('../db/schema'),
      ]);
      const client = postgres(TEST_DB_URL!, { max: 4, prepare: false });
      shared = { store: new PostgresAskStore(drizzle(client, { schema })), end: () => client.end() };
    }
    return shared.store;
  });

  it('the application role cannot read measurements back', async () => {
    const { default: postgres } = await import('postgres');
    const client = postgres(TEST_DB_URL!, { max: 1 });
    await expect(client`select * from dajc_ask.metrics`).rejects.toThrow(/permission denied/);
    await client.end();
  });
});
