// Sends recorded business events to ABRA Flexi, at least once and
// idempotently (ext: identifiers), in a safe order:
//   INVOICE -> PAYMENT_MATCH (enqueued only after the invoice exists)
//   CREDIT_NOTE waits until its original invoice is synchronised.
// Failure handling:
//   - ABRA unavailable (network, timeout, 429, 5xx): exponential backoff,
//     dead letter after MAX_TRANSIENT_ATTEMPTS; customer access is never
//     affected by an accounting outage.
//   - Missing/invalid credentials or unconfirmed VAT configuration: retried
//     every 6 hours until fixed, never dropped.
//   - Rejected payload: dead letter for a human (no silent data change).
// Personal billing details (if any) are removed from the outbox once synced.

import type { OutboxItem, PaidStore } from '../store/paid-types';
import { AbraConfigError, AbraRejected, AbraUnavailable, type AbraClient } from './abra-flexi';
import type { AccountingConfig } from './config';
import { creditNoteRecord, gatewayFeeRecord, invoiceRecord, paymentMatchRecord, VatConfigurationMissing, type InvoicePayload } from './documents';

export const MAX_TRANSIENT_ATTEMPTS = 12;
const BACKOFF_MS = [60_000, 5 * 60_000, 15 * 60_000, 3_600_000, 3 * 3_600_000, 6 * 3_600_000, 12 * 3_600_000, 24 * 3_600_000];
const CONFIG_RETRY_MS = 6 * 3_600_000;
const WAIT_FOR_INVOICE_MS = 10 * 60_000;
const LEASE_MS = 5 * 60_000;
const ORDER: Record<OutboxItem['kind'], number> = { INVOICE: 0, GATEWAY_FEE: 1, PAYMENT_MATCH: 2, CREDIT_NOTE: 3, DISPUTE_NOTICE: 4 };

export interface AccountingWorkerDeps {
  paid: PaidStore;
  client: AbraClient | null;
  config: AccountingConfig | null;
  now?: () => Date;
  batch?: number;
}

export interface WorkerResult {
  status: 'ran' | 'not_configured';
  synced: number;
  retried: number;
  deferred: number;
  dead: number;
}

class WaitForInvoice extends Error {}

export function backoffFor(attempts: number): number {
  return BACKOFF_MS[Math.min(attempts, BACKOFF_MS.length - 1)];
}

async function send(item: OutboxItem, deps: AccountingWorkerDeps & { client: AbraClient; config: AccountingConfig }, now: Date): Promise<string> {
  const { client, config, paid } = deps;
  switch (item.kind) {
    case 'INVOICE': {
      const payload = item.payload as unknown as InvoicePayload;
      const { record } = invoiceRecord(payload, config);
      const result = await client.upsert('faktura-vydana', record);
      await paid.enqueueOutbox([{ idemKey: `match:${payload.provider}:${payload.paymentRef}`, kind: 'PAYMENT_MATCH', payload: item.payload }], now);
      return `faktura-vydana:${result.id}`;
    }
    case 'PAYMENT_MATCH': {
      const result = await client.upsert('banka', paymentMatchRecord(item.payload as unknown as InvoicePayload, config));
      return `banka:${result.id}`;
    }
    case 'GATEWAY_FEE': {
      const result = await client.upsert('banka', gatewayFeeRecord(item.payload as any, config));
      return `banka:${result.id}`;
    }
    case 'CREDIT_NOTE': {
      const payload = item.payload as { provider: string; paymentRef: string; userRef: string; amountCents: number; refundedAt: string };
      const invoice = await paid.getOutbox(`invoice:${payload.provider}:${payload.paymentRef}`);
      if (!invoice || invoice.status !== 'SYNCED') throw new WaitForInvoice();
      const { record } = creditNoteRecord({ ...payload, billingCountry: (invoice.payload as { billingCountry?: string | null }).billingCountry ?? null }, config);
      const result = await client.upsert('faktura-vydana', record);
      return `faktura-vydana:${result.id}`;
    }
    case 'DISPUTE_NOTICE':
      // Reported to the accountant (report.ts); a dispute outcome needs a human decision.
      return 'report-only';
    default:
      throw new AbraRejected(`unknown outbox kind ${String(item.kind)}`);
  }
}

export async function runAccountingOutbox(deps: AccountingWorkerDeps): Promise<WorkerResult> {
  const result: WorkerResult = { status: 'ran', synced: 0, retried: 0, deferred: 0, dead: 0 };
  if (!deps.client || !deps.config) return { ...result, status: 'not_configured' };
  const now = deps.now?.() ?? new Date();
  // Original documents before the documents that refer to them.
  const items = (await deps.paid.claimOutbox(now, deps.batch ?? 25, LEASE_MS)).sort((a, b) => ORDER[a.kind] - ORDER[b.kind] || a.id - b.id);
  const ready = { ...deps, client: deps.client, config: deps.config };
  for (const item of items) {
    try {
      const externalRef = await send(item, ready, now);
      await deps.paid.completeOutbox(item.id, externalRef, now);
      await deps.paid.appendAudit({ actor: 'system:accounting', action: 'ACCOUNTING_SYNCED', subject: `outbox:${item.idemKey}`, details: { kind: item.kind, externalRef, mode: deps.config.mode } }, now);
      result.synced += 1;
    } catch (error) {
      if (error instanceof WaitForInvoice) {
        await deps.paid.failOutbox(item.id, 'WAITING_FOR_INVOICE', new Date(now.getTime() + WAIT_FOR_INVOICE_MS), now);
        result.deferred += 1;
      } else if (error instanceof AbraConfigError || error instanceof VatConfigurationMissing) {
        await deps.paid.failOutbox(item.id, `${error.name}: ${error.message}`, new Date(now.getTime() + CONFIG_RETRY_MS), now);
        result.deferred += 1;
      } else if (error instanceof AbraUnavailable && item.attempts + 1 < MAX_TRANSIENT_ATTEMPTS) {
        await deps.paid.failOutbox(item.id, `${error.name}: ${error.message}`, new Date(now.getTime() + backoffFor(item.attempts)), now);
        result.retried += 1;
      } else {
        await deps.paid.failOutbox(item.id, `${(error as Error)?.name ?? 'Error'}: ${(error as Error)?.message ?? ''}`, null, now);
        await deps.paid.appendAudit({ actor: 'system:accounting', action: 'ACCOUNTING_DEAD_LETTER', subject: `outbox:${item.idemKey}`, details: { kind: item.kind, error: (error as Error)?.name } }, now);
        result.dead += 1;
      }
    }
  }
  return result;
}
