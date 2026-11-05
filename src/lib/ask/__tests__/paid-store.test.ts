// One contract for both paid stores. The in-memory store always runs; the
// Postgres store runs when DAJC_ASK_TEST_DB_URL points at a database migrated
// with drizzle-ask/ (0000-0003) and connected as the dajc_ask_app role. The
// Application CI job "ask-postgres-integration" provides such a database.

import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { verifyAuditChain } from '../audit';
import { applyVerifiedPaymentEvent, type VerifiedPaymentEvent } from '../paid/subscription';
import { MemoryAskStore } from '../store/memory';
import { MemoryPaidStore } from '../store/paid-memory';
import type { PaidStore } from '../store/paid-types';
import type { AskStore } from '../store/types';

const NOW = new Date('2026-11-05T10:00:00.000Z');
const LATER = new Date('2027-03-05T10:00:00.000Z');
const TEST_DB_URL = process.env.DAJC_ASK_TEST_DB_URL;

type Pair = { ask: AskStore; paid: PaidStore };

function settle(userId: string, eventId: string, paymentRef: string): Extract<VerifiedPaymentEvent, { kind: 'PAYMENT_SETTLED' }> {
  return {
    kind: 'PAYMENT_SETTLED', eventId, provider: 'STRIPE', customerRef: `cus_${userId.slice(0, 8)}`, userId,
    occurredAt: NOW.toISOString(), paymentRef, amountCents: 1500, currency: 'EUR',
    periodStart: '2026-11-05T00:00:00.000Z', periodEnd: '2026-12-05T00:00:00.000Z',
  };
}

function contract(name: string, make: () => Promise<Pair>) {
  describe(`${name} paid store contract`, () => {
    const user = async (pair: Pair) => pair.ask.upsertUser(`hmac-${randomUUID()}`, NOW);

    it('keeps consent history and reports the latest decision per purpose', async () => {
      const pair = await make();
      const id = await user(pair);
      await pair.paid.recordConsent(id, 'HISTORY', 'v1', true, NOW);
      await pair.paid.recordConsent(id, 'HISTORY', 'v1', false, new Date(NOW.getTime() + 1000));
      await pair.paid.recordConsent(id, 'MEMORY', 'v1', true, NOW);
      const state = Object.fromEntries((await pair.paid.getConsents(id)).map((c) => [c.purpose, c.granted]));
      expect(state).toEqual({ HISTORY: false, MEMORY: true });
    });

    it('isolates history and memory between users and enforces caps', async () => {
      const pair = await make();
      const a = await user(pair);
      const b = await user(pair);
      const expiresAt = new Date(NOW.getTime() + 86_400_000);
      for (let i = 0; i < 4; i++) {
        await pair.paid.addHistory(a, { keyId: 'k1', ciphertext: `a-${i}`, createdAt: new Date(NOW.getTime() + i), expiresAt }, 3);
      }
      await pair.paid.addHistory(b, { keyId: 'k1', ciphertext: 'b-0', createdAt: NOW, expiresAt }, 3);
      const mine = await pair.paid.listHistory(a, NOW, 10);
      expect(mine.map((h) => h.ciphertext)).toEqual(['a-3', 'a-2', 'a-1']);
      expect((await pair.paid.listHistory(b, NOW, 10)).map((h) => h.ciphertext)).toEqual(['b-0']);
      // A user cannot delete someone else's entry by id.
      expect(await pair.paid.deleteHistory(b, mine[0].id)).toBe(0);
      expect(await pair.paid.deleteHistory(a, mine[0].id)).toBe(1);

      const results = await Promise.all([0, 1, 2].map((i) => pair.paid.upsertMemory(a, { id: null, kind: 'VEHICLE', keyId: 'k1', ciphertext: `v${i}`, now: NOW, expiresAt }, 2)));
      expect(results.filter((r) => r.status === 'ok')).toHaveLength(2);
      expect(results.filter((r) => r.status === 'limit')).toHaveLength(1);
      const memory = await pair.paid.listMemory(a, NOW);
      expect(await pair.paid.upsertMemory(b, { id: memory[0].id, kind: 'VEHICLE', keyId: 'k1', ciphertext: 'stolen', now: NOW, expiresAt }, 2)).toEqual({ status: 'not_found' });
      expect(await pair.paid.listMemory(b, NOW)).toEqual([]);
    });

    it('counts paid questions atomically per day and month', async () => {
      const pair = await make();
      const id = await user(pair);
      const results = await Promise.all(Array.from({ length: 6 }, () => pair.paid.consumePaidQuestion(id, '2026-11-05', '2026-11', 4, 100)));
      expect(results.filter((r) => r === 'ok')).toHaveLength(4);
      expect(results.filter((r) => r === 'daily')).toHaveLength(2);
      expect(await pair.paid.consumePaidQuestion(id, '2026-11-06', '2026-11', 4, 5)).toBe('ok');
      expect(await pair.paid.consumePaidQuestion(id, '2026-11-06', '2026-11', 4, 5)).toBe('monthly');
      await pair.paid.refundPaidQuestion(id, '2026-11-06', '2026-11');
      expect(await pair.paid.getPaidUsage(id, '2026-11-06', '2026-11')).toEqual({ day: 0, month: 4 });
      const reserved = await Promise.all([1, 2, 3].map(() => pair.paid.reserveUserCost(id, '2026-11', 400, 1000)));
      expect(reserved.filter(Boolean)).toHaveLength(2);
    });

    it('applies a payment event exactly once, with outbox and audit in the same step', async () => {
      const pair = await make();
      const id = await user(pair);
      const event = settle(id, `evt_${randomUUID()}`, `pay_${randomUUID()}`);
      const input = {
        provider: 'STRIPE' as const, eventId: event.eventId, kind: event.kind, payloadSha256: 'a'.repeat(64), receivedAt: NOW,
        userId: id, customerRef: event.customerRef, mutate: (ledger: any) => applyVerifiedPaymentEvent(ledger, event),
        outbox: [{ idemKey: `invoice:${event.paymentRef}`, kind: 'INVOICE' as const, payload: { paymentRef: event.paymentRef } }],
        audit: { actor: 'provider:STRIPE', action: 'PAYMENT_SETTLED', subject: `user:${id}`, details: { paymentRef: event.paymentRef } },
      };
      const outcomes = await Promise.all([pair.paid.applyPaymentEvent(input), pair.paid.applyPaymentEvent(input)]);
      expect(outcomes.sort()).toEqual(['applied', 'duplicate']);
      expect((await pair.paid.getLedger(id))?.settled).toHaveLength(1);
      expect((await pair.paid.listOutbox()).filter((o) => o.idemKey === `invoice:${event.paymentRef}`)).toHaveLength(1);
      const audit = await pair.paid.listAudit(`user:${id}`, 10);
      expect(audit.map((a) => a.action)).toEqual(['PAYMENT_SETTLED']);
    });

    it('rolls back a rejected event completely so a corrected redelivery can apply', async () => {
      const pair = await make();
      const id = await user(pair);
      const bad = { ...settle(id, `evt_${randomUUID()}`, `pay_${randomUUID()}`), amountCents: 1000 };
      const input = {
        provider: 'STRIPE' as const, eventId: bad.eventId, kind: bad.kind, payloadSha256: 'b'.repeat(64), receivedAt: NOW,
        userId: id, customerRef: bad.customerRef, mutate: (ledger: any) => applyVerifiedPaymentEvent(ledger, bad),
        outbox: [{ idemKey: `invoice:${bad.paymentRef}`, kind: 'INVOICE' as const, payload: {} }],
        audit: { actor: 'provider:STRIPE', action: 'PAYMENT_SETTLED', subject: `user:${id}` },
      };
      await expect(pair.paid.applyPaymentEvent(input)).rejects.toThrow('INVALID_PAID_PLAN');
      expect(await pair.paid.getLedger(id)).toBeNull();
      expect((await pair.paid.listOutbox()).some((o) => o.idemKey === `invoice:${bad.paymentRef}`)).toBe(false);
      const good = { ...bad, amountCents: 1500 };
      expect(await pair.paid.applyPaymentEvent({ ...input, mutate: (ledger: any) => applyVerifiedPaymentEvent(ledger, good) })).toBe('applied');
    });

    it('binds a provider customer to one user only', async () => {
      const pair = await make();
      const a = await user(pair);
      const b = await user(pair);
      const ref = `cus_${randomUUID()}`;
      expect(await pair.paid.bindCustomer({ provider: 'STRIPE', customerRef: ref, userId: a, subscriptionRef: null })).toBe('ok');
      expect(await pair.paid.bindCustomer({ provider: 'STRIPE', customerRef: ref, userId: a, subscriptionRef: 'sub_1' })).toBe('ok');
      expect(await pair.paid.bindCustomer({ provider: 'STRIPE', customerRef: ref, userId: b, subscriptionRef: null })).toBe('conflict');
      expect((await pair.paid.findCustomer('STRIPE', ref))?.subscriptionRef).toBe('sub_1');
    });

    it('leases outbox items so two workers never send the same document at once', async () => {
      const pair = await make();
      const key = `test:${randomUUID()}`;
      await pair.paid.enqueueOutbox([{ idemKey: key, kind: 'INVOICE', payload: { n: 1 } }, { idemKey: key, kind: 'INVOICE', payload: { n: 2 } }], NOW);
      const [first, second] = await Promise.all([pair.paid.claimOutbox(NOW, 100, 60_000), pair.paid.claimOutbox(NOW, 100, 60_000)]);
      const claimed = [...first, ...second].filter((o) => o.idemKey === key);
      expect(claimed).toHaveLength(1);
      expect(claimed[0].payload).toEqual({ n: 1 });
      await pair.paid.failOutbox(claimed[0].id, 'HTTP 503', new Date(NOW.getTime() + 60_000), NOW);
      expect((await pair.paid.claimOutbox(NOW, 100, 60_000)).some((o) => o.idemKey === key)).toBe(false);
      const retry = (await pair.paid.claimOutbox(new Date(NOW.getTime() + 61_000), 100, 60_000)).find((o) => o.idemKey === key)!;
      await pair.paid.completeOutbox(retry.id, 'abra:42', NOW);
      const done = (await pair.paid.listOutbox('SYNCED')).find((o) => o.idemKey === key)!;
      expect(done).toMatchObject({ attempts: 2, externalRef: 'abra:42', pii: null });
    });

    it('keeps a verifiable audit hash chain', async () => {
      const pair = await make();
      const subject = `test:${randomUUID()}`;
      await pair.paid.appendAudit({ actor: 'system', action: 'A', subject, details: { n: 1, email: 'x@example.com' } }, NOW);
      await pair.paid.appendAudit({ actor: 'system', action: 'B', subject, details: { n: 2 } }, NOW);
      const all = await pair.paid.listAudit(null, 100000);
      expect(verifyAuditChain(all)).toBeNull();
      const mine = all.filter((a) => a.subject === subject);
      expect(mine[0].details).toEqual({ n: 1 });
      const tampered = all.map((a) => (a.id === mine[0].id ? { ...a, details: { n: 99 } } : a));
      expect(verifyAuditChain(tampered)).toBe(mine[0].id);
    });

    it('deletes an account with its personal data and keeps billing pseudonymous', async () => {
      const pair = await make();
      const id = await user(pair);
      const expiresAt = new Date(NOW.getTime() + 86_400_000);
      await pair.paid.recordConsent(id, 'HISTORY', 'v1', true, NOW);
      await pair.paid.addHistory(id, { keyId: 'k1', ciphertext: 'h', createdAt: NOW, expiresAt }, 10);
      await pair.paid.upsertMemory(id, { id: null, kind: 'CARGO', keyId: 'k1', ciphertext: 'm', now: NOW, expiresAt }, 10);
      await pair.paid.addFeedback(id, { createdAt: NOW, category: 'WRONG_FACT', answerLevel: 'VERIFIED', answerFingerprint: 'f'.repeat(64), sourceUrls: [], keyId: 'k1', commentCiphertext: 'c', sharedLearningConsent: false });
      const event = settle(id, `evt_${randomUUID()}`, `pay_${randomUUID()}`);
      await pair.paid.applyPaymentEvent({
        provider: 'STRIPE', eventId: event.eventId, kind: event.kind, payloadSha256: 'c'.repeat(64), receivedAt: NOW, userId: id,
        customerRef: event.customerRef, mutate: (l) => applyVerifiedPaymentEvent(l, event), outbox: [], audit: { actor: 'provider:STRIPE', action: 'PAYMENT_SETTLED', subject: `user:${id}` },
      });
      await pair.paid.deleteUser(id, NOW);
      const exported = await pair.paid.exportUserData(id);
      expect(exported.consents).toEqual([]);
      expect(exported.history).toEqual([]);
      expect(exported.memory).toEqual([]);
      expect(exported.feedback).toEqual([]);
      // Billing record retained (legal retention), not linked to any e-mail fingerprint any more.
      expect(exported.subscription?.settled).toHaveLength(1);
      expect((await pair.paid.listAudit(`user:${id}`, 10)).map((a) => a.action)).toContain('ACCOUNT_DELETED');
    });

    it('purges expired personal data by retention', async () => {
      const pair = await make();
      const id = await user(pair);
      await pair.paid.addHistory(id, { keyId: 'k1', ciphertext: 'old', createdAt: NOW, expiresAt: new Date(NOW.getTime() + 1000) }, 10);
      await pair.paid.addHistory(id, { keyId: 'k1', ciphertext: 'new', createdAt: NOW, expiresAt: new Date(LATER.getTime() + 1000) }, 10);
      const purged = await pair.paid.purgePersonalData(LATER);
      expect(purged.history).toBeGreaterThanOrEqual(1);
      expect((await pair.paid.listHistory(id, NOW, 10)).map((h) => h.ciphertext)).toEqual(['new']);
    });

    it('enforces four eyes on knowledge review', async () => {
      const pair = await make();
      const id = `kn_${randomUUID().replace(/-/g, '')}`;
      const base = {
        id, origin: 'OFFICIAL_SOURCE_REVIEW' as const, topic: 'toll', jurisdiction: 'CZ', scope: 'GLOBAL' as const, organisationId: null,
        summary: 'Summary of an official toll rule for testing.', officialSourceUrl: 'https://www.mfcr.cz/x', sourceQuote: 'Official quote for testing purposes.',
        sourceCheckedAt: NOW, expiresAt: LATER, status: 'PENDING' as const, proposedBy: 'reviewer:a', sourceCheckedBy: null, verifiedBy: null, approvedBy: null, reviewedAt: null, version: 1,
      };
      expect(await pair.paid.insertKnowledge(base, NOW)).toBe('ok');
      expect(await pair.paid.insertKnowledge(base, NOW)).toBe('exists');
      await expect(pair.paid.updateKnowledge(id, { status: 'PENDING', version: 1 }, { status: 'SOURCE_CHECKED', sourceCheckedBy: 'reviewer:a' }, NOW)).rejects.toThrow('FOUR_EYES');
      expect(await pair.paid.updateKnowledge(id, { status: 'PENDING', version: 1 }, { status: 'SOURCE_CHECKED', sourceCheckedBy: 'reviewer:b' }, NOW)).toBe(true);
      // Stale version: a concurrent reviewer's update is not lost.
      expect(await pair.paid.updateKnowledge(id, { status: 'PENDING', version: 1 }, { status: 'SOURCE_CHECKED', sourceCheckedBy: 'reviewer:c' }, NOW)).toBe(false);
      await expect(pair.paid.updateKnowledge(id, { status: 'SOURCE_CHECKED', version: 2 }, { status: 'VERIFIED', verifiedBy: 'reviewer:b' }, NOW)).rejects.toThrow('FOUR_EYES');
    });
  });
}

contract('memory', async () => {
  const ask = new MemoryAskStore();
  return { ask, paid: new MemoryPaidStore(ask) };
});

describe.skipIf(!TEST_DB_URL)('postgres paid store', () => {
  let shared: { pair: Pair; end: () => Promise<void>; client: any } | null = null;
  afterAll(async () => {
    await shared?.end();
  });
  const make = async (): Promise<Pair> => {
    if (!shared) {
      const [{ PostgresAskStore }, { PostgresPaidStore }, { drizzle }, { default: postgres }, schema] = await Promise.all([
        import('../store/postgres'), import('../store/paid-postgres'), import('drizzle-orm/postgres-js'), import('postgres'), import('../db/schema'),
      ]);
      const client = postgres(TEST_DB_URL!, { max: 6, prepare: false });
      const db = drizzle(client, { schema });
      shared = { pair: { ask: new PostgresAskStore(db), paid: new PostgresPaidStore(db) }, end: () => client.end(), client };
    }
    return shared.pair;
  };
  contract('postgres', make);

  it('row-level security hides other users even from a query without a user filter', async () => {
    const pair = await make();
    const a = await pair.ask.upsertUser(`hmac-${randomUUID()}`, NOW);
    const b = await pair.ask.upsertUser(`hmac-${randomUUID()}`, NOW);
    const expiresAt = new Date(NOW.getTime() + 86_400_000);
    await pair.paid.addHistory(a, { keyId: 'k1', ciphertext: 'secret-a', createdAt: NOW, expiresAt }, 10);
    await pair.paid.addHistory(b, { keyId: 'k1', ciphertext: 'secret-b', createdAt: NOW, expiresAt }, 10);
    const sql = shared!.client;
    const unscoped = await sql`select ciphertext from dajc_ask.history`;
    expect(unscoped).toHaveLength(0);
    const scoped = await sql.begin(async (tx: any) => {
      await tx`select set_config('dajc_ask.user_id', ${a}, true)`;
      return tx`select ciphertext from dajc_ask.history`;
    });
    expect(scoped.map((r: any) => r.ciphertext)).toEqual(['secret-a']);
    await expect(sql.begin(async (tx: any) => {
      await tx`select set_config('dajc_ask.user_id', ${a}, true)`;
      await tx`insert into dajc_ask.history (user_id, expires_at, key_id, ciphertext) values (${b}, now() + interval '1 day', 'k1', 'forged')`;
    })).rejects.toThrow(/row-level security/);
  });

  it('the application role cannot rewrite or delete the audit trail or grant reviewer roles', async () => {
    const sql = shared ? shared.client : (await make(), shared!.client);
    await expect(sql`update dajc_ask.audit_log set action = 'X'`).rejects.toThrow(/permission denied/);
    await expect(sql`delete from dajc_ask.audit_log`).rejects.toThrow(/permission denied/);
    await expect(sql`insert into dajc_ask.reviewers (user_id, role, granted_by) values (gen_random_uuid(), 'KNOWLEDGE_REVIEWER', 'self')`).rejects.toThrow(/permission denied/);
    await expect(sql`delete from dajc_ask.payment_events`).rejects.toThrow(/permission denied/);
  });
});
