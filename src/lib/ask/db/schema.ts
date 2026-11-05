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
import { bigint, bigserial, boolean, date, index, integer, jsonb, pgSchema, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';

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

// ---------------------------------------------------------------------------
// Paid DAJC AI (EUR 15 / month) and customer data rights. See
// docs/DAJC_AI_PAID_OPERATIONS.md. Two groups of tables:
//
// 1. Personal data of one signed-in user (consents, history, memory,
//    usage, cost). They cascade on account deletion and are additionally
//    protected by row-level security keyed to the transaction setting
//    dajc_ask.user_id (drizzle-ask/0003_dajc_ai_paid_security.sql), so a
//    query that forgets its WHERE clause still cannot read another user.
//    Free text (questions, answers, vehicle profiles, comments) is stored
//    only as AES-256-GCM ciphertext bound to the owner (src/lib/ask/crypto.ts).
// 2. Business records needed for billing, audit and accounting sync. They
//    hold no e-mail, card or bank data and are kept after account deletion
//    (legal retention) without a link back to the deleted user's e-mail.
// ---------------------------------------------------------------------------

export const consents = askSchema.table('consents', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  purpose: text('purpose').notNull(),
  version: text('version').notNull(),
  granted: boolean('granted').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index('consents_user_purpose_idx').on(table.userId, table.purpose, table.createdAt)]);

export const history = askSchema.table('history', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  keyId: text('key_id').notNull(),
  ciphertext: text('ciphertext').notNull(),
}, (table) => [
  index('history_user_created_idx').on(table.userId, table.createdAt),
  index('history_expires_idx').on(table.expiresAt),
]);

export const memoryItems = askSchema.table('memory_items', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  kind: text('kind').notNull(),
  keyId: text('key_id').notNull(),
  ciphertext: text('ciphertext').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
}, (table) => [index('memory_items_user_idx').on(table.userId), index('memory_items_expires_idx').on(table.expiresAt)]);

export const feedback = askSchema.table('feedback', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  category: text('category').notNull(),
  answerLevel: text('answer_level').notNull(),
  answerFingerprint: text('answer_fingerprint').notNull(),
  sourceUrls: jsonb('source_urls').notNull().default(sql`'[]'::jsonb`),
  keyId: text('key_id'),
  commentCiphertext: text('comment_ciphertext'),
  sharedLearningConsent: boolean('shared_learning_consent').notNull().default(false),
  status: text('status').notNull().default('NEW'),
}, (table) => [index('feedback_status_idx').on(table.status, table.createdAt)]);

// "D:2026-11-05" and "M:2026-11" counters of paid (fair-use) questions.
export const paidUsage = askSchema.table('paid_usage', {
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  period: text('period').notNull(),
  count: integer('count').notNull().default(0),
}, (table) => [primaryKey({ columns: [table.userId, table.period] })]);

// Per-user monthly AI cost cap of the paid plan, in micro-euros.
export const userCost = askSchema.table('user_cost', {
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  month: text('month').notNull(),
  spentMicro: bigint('spent_micro', { mode: 'number' }).notNull().default(0),
  reservedMicro: bigint('reserved_micro', { mode: 'number' }).notNull().default(0),
}, (table) => [primaryKey({ columns: [table.userId, table.month] })]);

// A checkout started by the server for an authenticated user. The provider
// echoes checkout_ref back in signed events; the user is resolved here,
// never from the event body.
export const billingCheckouts = askSchema.table('billing_checkouts', {
  checkoutRef: text('checkout_ref').primaryKey(),
  userId: uuid('user_id').notNull(),
  provider: text('provider').notNull(),
  amountCents: integer('amount_cents').notNull(),
  currency: text('currency').notNull(),
  status: text('status').notNull().default('OPEN'),
  providerSessionRef: text('provider_session_ref'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
}, (table) => [index('billing_checkouts_user_idx').on(table.userId)]);

export const billingCustomers = askSchema.table('billing_customers', {
  provider: text('provider').notNull(),
  customerRef: text('customer_ref').notNull(),
  userId: uuid('user_id').notNull(),
  subscriptionRef: text('subscription_ref'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [primaryKey({ columns: [table.provider, table.customerRef] }), index('billing_customers_user_idx').on(table.userId)]);

// The subscription ledger (src/lib/ask/paid/subscription.ts) per user, with
// an optimistic version for concurrent webhook deliveries.
export const subscriptions = askSchema.table('subscriptions', {
  userId: uuid('user_id').primaryKey(),
  provider: text('provider').notNull(),
  customerRef: text('customer_ref').notNull(),
  ledger: jsonb('ledger').notNull(),
  version: integer('version').notNull().default(1),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// Idempotency of provider events: (provider, event_id) is processed once.
export const paymentEvents = askSchema.table('payment_events', {
  provider: text('provider').notNull(),
  eventId: text('event_id').notNull(),
  userId: uuid('user_id'),
  kind: text('kind').notNull(),
  payloadSha256: text('payload_sha256').notNull(),
  outcome: text('outcome').notNull(),
  receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [primaryKey({ columns: [table.provider, table.eventId] })]);

export const refundRequests = askSchema.table('refund_requests', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid('user_id').notNull(),
  provider: text('provider').notNull(),
  paymentRef: text('payment_ref').notNull().unique(),
  reason: text('reason').notNull(),
  status: text('status').notNull(),
  decidedBy: text('decided_by'),
  refundRef: text('refund_ref'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  decidedAt: timestamp('decided_at', { withTimezone: true }),
}, (table) => [index('refund_requests_user_idx').on(table.userId)]);

// Append-only, hash-chained audit trail. No e-mail, card, bank or content.
export const auditLog = askSchema.table('audit_log', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  actor: text('actor').notNull(),
  action: text('action').notNull(),
  subject: text('subject').notNull(),
  details: jsonb('details').notNull().default(sql`'{}'::jsonb`),
  prevHash: text('prev_hash').notNull(),
  hash: text('hash').notNull(),
}, (table) => [index('audit_log_subject_idx').on(table.subject, table.id)]);

// Outbox for ABRA Flexi: DAJC records the business event, ABRA stays the
// authority for accounting documents. Personal billing details (if any) are
// encrypted and dropped once the document is synchronised.
export const accountingOutbox = askSchema.table('accounting_outbox', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  idemKey: text('idem_key').notNull().unique(),
  kind: text('kind').notNull(),
  payload: jsonb('payload').notNull(),
  piiKeyId: text('pii_key_id'),
  piiCiphertext: text('pii_ciphertext'),
  status: text('status').notNull().default('PENDING'),
  attempts: integer('attempts').notNull().default(0),
  nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull().defaultNow(),
  lockedUntil: timestamp('locked_until', { withTimezone: true }),
  lastError: text('last_error'),
  externalRef: text('external_ref'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index('accounting_outbox_due_idx').on(table.status, table.nextAttemptAt)]);

// Verified generic answers keyed by a hash of the redacted question, the
// interface language, the Driving Bans dataset version and the day. No user
// reference: identical questions on the same data reuse one checked answer.
export const answerCache = askSchema.table('answer_cache', {
  cacheKey: text('cache_key').primaryKey(),
  answer: jsonb('answer').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
}, (table) => [index('answer_cache_expires_idx').on(table.expiresAt)]);

// Controlled learning (src/lib/ask/learning): proposal -> source check ->
// independent verification -> approval -> publication.
export const knowledgeEntries = askSchema.table('knowledge_entries', {
  id: text('id').primaryKey(),
  origin: text('origin').notNull(),
  topic: text('topic').notNull(),
  jurisdiction: text('jurisdiction'),
  scope: text('scope').notNull(),
  organisationId: text('organisation_id'),
  summary: text('summary').notNull(),
  officialSourceUrl: text('official_source_url').notNull(),
  sourceQuote: text('source_quote').notNull(),
  sourceCheckedAt: timestamp('source_checked_at', { withTimezone: true }).notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  status: text('status').notNull(),
  proposedBy: text('proposed_by').notNull(),
  sourceCheckedBy: text('source_checked_by'),
  verifiedBy: text('verified_by'),
  approvedBy: text('approved_by'),
  reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index('knowledge_entries_topic_idx').on(table.topic, table.status)]);

// Reviewer roles are granted by the owner with an administrative connection
// only; the application role can read them but never write them.
export const reviewers = askSchema.table('reviewers', {
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  role: text('role').notNull(),
  grantedBy: text('granted_by').notNull(),
  grantedAt: timestamp('granted_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [primaryKey({ columns: [table.userId, table.role] })]);
