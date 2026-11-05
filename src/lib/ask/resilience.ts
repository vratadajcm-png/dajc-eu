// Retry and circuit breaker around the Ask DAJC AI provider clients
// (providers.ts), in the spirit of the research orchestrator
// (src/lib/ai/orchestrator.mjs) but without sharing its keys, quotas or data
// classes: questions of users never go through the research route.
//
// - A transient failure (network, invalid JSON, HTTP 429/5xx) is retried
//   once with a short backoff, only while the question deadline allows.
// - Refusals, truncated output and other 4xx are not retried: the same
//   request would fail again (and could be billed again).
// - After `threshold` consecutive failures a provider's circuit opens for
//   `cooldownMs`; calls then fail fast and the service refunds the question
//   instead of making the user wait for a timeout.
// There is deliberately no fallback that would let one vendor both draft
// and verify an answer: with the verifier's vendor down the answer cannot
// be independently checked, so the service fails closed. The safe fallback
// is the answer cache, the deterministic Driving Bans tools (paid) and the
// FAQ, which never depend on a model.

import { ProviderError, type JsonCallParams, type ModelResult, type Providers } from './providers';

export interface ResilienceOptions {
  retries?: number;
  backoffMs?: number;
  threshold?: number;
  cooldownMs?: number;
  clock?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

type ProviderId = ProviderError['provider'];

interface Breaker {
  failures: number;
  openUntil: number;
}

// Module scope: shared by all requests of one serverless instance.
const sharedBreakers = new Map<ProviderId, Breaker>();

const RETRYABLE = /^(network error|invalid JSON response|HTTP (429|5\d\d))$/;

export function isRetryable(error: unknown): boolean {
  if (!(error instanceof ProviderError)) return false;
  const message = error.message.replace(/^[a-z]+: /, '');
  return RETRYABLE.test(message);
}

export function resilientProviders(inner: Providers, options: ResilienceOptions = {}, breakers: Map<ProviderId, Breaker> = sharedBreakers): Providers & { breakerState(): Record<string, { open: boolean; failures: number }> } {
  const retries = options.retries ?? 1;
  const backoffMs = options.backoffMs ?? 400;
  const threshold = options.threshold ?? 3;
  const cooldownMs = options.cooldownMs ?? 60_000;
  const clock = options.clock ?? Date.now;
  const sleep = options.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const state = (id: ProviderId) => {
    if (!breakers.has(id)) breakers.set(id, { failures: 0, openUntil: 0 });
    return breakers.get(id)!;
  };

  async function guarded<T>(id: ProviderId, signal: AbortSignal | undefined, call: () => Promise<T>): Promise<T> {
    const breaker = state(id);
    if (breaker.openUntil > clock()) throw new ProviderError(id, 'circuit open');
    let attempt = 0;
    for (;;) {
      try {
        const result = await call();
        breaker.failures = 0;
        return result;
      } catch (error) {
        if (attempt < retries && isRetryable(error) && !signal?.aborted) {
          attempt += 1;
          await sleep(backoffMs * attempt);
          if (!signal?.aborted) continue;
        }
        breaker.failures += 1;
        if (breaker.failures >= threshold) breaker.openUntil = clock() + cooldownMs;
        throw error;
      }
    }
  }

  return {
    openaiJson<T>(params: JsonCallParams): Promise<ModelResult<T>> {
      return guarded('openai', params.signal, () => inner.openaiJson<T>(params));
    },
    anthropicJson<T>(params: JsonCallParams): Promise<ModelResult<T>> {
      return guarded('anthropic', params.signal, () => inner.anthropicJson<T>(params));
    },
    search(params) {
      return guarded('perplexity', params.signal, () => inner.search(params));
    },
    breakerState() {
      return Object.fromEntries([...breakers].map(([id, b]) => [id, { open: b.openUntil > clock(), failures: b.failures }]));
    },
  };
}

/** True when a model needed for an independently checked answer is known to be down. */
export function aiUnavailable(providers: Providers): boolean {
  const orchestrated = (providers as { unavailable?: () => boolean }).unavailable;
  if (typeof orchestrated === 'function') return orchestrated.call(providers);
  const state = (providers as Partial<ReturnType<typeof resilientProviders>>).breakerState?.();
  return Boolean(state && (state.openai?.open || state.anthropic?.open));
}
