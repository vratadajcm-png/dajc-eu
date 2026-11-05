// Storage contract for paid DAJC AI and customer data rights. Two
// implementations share it: paid-memory.ts (tests, no network) and
// paid-postgres.ts (schema dajc_ask, migrations 0002/0003).
//
// Rules every implementation keeps:
// - Personal methods take the authenticated userId and touch only that
//   user's rows (Postgres also enforces it with row-level security).
// - Content is stored only as ciphertext produced by crypto.ts.
// - Every method that enforces a limit or an idempotency rule is atomic.
// - Payment events are applied exactly once per (provider, eventId), in
//   the same transaction as the ledger change, the outbox entries and the
//   audit record (applyPaymentEvent).

import type { CardProvider, SubscriptionLedger } from '../paid/subscription';

export const CONSENT_PURPOSES = ['HISTORY', 'MEMORY', 'AI_PERSONAL_CONTEXT', 'DOCUMENT_ANALYSIS', 'SHARED_LEARNING'] as const;
export type ConsentPurpose = (typeof CONSENT_PURPOSES)[number];

export const MEMORY_KINDS = ['VEHICLE', 'CARGO', 'ROUTE', 'PREFERENCE'] as const;
export type MemoryKind = (typeof MEMORY_KINDS)[number];

export const FEEDBACK_CATEGORIES = ['WRONG_FACT', 'OUTDATED', 'MISSING_SOURCE', 'UNCLEAR', 'OTHER'] as const;
export type FeedbackCategory = (typeof FEEDBACK_CATEGORIES)[number];

export interface ConsentState {
  purpose: ConsentPurpose;
  granted: boolean;
  version: string;
  at: Date;
}

export interface SealedRow {
  id: string;
  keyId: string;
  ciphertext: string;
  createdAt: Date;
  expiresAt: Date;
}

export interface MemoryRow extends SealedRow {
  kind: MemoryKind;
  updatedAt: Date;
}

export interface FeedbackRow {
  id: string;
  userId: string | null;
  createdAt: Date;
  category: FeedbackCategory;
  answerLevel: string;
  answerFingerprint: string;
  sourceUrls: string[];
  keyId: string | null;
  commentCiphertext: string | null;
  sharedLearningConsent: boolean;
  status: 'NEW' | 'TRIAGED' | 'PROPOSED' | 'CLOSED';
}

export type PaidQuotaResult = 'ok' | 'daily' | 'monthly';

export interface CheckoutRow {
  checkoutRef: string;
  userId: string;
  provider: CardProvider;
  amountCents: number;
  currency: 'EUR';
  status: 'OPEN' | 'COMPLETED' | 'EXPIRED';
  providerSessionRef: string | null;
  createdAt: Date;
  expiresAt: Date;
}

export interface CustomerRow {
  provider: CardProvider;
  customerRef: string;
  userId: string;
  subscriptionRef: string | null;
}

export interface AuditInput {
  actor: string;
  action: string;
  subject: string;
  details?: Record<string, unknown>;
}

export interface AuditRow extends Required<AuditInput> {
  id: number;
  at: Date;
  prevHash: string;
  hash: string;
}

export type OutboxKind = 'INVOICE' | 'CREDIT_NOTE' | 'PAYMENT_MATCH' | 'GATEWAY_FEE' | 'DISPUTE_NOTICE';

export interface OutboxInput {
  idemKey: string;
  kind: OutboxKind;
  /** Non-personal business data (amounts, references, dates, country). */
  payload: Record<string, unknown>;
  /** Optional personal billing details, already sealed with crypto.ts. */
  pii?: { keyId: string; ciphertext: string } | null;
}

export interface OutboxItem extends OutboxInput {
  id: number;
  status: 'PENDING' | 'SYNCED' | 'DEAD';
  attempts: number;
  nextAttemptAt: Date;
  lastError: string | null;
  externalRef: string | null;
  createdAt: Date;
}

export interface RefundRow {
  id: string;
  userId: string;
  provider: CardProvider;
  paymentRef: string;
  reason: string;
  status: 'PENDING_REVIEW' | 'APPROVED' | 'EXECUTED' | 'REJECTED' | 'FAILED';
  decidedBy: string | null;
  refundRef: string | null;
  createdAt: Date;
  decidedAt: Date | null;
}

export type KnowledgeStatusRow = 'PENDING' | 'SOURCE_CHECKED' | 'VERIFIED' | 'APPROVED' | 'REJECTED' | 'REVOKED';

export interface KnowledgeRow {
  id: string;
  origin: 'OPT_IN_QA_REVIEW' | 'OFFICIAL_SOURCE_REVIEW';
  topic: string;
  jurisdiction: string | null;
  scope: 'GLOBAL' | 'ORGANISATION';
  organisationId: string | null;
  summary: string;
  officialSourceUrl: string;
  sourceQuote: string;
  sourceCheckedAt: Date;
  expiresAt: Date;
  status: KnowledgeStatusRow;
  proposedBy: string;
  sourceCheckedBy: string | null;
  verifiedBy: string | null;
  approvedBy: string | null;
  reviewedAt: Date | null;
  version: number;
}

export interface ApplyPaymentInput {
  provider: CardProvider;
  eventId: string;
  kind: string;
  payloadSha256: string;
  receivedAt: Date;
  /** Resolved server-side (checkout or customer mapping); null = cannot be attributed. */
  userId: string | null;
  customerRef: string | null;
  /** Pure reducer step; throwing rejects the event and rolls everything back. */
  mutate: ((ledger: SubscriptionLedger | null) => SubscriptionLedger) | null;
  outbox: OutboxInput[];
  audit: AuditInput;
  /** Recorded as the event outcome when mutate is null. */
  ignoredOutcome?: 'IGNORED' | 'REJECTED';
}

export interface DataExport {
  consents: ConsentState[];
  history: SealedRow[];
  memory: MemoryRow[];
  feedback: FeedbackRow[];
  usage: Array<{ period: string; count: number }>;
  subscription: SubscriptionLedger | null;
  refunds: RefundRow[];
}

export interface PaidStore {
  // Consents (append-only evidence; the latest row per purpose is current).
  recordConsent(userId: string, purpose: ConsentPurpose, version: string, granted: boolean, now: Date): Promise<void>;
  getConsents(userId: string): Promise<ConsentState[]>;

  // Conversation history and personal memory (ciphertext only).
  addHistory(userId: string, row: Omit<SealedRow, 'id'>, maxEntries: number): Promise<string>;
  listHistory(userId: string, now: Date, limit: number): Promise<SealedRow[]>;
  deleteHistory(userId: string, id: string | 'all'): Promise<number>;
  upsertMemory(userId: string, row: { id: string | null; kind: MemoryKind; keyId: string; ciphertext: string; now: Date; expiresAt: Date }, maxItems: number): Promise<{ status: 'ok'; id: string } | { status: 'limit' | 'not_found' }>;
  listMemory(userId: string, now: Date): Promise<MemoryRow[]>;
  deleteMemory(userId: string, id: string | 'all'): Promise<number>;

  // Feedback ("report an error").
  addFeedback(userId: string, row: Omit<FeedbackRow, 'id' | 'userId' | 'status'>): Promise<string>;
  listFeedback(status: FeedbackRow['status'], limit: number): Promise<FeedbackRow[]>;
  setFeedbackStatus(id: string, status: FeedbackRow['status']): Promise<void>;

  // Paid fair use: questions per day and month, and AI cost per user and month.
  consumePaidQuestion(userId: string, day: string, month: string, dailyLimit: number, monthlyLimit: number): Promise<PaidQuotaResult>;
  refundPaidQuestion(userId: string, day: string, month: string): Promise<void>;
  getPaidUsage(userId: string, day: string, month: string): Promise<{ day: number; month: number }>;
  reserveUserCost(userId: string, month: string, amountMicro: number, capMicro: number): Promise<boolean>;
  settleUserCost(userId: string, month: string, reservedMicro: number, actualMicro: number): Promise<void>;

  // Billing.
  createCheckout(row: CheckoutRow): Promise<void>;
  getCheckout(checkoutRef: string): Promise<CheckoutRow | null>;
  setCheckoutStatus(checkoutRef: string, status: CheckoutRow['status'], providerSessionRef?: string | null): Promise<void>;
  /** Binds a provider customer to a user; 'conflict' if it is bound to someone else. */
  bindCustomer(row: CustomerRow): Promise<'ok' | 'conflict'>;
  findCustomer(provider: CardProvider, customerRef: string): Promise<CustomerRow | null>;
  findCustomersOfUser(userId: string): Promise<CustomerRow[]>;
  getLedger(userId: string): Promise<SubscriptionLedger | null>;
  applyPaymentEvent(input: ApplyPaymentInput): Promise<'applied' | 'duplicate' | 'ignored'>;

  createRefundRequest(row: Omit<RefundRow, 'id' | 'createdAt' | 'decidedAt' | 'decidedBy' | 'refundRef'>, now: Date): Promise<{ status: 'created'; id: string } | { status: 'exists' }>;
  listRefundRequests(userId: string | null, status?: RefundRow['status']): Promise<RefundRow[]>;
  decideRefundRequest(id: string, expected: RefundRow['status'], next: RefundRow['status'], decidedBy: string, now: Date, refundRef?: string | null): Promise<boolean>;

  // Audit trail (append-only, hash-chained).
  appendAudit(entry: AuditInput, now: Date): Promise<void>;
  listAudit(subject: string | null, limit: number): Promise<AuditRow[]>;

  // Accounting outbox (ABRA Flexi).
  enqueueOutbox(items: OutboxInput[], now: Date): Promise<void>;
  /** Leases due items so parallel workers never send the same document twice at once. */
  claimOutbox(now: Date, limit: number, leaseMs: number): Promise<OutboxItem[]>;
  completeOutbox(id: number, externalRef: string, now: Date): Promise<void>;
  failOutbox(id: number, error: string, nextAttemptAt: Date | null, now: Date): Promise<void>;
  listOutbox(status?: OutboxItem['status']): Promise<OutboxItem[]>;

  // Answer cache for identical generic questions on the same data.
  getCachedAnswer(cacheKey: string, now: Date): Promise<unknown | null>;
  putCachedAnswer(cacheKey: string, answer: unknown, expiresAt: Date): Promise<void>;

  // Controlled learning.
  isReviewer(userId: string, role: 'KNOWLEDGE_REVIEWER' | 'BILLING_REVIEWER'): Promise<boolean>;
  insertKnowledge(row: KnowledgeRow, now: Date): Promise<'ok' | 'exists'>;
  getKnowledge(id: string): Promise<KnowledgeRow | null>;
  /** Compare-and-set on status and version (no lost review updates). */
  updateKnowledge(id: string, expected: { status: KnowledgeStatusRow; version: number }, patch: Partial<KnowledgeRow>, now: Date): Promise<boolean>;
  listKnowledge(filter: { status?: KnowledgeStatusRow; topic?: string }): Promise<KnowledgeRow[]>;

  // Data subject rights and retention.
  exportUserData(userId: string): Promise<DataExport>;
  /** Removes the user and every personal row; business records stay pseudonymous. */
  deleteUser(userId: string, now: Date): Promise<void>;
  purgePersonalData(now: Date): Promise<{ history: number; memory: number; feedback: number; checkouts: number; cache: number }>;
}
