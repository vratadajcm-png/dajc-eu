// Wires the real dependencies for the deployed routes. Returns null - and
// every route then answers 404 - unless getAskConfig() confirms that the
// feature flag is "true" and the whole configuration is present.

import { getAskConfig, type AskConfig, type AskEnv } from './config';
import { createMailer, type AskMailer } from './email';
import { createProviders, type Providers } from './providers';
import { resilientProviders } from './resilience';
import { orchestratedProviders } from './orchestrated';
import { PostgresAskStore } from './store/postgres';
import { PostgresPaidStore } from './store/paid-postgres';
import { answerCacheFrom } from './service';
import type { ServiceDeps } from './service';
import type { AskStore } from './store/types';

export interface AskRuntime {
  config: AskConfig;
  store: AskStore;
  providers: Providers;
  mailer: AskMailer;
  now?: () => Date;
  /** Test seams only (fixture data, fake page fetches); unset in production. */
  pipeline?: ServiceDeps['pipeline'];
  /** Shared cache of checked generic answers (needs migration 0002). */
  cache?: ServiceDeps['cache'];
  /** Orchestrated routing (DAJC_ASK_AI_ROUTING=orchestrator): providers per question and budget. */
  providerFactory?: ServiceDeps['providerFactory'];
}

export function getAskRuntime(env: AskEnv = process.env): AskRuntime | null {
  const config = getAskConfig(env);
  if (!config) return null;
  // Orchestrated: the shared orchestrator and adapters, one budgeted instance per question.
  const providerFactory: ServiceDeps['providerFactory'] = config.routing === 'orchestrator'
    ? ({ budgetMicro, personalData }) => orchestratedProviders({ env, budgetUsd: budgetMicro / 1_000_000 / config.usdToEur, personalData })
    : undefined;
  return {
    config,
    store: PostgresAskStore.fromUrl(config.dbUrl),
    // Direct: retry once on transient errors and fail fast while a provider is down.
    providers: providerFactory
      ? providerFactory({ budgetMicro: 0, personalData: false })
      : resilientProviders(createProviders({ openaiKey: config.openaiKey, anthropicKey: config.anthropicKey, perplexityKey: config.perplexityKey })),
    providerFactory,
    mailer: createMailer(config),
    cache: env.DAJC_ASK_ANSWER_CACHE_ENABLED === 'true' ? answerCacheFrom(PostgresPaidStore.fromUrl(config.dbUrl)) : undefined,
  };
}
