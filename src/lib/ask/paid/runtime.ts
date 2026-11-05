// Wires paid DAJC AI for the deployed routes. Returns null - and every paid
// route answers 404 - unless Ask DAJC AI is on and getPaidConfig() confirms
// the paid release, flag, provider credentials and data keys.

import { createAbraClient, type AbraClient } from '../accounting/abra-flexi';
import { readAccountingConfig, type AccountingConfig } from '../accounting/config';
import { createGpWebpayAdapter } from '../billing/gpwebpay';
import { createRevolutAdapter } from '../billing/revolut';
import { createSandboxAdapter } from '../billing/sandbox';
import { createStripeAdapter } from '../billing/stripe';
import type { BillingDeps } from '../billing/service';
import type { FetchFn, PaymentAdapter } from '../billing/types';
import type { AskEnv } from '../config';
import { getAskRuntime, type AskRuntime } from '../runtime';
import { getAskDb } from '../db/client';
import { PostgresPaidStore } from '../store/paid-postgres';
import type { PaidStore } from '../store/paid-types';
import { getPaidConfig, paidReleased, type PaidConfig } from './config';
import { DAJC_AI_PAID_RELEASED } from './subscription';

export interface PaidRuntime {
  ask: AskRuntime;
  config: PaidConfig;
  paid: PaidStore;
  adapter: PaymentAdapter;
  env: AskEnv;
  released: boolean;
  accounting: { config: AccountingConfig; client: AbraClient } | null;
  now?: () => Date;
}

export function createAdapter(config: PaidConfig, publicOrigin: string, fetchFn?: FetchFn): PaymentAdapter {
  switch (config.provider) {
    case 'STRIPE':
      return createStripeAdapter({ ...config.stripe!, mode: config.mode, fetchFn });
    case 'REVOLUT_MERCHANT':
      return createRevolutAdapter({ ...config.revolut!, mode: config.mode, fetchFn });
    case 'GP_WEBPAY':
      return createGpWebpayAdapter({ ...config.gpwebpay!, mode: config.mode });
    case 'DAJC_SANDBOX':
      return createSandboxAdapter({ secret: config.sandbox!.secret, publicOrigin });
    default:
      throw new Error('unknown payment provider');
  }
}

export function billingDeps(runtime: PaidRuntime): BillingDeps {
  return {
    config: runtime.config,
    askStore: runtime.ask.store,
    paid: runtime.paid,
    adapter: runtime.adapter,
    publicOrigin: runtime.ask.config.publicOrigin,
    env: runtime.env,
    released: runtime.released,
    now: runtime.now ?? runtime.ask.now,
  };
}

export function getPaidRuntime(env: AskEnv = process.env, released: boolean = DAJC_AI_PAID_RELEASED): PaidRuntime | null {
  const config = getPaidConfig(env, released);
  if (!config) return null;
  const ask = getAskRuntime(env);
  if (!ask) return null;
  const accountingConfig = readAccountingConfig(env);
  return {
    ask,
    config,
    paid: new PostgresPaidStore(getAskDb(ask.config.dbUrl)),
    adapter: createAdapter(config, ask.config.publicOrigin),
    env,
    released: paidReleased(env, released).released,
    accounting: accountingConfig.ok && accountingConfig.config
      ? { config: accountingConfig.config, client: createAbraClient(accountingConfig.config.abra) }
      : null,
  };
}
