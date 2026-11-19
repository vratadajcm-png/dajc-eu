// When may the public site link to DAJC AI (the existing Ask)?
//
// Two separate decisions, both server-side and deny-by-default:
//   1. Activation: DAJC_ASK_ENABLED is exactly "true" and the whole Ask
//      configuration is valid (getAskConfig). Only then do /intelligence/ask
//      and /api/ask/* answer at all.
//   2. Publication: DAJC_ASK_PUBLIC_ENTRY is exactly "true". The owner sets it
//      only after the activated service passed the production smoke test, so
//      no public link ever leads to a service that is off, incomplete or not
//      yet checked (owner decision: "odkaz zveřejnit jako funkční až po
//      úspěšné aktivaci").
// The main navigation (Header.astro) and the Ask DAJC · FAQ panel
// (guide-entry.ts) both use this one function.

import { getAskConfig, type AskEnv } from './config';

export const ASK_PUBLIC_PATH = '/intelligence/ask';

/** True only when Ask is activated AND the owner published the public links. */
export function isAskPublicEntryEnabled(env: AskEnv = process.env): boolean {
  return env.DAJC_ASK_PUBLIC_ENTRY === 'true' && getAskConfig(env) !== null;
}
