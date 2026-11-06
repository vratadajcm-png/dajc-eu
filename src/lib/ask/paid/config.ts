// Server-only configuration of paid DAJC AI (EUR 15 / month). Deny by
// default and fail closed, like src/lib/ask/config.ts:
//
// 1. Ask DAJC AI itself must be fully configured (getAskConfig).
// 2. DAJC_AI_PAID_ENABLED must be the exact string "true".
// 3. Release: the reviewed code constant DAJC_AI_PAID_RELEASED (false), OR a
//    staging dry run - Vercel preview deployment + sandbox payment mode +
//    DAJC_AI_STAGING_SANDBOX="true". A production deployment can never run
//    on the staging exception.
// 4. Live card payments additionally need DAJC_AI_LIVE_PAYMENTS_RELEASED
//    (false): no configuration can take real money without a code review.
// 5. Personal data storage needs DAJC_AI_DATA_KEYS (crypto.ts).
// Problems name variables only, never values.

import { getAskConfig, isAskFlagOn, type AskEnv } from '../config';
import { parseDataKeys, type DataKeyring } from '../crypto';
import { DAJC_AI_PAID_RELEASED, type CardProvider } from './subscription';

/** Real card payments. Flip only in a reviewed release change with a signed merchant contract. */
export const DAJC_AI_LIVE_PAYMENTS_RELEASED = false;

/** Version of the consent texts shown in the account panel (i18n consent.*). */
export const CONSENT_TEXT_VERSION = '2026-11-05.draft-1';

export interface FairUse {
  dailyQuestions: number;
  monthlyQuestions: number;
  userMonthlyCostEur: number;
}

export interface RefundPolicy {
  /** Self-service refund of the latest payment within this many days of its period start. */
  windowDays: number;
  /** At most this many self-service refunds per user, ever (anti-abuse). */
  maxSelfService: number;
  /** Self-service only while paid questions in the period stay at or below this. */
  maxPaidQuestions: number;
}

export interface PaidConfig {
  provider: CardProvider;
  mode: 'sandbox' | 'live';
  staging: boolean;
  keyring: DataKeyring;
  fairUse: FairUse;
  refund: RefundPolicy;
  historyRetentionDays: number;
  historyMaxEntries: number;
  memoryRetentionDays: number;
  memoryMaxItems: number;
  stripe: { secretKey: string; webhookSecret: string; priceId: string } | null;
  revolut: { secretKey: string; webhookSecret: string } | null;
  gpwebpay: { merchantNumber: string; privateKeyPem: string; privateKeyPassphrase?: string; gpPublicKeyPem: string } | null;
  sandbox: { secret: string } | null;
}

export interface PaidConfigResult {
  ok: boolean;
  config: PaidConfig | null;
  problems: string[];
}

const PROVIDERS: Record<string, CardProvider> = {
  stripe: 'STRIPE',
  revolut: 'REVOLUT_MERCHANT',
  gpwebpay: 'GP_WEBPAY',
  sandbox: 'DAJC_SANDBOX',
};

/** True for the reviewed release, or for a sandbox dry run on a Vercel preview deployment. */
export function paidReleased(env: AskEnv, released: boolean = DAJC_AI_PAID_RELEASED): { released: boolean; staging: boolean } {
  if (released === true) return { released: true, staging: false };
  const staging = env.VERCEL_ENV === 'preview' && env.DAJC_AI_PAYMENT_MODE === 'sandbox' && env.DAJC_AI_STAGING_SANDBOX === 'true';
  return { released: staging, staging };
}

function intIn(env: AskEnv, name: string, fallback: number, min: number, max: number, problems: string[]): number {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    problems.push(`${name} must be an integer from ${min} to ${max}`);
    return fallback;
  }
  return value;
}

function numberIn(env: AskEnv, name: string, fallback: number, min: number, max: number, problems: string[]): number {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < min || value > max) {
    problems.push(`${name} must be a number from ${min} to ${max}`);
    return fallback;
  }
  return value;
}

function required(env: AskEnv, names: string[], problems: string[]): Record<string, string> | null {
  const values: Record<string, string> = {};
  let ok = true;
  for (const name of names) {
    const value = env[name]?.trim();
    if (!value) {
      problems.push(`${name} is missing`);
      ok = false;
    } else values[name] = value;
  }
  return ok ? values : null;
}

const pem = (value: string) => value.replace(/\\n/g, '\n');

export function readPaidConfig(env: AskEnv = process.env, released: boolean = DAJC_AI_PAID_RELEASED): PaidConfigResult {
  const problems: string[] = [];
  const release = paidReleased(env, released);
  if (!release.released) problems.push('paid DAJC AI is not released (DAJC_AI_PAID_RELEASED) and this is not a sandbox preview');

  const provider = PROVIDERS[String(env.DAJC_AI_PAYMENT_PROVIDER || '').trim().toLowerCase()];
  if (!provider) problems.push('DAJC_AI_PAYMENT_PROVIDER must be one of stripe, revolut, gpwebpay, sandbox');
  const mode = env.DAJC_AI_PAYMENT_MODE === 'live' ? 'live' : env.DAJC_AI_PAYMENT_MODE === 'sandbox' ? 'sandbox' : null;
  if (!mode) problems.push('DAJC_AI_PAYMENT_MODE must be sandbox or live');
  if (mode === 'live' && !DAJC_AI_LIVE_PAYMENTS_RELEASED) problems.push('live payments are not released (DAJC_AI_LIVE_PAYMENTS_RELEASED)');
  if (provider === 'DAJC_SANDBOX' && (env.VERCEL_ENV === 'production' || mode !== 'sandbox')) problems.push('the sandbox provider is never allowed in production or live mode');
  if (release.staging && provider !== 'DAJC_SANDBOX' && mode !== 'sandbox') problems.push('a staging dry run must use sandbox mode');

  const keys = parseDataKeys(env.DAJC_AI_DATA_KEYS);
  if (keys.problem) problems.push(keys.problem);

  let stripe: PaidConfig['stripe'] = null;
  let revolut: PaidConfig['revolut'] = null;
  let gpwebpay: PaidConfig['gpwebpay'] = null;
  let sandbox: PaidConfig['sandbox'] = null;
  if (provider === 'STRIPE') {
    const v = required(env, ['DAJC_AI_STRIPE_SECRET_KEY', 'DAJC_AI_STRIPE_WEBHOOK_SECRET', 'DAJC_AI_STRIPE_PRICE_ID'], problems);
    if (v) {
      const testKey = /^(sk|rk)_test_/.test(v.DAJC_AI_STRIPE_SECRET_KEY);
      const liveKey = /^(sk|rk)_live_/.test(v.DAJC_AI_STRIPE_SECRET_KEY);
      if (mode === 'sandbox' && !testKey) problems.push('DAJC_AI_STRIPE_SECRET_KEY must be a test-mode key in sandbox mode');
      if (mode === 'live' && !liveKey) problems.push('DAJC_AI_STRIPE_SECRET_KEY must be a live key in live mode');
      if (!v.DAJC_AI_STRIPE_WEBHOOK_SECRET.startsWith('whsec_')) problems.push('DAJC_AI_STRIPE_WEBHOOK_SECRET must be a webhook signing secret');
      stripe = { secretKey: v.DAJC_AI_STRIPE_SECRET_KEY, webhookSecret: v.DAJC_AI_STRIPE_WEBHOOK_SECRET, priceId: v.DAJC_AI_STRIPE_PRICE_ID };
    }
  } else if (provider === 'REVOLUT_MERCHANT') {
    const v = required(env, ['DAJC_AI_REVOLUT_SECRET_KEY', 'DAJC_AI_REVOLUT_WEBHOOK_SECRET'], problems);
    if (v) revolut = { secretKey: v.DAJC_AI_REVOLUT_SECRET_KEY, webhookSecret: v.DAJC_AI_REVOLUT_WEBHOOK_SECRET };
  } else if (provider === 'GP_WEBPAY') {
    const v = required(env, ['DAJC_AI_GPWEBPAY_MERCHANT_NUMBER', 'DAJC_AI_GPWEBPAY_PRIVATE_KEY_PEM', 'DAJC_AI_GPWEBPAY_PUBLIC_KEY_PEM'], problems);
    if (v) {
      if (!/^\d{1,20}$/.test(v.DAJC_AI_GPWEBPAY_MERCHANT_NUMBER)) problems.push('DAJC_AI_GPWEBPAY_MERCHANT_NUMBER must be numeric');
      gpwebpay = {
        merchantNumber: v.DAJC_AI_GPWEBPAY_MERCHANT_NUMBER,
        privateKeyPem: pem(v.DAJC_AI_GPWEBPAY_PRIVATE_KEY_PEM),
        privateKeyPassphrase: env.DAJC_AI_GPWEBPAY_PRIVATE_KEY_PASSPHRASE || undefined,
        gpPublicKeyPem: pem(v.DAJC_AI_GPWEBPAY_PUBLIC_KEY_PEM),
      };
    }
  } else if (provider === 'DAJC_SANDBOX') {
    const v = required(env, ['DAJC_AI_SANDBOX_WEBHOOK_SECRET'], problems);
    if (v && v.DAJC_AI_SANDBOX_WEBHOOK_SECRET.length < 32) problems.push('DAJC_AI_SANDBOX_WEBHOOK_SECRET must be at least 32 characters');
    if (v) sandbox = { secret: v.DAJC_AI_SANDBOX_WEBHOOK_SECRET };
  }

  const fairUse: FairUse = {
    dailyQuestions: intIn(env, 'DAJC_AI_PAID_DAILY_QUERY_LIMIT', 30, 1, 500, problems),
    monthlyQuestions: intIn(env, 'DAJC_AI_PAID_MONTHLY_QUERY_LIMIT', 400, 1, 10_000, problems),
    // Leaves a margin under the EUR 15 price for VAT, gateway fees and operations.
    userMonthlyCostEur: numberIn(env, 'DAJC_AI_PAID_USER_MONTHLY_COST_EUR', 5, 0.1, 15, problems),
  };
  const refund: RefundPolicy = {
    windowDays: intIn(env, 'DAJC_AI_REFUND_WINDOW_DAYS', 14, 0, 31, problems),
    maxSelfService: intIn(env, 'DAJC_AI_REFUND_MAX_SELF_SERVICE', 1, 0, 3, problems),
    maxPaidQuestions: intIn(env, 'DAJC_AI_REFUND_MAX_PAID_QUESTIONS', 20, 0, 500, problems),
  };

  if (problems.length > 0 || !provider || !mode || !keys.keyring) return { ok: false, config: null, problems };
  return {
    ok: true,
    problems: [],
    config: {
      provider, mode, staging: release.staging, keyring: keys.keyring, fairUse, refund,
      historyRetentionDays: intIn(env, 'DAJC_AI_HISTORY_RETENTION_DAYS', 90, 1, 730, problems),
      historyMaxEntries: intIn(env, 'DAJC_AI_HISTORY_MAX_ENTRIES', 200, 1, 2000, problems),
      memoryRetentionDays: intIn(env, 'DAJC_AI_MEMORY_RETENTION_DAYS', 365, 1, 1095, problems),
      memoryMaxItems: intIn(env, 'DAJC_AI_MEMORY_MAX_ITEMS', 50, 1, 500, problems),
      stripe, revolut, gpwebpay, sandbox,
    },
  };
}

let warned = false;

/** The paid configuration when paid DAJC AI is effectively on, otherwise null (routes answer 404). */
export function getPaidConfig(env: AskEnv = process.env, released: boolean = DAJC_AI_PAID_RELEASED): PaidConfig | null {
  if (!isAskFlagOn(env) || env.DAJC_AI_PAID_ENABLED !== 'true' || !getAskConfig(env)) return null;
  const result = readPaidConfig(env, released);
  if (result.ok && result.config) return result.config;
  if (!warned) {
    warned = true;
    console.warn(`[dajc-ai] DAJC_AI_PAID_ENABLED is "true" but paid DAJC AI stays off: ${result.problems.join('; ')}`);
  }
  return null;
}
