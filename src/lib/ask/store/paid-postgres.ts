// Postgres implementation of PaidStore (schema dajc_ask, migrations 0002 and
// 0003). Personal data is read and written only inside a transaction that
// first sets dajc_ask.user_id to the authenticated user, so row-level
// security limits every statement to that user's rows. Cross-user
// maintenance (retention purge, account deletion, review queues) runs with
// dajc_ask.scope = 'system'. Neither setting ever comes from a request.

import { sql, type SQL } from 'drizzle-orm';
import { AUDIT_GENESIS, auditDetails, auditHash } from '../audit';
import type { AskDb } from '../db/client';
import { getAskDb } from '../db/client';
import type { CardProvider, SubscriptionLedger } from '../paid/subscription';
import { trimLedger } from './paid-memory';
import type {
  ApplyPaymentInput, AuditInput, AuditRow, CheckoutRow, ConsentPurpose, ConsentState, CustomerRow, DataExport,
  FeedbackRow, KnowledgeRow, KnowledgeStatusRow, MemoryKind, MemoryRow, OperationalSummary, OutboxInput, OutboxItem,
  PaidQuotaResult, PaidStore, RefundRow, SealedRow,
} from './paid-types';

type Tx = Parameters<Parameters<AskDb['transaction']>[0]>[0];
type Row = Record<string, any>;

function rows(result: unknown): Row[] {
  return Array.isArray(result) ? (result as Row[]) : ((result as { rows?: Row[] })?.rows ?? []);
}

/** postgres-js with prepare:false needs timestamps as strings in raw SQL. */
const iso = (value: Date | null): string | null => (value ? value.toISOString() : null);
const date = (value: unknown): Date => (value instanceof Date ? value : new Date(String(value)));
const dateOrNull = (value: unknown): Date | null => (value === null || value === undefined ? null : date(value));

class LedgerRejected extends Error {}

function sealedRow(r: Row): SealedRow {
  return { id: r.id, keyId: r.key_id, ciphertext: r.ciphertext, createdAt: date(r.created_at), expiresAt: date(r.expires_at) };
}

function memoryRow(r: Row): MemoryRow {
  return { ...sealedRow(r), kind: r.kind, updatedAt: date(r.updated_at) };
}

function feedbackRow(r: Row): FeedbackRow {
  return {
    id: r.id, userId: r.user_id ?? null, createdAt: date(r.created_at), category: r.category, answerLevel: r.answer_level,
    answerFingerprint: r.answer_fingerprint, sourceUrls: Array.isArray(r.source_urls) ? r.source_urls : [],
    keyId: r.key_id ?? null, commentCiphertext: r.comment_ciphertext ?? null, sharedLearningConsent: Boolean(r.shared_learning_consent), status: r.status,
  };
}

function refundRow(r: Row): RefundRow {
  return {
    id: r.id, userId: r.user_id, provider: r.provider, paymentRef: r.payment_ref, reason: r.reason, status: r.status,
    decidedBy: r.decided_by ?? null, refundRef: r.refund_ref ?? null, createdAt: date(r.created_at), decidedAt: dateOrNull(r.decided_at),
  };
}

function outboxRow(r: Row): OutboxItem {
  return {
    id: Number(r.id), idemKey: r.idem_key, kind: r.kind, payload: r.payload ?? {},
    pii: r.pii_ciphertext ? { keyId: r.pii_key_id, ciphertext: r.pii_ciphertext } : null,
    status: r.status, attempts: Number(r.attempts), nextAttemptAt: date(r.next_attempt_at), lastError: r.last_error ?? null,
    externalRef: r.external_ref ?? null, createdAt: date(r.created_at),
  };
}

function knowledgeRow(r: Row): KnowledgeRow {
  return {
    id: r.id, origin: r.origin, topic: r.topic, jurisdiction: r.jurisdiction ?? null, scope: r.scope, organisationId: r.organisation_id ?? null,
    summary: r.summary, officialSourceUrl: r.official_source_url, sourceQuote: r.source_quote, sourceCheckedAt: date(r.source_checked_at),
    expiresAt: date(r.expires_at), status: r.status, proposedBy: r.proposed_by, sourceCheckedBy: r.source_checked_by ?? null,
    verifiedBy: r.verified_by ?? null, approvedBy: r.approved_by ?? null, reviewedAt: dateOrNull(r.reviewed_at), version: Number(r.version),
  };
}

const KNOWLEDGE_COLUMNS: Record<string, string> = {
  status: 'status', sourceCheckedBy: 'source_checked_by', verifiedBy: 'verified_by', approvedBy: 'approved_by', reviewedAt: 'reviewed_at',
  expiresAt: 'expires_at', sourceCheckedAt: 'source_checked_at', summary: 'summary', sourceQuote: 'source_quote',
};

export class PostgresPaidStore implements PaidStore {
  constructor(private readonly db: AskDb) {}

  static fromUrl(url: string): PostgresPaidStore {
    return new PostgresPaidStore(getAskDb(url));
  }

  /** Runs fn in a transaction scoped by RLS to one user. */
  private asUser<T>(userId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('dajc_ask.user_id', ${userId}, true)`);
      return fn(tx);
    });
  }

  private asSystem<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('dajc_ask.scope', 'system', true)`);
      return fn(tx);
    });
  }

  async recordConsent(userId: string, purpose: ConsentPurpose, version: string, granted: boolean, now: Date) {
    await this.asUser(userId, (tx) => tx.execute(sql`
      insert into dajc_ask.consents (user_id, purpose, version, granted, created_at) values (${userId}, ${purpose}, ${version}, ${granted}, ${iso(now)})`));
  }

  async getConsents(userId: string): Promise<ConsentState[]> {
    const result = await this.asUser(userId, (tx) => tx.execute(sql`
      select distinct on (purpose) purpose, granted, version, created_at from dajc_ask.consents
      where user_id = ${userId} order by purpose, created_at desc, id desc`));
    return rows(result).map((r) => ({ purpose: r.purpose, granted: Boolean(r.granted), version: r.version, at: date(r.created_at) }));
  }

  async addHistory(userId: string, row: Omit<SealedRow, 'id'>, maxEntries: number) {
    return this.asUser(userId, async (tx) => {
      const [inserted] = rows(await tx.execute(sql`
        insert into dajc_ask.history (user_id, created_at, expires_at, key_id, ciphertext)
        values (${userId}, ${iso(row.createdAt)}, ${iso(row.expiresAt)}, ${row.keyId}, ${row.ciphertext}) returning id`));
      await tx.execute(sql`
        delete from dajc_ask.history where user_id = ${userId} and id in (
          select id from dajc_ask.history where user_id = ${userId} order by created_at desc, id desc offset ${maxEntries})`);
      return String(inserted.id);
    });
  }

  async listHistory(userId: string, now: Date, limit: number) {
    const result = await this.asUser(userId, (tx) => tx.execute(sql`
      select id, key_id, ciphertext, created_at, expires_at from dajc_ask.history
      where user_id = ${userId} and expires_at > ${iso(now)} order by created_at desc, id desc limit ${limit}`));
    return rows(result).map(sealedRow);
  }

  async deleteHistory(userId: string, id: string | 'all') {
    const result = await this.asUser(userId, (tx) => id === 'all'
      ? tx.execute(sql`delete from dajc_ask.history where user_id = ${userId} returning id`)
      : tx.execute(sql`delete from dajc_ask.history where user_id = ${userId} and id = ${id}::uuid returning id`));
    return rows(result).length;
  }

  async upsertMemory(userId: string, row: { id: string | null; kind: MemoryKind; keyId: string; ciphertext: string; now: Date; expiresAt: Date }, maxItems: number) {
    return this.asUser(userId, async (tx) => {
      if (row.id) {
        const updated = rows(await tx.execute(sql`
          update dajc_ask.memory_items set kind = ${row.kind}, key_id = ${row.keyId}, ciphertext = ${row.ciphertext}, updated_at = ${iso(row.now)}, expires_at = ${iso(row.expiresAt)}
          where user_id = ${userId} and id = ${row.id}::uuid returning id`));
        return updated.length ? { status: 'ok' as const, id: String(updated[0].id) } : { status: 'not_found' as const };
      }
      // Serialise concurrent inserts of one user so the item cap holds.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`memory:${userId}`}, 0))`);
      const [{ count }] = rows(await tx.execute(sql`select count(*)::int as count from dajc_ask.memory_items where user_id = ${userId}`));
      if (Number(count) >= maxItems) return { status: 'limit' as const };
      const [inserted] = rows(await tx.execute(sql`
        insert into dajc_ask.memory_items (user_id, kind, key_id, ciphertext, created_at, updated_at, expires_at)
        values (${userId}, ${row.kind}, ${row.keyId}, ${row.ciphertext}, ${iso(row.now)}, ${iso(row.now)}, ${iso(row.expiresAt)}) returning id`));
      return { status: 'ok' as const, id: String(inserted.id) };
    });
  }

  async listMemory(userId: string, now: Date) {
    const result = await this.asUser(userId, (tx) => tx.execute(sql`
      select id, kind, key_id, ciphertext, created_at, updated_at, expires_at from dajc_ask.memory_items
      where user_id = ${userId} and expires_at > ${iso(now)} order by created_at, id`));
    return rows(result).map(memoryRow);
  }

  async deleteMemory(userId: string, id: string | 'all') {
    const result = await this.asUser(userId, (tx) => id === 'all'
      ? tx.execute(sql`delete from dajc_ask.memory_items where user_id = ${userId} returning id`)
      : tx.execute(sql`delete from dajc_ask.memory_items where user_id = ${userId} and id = ${id}::uuid returning id`));
    return rows(result).length;
  }

  async addFeedback(userId: string, row: Omit<FeedbackRow, 'id' | 'userId' | 'status'>) {
    const [inserted] = rows(await this.asUser(userId, (tx) => tx.execute(sql`
      insert into dajc_ask.feedback (user_id, created_at, category, answer_level, answer_fingerprint, source_urls, key_id, comment_ciphertext, shared_learning_consent)
      values (${userId}, ${iso(row.createdAt)}, ${row.category}, ${row.answerLevel}, ${row.answerFingerprint}, ${JSON.stringify(row.sourceUrls)}::jsonb,
        ${row.keyId}, ${row.commentCiphertext}, ${row.sharedLearningConsent}) returning id`)));
    return String(inserted.id);
  }

  async listFeedback(status: FeedbackRow['status'], limit: number) {
    const result = await this.asSystem((tx) => tx.execute(sql`
      select * from dajc_ask.feedback where status = ${status} order by created_at limit ${limit}`));
    return rows(result).map(feedbackRow);
  }

  async setFeedbackStatus(id: string, status: FeedbackRow['status']) {
    await this.asSystem((tx) => tx.execute(sql`update dajc_ask.feedback set status = ${status} where id = ${id}::uuid`));
  }

  async consumePaidQuestion(userId: string, day: string, month: string, dailyLimit: number, monthlyLimit: number): Promise<PaidQuotaResult> {
    return this.asUser(userId, async (tx) => {
      // Fixed lock order (month, then day) for every transaction.
      await tx.execute(sql`insert into dajc_ask.paid_usage (user_id, period, count) values (${userId}, ${`M:${month}`}, 0), (${userId}, ${`D:${day}`}, 0) on conflict do nothing`);
      const [m] = rows(await tx.execute(sql`select count from dajc_ask.paid_usage where user_id = ${userId} and period = ${`M:${month}`} for update`));
      const [d] = rows(await tx.execute(sql`select count from dajc_ask.paid_usage where user_id = ${userId} and period = ${`D:${day}`} for update`));
      if (Number(d.count) >= dailyLimit) return 'daily';
      if (Number(m.count) >= monthlyLimit) return 'monthly';
      await tx.execute(sql`update dajc_ask.paid_usage set count = count + 1 where user_id = ${userId} and period in (${`M:${month}`}, ${`D:${day}`})`);
      return 'ok';
    });
  }

  async refundPaidQuestion(userId: string, day: string, month: string) {
    await this.asUser(userId, (tx) => tx.execute(sql`
      update dajc_ask.paid_usage set count = greatest(0, count - 1) where user_id = ${userId} and period in (${`M:${month}`}, ${`D:${day}`})`));
  }

  async getPaidUsage(userId: string, day: string, month: string) {
    const result = rows(await this.asUser(userId, (tx) => tx.execute(sql`
      select period, count from dajc_ask.paid_usage where user_id = ${userId} and period in (${`M:${month}`}, ${`D:${day}`})`)));
    return {
      day: Number(result.find((r) => r.period === `D:${day}`)?.count ?? 0),
      month: Number(result.find((r) => r.period === `M:${month}`)?.count ?? 0),
    };
  }

  async reserveUserCost(userId: string, month: string, amountMicro: number, capMicro: number) {
    return this.asUser(userId, async (tx) => {
      await tx.execute(sql`insert into dajc_ask.user_cost (user_id, month) values (${userId}, ${month}) on conflict do nothing`);
      const updated = rows(await tx.execute(sql`
        update dajc_ask.user_cost set reserved_micro = reserved_micro + ${amountMicro}
        where user_id = ${userId} and month = ${month} and spent_micro + reserved_micro + ${amountMicro} <= ${capMicro} returning month`));
      return updated.length > 0;
    });
  }

  async settleUserCost(userId: string, month: string, reservedMicro: number, actualMicro: number) {
    await this.asUser(userId, (tx) => tx.execute(sql`
      update dajc_ask.user_cost set reserved_micro = greatest(0, reserved_micro - ${reservedMicro}), spent_micro = spent_micro + ${actualMicro}
      where user_id = ${userId} and month = ${month}`));
  }

  async createCheckout(row: CheckoutRow) {
    await this.db.execute(sql`
      insert into dajc_ask.billing_checkouts (checkout_ref, user_id, provider, amount_cents, currency, status, provider_session_ref, created_at, expires_at)
      values (${row.checkoutRef}, ${row.userId}, ${row.provider}, ${row.amountCents}, ${row.currency}, ${row.status}, ${row.providerSessionRef}, ${iso(row.createdAt)}, ${iso(row.expiresAt)})`);
  }

  async getCheckout(checkoutRef: string) {
    const [r] = rows(await this.db.execute(sql`select * from dajc_ask.billing_checkouts where checkout_ref = ${checkoutRef}`));
    if (!r) return null;
    return {
      checkoutRef: r.checkout_ref, userId: r.user_id, provider: r.provider, amountCents: Number(r.amount_cents), currency: r.currency,
      status: r.status, providerSessionRef: r.provider_session_ref ?? null, createdAt: date(r.created_at), expiresAt: date(r.expires_at),
    } as CheckoutRow;
  }

  async setCheckoutStatus(checkoutRef: string, status: CheckoutRow['status'], providerSessionRef?: string | null) {
    await this.db.execute(providerSessionRef === undefined
      ? sql`update dajc_ask.billing_checkouts set status = ${status} where checkout_ref = ${checkoutRef}`
      : sql`update dajc_ask.billing_checkouts set status = ${status}, provider_session_ref = ${providerSessionRef} where checkout_ref = ${checkoutRef}`);
  }

  async bindCustomer(row: CustomerRow) {
    const [r] = rows(await this.db.execute(sql`
      insert into dajc_ask.billing_customers as c (provider, customer_ref, user_id, subscription_ref) values (${row.provider}, ${row.customerRef}, ${row.userId}, ${row.subscriptionRef})
      on conflict (provider, customer_ref) do update set subscription_ref = coalesce(excluded.subscription_ref, c.subscription_ref)
        where c.user_id = excluded.user_id
      returning user_id`));
    return r ? 'ok' as const : 'conflict' as const;
  }

  async findCustomer(provider: CardProvider, customerRef: string) {
    const [r] = rows(await this.db.execute(sql`select * from dajc_ask.billing_customers where provider = ${provider} and customer_ref = ${customerRef}`));
    return r ? { provider: r.provider, customerRef: r.customer_ref, userId: r.user_id, subscriptionRef: r.subscription_ref ?? null } : null;
  }

  async findCustomersOfUser(userId: string) {
    return rows(await this.db.execute(sql`select * from dajc_ask.billing_customers where user_id = ${userId} order by created_at`))
      .map((r) => ({ provider: r.provider, customerRef: r.customer_ref, userId: r.user_id, subscriptionRef: r.subscription_ref ?? null }));
  }

  async getLedger(userId: string) {
    const [r] = rows(await this.db.execute(sql`select ledger from dajc_ask.subscriptions where user_id = ${userId}`));
    return (r?.ledger as SubscriptionLedger) ?? null;
  }

  async listRenewableLedgers(providers: CardProvider[]) {
    if (providers.length === 0) return [];
    const list = sql.join(providers.map((p) => sql`${p}`), sql`, `);
    return rows(await this.db.execute(sql`
      select user_id, ledger from dajc_ask.subscriptions
      where provider in (${list}) and coalesce((ledger->>'cancelAtPeriodEnd')::boolean, false) = false
      order by updated_at`)).map((r) => ({ userId: String(r.user_id), ledger: r.ledger as SubscriptionLedger }));
  }

  async findUserByPaymentRef(provider: CardProvider, paymentRef: string) {
    const [r] = rows(await this.db.execute(sql`
      select user_id from dajc_ask.subscriptions
      where ledger->'settled' @> ${JSON.stringify([{ paymentRef }])}::jsonb limit 1`));
    void provider;
    return r?.user_id ?? null;
  }

  private async appendAuditTx(tx: Tx, entry: AuditInput, now: Date) {
    // One writer at a time keeps the hash chain linear across instances.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended('dajc_ask.audit_log', 0))`);
    const [last] = rows(await tx.execute(sql`select hash from dajc_ask.audit_log order by id desc limit 1`));
    const full = { actor: entry.actor, action: entry.action, subject: entry.subject, details: auditDetails(entry.details) };
    const prevHash = last?.hash ?? AUDIT_GENESIS;
    await tx.execute(sql`
      insert into dajc_ask.audit_log (at, actor, action, subject, details, prev_hash, hash)
      values (${iso(now)}, ${full.actor}, ${full.action}, ${full.subject}, ${JSON.stringify(full.details)}::jsonb, ${prevHash}, ${auditHash(prevHash, full, now)})`);
  }

  private async enqueueOutboxTx(tx: Tx, items: OutboxInput[], now: Date) {
    for (const item of items) {
      await tx.execute(sql`
        insert into dajc_ask.accounting_outbox (idem_key, kind, payload, pii_key_id, pii_ciphertext, status, next_attempt_at, created_at, updated_at)
        values (${item.idemKey}, ${item.kind}, ${JSON.stringify(item.payload)}::jsonb, ${item.pii?.keyId ?? null}, ${item.pii?.ciphertext ?? null}, 'PENDING', ${iso(now)}, ${iso(now)}, ${iso(now)})
        on conflict (idem_key) do nothing`);
    }
  }

  async applyPaymentEvent(input: ApplyPaymentInput) {
    try {
      return await this.db.transaction(async (tx) => {
        const inserted = rows(await tx.execute(sql`
          insert into dajc_ask.payment_events (provider, event_id, user_id, kind, payload_sha256, outcome, received_at)
          values (${input.provider}, ${input.eventId}, ${input.userId}, ${input.kind}, ${input.payloadSha256}, ${input.mutate && input.userId ? 'APPLIED' : input.ignoredOutcome ?? 'IGNORED'}, ${iso(input.receivedAt)})
          on conflict (provider, event_id) do nothing returning event_id`));
        if (inserted.length === 0) return 'duplicate' as const;
        let applied = false;
        if (input.mutate && input.userId) {
          const [current] = rows(await tx.execute(sql`select ledger, version from dajc_ask.subscriptions where user_id = ${input.userId} for update`));
          let next: SubscriptionLedger;
          try {
            next = trimLedger(input.mutate((current?.ledger as SubscriptionLedger) ?? null));
          } catch (error) {
            throw new LedgerRejected((error as Error).message);
          }
          await tx.execute(sql`
            insert into dajc_ask.subscriptions (user_id, provider, customer_ref, ledger, version, updated_at)
            values (${input.userId}, ${next.provider}, ${next.customerRef}, ${JSON.stringify(next)}::jsonb, 1, ${iso(input.receivedAt)})
            on conflict (user_id) do update set ledger = excluded.ledger, provider = excluded.provider, customer_ref = excluded.customer_ref,
              version = dajc_ask.subscriptions.version + 1, updated_at = excluded.updated_at`);
          applied = true;
        }
        await this.enqueueOutboxTx(tx, input.outbox, input.receivedAt);
        await this.appendAuditTx(tx, input.audit, input.receivedAt);
        return applied ? 'applied' as const : 'ignored' as const;
      });
    } catch (error) {
      if (error instanceof LedgerRejected) throw new Error(error.message);
      throw error;
    }
  }

  async createRefundRequest(row: Omit<RefundRow, 'id' | 'createdAt' | 'decidedAt' | 'decidedBy' | 'refundRef'>, now: Date) {
    const [r] = rows(await this.db.execute(sql`
      insert into dajc_ask.refund_requests (user_id, provider, payment_ref, reason, status, created_at)
      values (${row.userId}, ${row.provider}, ${row.paymentRef}, ${row.reason}, ${row.status}, ${iso(now)})
      on conflict (payment_ref) do nothing returning id`));
    return r ? { status: 'created' as const, id: String(r.id) } : { status: 'exists' as const };
  }

  async listRefundRequests(userId: string | null, status?: RefundRow['status']) {
    const filters: SQL[] = [];
    if (userId) filters.push(sql`user_id = ${userId}`);
    if (status) filters.push(sql`status = ${status}`);
    const where = filters.length ? sql`where ${sql.join(filters, sql` and `)}` : sql``;
    return rows(await this.db.execute(sql`select * from dajc_ask.refund_requests ${where} order by created_at`)).map(refundRow);
  }

  async decideRefundRequest(id: string, expected: RefundRow['status'], next: RefundRow['status'], decidedBy: string, now: Date, refundRef: string | null = null) {
    const updated = rows(await this.db.execute(sql`
      update dajc_ask.refund_requests set status = ${next}, decided_by = ${decidedBy}, decided_at = ${iso(now)}, refund_ref = coalesce(${refundRef}, refund_ref)
      where id = ${id}::uuid and status = ${expected} returning id`));
    return updated.length > 0;
  }

  async appendAudit(entry: AuditInput, now: Date) {
    await this.db.transaction((tx) => this.appendAuditTx(tx, entry, now));
  }

  async listAudit(subject: string | null, limit: number): Promise<AuditRow[]> {
    const result = rows(await this.db.execute(subject === null
      ? sql`select * from (select * from dajc_ask.audit_log order by id desc limit ${limit}) a order by id`
      : sql`select * from (select * from dajc_ask.audit_log where subject = ${subject} order by id desc limit ${limit}) a order by id`));
    return result.map((r) => ({ id: Number(r.id), at: date(r.at), actor: r.actor, action: r.action, subject: r.subject, details: r.details ?? {}, prevHash: r.prev_hash, hash: r.hash }));
  }

  async enqueueOutbox(items: OutboxInput[], now: Date) {
    await this.db.transaction((tx) => this.enqueueOutboxTx(tx, items, now));
  }

  async claimOutbox(now: Date, limit: number, leaseMs: number) {
    const until = new Date(now.getTime() + leaseMs);
    const result = rows(await this.db.execute(sql`
      update dajc_ask.accounting_outbox set locked_until = ${iso(until)}, updated_at = ${iso(now)}
      where id in (
        select id from dajc_ask.accounting_outbox
        where status = 'PENDING' and next_attempt_at <= ${iso(now)} and (locked_until is null or locked_until <= ${iso(now)})
        order by id limit ${limit} for update skip locked)
      returning *`));
    return result.map(outboxRow).sort((a, b) => a.id - b.id);
  }

  async completeOutbox(id: number, externalRef: string, now: Date) {
    await this.db.execute(sql`
      update dajc_ask.accounting_outbox set status = 'SYNCED', external_ref = ${externalRef}, locked_until = null, pii_key_id = null, pii_ciphertext = null,
        last_error = null, attempts = attempts + 1, updated_at = ${iso(now)} where id = ${id}`);
  }

  async failOutbox(id: number, error: string, nextAttemptAt: Date | null, now: Date) {
    await this.db.execute(sql`
      update dajc_ask.accounting_outbox set attempts = attempts + 1, last_error = ${error.slice(0, 500)}, locked_until = null,
        status = ${nextAttemptAt ? 'PENDING' : 'DEAD'}, next_attempt_at = ${iso(nextAttemptAt ?? now)}, updated_at = ${iso(now)} where id = ${id}`);
  }

  async listOutbox(status?: OutboxItem['status']) {
    return rows(await this.db.execute(status
      ? sql`select * from dajc_ask.accounting_outbox where status = ${status} order by id`
      : sql`select * from dajc_ask.accounting_outbox order by id`)).map(outboxRow);
  }

  async requeueOutbox(idemKey: string, now: Date) {
    const result = rows(await this.db.execute(sql`
      update dajc_ask.accounting_outbox set status = 'PENDING', attempts = 0, next_attempt_at = ${iso(now)}, locked_until = null, updated_at = ${iso(now)}
      where idem_key = ${idemKey} and status = 'DEAD' returning id`));
    return result.length === 1;
  }

  async operationalSummary(since: Date): Promise<OperationalSummary> {
    const [r] = rows(await this.db.execute(sql`
      select
        (select count(*) from dajc_ask.accounting_outbox where status = 'PENDING')::int as outbox_pending,
        (select count(*) from dajc_ask.accounting_outbox where status = 'DEAD')::int as outbox_dead,
        (select min(created_at) from dajc_ask.accounting_outbox where status = 'PENDING') as oldest_pending,
        (select count(*) from dajc_ask.payment_events where received_at >= ${iso(since)} and outcome = 'APPLIED')::int as applied,
        (select count(*) from dajc_ask.payment_events where received_at >= ${iso(since)} and outcome = 'IGNORED')::int as ignored,
        (select count(*) from dajc_ask.payment_events where received_at >= ${iso(since)} and outcome = 'REJECTED')::int as rejected,
        (select count(*) from dajc_ask.refund_requests where status = 'PENDING_REVIEW')::int as refunds,
        (select count(*) from dajc_ask.knowledge_entries where status in ('PENDING', 'SOURCE_CHECKED', 'VERIFIED'))::int as knowledge`));
    return {
      outbox: { pending: Number(r.outbox_pending), dead: Number(r.outbox_dead), oldestPendingAt: dateOrNull(r.oldest_pending) },
      paymentEvents: { applied: Number(r.applied), ignored: Number(r.ignored), rejected: Number(r.rejected) },
      refundsPendingReview: Number(r.refunds),
      knowledgeAwaitingReview: Number(r.knowledge),
    };
  }

  async getOutbox(idemKey: string) {
    const [r] = rows(await this.db.execute(sql`select * from dajc_ask.accounting_outbox where idem_key = ${idemKey}`));
    return r ? outboxRow(r) : null;
  }

  async getCachedAnswer(cacheKey: string, now: Date) {
    const [r] = rows(await this.db.execute(sql`select answer from dajc_ask.answer_cache where cache_key = ${cacheKey} and expires_at > ${iso(now)}`));
    return r?.answer ?? null;
  }

  async putCachedAnswer(cacheKey: string, answer: unknown, expiresAt: Date) {
    await this.db.execute(sql`
      insert into dajc_ask.answer_cache (cache_key, answer, expires_at) values (${cacheKey}, ${JSON.stringify(answer)}::jsonb, ${iso(expiresAt)})
      on conflict (cache_key) do nothing`);
  }

  async isReviewer(userId: string, role: 'KNOWLEDGE_REVIEWER' | 'BILLING_REVIEWER') {
    const [r] = rows(await this.db.execute(sql`select 1 as ok from dajc_ask.reviewers where user_id = ${userId} and role = ${role}`));
    return Boolean(r);
  }

  async insertKnowledge(row: KnowledgeRow, now: Date) {
    const inserted = rows(await this.db.execute(sql`
      insert into dajc_ask.knowledge_entries (id, origin, topic, jurisdiction, scope, organisation_id, summary, official_source_url, source_quote,
        source_checked_at, expires_at, status, proposed_by, source_checked_by, verified_by, approved_by, reviewed_at, version, created_at, updated_at)
      values (${row.id}, ${row.origin}, ${row.topic}, ${row.jurisdiction}, ${row.scope}, ${row.organisationId}, ${row.summary}, ${row.officialSourceUrl},
        ${row.sourceQuote}, ${iso(row.sourceCheckedAt)}, ${iso(row.expiresAt)}, ${row.status}, ${row.proposedBy}, ${row.sourceCheckedBy}, ${row.verifiedBy},
        ${row.approvedBy}, ${iso(row.reviewedAt)}, ${row.version}, ${iso(now)}, ${iso(now)})
      on conflict (id) do nothing returning id`));
    return inserted.length ? 'ok' as const : 'exists' as const;
  }

  async getKnowledge(id: string) {
    const [r] = rows(await this.db.execute(sql`select * from dajc_ask.knowledge_entries where id = ${id}`));
    return r ? knowledgeRow(r) : null;
  }

  async updateKnowledge(id: string, expected: { status: KnowledgeStatusRow; version: number }, patch: Partial<KnowledgeRow>, now: Date) {
    const sets: SQL[] = [];
    for (const [key, column] of Object.entries(KNOWLEDGE_COLUMNS)) {
      if (key in patch) sets.push(sql`${sql.raw(column)} = ${(patch as Record<string, unknown>)[key] as never}`);
    }
    sets.push(sql`version = version + 1`, sql`updated_at = ${iso(now)}`);
    try {
      const updated = rows(await this.db.execute(sql`
        update dajc_ask.knowledge_entries set ${sql.join(sets, sql`, `)}
        where id = ${id} and status = ${expected.status} and version = ${expected.version} returning id`));
      return updated.length > 0;
    } catch (error) {
      const cause = (error as { cause?: { constraint_name?: string; message?: string } })?.cause;
      if (/knowledge_entries_four_eyes/.test(`${(error as Error)?.message} ${cause?.constraint_name ?? ''} ${cause?.message ?? ''}`)) throw new Error('FOUR_EYES');
      throw error;
    }
  }

  async listKnowledge(filter: { status?: KnowledgeStatusRow; topic?: string }) {
    const filters: SQL[] = [];
    if (filter.status) filters.push(sql`status = ${filter.status}`);
    if (filter.topic) filters.push(sql`topic = ${filter.topic}`);
    const where = filters.length ? sql`where ${sql.join(filters, sql` and `)}` : sql``;
    return rows(await this.db.execute(sql`select * from dajc_ask.knowledge_entries ${where} order by created_at`)).map(knowledgeRow);
  }

  async exportUserData(userId: string): Promise<DataExport> {
    const personal = await this.asUser(userId, async (tx) => ({
      history: rows(await tx.execute(sql`select id, key_id, ciphertext, created_at, expires_at from dajc_ask.history where user_id = ${userId} order by created_at`)).map(sealedRow),
      memory: rows(await tx.execute(sql`select * from dajc_ask.memory_items where user_id = ${userId} order by created_at`)).map(memoryRow),
      feedback: rows(await tx.execute(sql`select * from dajc_ask.feedback where user_id = ${userId} order by created_at`)).map(feedbackRow),
      usage: rows(await tx.execute(sql`select period, count from dajc_ask.paid_usage where user_id = ${userId} order by period`)).map((r) => ({ period: r.period, count: Number(r.count) })),
    }));
    return {
      consents: await this.getConsents(userId),
      ...personal,
      subscription: await this.getLedger(userId),
      refunds: await this.listRefundRequests(userId),
    };
  }

  async deleteUser(userId: string, now: Date) {
    await this.db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('dajc_ask.scope', 'system', true)`);
      // Feedback stays as a pseudonymous quality signal, without its comment.
      await tx.execute(sql`update dajc_ask.feedback set comment_ciphertext = null, key_id = null where user_id = ${userId}`);
      await tx.execute(sql`delete from dajc_ask.billing_checkouts where user_id = ${userId} and status = 'OPEN'`);
      // Cascades: sessions, daily usage, consents, history, memory, paid usage, cost, reviewer roles.
      await tx.execute(sql`delete from dajc_ask.users where id = ${userId}`);
      await this.appendAuditTx(tx, { actor: `user:${userId}`, action: 'ACCOUNT_DELETED', subject: `user:${userId}` }, now);
    });
  }

  async purgePersonalData(now: Date) {
    return this.asSystem(async (tx) => {
      const history = rows(await tx.execute(sql`delete from dajc_ask.history where expires_at <= ${iso(now)} returning id`)).length;
      const memory = rows(await tx.execute(sql`delete from dajc_ask.memory_items where expires_at <= ${iso(now)} returning id`)).length;
      const feedback = rows(await tx.execute(sql`
        update dajc_ask.feedback set comment_ciphertext = null, key_id = null
        where comment_ciphertext is not null and created_at < ${iso(new Date(now.getTime() - 365 * 86_400_000))} returning id`)).length;
      const checkouts = rows(await tx.execute(sql`update dajc_ask.billing_checkouts set status = 'EXPIRED' where status = 'OPEN' and expires_at <= ${iso(now)} returning checkout_ref`)).length;
      const cache = rows(await tx.execute(sql`delete from dajc_ask.answer_cache where expires_at <= ${iso(now)} returning cache_key`)).length;
      return { history, memory, feedback, checkouts, cache };
    });
  }
}
