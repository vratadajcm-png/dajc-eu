// In-memory PaidStore for tests. Same semantics as paid-postgres.ts within a
// single process (JavaScript runs each method to completion between awaits,
// so the read-check-write steps below are atomic here).

import { randomUUID } from 'node:crypto';
import { AUDIT_GENESIS, auditDetails, auditHash } from '../audit';
import type { CardProvider, SubscriptionLedger } from '../paid/subscription';
import type { MemoryAskStore } from './memory';
import type {
  ApplyPaymentInput, AuditInput, AuditRow, CheckoutRow, ConsentPurpose, ConsentState, CustomerRow, DataExport,
  FeedbackRow, KnowledgeRow, KnowledgeStatusRow, MemoryKind, MemoryRow, OutboxInput, OutboxItem, PaidQuotaResult,
  PaidStore, RefundRow, SealedRow,
} from './paid-types';

const clone = <T>(value: T): T => structuredClone(value);

export class MemoryPaidStore implements PaidStore {
  consents: Array<{ userId: string; purpose: ConsentPurpose; version: string; granted: boolean; at: Date }> = [];
  history: Array<SealedRow & { userId: string }> = [];
  memory: Array<MemoryRow & { userId: string }> = [];
  feedback: FeedbackRow[] = [];
  usage = new Map<string, number>();
  cost = new Map<string, { spent: number; reserved: number }>();
  checkouts = new Map<string, CheckoutRow>();
  customers = new Map<string, CustomerRow>();
  ledgers = new Map<string, { provider: CardProvider; customerRef: string; ledger: SubscriptionLedger }>();
  events = new Map<string, { userId: string | null; kind: string; outcome: string }>();
  refunds: RefundRow[] = [];
  audit: AuditRow[] = [];
  outbox: Array<OutboxItem & { lockedUntil: Date | null }> = [];
  cache = new Map<string, { answer: unknown; expiresAt: Date }>();
  knowledge = new Map<string, KnowledgeRow>();
  reviewerRoles = new Set<string>();
  /** Simulates an outage of the database for failure tests. */
  failNext: string | null = null;
  private outboxId = 1;

  constructor(private readonly users?: MemoryAskStore) {}

  private maybeFail(method: string) {
    if (this.failNext === method) {
      this.failNext = null;
      throw new Error(`simulated database failure in ${method}`);
    }
  }

  async recordConsent(userId: string, purpose: ConsentPurpose, version: string, granted: boolean, now: Date) {
    this.consents.push({ userId, purpose, version, granted, at: now });
  }

  async getConsents(userId: string): Promise<ConsentState[]> {
    const latest = new Map<ConsentPurpose, ConsentState>();
    for (const row of this.consents) if (row.userId === userId) latest.set(row.purpose, { purpose: row.purpose, granted: row.granted, version: row.version, at: row.at });
    return [...latest.values()];
  }

  async addHistory(userId: string, row: Omit<SealedRow, 'id'>, maxEntries: number) {
    const id = randomUUID();
    this.history.push({ ...row, id, userId });
    const mine = this.history.filter((h) => h.userId === userId).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    const drop = new Set(mine.slice(maxEntries).map((h) => h.id));
    this.history = this.history.filter((h) => !drop.has(h.id));
    return id;
  }

  async listHistory(userId: string, now: Date, limit: number) {
    return this.history.filter((h) => h.userId === userId && h.expiresAt > now)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, limit)
      .map(({ userId: _u, ...row }) => clone(row));
  }

  async deleteHistory(userId: string, id: string | 'all') {
    const before = this.history.length;
    this.history = this.history.filter((h) => !(h.userId === userId && (id === 'all' || h.id === id)));
    return before - this.history.length;
  }

  async upsertMemory(userId: string, row: { id: string | null; kind: MemoryKind; keyId: string; ciphertext: string; now: Date; expiresAt: Date }, maxItems: number) {
    if (row.id) {
      const existing = this.memory.find((m) => m.id === row.id && m.userId === userId);
      if (!existing) return { status: 'not_found' as const };
      Object.assign(existing, { kind: row.kind, keyId: row.keyId, ciphertext: row.ciphertext, updatedAt: row.now, expiresAt: row.expiresAt });
      return { status: 'ok' as const, id: existing.id };
    }
    if (this.memory.filter((m) => m.userId === userId).length >= maxItems) return { status: 'limit' as const };
    const id = randomUUID();
    this.memory.push({ id, userId, kind: row.kind, keyId: row.keyId, ciphertext: row.ciphertext, createdAt: row.now, updatedAt: row.now, expiresAt: row.expiresAt });
    return { status: 'ok' as const, id };
  }

  async listMemory(userId: string, now: Date) {
    return this.memory.filter((m) => m.userId === userId && m.expiresAt > now)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .map(({ userId: _u, ...row }) => clone(row));
  }

  async deleteMemory(userId: string, id: string | 'all') {
    const before = this.memory.length;
    this.memory = this.memory.filter((m) => !(m.userId === userId && (id === 'all' || m.id === id)));
    return before - this.memory.length;
  }

  async addFeedback(userId: string, row: Omit<FeedbackRow, 'id' | 'userId' | 'status'>) {
    const id = randomUUID();
    this.feedback.push({ ...clone(row), id, userId, status: 'NEW' });
    return id;
  }

  async listFeedback(status: FeedbackRow['status'], limit: number) {
    return this.feedback.filter((f) => f.status === status).slice(0, limit).map(clone);
  }

  async setFeedbackStatus(id: string, status: FeedbackRow['status']) {
    const row = this.feedback.find((f) => f.id === id);
    if (row) row.status = status;
  }

  async consumePaidQuestion(userId: string, day: string, month: string, dailyLimit: number, monthlyLimit: number): Promise<PaidQuotaResult> {
    const d = `${userId}|D:${day}`;
    const m = `${userId}|M:${month}`;
    if ((this.usage.get(d) ?? 0) >= dailyLimit) return 'daily';
    if ((this.usage.get(m) ?? 0) >= monthlyLimit) return 'monthly';
    this.usage.set(d, (this.usage.get(d) ?? 0) + 1);
    this.usage.set(m, (this.usage.get(m) ?? 0) + 1);
    return 'ok';
  }

  async refundPaidQuestion(userId: string, day: string, month: string) {
    for (const key of [`${userId}|D:${day}`, `${userId}|M:${month}`]) this.usage.set(key, Math.max(0, (this.usage.get(key) ?? 0) - 1));
  }

  async getPaidUsage(userId: string, day: string, month: string) {
    return { day: this.usage.get(`${userId}|D:${day}`) ?? 0, month: this.usage.get(`${userId}|M:${month}`) ?? 0 };
  }

  private costRow(userId: string, month: string) {
    const key = `${userId}|${month}`;
    if (!this.cost.has(key)) this.cost.set(key, { spent: 0, reserved: 0 });
    return this.cost.get(key)!;
  }

  async reserveUserCost(userId: string, month: string, amountMicro: number, capMicro: number) {
    const row = this.costRow(userId, month);
    if (row.spent + row.reserved + amountMicro > capMicro) return false;
    row.reserved += amountMicro;
    return true;
  }

  async settleUserCost(userId: string, month: string, reservedMicro: number, actualMicro: number) {
    const row = this.costRow(userId, month);
    row.reserved = Math.max(0, row.reserved - reservedMicro);
    row.spent += actualMicro;
  }

  async createCheckout(row: CheckoutRow) {
    if (this.checkouts.has(row.checkoutRef)) throw new Error('duplicate checkout');
    this.checkouts.set(row.checkoutRef, clone(row));
  }

  async getCheckout(checkoutRef: string) {
    const row = this.checkouts.get(checkoutRef);
    return row ? clone(row) : null;
  }

  async setCheckoutStatus(checkoutRef: string, status: CheckoutRow['status'], providerSessionRef?: string | null) {
    const row = this.checkouts.get(checkoutRef);
    if (!row) return;
    row.status = status;
    if (providerSessionRef !== undefined) row.providerSessionRef = providerSessionRef;
  }

  async bindCustomer(row: CustomerRow) {
    const key = `${row.provider}|${row.customerRef}`;
    const existing = this.customers.get(key);
    if (existing && existing.userId !== row.userId) return 'conflict' as const;
    this.customers.set(key, { ...row, subscriptionRef: row.subscriptionRef ?? existing?.subscriptionRef ?? null });
    return 'ok' as const;
  }

  async findCustomer(provider: CardProvider, customerRef: string) {
    const row = this.customers.get(`${provider}|${customerRef}`);
    return row ? clone(row) : null;
  }

  async findCustomersOfUser(userId: string) {
    return [...this.customers.values()].filter((c) => c.userId === userId).map(clone);
  }

  async getLedger(userId: string) {
    const row = this.ledgers.get(userId);
    return row ? clone(row.ledger) : null;
  }

  async applyPaymentEvent(input: ApplyPaymentInput) {
    this.maybeFail('applyPaymentEvent');
    const key = `${input.provider}|${input.eventId}`;
    if (this.events.has(key)) return 'duplicate' as const;
    let next: SubscriptionLedger | null = null;
    if (input.mutate && input.userId) {
      // Throws on an invalid event: nothing below is recorded (rollback).
      next = input.mutate(this.ledgers.has(input.userId) ? clone(this.ledgers.get(input.userId)!.ledger) : null);
    }
    this.events.set(key, { userId: input.userId, kind: input.kind, outcome: next ? 'APPLIED' : input.ignoredOutcome ?? 'IGNORED' });
    if (next && input.userId) this.ledgers.set(input.userId, { provider: next.provider, customerRef: next.customerRef, ledger: trimLedger(next) });
    await this.enqueueOutbox(input.outbox, input.receivedAt);
    await this.appendAudit(input.audit, input.receivedAt);
    return next ? 'applied' as const : 'ignored' as const;
  }

  async createRefundRequest(row: Omit<RefundRow, 'id' | 'createdAt' | 'decidedAt' | 'decidedBy' | 'refundRef'>, now: Date) {
    if (this.refunds.some((r) => r.paymentRef === row.paymentRef)) return { status: 'exists' as const };
    const id = randomUUID();
    this.refunds.push({ ...row, id, createdAt: now, decidedAt: null, decidedBy: null, refundRef: null });
    return { status: 'created' as const, id };
  }

  async listRefundRequests(userId: string | null, status?: RefundRow['status']) {
    return this.refunds.filter((r) => (userId === null || r.userId === userId) && (!status || r.status === status)).map(clone);
  }

  async decideRefundRequest(id: string, expected: RefundRow['status'], next: RefundRow['status'], decidedBy: string, now: Date, refundRef: string | null = null) {
    const row = this.refunds.find((r) => r.id === id);
    if (!row || row.status !== expected) return false;
    Object.assign(row, { status: next, decidedBy, decidedAt: now, refundRef: refundRef ?? row.refundRef });
    return true;
  }

  async appendAudit(entry: AuditInput, now: Date) {
    const full = { actor: entry.actor, action: entry.action, subject: entry.subject, details: auditDetails(entry.details) };
    const prevHash = this.audit.at(-1)?.hash ?? AUDIT_GENESIS;
    this.audit.push({ ...full, id: this.audit.length + 1, at: now, prevHash, hash: auditHash(prevHash, full, now) });
  }

  async listAudit(subject: string | null, limit: number) {
    return this.audit.filter((a) => subject === null || a.subject === subject).slice(-limit).map(clone);
  }

  async enqueueOutbox(items: OutboxInput[], now: Date) {
    for (const item of items) {
      if (this.outbox.some((o) => o.idemKey === item.idemKey)) continue;
      this.outbox.push({ ...clone(item), pii: item.pii ?? null, id: this.outboxId++, status: 'PENDING', attempts: 0, nextAttemptAt: now, lastError: null, externalRef: null, createdAt: now, lockedUntil: null });
    }
  }

  async claimOutbox(now: Date, limit: number, leaseMs: number) {
    const due = this.outbox.filter((o) => o.status === 'PENDING' && o.nextAttemptAt <= now && (!o.lockedUntil || o.lockedUntil <= now))
      .sort((a, b) => a.id - b.id).slice(0, limit);
    for (const item of due) item.lockedUntil = new Date(now.getTime() + leaseMs);
    return due.map(({ lockedUntil: _l, ...item }) => clone(item));
  }

  async completeOutbox(id: number, externalRef: string, now: Date) {
    const item = this.outbox.find((o) => o.id === id);
    if (!item) return;
    Object.assign(item, { status: 'SYNCED', externalRef, lockedUntil: null, pii: null, lastError: null, attempts: item.attempts + 1, nextAttemptAt: now });
  }

  async failOutbox(id: number, error: string, nextAttemptAt: Date | null, now: Date) {
    const item = this.outbox.find((o) => o.id === id);
    if (!item) return;
    Object.assign(item, { attempts: item.attempts + 1, lastError: error.slice(0, 500), lockedUntil: null, status: nextAttemptAt ? 'PENDING' : 'DEAD', nextAttemptAt: nextAttemptAt ?? now });
  }

  async listOutbox(status?: OutboxItem['status']) {
    return this.outbox.filter((o) => !status || o.status === status).map(({ lockedUntil: _l, ...item }) => clone(item));
  }

  async getCachedAnswer(cacheKey: string, now: Date) {
    const row = this.cache.get(cacheKey);
    return row && row.expiresAt > now ? clone(row.answer) : null;
  }

  async putCachedAnswer(cacheKey: string, answer: unknown, expiresAt: Date) {
    this.cache.set(cacheKey, { answer: clone(answer), expiresAt });
  }

  async isReviewer(userId: string, role: 'KNOWLEDGE_REVIEWER' | 'BILLING_REVIEWER') {
    return this.reviewerRoles.has(`${userId}|${role}`);
  }

  async insertKnowledge(row: KnowledgeRow) {
    if (this.knowledge.has(row.id)) return 'exists' as const;
    this.knowledge.set(row.id, clone(row));
    return 'ok' as const;
  }

  async getKnowledge(id: string) {
    const row = this.knowledge.get(id);
    return row ? clone(row) : null;
  }

  async updateKnowledge(id: string, expected: { status: KnowledgeStatusRow; version: number }, patch: Partial<KnowledgeRow>) {
    const row = this.knowledge.get(id);
    if (!row || row.status !== expected.status || row.version !== expected.version) return false;
    const next = { ...row, ...clone(patch), version: row.version + 1 };
    // Same four-eyes rule as the database constraint.
    if (next.sourceCheckedBy && next.sourceCheckedBy === next.proposedBy) throw new Error('FOUR_EYES');
    if (next.verifiedBy && (next.verifiedBy === next.proposedBy || next.verifiedBy === next.sourceCheckedBy)) throw new Error('FOUR_EYES');
    if (next.approvedBy && next.approvedBy === next.proposedBy) throw new Error('FOUR_EYES');
    this.knowledge.set(id, next);
    return true;
  }

  async listKnowledge(filter: { status?: KnowledgeStatusRow; topic?: string }) {
    return [...this.knowledge.values()].filter((k) => (!filter.status || k.status === filter.status) && (!filter.topic || k.topic === filter.topic)).map(clone);
  }

  async exportUserData(userId: string): Promise<DataExport> {
    const usage = [...this.usage.entries()].filter(([key]) => key.startsWith(`${userId}|`)).map(([key, count]) => ({ period: key.split('|')[1], count }));
    return {
      consents: await this.getConsents(userId),
      history: this.history.filter((h) => h.userId === userId).map(({ userId: _u, ...row }) => clone(row)),
      memory: this.memory.filter((m) => m.userId === userId).map(({ userId: _u, ...row }) => clone(row)),
      feedback: this.feedback.filter((f) => f.userId === userId).map(clone),
      usage,
      subscription: await this.getLedger(userId),
      refunds: await this.listRefundRequests(userId),
    };
  }

  async deleteUser(userId: string, now: Date) {
    this.consents = this.consents.filter((c) => c.userId !== userId);
    this.history = this.history.filter((h) => h.userId !== userId);
    this.memory = this.memory.filter((m) => m.userId !== userId);
    for (const f of this.feedback) if (f.userId === userId) Object.assign(f, { userId: null, commentCiphertext: null, keyId: null });
    for (const key of [...this.usage.keys()]) if (key.startsWith(`${userId}|`)) this.usage.delete(key);
    for (const key of [...this.cost.keys()]) if (key.startsWith(`${userId}|`)) this.cost.delete(key);
    for (const [ref, checkout] of this.checkouts) if (checkout.userId === userId && checkout.status === 'OPEN') this.checkouts.delete(ref);
    if (this.users) {
      for (const [hmac, user] of this.users.users) if (user.id === userId) this.users.users.delete(hmac);
      for (const [hash, session] of this.users.sessions) if (session.userId === userId) this.users.sessions.delete(hash);
    }
    await this.appendAudit({ actor: `user:${userId}`, action: 'ACCOUNT_DELETED', subject: `user:${userId}` }, now);
  }

  async purgePersonalData(now: Date) {
    const h = this.history.length;
    const m = this.memory.length;
    this.history = this.history.filter((x) => x.expiresAt > now);
    this.memory = this.memory.filter((x) => x.expiresAt > now);
    let feedback = 0;
    const cutoff = now.getTime() - 365 * 86_400_000;
    for (const f of this.feedback) {
      if (f.createdAt.getTime() < cutoff && f.commentCiphertext) {
        f.commentCiphertext = null;
        f.keyId = null;
        feedback += 1;
      }
    }
    let checkouts = 0;
    for (const [ref, c] of this.checkouts) if (c.status === 'OPEN' && c.expiresAt <= now) { c.status = 'EXPIRED'; checkouts += 1; void ref; }
    let cache = 0;
    for (const [key, c] of this.cache) if (c.expiresAt <= now) { this.cache.delete(key); cache += 1; }
    return { history: h - this.history.length, memory: m - this.memory.length, feedback, checkouts, cache };
  }
}

/** Bounded idempotency memory in the stored ledger; the events table is authoritative. */
export function trimLedger(ledger: SubscriptionLedger): SubscriptionLedger {
  return { ...ledger, seenEventIds: ledger.seenEventIds.slice(-200) };
}
