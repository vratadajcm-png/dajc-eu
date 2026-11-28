// In-memory AskStore for tests. Same semantics as postgres.ts; single
// process only, so it is never used by the deployed routes.

import type { AskStore, BudgetCaps, BudgetStatus, MetricRow, ReviewQueueEntry } from './types';

export class MemoryAskStore implements AskStore {
  loginTokens = new Map<string, { emailHmac: string; expiresAt: Date; consumedAt: Date | null }>();
  users = new Map<string, { id: string; createdAt: Date; lastLoginAt: Date }>();
  sessions = new Map<string, { userId: string; expiresAt: Date }>();
  rate = new Map<string, Date[]>();
  usage = new Map<string, number>();
  budget = new Map<string, { spent: number; reserved: number }>();
  metrics: MetricRow[] = [];
  reviewQueue = new Map<string, ReviewQueueEntry & { seenCount: number; lastSeen: string }>();
  private nextId = 1;

  async createLoginToken({ tokenHash, emailHmac, expiresAt }: { tokenHash: string; emailHmac: string; expiresAt: Date }) {
    this.loginTokens.set(tokenHash, { emailHmac, expiresAt, consumedAt: null });
  }

  async consumeLoginToken(tokenHash: string, now: Date) {
    const token = this.loginTokens.get(tokenHash);
    if (!token || token.consumedAt || token.expiresAt.getTime() <= now.getTime()) return null;
    token.consumedAt = now;
    return token.emailHmac;
  }

  async upsertUser(emailHmac: string, now: Date) {
    const existing = this.users.get(emailHmac);
    if (existing) {
      existing.lastLoginAt = now;
      return existing.id;
    }
    const id = `user-${this.nextId++}`;
    this.users.set(emailHmac, { id, createdAt: now, lastLoginAt: now });
    return id;
  }

  async createSession({ tokenHash, userId, expiresAt }: { tokenHash: string; userId: string; expiresAt: Date }) {
    this.sessions.set(tokenHash, { userId, expiresAt });
  }

  async getSession(tokenHash: string, now: Date) {
    const session = this.sessions.get(tokenHash);
    if (!session || session.expiresAt.getTime() <= now.getTime()) return null;
    return { ...session };
  }

  async deleteSession(tokenHash: string) {
    this.sessions.delete(tokenHash);
  }

  async hitRateLimit(bucketKey: string, windowSeconds: number, max: number, now: Date) {
    const since = now.getTime() - windowSeconds * 1000;
    const hits = (this.rate.get(bucketKey) || []).filter((d) => d.getTime() > since);
    const allowed = hits.length < max;
    hits.push(now);
    this.rate.set(bucketKey, hits);
    return allowed;
  }

  async getDailyUsage(userId: string, day: string) {
    return this.usage.get(`${userId}|${day}`) || 0;
  }

  async consumeDailyQuestion(userId: string, day: string, limit: number) {
    const key = `${userId}|${day}`;
    const used = this.usage.get(key) || 0;
    if (used >= limit) return false;
    this.usage.set(key, used + 1);
    return true;
  }

  async refundDailyQuestion(userId: string, day: string) {
    const key = `${userId}|${day}`;
    this.usage.set(key, Math.max(0, (this.usage.get(key) || 0) - 1));
  }

  private row(key: string) {
    if (!this.budget.has(key)) this.budget.set(key, { spent: 0, reserved: 0 });
    return this.budget.get(key)!;
  }

  async reserveBudget(caps: BudgetCaps, amountMicro: number) {
    const month = this.row(`M:${caps.monthKey}`);
    const day = this.row(`D:${caps.dayKey}`);
    if (month.spent + month.reserved + amountMicro > caps.monthlyCapMicro) return false;
    if (caps.dailyCapMicro !== null && day.spent + day.reserved + amountMicro > caps.dailyCapMicro) return false;
    month.reserved += amountMicro;
    day.reserved += amountMicro;
    return true;
  }

  async settleBudget(caps: Pick<BudgetCaps, 'monthKey' | 'dayKey'>, reservedMicro: number, actualMicro: number) {
    for (const key of [`M:${caps.monthKey}`, `D:${caps.dayKey}`]) {
      const r = this.row(key);
      r.reserved = Math.max(0, r.reserved - reservedMicro);
      r.spent += actualMicro;
    }
  }

  async getBudget(caps: Pick<BudgetCaps, 'monthKey' | 'dayKey'>): Promise<BudgetStatus> {
    const month = this.row(`M:${caps.monthKey}`);
    const day = this.row(`D:${caps.dayKey}`);
    return { monthSpentMicro: month.spent, monthReservedMicro: month.reserved, daySpentMicro: day.spent, dayReservedMicro: day.reserved };
  }

  async recordMetric(row: MetricRow) {
    this.metrics.push(row);
  }

  async enqueueReviewUrls(entries: ReviewQueueEntry[]) {
    for (const entry of entries) {
      const existing = this.reviewQueue.get(entry.url);
      if (existing) {
        existing.seenCount += 1;
        existing.lastSeen = entry.day;
      } else {
        this.reviewQueue.set(entry.url, { ...entry, seenCount: 1, lastSeen: entry.day });
      }
    }
  }

  async purgeExpired(now: Date) {
    for (const [key, token] of this.loginTokens) if (token.expiresAt.getTime() <= now.getTime()) this.loginTokens.delete(key);
    for (const [key, session] of this.sessions) if (session.expiresAt.getTime() <= now.getTime()) this.sessions.delete(key);
  }
}
