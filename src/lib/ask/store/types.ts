// Storage contract for "Ask DAJC AI". Two implementations share it:
// memory.ts (tests, no network) and postgres.ts (schema dajc_ask). Every
// method that enforces a limit is atomic in both, so concurrent requests
// cannot exceed the daily question limit or the cost caps.
//
// What is stored (data minimisation, §47.3):
//   - users: only an HMAC fingerprint of the e-mail (never the address);
//   - login tokens and sessions: only SHA-256 hashes, deleted after expiry;
//   - daily usage: user, day, count;
//   - budget: spent and reserved micro-euros per month and per day;
//   - metrics: one row per answered question WITHOUT any user reference,
//     question text or answer text;
//   - review queue: official URLs only - no user, no question, no e-mail;
//   - rate-limit events: HMAC fingerprints of IP/e-mail, kept for one day.

export interface BudgetCaps {
  monthKey: string;
  dayKey: string;
  monthlyCapMicro: number;
  dailyCapMicro: number | null;
}

export interface BudgetStatus {
  monthSpentMicro: number;
  monthReservedMicro: number;
  daySpentMicro: number;
  dayReservedMicro: number;
}

export interface MetricRow {
  day: string;
  level: 'VERIFIED' | 'PARTIAL' | 'UNKNOWN' | 'SYSTEM_ERROR';
  language: string;
  path: 'own' | 'web' | 'mixed' | 'none';
  costMicro: number;
  latencyMs: number;
}

export interface ReviewQueueEntry {
  url: string;
  jurisdiction: string | null;
  topic: string;
  day: string;
}

export interface AskStore {
  createLoginToken(input: { tokenHash: string; emailHmac: string; expiresAt: Date }): Promise<void>;
  /** Single-use: marks the token consumed and returns its e-mail fingerprint, or null. */
  consumeLoginToken(tokenHash: string, now: Date): Promise<string | null>;
  upsertUser(emailHmac: string, now: Date): Promise<string>;
  createSession(input: { tokenHash: string; userId: string; expiresAt: Date }): Promise<void>;
  getSession(tokenHash: string, now: Date): Promise<{ userId: string; expiresAt: Date } | null>;
  deleteSession(tokenHash: string): Promise<void>;

  /** Records an attempt and reports whether it is within `max` per window. */
  hitRateLimit(bucketKey: string, windowSeconds: number, max: number, now: Date): Promise<boolean>;

  getDailyUsage(userId: string, day: string): Promise<number>;
  /** Atomically takes one question from the day's allowance; false when the limit is reached. */
  consumeDailyQuestion(userId: string, day: string, limit: number): Promise<boolean>;
  /** Gives the question back after a system error. */
  refundDailyQuestion(userId: string, day: string): Promise<void>;

  /** Atomically reserves `amountMicro` in both the month and the day; false if a cap would be exceeded. */
  reserveBudget(caps: BudgetCaps, amountMicro: number): Promise<boolean>;
  /** Replaces a reservation with the actual cost. */
  settleBudget(caps: Pick<BudgetCaps, 'monthKey' | 'dayKey'>, reservedMicro: number, actualMicro: number): Promise<void>;
  getBudget(caps: Pick<BudgetCaps, 'monthKey' | 'dayKey'>): Promise<BudgetStatus>;

  recordMetric(row: MetricRow): Promise<void>;
  enqueueReviewUrls(entries: ReviewQueueEntry[]): Promise<void>;

  /** Deletes expired tokens/sessions and old usage and rate-limit rows. */
  purgeExpired(now: Date): Promise<void>;
}
