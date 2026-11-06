// Shared fixtures for paid DAJC AI tests (synthetic keys and secrets only).
import { createSandboxAdapter, signSandboxEvent, SANDBOX_SIGNATURE_HEADER, type SandboxEventInput } from '../billing/sandbox';
import { processWebhook, type BillingDeps } from '../billing/service';
import type { PaymentAdapter } from '../billing/types';
import { parseDataKeys } from '../crypto';
import type { PaidConfig } from '../paid/config';
import { MemoryAskStore } from '../store/memory';
import { MemoryPaidStore } from '../store/paid-memory';

const NOW = new Date('2026-11-05T10:00:00.000Z');

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

export function billingScenario(adapter?: PaymentAdapter) {
  const askStore = new MemoryAskStore();
  const paid = new MemoryPaidStore(askStore);
  let clock = NOW;
  const deps: BillingDeps = {
    config: paidConfig(), askStore, paid, adapter: adapter ?? createSandboxAdapter({ secret: SECRET, publicOrigin: 'https://www.dajc.eu' }),
    publicOrigin: 'https://www.dajc.eu', env: { DAJC_AI_PAID_ENABLED: 'true' }, released: true, now: () => clock,
  };
  return {
    deps, askStore, paid,
    setNow(date: Date) { clock = date; },
    async sandboxEvent(event: Omit<SandboxEventInput, 'occurredAt'> & { occurredAt?: string }, secret = SECRET) {
      const body = JSON.stringify({ occurredAt: clock.toISOString(), ...event });
      const headers = new Headers({ [SANDBOX_SIGNATURE_HEADER]: signSandboxEvent(secret, body, clock) });
      return processWebhook({ rawBody: body, headers }, deps);
    },
  };
}
