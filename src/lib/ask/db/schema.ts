// Database schema for "Ask DAJC AI": its own Postgres schema `dajc_ask`,
// separate from the Partner Portal tables in `public` (src/portal/db). The
// application connects with its own least-privileged role (dajc_ask_app,
// see drizzle-ask/0001_dajc_ask_security.sql) through DAJC_ASK_DB_URL; the
// schema is not exposed through the Supabase Data API and anon /
// authenticated have no rights in it.
//
// See src/lib/ask/store/types.ts for what each table holds and, as
// importantly, what it never holds (e-mail addresses, questions, answers).

import { sql } from 'drizzle-orm';
import { bigint, bigserial, date, index, integer, pgSchema, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const askSchema = pgSchema('dajc_ask');

export const users = askSchema.table('users', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  // HMAC-SHA256(DAJC_ASK_EMAIL_PEPPER, normalized e-mail). Never the address.
  emailHmac: text('email_hmac').notNull().unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }).notNull().defaultNow(),
});

export const loginTokens = askSchema.table('login_tokens', {
  tokenHash: text('token_hash').primaryKey(),
  emailHmac: text('email_hmac').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  consumedAt: timestamp('consumed_at', { withTimezone: true }),
}, (table) => [index('login_tokens_expires_idx').on(table.expiresAt)]);

export const sessions = askSchema.table('sessions', {
  tokenHash: text('token_hash').primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
}, (table) => [index('sessions_expires_idx').on(table.expiresAt)]);

export const dailyUsage = askSchema.table('daily_usage', {
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  day: date('day').notNull(),
  count: integer('count').notNull().default(0),
}, (table) => [primaryKey({ columns: [table.userId, table.day] })]);

// One row per period: "M:2026-10" (month) and "D:2026-10-25" (day), in
// integer micro-euros.
export const budget = askSchema.table('budget', {
  period: text('period').primaryKey(),
  spentMicro: bigint('spent_micro', { mode: 'number' }).notNull().default(0),
  reservedMicro: bigint('reserved_micro', { mode: 'number' }).notNull().default(0),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// Measurement without content: no user reference, no question, no answer.
export const metrics = askSchema.table('metrics', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  day: date('day').notNull(),
  level: text('level').notNull(),
  language: text('language').notNull(),
  path: text('path').notNull(),
  costMicro: integer('cost_micro').notNull(),
  latencyMs: integer('latency_ms').notNull(),
}, (table) => [index('metrics_day_idx').on(table.day)]);

// New official URLs for human review (§47.2 step 8). URLs only - no user,
// no question, no e-mail. Nothing here is ever written into data/.
export const reviewQueue = askSchema.table('review_queue', {
  url: text('url').primaryKey(),
  jurisdiction: text('jurisdiction'),
  topic: text('topic').notNull(),
  firstSeen: date('first_seen').notNull(),
  lastSeen: date('last_seen').notNull(),
  seenCount: integer('seen_count').notNull().default(1),
  status: text('status').notNull().default('NEW'),
});

export const rateEvents = askSchema.table('rate_events', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  bucketKey: text('bucket_key').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index('rate_events_bucket_idx').on(table.bucketKey, table.createdAt)]);
