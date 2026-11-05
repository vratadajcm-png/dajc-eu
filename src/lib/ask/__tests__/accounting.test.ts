import { describe, expect, it } from 'vitest';
import { createAbraClient, extId } from '../accounting/abra-flexi';
import { readAccountingConfig, type AccountingConfig } from '../accounting/config';
import { invoiceRecord, vatSplit, VatConfigurationMissing } from '../accounting/documents';
import { createFakeAbra } from '../accounting/fake-abra';
import { MAX_TRANSIENT_ATTEMPTS, runAccountingOutbox } from '../accounting/outbox-worker';
import { monthlyReport, reportCsv } from '../accounting/report';
import { MemoryPaidStore } from '../store/paid-memory';

const NOW = new Date('2026-11-05T10:00:00.000Z');
// Synthetic rates for tests only; production rates come from the accountant-confirmed configuration.
const RATES = { CZ: 21, DE: 19, SK: 23 };

function accountingConfig(overrides: Partial<AccountingConfig> = {}): AccountingConfig {
  return {
    mode: 'sandbox', abra: { baseUrl: 'https://abra.test.invalid', company: 'dajc_test', username: 'api', password: 'pw' },
    supplierCountry: 'CZ', vatRates: RATES, vatConfirmedBy: 'test fixture (not a real confirmation)',
    codes: { invoiceType: 'FAKTURA', creditNoteType: 'DOBROPIS', paymentMethod: 'KARTA', gatewayBankAccount: 'BRANA', gatewayFeeMovementType: 'POPLATKY' },
    itemName: 'DAJC AI', dueDays: 0, ...overrides,
  };
}

function invoice(paymentRef: string, country: string | null = 'DE') {
  return {
    idemKey: `invoice:DAJC_SANDBOX:${paymentRef}`, kind: 'INVOICE' as const,
    payload: { provider: 'DAJC_SANDBOX', paymentRef, userRef: 'user-1', amountCents: 1500, currency: 'EUR', periodStart: '2026-11-05T10:00:00.000Z', periodEnd: '2026-12-05T10:00:00.000Z', paidAt: '2026-11-05T10:00:00.000Z', billingCountry: country },
  };
}

function setup(config = accountingConfig()) {
  const paid = new MemoryPaidStore();
  const abra = createFakeAbra({ company: 'dajc_test', username: 'api', password: 'pw' });
  const client = createAbraClient({ ...config.abra, fetchFn: abra.fetchFn });
  let clock = NOW;
  const run = () => runAccountingOutbox({ paid, client, config, now: () => clock });
  return { paid, abra, client, config, run, advance(ms: number) { clock = new Date(clock.getTime() + ms); } };
}

describe('VAT and document mapping (configuration-driven, nothing invented)', () => {
  it('splits the gross EUR 15 price by the confirmed rate of the customer country', () => {
    expect(vatSplit(1500, 'CZ', accountingConfig())).toEqual({ country: 'CZ', ratePercent: 21, grossCents: 1500, netCents: 1240, vatCents: 260, regime: 'DOMESTIC' });
    expect(vatSplit(1500, 'DE', accountingConfig())).toMatchObject({ regime: 'OSS', ratePercent: 19, netCents: 1261, vatCents: 239 });
    expect(vatSplit(1500, null, accountingConfig())).toMatchObject({ country: 'CZ' });
    expect(() => vatSplit(1500, 'FR', accountingConfig())).toThrow(VatConfigurationMissing);
  });

  it('builds an idempotent invoice record with an external identifier and VAT country', () => {
    const { record } = invoiceRecord(invoice('pay_1').payload, accountingConfig());
    expect(record).toMatchObject({ id: 'ext:DAJC:invoice-DAJC_SANDBOX-pay_1', typDokl: 'code:FAKTURA', mena: 'code:EUR', statDph: 'code:DE', datVyst: '2026-11-05' });
    expect(record.polozkyFaktury[0]).toMatchObject({ cenaMj: 15, szbDph: 19, typCenyDphK: 'typCeny.sDph' });
    expect(record.varSym).toMatch(/^\d{10}$/);
    expect(extId('a b/c')).toBe('ext:DAJC:a_b_c');
  });

  it('requires confirmed VAT rates, credentials and never runs live without a release', () => {
    const env = { DAJC_ABRA_MODE: 'sandbox', DAJC_ABRA_URL: 'https://demo.flexibee.eu', DAJC_ABRA_COMPANY: 'demo', DAJC_ABRA_USERNAME: 'u', DAJC_ABRA_PASSWORD: 'p', DAJC_VAT_RATES_JSON: JSON.stringify(RATES), DAJC_VAT_RATES_CONFIRMED_BY: 'Accountant 2026-11' };
    expect(readAccountingConfig(env).ok).toBe(true);
    expect(readAccountingConfig({ ...env, DAJC_VAT_RATES_CONFIRMED_BY: '' }).problems).toContain('DAJC_VAT_RATES_CONFIRMED_BY is missing');
    expect(readAccountingConfig({ ...env, DAJC_ABRA_MODE: 'live' }).problems.join(' ')).toMatch(/live accounting is not released/);
    expect(readAccountingConfig({ ...env, DAJC_VAT_RATES_JSON: '{"cz": 21}' }).ok).toBe(false);
    expect(readAccountingConfig({ ...env, DAJC_ABRA_URL: 'http://insecure.example' }).problems).toContain('DAJC_ABRA_URL must be https');
  });
});

describe('ABRA Flexi outbox worker', () => {
  it('syncs an invoice, then pairs the card payment, idempotently', async () => {
    const t = setup();
    await t.paid.enqueueOutbox([invoice('pay_1')], NOW);
    expect(await t.run()).toMatchObject({ synced: 1 });
    expect(await t.run()).toMatchObject({ synced: 1 });
    expect(t.abra.records.get('faktura-vydana')?.size).toBe(1);
    expect(t.abra.records.get('banka')?.get('ext:DAJC:payment-DAJC_SANDBOX-pay_1')).toMatchObject({ sparovani: { uhrazovanaFak: { '#': 'ext:DAJC:invoice-DAJC_SANDBOX-pay_1' } } });
    // Re-sending the same document updates the same ABRA record (no duplicate).
    await t.client.upsert('faktura-vydana', invoiceRecord(invoice('pay_1').payload, t.config).record);
    expect(t.abra.records.get('faktura-vydana')?.size).toBe(1);
    expect((await t.paid.listOutbox('SYNCED')).every((o) => o.pii === null)).toBe(true);
  });

  it('recovers from an ABRA outage with backoff and never loses the event', async () => {
    const t = setup();
    await t.paid.enqueueOutbox([invoice('pay_2')], NOW);
    t.abra.failNext(2, 503);
    expect(await t.run()).toMatchObject({ retried: 1, synced: 0 });
    expect(await t.run()).toMatchObject({ retried: 0, synced: 0 }); // not due yet
    t.advance(61_000);
    expect(await t.run()).toMatchObject({ retried: 1 });
    t.advance(5 * 60_000 + 1000);
    expect(await t.run()).toMatchObject({ synced: 1 });
    t.abra.failNext(1, 'timeout');
    expect(await t.run()).toMatchObject({ retried: 1 }); // payment match hit a timeout
    t.advance(61_000);
    expect(await t.run()).toMatchObject({ synced: 1 });
    expect((await t.paid.listOutbox('PENDING')).length).toBe(0);
  });

  it('dead-letters after too many transient failures', async () => {
    const t = setup();
    await t.paid.enqueueOutbox([invoice('pay_3')], NOW);
    t.abra.failNext(100, 502);
    for (let i = 0; i < MAX_TRANSIENT_ATTEMPTS + 2; i++) {
      await t.run();
      t.advance(25 * 3_600_000);
    }
    const dead = await t.paid.listOutbox('DEAD');
    expect(dead.map((d) => d.idemKey)).toEqual(['invoice:DAJC_SANDBOX:pay_3']);
    expect((await t.paid.listAudit('outbox:invoice:DAJC_SANDBOX:pay_3', 5)).map((a) => a.action)).toContain('ACCOUNTING_DEAD_LETTER');
  });

  it('wrong credentials and a missing VAT rate are retried until fixed, never dropped', async () => {
    const t = setup();
    await t.paid.enqueueOutbox([invoice('pay_4'), invoice('pay_5', 'FR')], NOW);
    t.abra.failNext(1, 401);
    expect(await t.run()).toMatchObject({ deferred: 2, dead: 0 });
    t.advance(6 * 3_600_000 + 1000);
    expect(await t.run()).toMatchObject({ synced: 1, deferred: 1 });
    expect((await t.paid.getOutbox('invoice:DAJC_SANDBOX:pay_5'))?.lastError).toMatch(/VatConfigurationMissing/);
  });

  it('a validation error goes to the dead letter queue for a human', async () => {
    const t = setup();
    t.abra.rejectEvidence.add('faktura-vydana');
    await t.paid.enqueueOutbox([invoice('pay_6')], NOW);
    expect(await t.run()).toMatchObject({ dead: 1 });
    expect((await t.paid.getOutbox('invoice:DAJC_SANDBOX:pay_6'))?.lastError).toMatch(/AbraRejected/);
  });

  it('a credit note waits for its original invoice and uses the invoice country', async () => {
    const t = setup();
    const credit = { idemKey: 'credit:DAJC_SANDBOX:pay_7', kind: 'CREDIT_NOTE' as const, payload: { provider: 'DAJC_SANDBOX', paymentRef: 'pay_7', userRef: 'user-1', amountCents: 1500, currency: 'EUR', refundedAt: '2026-11-06T10:00:00.000Z' } };
    await t.paid.enqueueOutbox([credit], NOW);
    expect(await t.run()).toMatchObject({ deferred: 1 });
    await t.paid.enqueueOutbox([invoice('pay_7', 'SK')], NOW);
    t.advance(11 * 60_000);
    await t.run();
    await t.run();
    const creditNote = t.abra.records.get('faktura-vydana')?.get('ext:DAJC:credit-DAJC_SANDBOX-pay_7') as any;
    expect(creditNote).toMatchObject({ typDokl: 'code:DOBROPIS', statDph: 'code:SK' });
    expect(creditNote.polozkyFaktury[0]).toMatchObject({ mnozMj: -1, szbDph: 23 });
  });

  it('without an accounting configuration nothing is sent and events stay pending', async () => {
    const paid = new MemoryPaidStore();
    await paid.enqueueOutbox([invoice('pay_8')], NOW);
    expect(await runAccountingOutbox({ paid, client: null, config: null, now: () => NOW })).toMatchObject({ status: 'not_configured' });
    expect((await paid.listOutbox('PENDING')).length).toBe(1);
  });

  it('monthly report: payments, refunds, fees, disputes, VAT by country and sync state', async () => {
    const t = setup();
    await t.paid.enqueueOutbox([invoice('a', 'CZ'), invoice('b', 'DE'), invoice('c', 'DE')], NOW);
    await t.paid.enqueueOutbox([
      { idemKey: 'credit:DAJC_SANDBOX:c', kind: 'CREDIT_NOTE', payload: { provider: 'DAJC_SANDBOX', paymentRef: 'c', userRef: 'u', amountCents: 1500, refundedAt: '2026-11-07T00:00:00.000Z' } },
      { idemKey: 'fee:DAJC_SANDBOX:a', kind: 'GATEWAY_FEE', payload: { provider: 'DAJC_SANDBOX', paymentRef: 'a', feeCents: 35, currency: 'EUR', at: '2026-11-05T10:00:00.000Z' } },
      { idemKey: 'dispute:DAJC_SANDBOX:b', kind: 'DISPUTE_NOTICE', payload: { provider: 'DAJC_SANDBOX', paymentRef: 'b', userRef: 'u', at: '2026-11-08T00:00:00.000Z' } },
    ], NOW);
    const report = await monthlyReport({ paid: t.paid, month: '2026-11', config: t.config, aiCostMicroEur: 1_234_000, now: NOW });
    expect(report.payments).toEqual({ count: 3, grossCents: 4500 });
    expect(report.refunds).toEqual({ count: 1, grossCents: 1500 });
    expect(report.disputes.count).toBe(1);
    expect(report.gatewayFeesCents).toBe(35);
    expect(report.vatByCountry).toEqual([
      { country: 'CZ', regime: 'DOMESTIC', ratePercent: 21, grossCents: 1500, netCents: 1240, vatCents: 260 },
      { country: 'DE', regime: 'OSS', ratePercent: 19, grossCents: 1500, netCents: 1261, vatCents: 239 },
    ]);
    expect(reportCsv(report)).toContain('2026-11;DE;OSS;19;15.00;12.61;2.39');
  });
});
