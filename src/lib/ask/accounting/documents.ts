// Maps DAJC business events (outbox entries) to ABRA Flexi records.
//
// - INVOICE      -> faktura-vydana (issued invoice), price incl. VAT, VAT
//                   rate of the customer's country (OSS) or the supplier's
//                   country when the country is unknown or domestic.
// - PAYMENT_MATCH-> banka record on the card clearing account, paired with
//                   the invoice (the card payment that settled it).
// - GATEWAY_FEE  -> banka expense on the clearing account.
// - CREDIT_NOTE  -> faktura-vydana of the credit-note type referring to the
//                   original invoice (corrective tax document).
// - DISPUTE_NOTICE is not an accounting document: it is reported to the
//                   accountant (report.ts) and needs a human decision.
// Bank statements of the Česká spořitelna accounts are imported by ABRA's
// own bank import; DAJC does not parse them (no second accounting).

import type { AccountingConfig } from './config';
import { extId } from './abra-flexi';

export class VatConfigurationMissing extends Error {
  constructor(country: string) {
    super(`no confirmed VAT rate for ${country}`);
    this.name = 'VatConfigurationMissing';
  }
}

export interface VatSplit {
  country: string;
  ratePercent: number;
  grossCents: number;
  netCents: number;
  vatCents: number;
  regime: 'DOMESTIC' | 'OSS';
}

/** B2C digital service: VAT of the customer's country (OSS) inside the gross EUR price. */
export function vatSplit(grossCents: number, billingCountry: string | null, config: Pick<AccountingConfig, 'vatRates' | 'supplierCountry'>): VatSplit {
  const country = billingCountry && /^[A-Z]{2}$/.test(billingCountry) ? billingCountry : config.supplierCountry;
  const rate = config.vatRates[country];
  if (rate === undefined) throw new VatConfigurationMissing(country);
  const netCents = Math.round(grossCents / (1 + rate / 100));
  return { country, ratePercent: rate, grossCents, netCents, vatCents: grossCents - netCents, regime: country === config.supplierCountry ? 'DOMESTIC' : 'OSS' };
}

const day = (iso: string) => new Date(iso).toISOString().slice(0, 10);
const eur = (cents: number) => Number((cents / 100).toFixed(2));

/** Variable symbol: digits only, stable per payment (max 10 digits). */
export function variableSymbol(key: string): string {
  let hash = 0;
  for (const char of key) hash = (hash * 31 + char.charCodeAt(0)) % 9_000_000_000;
  return String(1_000_000_000 + hash);
}

export interface InvoicePayload {
  provider: string;
  paymentRef: string;
  userRef: string;
  amountCents: number;
  currency: string;
  periodStart: string;
  periodEnd: string;
  paidAt: string;
  billingCountry: string | null;
}

export function invoiceKey(payload: Pick<InvoicePayload, 'provider' | 'paymentRef'>): string {
  return `invoice-${payload.provider}-${payload.paymentRef}`;
}

export function invoiceRecord(payload: InvoicePayload, config: AccountingConfig) {
  if (payload.currency !== 'EUR') throw new Error('only EUR invoices are supported');
  const vat = vatSplit(payload.amountCents, payload.billingCountry, config);
  const key = invoiceKey(payload);
  return {
    vat,
    record: {
      id: extId(key),
      typDokl: `code:${config.codes.invoiceType}`,
      datVyst: day(payload.paidAt),
      duzpPuv: day(payload.paidAt),
      datSplat: day(payload.paidAt),
      mena: 'code:EUR',
      varSym: variableSymbol(key),
      formaUhradyCis: `code:${config.codes.paymentMethod}`,
      popis: `DAJC AI ${day(payload.periodStart)} – ${day(payload.periodEnd)}`,
      // The OSS country of consumption; the accountant maps it to ABRA's OSS settings.
      statDph: `code:${vat.country}`,
      poznam: `DAJC ref ${payload.provider} ${payload.paymentRef}; customer ${payload.userRef}; VAT ${vat.regime} ${vat.ratePercent}% confirmed by ${config.vatConfirmedBy}`,
      bezPolozek: false,
      polozkyFaktury: [{
        id: extId(`${key}-item-1`),
        nazev: config.itemName,
        mnozMj: 1,
        cenaMj: eur(payload.amountCents),
        typCenyDphK: 'typCeny.sDph',
        szbDph: vat.ratePercent,
      }],
    },
  };
}

export function paymentMatchRecord(payload: InvoicePayload, config: AccountingConfig) {
  const key = invoiceKey(payload);
  return {
    id: extId(`payment-${payload.provider}-${payload.paymentRef}`),
    banka: `code:${config.codes.gatewayBankAccount}`,
    typPohybuK: 'typPohybu.prijem',
    datVyst: day(payload.paidAt),
    mena: 'code:EUR',
    varSym: variableSymbol(key),
    popis: `Card payment ${payload.provider} ${payload.paymentRef}`,
    bezPolozek: true,
    sumOsv: eur(payload.amountCents),
    sparovani: { uhrazovanaFak: { '@type': 'faktura-vydana', '#': extId(key) }, zbytek: 'ne' },
  };
}

export function gatewayFeeRecord(payload: { provider: string; paymentRef: string; feeCents: number; currency: string; at: string }, config: AccountingConfig) {
  return {
    id: extId(`fee-${payload.provider}-${payload.paymentRef}`),
    banka: `code:${config.codes.gatewayBankAccount}`,
    typPohybuK: 'typPohybu.vydej',
    datVyst: day(payload.at),
    mena: `code:${payload.currency || 'EUR'}`,
    popis: `Gateway fee ${payload.provider} ${payload.paymentRef}`,
    bezPolozek: true,
    sumOsv: eur(payload.feeCents),
    typUcOp: `code:${config.codes.gatewayFeeMovementType}`,
  };
}

export function creditNoteRecord(payload: { provider: string; paymentRef: string; userRef: string; amountCents: number; refundedAt: string; billingCountry?: string | null }, config: AccountingConfig) {
  const original = invoiceKey(payload);
  const vat = vatSplit(payload.amountCents, payload.billingCountry ?? null, config);
  const key = `credit-${payload.provider}-${payload.paymentRef}`;
  return {
    vat,
    record: {
      id: extId(key),
      typDokl: `code:${config.codes.creditNoteType}`,
      datVyst: day(payload.refundedAt),
      duzpPuv: day(payload.refundedAt),
      datSplat: day(payload.refundedAt),
      mena: 'code:EUR',
      varSym: variableSymbol(original),
      statDph: `code:${vat.country}`,
      popis: `Opravný daňový doklad k ${extId(original)} (refund)`,
      poznam: `DAJC ref ${payload.provider} ${payload.paymentRef}; customer ${payload.userRef}`,
      bezPolozek: false,
      polozkyFaktury: [{
        id: extId(`${key}-item-1`),
        nazev: config.itemName,
        mnozMj: -1,
        cenaMj: eur(payload.amountCents),
        typCenyDphK: 'typCeny.sDph',
        szbDph: vat.ratePercent,
      }],
    },
  };
}
