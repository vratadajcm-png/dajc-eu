// Shared fixtures for paid DAJC AI tests (synthetic keys and secrets only).
import { parseDataKeys } from '../crypto';
import type { PaidConfig } from '../paid/config';

export const SECRET = 'sandbox-secret-0123456789abcdef0123456789';
export const KEYS = `k1:${Buffer.alloc(32, 7).toString('base64')}`;

export function paidConfig(overrides: Partial<PaidConfig> = {}): PaidConfig {
  return {
    provider: 'DAJC_SANDBOX', mode: 'sandbox', staging: false, keyring: parseDataKeys(KEYS).keyring!,
    fairUse: { dailyQuestions: 30, monthlyQuestions: 400, userMonthlyCostEur: 5 },
    refund: { windowDays: 14, maxSelfService: 1, maxPaidQuestions: 20 },
    historyRetentionDays: 90, historyMaxEntries: 200, memoryRetentionDays: 365, memoryMaxItems: 50,
    stripe: null, revolut: null, gpwebpay: null, sandbox: { secret: SECRET },
    ...overrides,
  };
}
