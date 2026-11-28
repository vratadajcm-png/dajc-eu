// Wires the real dependencies for the deployed routes. Returns null - and
// every route then answers 404 - unless getAskConfig() confirms that the
// feature flag is "true" and the whole configuration is present.

import { getAskConfig, type AskConfig, type AskEnv } from './config';
import { createMailer, type AskMailer } from './email';
import { createProviders, type Providers } from './providers';
import { PostgresAskStore } from './store/postgres';
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
}

export function getAskRuntime(env: AskEnv = process.env): AskRuntime | null {
  const config = getAskConfig(env);
  if (!config) return null;
  return {
    config,
    store: PostgresAskStore.fromUrl(config.dbUrl),
    providers: createProviders({ openaiKey: config.openaiKey, anthropicKey: config.anthropicKey, perplexityKey: config.perplexityKey }),
    mailer: createMailer(config),
  };
}
