// Monthly business report for the accountant and the owner: DAJC's own
// business events (payments, refunds, disputes, gateway fees, AI costs)
// and the state of their synchronisation to ABRA Flexi. It is a working
// document (podklad), not a ledger: ABRA remains the accounting authority
// and the source for the VAT / OSS returns.

import type { OutboxItem, PaidStore } from '../store/paid-types';
import type { AccountingConfig } from './config';
import { vatSplit, VatConfigurationMissing } from './documents';

export interface MonthlyReport {
  month: string;
  generatedAt: string;
  payments: { count: number; grossCents: number };
  refunds: { count: number; grossCents: number };
  disputes: { count: number };
  gatewayFeesCents: number;
  vatByCountry: Array<{ country: string; regime: 'DOMESTIC' | 'OSS' | 'UNCONFIRMED'; ratePercent: number | null; grossCents: number; netCents: number | null; vatCents: number | null }>;
  aiCostMicroEur: number | null;
  sync: { synced: number; pending: number; dead: number; deadKeys: string[] };
  vatConfirmedBy: string | null;
}

const monthOf = (iso: unknown) => (typeof iso === 'string' ? iso.slice(0, 7) : '');

export async function monthlyReport(args: { paid: PaidStore; month: string; config: AccountingConfig | null; aiCostMicroEur?: number | null; now?: Date }): Promise<MonthlyReport> {
  if (!/^\d{4}-\d{2}$/.test(args.month)) throw new Error('month must be YYYY-MM');
  const all = await args.paid.listOutbox();
  const inMonth = (item: OutboxItem) => {
    const p = item.payload as Record<string, unknown>;
    return monthOf(p.paidAt ?? p.refundedAt ?? p.at ?? item.createdAt.toISOString()) === args.month;
  };
  const items = all.filter(inMonth);
  const invoices = items.filter((i) => i.kind === 'INVOICE');
  const credits = items.filter((i) => i.kind === 'CREDIT_NOTE');
  const vat = new Map<string, MonthlyReport['vatByCountry'][number]>();
  const addVat = (country: string | null, cents: number) => {
    let row: MonthlyReport['vatByCountry'][number];
    try {
      if (!args.config) throw new VatConfigurationMissing(country ?? '??');
      const split = vatSplit(cents, country, args.config);
      row = vat.get(split.country) ?? { country: split.country, regime: split.regime, ratePercent: split.ratePercent, grossCents: 0, netCents: 0, vatCents: 0 };
      row.grossCents += cents;
      row.netCents! += split.netCents;
      row.vatCents! += split.vatCents;
      vat.set(split.country, row);
    } catch {
      const key = country ?? '??';
      row = vat.get(key) ?? { country: key, regime: 'UNCONFIRMED', ratePercent: null, grossCents: 0, netCents: null, vatCents: null };
      row.grossCents += cents;
      vat.set(key, row);
    }
  };
  for (const invoice of invoices) {
    const p = invoice.payload as { amountCents?: number; billingCountry?: string | null };
    addVat(p.billingCountry ?? null, p.amountCents ?? 0);
  }
  for (const credit of credits) {
    const p = credit.payload as { provider: string; paymentRef: string; amountCents?: number };
    const original = all.find((i) => i.idemKey === `invoice:${p.provider}:${p.paymentRef}`);
    addVat((original?.payload as { billingCountry?: string | null })?.billingCountry ?? null, -(p.amountCents ?? 0));
  }
  return {
    month: args.month,
    generatedAt: (args.now ?? new Date()).toISOString(),
    payments: { count: invoices.length, grossCents: invoices.reduce((sum, i) => sum + Number((i.payload as { amountCents?: number }).amountCents ?? 0), 0) },
    refunds: { count: credits.length, grossCents: credits.reduce((sum, i) => sum + Number((i.payload as { amountCents?: number }).amountCents ?? 0), 0) },
    disputes: { count: items.filter((i) => i.kind === 'DISPUTE_NOTICE').length },
    gatewayFeesCents: items.filter((i) => i.kind === 'GATEWAY_FEE').reduce((sum, i) => sum + Number((i.payload as { feeCents?: number }).feeCents ?? 0), 0),
    vatByCountry: [...vat.values()].sort((a, b) => a.country.localeCompare(b.country)),
    aiCostMicroEur: args.aiCostMicroEur ?? null,
    sync: {
      synced: items.filter((i) => i.status === 'SYNCED').length,
      pending: items.filter((i) => i.status === 'PENDING').length,
      dead: items.filter((i) => i.status === 'DEAD').length,
      deadKeys: items.filter((i) => i.status === 'DEAD').map((i) => i.idemKey),
    },
    vatConfirmedBy: args.config?.vatConfirmedBy ?? null,
  };
}

/** CSV export of the report's VAT table (podklad pro DPH / OSS). */
export function reportCsv(report: MonthlyReport): string {
  const lines = ['month;country;regime;rate_percent;gross_eur;net_eur;vat_eur'];
  const eur = (cents: number | null) => (cents === null ? '' : (cents / 100).toFixed(2));
  for (const row of report.vatByCountry) {
    lines.push([report.month, row.country, row.regime, row.ratePercent ?? '', eur(row.grossCents), eur(row.netCents), eur(row.vatCents)].join(';'));
  }
  return `${lines.join('\n')}\n`;
}
