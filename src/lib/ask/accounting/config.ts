// Accounting synchronisation settings (ABRA Flexi). Off unless configured,
// and never "live" without a reviewed code change: DAJC must not issue real
// tax documents on behalf of a legal entity that does not exist yet.
//
// Tax data are NOT built into the code. VAT rates (domestic and OSS) come
// from DAJC_VAT_RATES_JSON and are used only when DAJC_VAT_RATES_CONFIRMED_BY
// names who confirmed them (the accountant) - otherwise no invoice is sent
// and the outbox keeps the event until the configuration is fixed.

export const DAJC_ACCOUNTING_LIVE_RELEASED = false;

export interface AccountingConfig {
  mode: 'sandbox' | 'live';
  abra: { baseUrl: string; company: string; username: string; password: string };
  /** Country of the supplier's VAT registration (CZ). */
  supplierCountry: string;
  vatRates: Record<string, number>;
  vatConfirmedBy: string;
  codes: {
    invoiceType: string;
    creditNoteType: string;
    paymentMethod: string;
    /** Clearing bank account for card settlements in ABRA (gateway account). */
    gatewayBankAccount: string;
    gatewayFeeMovementType: string;
  };
  itemName: string;
  dueDays: number;
}

export interface AccountingConfigResult {
  ok: boolean;
  config: AccountingConfig | null;
  problems: string[];
}

export function parseVatRates(raw: string | undefined): Record<string, number> | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const rates: Record<string, number> = {};
    for (const [country, rate] of Object.entries(parsed)) {
      if (!/^[A-Z]{2}$/.test(country) || typeof rate !== 'number' || !Number.isFinite(rate) || rate < 0 || rate > 30) return null;
      rates[country] = rate;
    }
    return Object.keys(rates).length ? rates : null;
  } catch {
    return null;
  }
}

export function readAccountingConfig(env: Record<string, string | undefined> = process.env): AccountingConfigResult {
  const problems: string[] = [];
  const mode = env.DAJC_ABRA_MODE === 'live' ? 'live' : env.DAJC_ABRA_MODE === 'sandbox' ? 'sandbox' : null;
  if (!mode) problems.push('DAJC_ABRA_MODE must be sandbox or live');
  if (mode === 'live' && !DAJC_ACCOUNTING_LIVE_RELEASED) problems.push('live accounting is not released (DAJC_ACCOUNTING_LIVE_RELEASED)');
  for (const name of ['DAJC_ABRA_URL', 'DAJC_ABRA_COMPANY', 'DAJC_ABRA_USERNAME', 'DAJC_ABRA_PASSWORD', 'DAJC_VAT_RATES_JSON', 'DAJC_VAT_RATES_CONFIRMED_BY']) {
    if (!env[name]?.trim()) problems.push(`${name} is missing`);
  }
  let baseUrl = '';
  try {
    const url = new URL(env.DAJC_ABRA_URL ?? '');
    if (url.protocol !== 'https:') problems.push('DAJC_ABRA_URL must be https');
    baseUrl = url.toString().replace(/\/+$/, '');
  } catch {
    if (env.DAJC_ABRA_URL) problems.push('DAJC_ABRA_URL is not a URL');
  }
  const vatRates = parseVatRates(env.DAJC_VAT_RATES_JSON);
  if (env.DAJC_VAT_RATES_JSON && !vatRates) problems.push('DAJC_VAT_RATES_JSON must map ISO country codes to rates in percent');
  const supplierCountry = (env.DAJC_SUPPLIER_COUNTRY || 'CZ').toUpperCase();
  if (vatRates && vatRates[supplierCountry] === undefined) problems.push(`DAJC_VAT_RATES_JSON has no rate for the supplier country ${supplierCountry}`);
  if (problems.length > 0 || !mode || !vatRates) return { ok: false, config: null, problems };
  return {
    ok: true,
    problems: [],
    config: {
      mode,
      abra: { baseUrl, company: env.DAJC_ABRA_COMPANY!.trim(), username: env.DAJC_ABRA_USERNAME!.trim(), password: env.DAJC_ABRA_PASSWORD! },
      supplierCountry,
      vatRates,
      vatConfirmedBy: env.DAJC_VAT_RATES_CONFIRMED_BY!.trim().slice(0, 120),
      codes: {
        invoiceType: env.DAJC_ABRA_INVOICE_TYPE || 'FAKTURA',
        creditNoteType: env.DAJC_ABRA_CREDIT_NOTE_TYPE || 'DOBROPIS',
        paymentMethod: env.DAJC_ABRA_PAYMENT_METHOD || 'KARTA',
        gatewayBankAccount: env.DAJC_ABRA_GATEWAY_BANK_ACCOUNT || 'BRANA',
        gatewayFeeMovementType: env.DAJC_ABRA_GATEWAY_FEE_TYPE || 'POPLATKY',
      },
      itemName: env.DAJC_ABRA_ITEM_NAME || 'DAJC AI - měsíční předplatné / monthly subscription',
      dueDays: 0,
    },
  };
}
