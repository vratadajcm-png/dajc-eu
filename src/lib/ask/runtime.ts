// Wires the real dependencies for the deployed routes. Returns null - and
// every route then answers 404 - unless getAskConfig() confirms that the
// feature flag is "true" and the whole configuration is present.

import { getAskConfig, type AskConfig, type AskEnv } from './config';
import { createMailer, type AskMailer } from './email';
import { createProviders, type Providers } from './providers';
import { resilientProviders } from './resilience';
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
}

export function getAskRuntime(env: AskEnv = process.env): AskRuntime | null {
  const config = getAskConfig(env);
  if (!config) return null;
  return {
    config,
    store: PostgresAskStore.fromUrl(config.dbUrl),
    // Retry once on transient errors and fail fast while a provider is down.
    providers: resilientProviders(createProviders({ openaiKey: config.openaiKey, anthropicKey: config.anthropicKey, perplexityKey: config.perplexityKey })),
    mailer: createMailer(config),
    cache: env.DAJC_ASK_ANSWER_CACHE_ENABLED === 'true' ? answerCacheFrom(PostgresPaidStore.fromUrl(config.dbUrl)) : undefined,
  };
}
