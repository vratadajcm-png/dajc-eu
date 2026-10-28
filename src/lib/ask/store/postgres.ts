// Postgres implementation of AskStore (schema dajc_ask). Every limit is
// enforced inside the database in one statement or one transaction, so
// parallel serverless instances cannot exceed the daily question limit or
// the cost caps: an UPDATE ... WHERE <limit not reached> takes a row lock
// and re-checks the condition after a concurrent update commits.

import { and, eq, gt, gte, isNull, lt, lte, sql } from 'drizzle-orm';
import { getAskDb, type AskDb } from '../db/client';
import { budget, dailyUsage, loginTokens, metrics, rateEvents, reviewQueue, sessions, users } from '../db/schema';
import type { AskStore, BudgetCaps, BudgetStatus, MetricRow, ReviewQueueEntry } from './types';

class BudgetExceeded extends Error {}

const DAY_MS = 86_400_000;

function rows<T>(result: unknown): T[] {
  return Array.isArray(result) ? (result as T[]) : ((result as { rows?: T[] })?.rows ?? []);
}

export class PostgresAskStore implements AskStore {
  constructor(private readonly db: AskDb) {}

  static fromUrl(url: string): PostgresAskStore {
    return new PostgresAskStore(getAskDb(url));
  }

  async createLoginToken({ tokenHash, emailHmac, expiresAt }: { tokenHash: string; emailHmac: string; expiresAt: Date }) {
    await this.db.insert(loginTokens).values({ tokenHash, emailHmac, expiresAt });
  }

  async consumeLoginToken(tokenHash: string, now: Date) {
    // Compare-and-swap: a replayed or concurrent second use updates nothing.
    const [row] = await this.db.update(loginTokens)
      .set({ consumedAt: now })
      .where(and(eq(loginTokens.tokenHash, tokenHash), isNull(loginTokens.consumedAt), gt(loginTokens.expiresAt, now)))
      .returning({ emailHmac: loginTokens.emailHmac });
    return row?.emailHmac ?? null;
  }

  async upsertUser(emailHmac: string, now: Date) {
    const [row] = await this.db.insert(users)
      .values({ emailHmac, createdAt: now, lastLoginAt: now })
      .onConflictDoUpdate({ target: users.emailHmac, set: { lastLoginAt: now } })
      .returning({ id: users.id });
    return row.id;
  }

  async createSession({ tokenHash, userId, expiresAt }: { tokenHash: string; userId: string; expiresAt: Date }) {
    await this.db.insert(sessions).values({ tokenHash, userId, expiresAt });
  }

  async getSession(tokenHash: string, now: Date) {
    const [row] = await this.db.select({ userId: sessions.userId, expiresAt: sessions.expiresAt })
      .from(sessions)
      .where(and(eq(sessions.tokenHash, tokenHash), gt(sessions.expiresAt, now)))
      .limit(1);
    return row ?? null;
  }

  async deleteSession(tokenHash: string) {
    await this.db.delete(sessions).where(eq(sessions.tokenHash, tokenHash));
  }

  async hitRateLimit(bucketKey: string, windowSeconds: number, max: number, now: Date) {
    const since = new Date(now.getTime() - windowSeconds * 1000);
    const [{ count }] = await this.db.select({ count: sql<number>`count(*)::int` })
      .from(rateEvents)
      .where(and(eq(rateEvents.bucketKey, bucketKey), gte(rateEvents.createdAt, since)));
    // Recorded even when denied, so hammering a refused route keeps it refused.
    await this.db.insert(rateEvents).values({ bucketKey, createdAt: now });
    return count < max;
  }

  async getDailyUsage(userId: string, day: string) {
    const [row] = await this.db.select({ count: dailyUsage.count }).from(dailyUsage)
      .where(and(eq(dailyUsage.userId, userId), eq(dailyUsage.day, day))).limit(1);
    return row?.count ?? 0;
  }

  async consumeDailyQuestion(userId: string, day: string, limit: number) {
    if (limit < 1) return false;
    const result = await this.db.execute(sql`
      insert into ${dailyUsage} as u (user_id, day, count) values (${userId}, ${day}, 1)
      on conflict (user_id, day) do update set count = u.count + 1 where u.count < ${limit}
      returning u.count`);
    return rows(result).length > 0;
  }

  async refundDailyQuestion(userId: string, day: string) {
    await this.db.update(dailyUsage)
      .set({ count: sql`greatest(0, ${dailyUsage.count} - 1)` })
      .where(and(eq(dailyUsage.userId, userId), eq(dailyUsage.day, day)));
  }

  async reserveBudget(caps: BudgetCaps, amountMicro: number) {
    const month = `M:${caps.monthKey}`;
    const day = `D:${caps.dayKey}`;
    try {
      await this.db.transaction(async (tx) => {
        await tx.insert(budget).values([{ period: month }, { period: day }]).onConflictDoNothing();
        // Month first, then day: every transaction locks in the same order.
        const m = await tx.execute(sql`
          update ${budget} set reserved_micro = reserved_micro + ${amountMicro}, updated_at = now()
          where period = ${month} and spent_micro + reserved_micro + ${amountMicro} <= ${caps.monthlyCapMicro}
          returning period`);
        if (rows(m).length === 0) throw new BudgetExceeded();
        const d = caps.dailyCapMicro === null
          ? await tx.execute(sql`update ${budget} set reserved_micro = reserved_micro + ${amountMicro}, updated_at = now() where period = ${day} returning period`)
          : await tx.execute(sql`
              update ${budget} set reserved_micro = reserved_micro + ${amountMicro}, updated_at = now()
              where period = ${day} and spent_micro + reserved_micro + ${amountMicro} <= ${caps.dailyCapMicro}
              returning period`);
        if (rows(d).length === 0) throw new BudgetExceeded();
      });
      return true;
    } catch (error) {
      if (error instanceof BudgetExceeded) return false;
      throw error;
    }
  }

  async settleBudget(caps: Pick<BudgetCaps, 'monthKey' | 'dayKey'>, reservedMicro: number, actualMicro: number) {
    await this.db.execute(sql`
      update ${budget}
      set reserved_micro = greatest(0, reserved_micro - ${reservedMicro}), spent_micro = spent_micro + ${actualMicro}, updated_at = now()
      where period in (${`M:${caps.monthKey}`}, ${`D:${caps.dayKey}`})`);
  }

  async getBudget(caps: Pick<BudgetCaps, 'monthKey' | 'dayKey'>): Promise<BudgetStatus> {
    const found = await this.db.select().from(budget)
      .where(sql`${budget.period} in (${`M:${caps.monthKey}`}, ${`D:${caps.dayKey}`})`);
    const month = found.find((r) => r.period.startsWith('M:'));
    const day = found.find((r) => r.period.startsWith('D:'));
    return {
      monthSpentMicro: Number(month?.spentMicro ?? 0),
      monthReservedMicro: Number(month?.reservedMicro ?? 0),
      daySpentMicro: Number(day?.spentMicro ?? 0),
      dayReservedMicro: Number(day?.reservedMicro ?? 0),
    };
  }

  async recordMetric(row: MetricRow) {
    await this.db.insert(metrics).values({
      day: row.day,
      level: row.level,
      language: row.language.slice(0, 8),
      path: row.path,
      costMicro: Math.min(row.costMicro, 2_000_000_000),
      latencyMs: Math.min(Math.round(row.latencyMs), 2_000_000_000),
    });
  }

  async enqueueReviewUrls(entries: ReviewQueueEntry[]) {
    if (entries.length === 0) return;
    const values = sql.join(entries.map((e) => sql`(${e.url.slice(0, 2000)}, ${e.jurisdiction}, ${e.topic}, ${e.day}, ${e.day})`), sql`, `);
    await this.db.execute(sql`
      insert into ${reviewQueue} as q (url, jurisdiction, topic, first_seen, last_seen) values ${values}
      on conflict (url) do update set last_seen = excluded.last_seen, seen_count = q.seen_count + 1`);
  }

  async purgeExpired(now: Date) {
    await this.db.delete(loginTokens).where(lte(loginTokens.expiresAt, now));
    await this.db.delete(sessions).where(lte(sessions.expiresAt, now));
    await this.db.delete(rateEvents).where(lt(rateEvents.createdAt, new Date(now.getTime() - DAY_MS)));
    const oldDay = new Date(now.getTime() - 35 * DAY_MS).toISOString().slice(0, 10);
    await this.db.delete(dailyUsage).where(lt(dailyUsage.day, oldDay));
  }
}
