// Wires the DAJC AI account (consents, data export, deletion, error
// reports) and, when released and configured, the paid runtime. Off - every
// account route answers 404 - unless Ask DAJC AI is on and
// DAJC_AI_ACCOUNT_ENABLED is "true" (it needs migrations 0002/0003).

import type { AskEnv } from '../config';
import { parseDataKeys, type DataKeyring } from '../crypto';
import { getAskDb } from '../db/client';
import { getPaidRuntime, type PaidRuntime } from '../paid/runtime';
import { getAskRuntime, type AskRuntime } from '../runtime';
import { PostgresPaidStore } from '../store/paid-postgres';
import type { PaidStore } from '../store/paid-types';

export interface AccountRuntime {
  ask: AskRuntime;
  paid: PaidStore;
  keyring: DataKeyring | null;
  paidRuntime: PaidRuntime | null;
  env: AskEnv;
  now?: () => Date;
}

export function getAccountRuntime(env: AskEnv = process.env): AccountRuntime | null {
  if (env.DAJC_AI_ACCOUNT_ENABLED !== 'true') return null;
  const ask = getAskRuntime(env);
  if (!ask) return null;
  const paidRuntime = getPaidRuntime(env);
  return {
    ask,
    paid: paidRuntime?.paid ?? new PostgresPaidStore(getAskDb(ask.config.dbUrl)),
    // One keyring for every personal-data path (same DAJC_AI_DATA_KEYS).
    keyring: paidRuntime?.config.keyring ?? parseDataKeys(env.DAJC_AI_DATA_KEYS).keyring,
    paidRuntime,
    env,
  };
}
