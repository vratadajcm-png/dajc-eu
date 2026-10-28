// Cost accounting in integer micro-euros (1 EUR = 1,000,000). Prices and
// the USD/EUR rate come from the environment (config.ts), so the provider
// and model stay replaceable without code changes.
//
// A call that fails or times out may still be billed by the provider, so
// it is charged at its worst case (every prompt character counted as a
// token plus the full output allowance). The up-front reservation for a
// whole question is the sum of those worst cases, so the monthly and
// daily caps can never be exceeded by a question that is already running.

import type { AskConfig, AskModelPrice } from './config';

export type CostRole = 'classifier' | 'answer' | 'verifier';

export const MICRO = 1_000_000;

export function tokenCostMicroEur(price: AskModelPrice, usdToEur: number, inputTokens: number, outputTokens: number): number {
  // price is USD per 1M tokens, so tokens * price is already micro-USD.
  const microUsd = Math.max(0, inputTokens) * price.input + Math.max(0, outputTokens) * price.output;
  return Math.ceil(microUsd * usdToEur);
}

export function searchCostMicroEur(config: Pick<AskConfig, 'pricing' | 'usdToEur'>, requests: number): number {
  return Math.ceil(requests * config.pricing.searchRequest * MICRO * config.usdToEur);
}

export function eurToMicro(eur: number): number {
  return Math.round(eur * MICRO);
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
}

export class CostMeter {
  private totalMicro = 0;
  readonly calls: Array<{ role: CostRole | 'search'; micro: number; estimated: boolean }> = [];

  constructor(private readonly config: Pick<AskConfig, 'pricing' | 'usdToEur'>) {}

  worstCase(role: CostRole, promptChars: number, maxOutputTokens: number): number {
    return tokenCostMicroEur(this.config.pricing[role], this.config.usdToEur, promptChars, maxOutputTokens);
  }

  /** Runs one model call and records its actual cost, or its worst case if it throws. */
  async track<T extends { usage: Usage }>(role: CostRole, promptChars: number, maxOutputTokens: number, call: () => Promise<T>): Promise<T> {
    try {
      const result = await call();
      const micro = tokenCostMicroEur(this.config.pricing[role], this.config.usdToEur, result.usage.inputTokens, result.usage.outputTokens);
      this.add(role, micro, false);
      return result;
    } catch (error) {
      this.add(role, this.worstCase(role, promptChars, maxOutputTokens), true);
      throw error;
    }
  }

  addSearch(requests = 1): void {
    this.add('search', searchCostMicroEur(this.config, requests), false);
  }

  private add(role: CostRole | 'search', micro: number, estimated: boolean) {
    this.totalMicro += micro;
    this.calls.push({ role, micro, estimated });
  }

  get total(): number {
    return this.totalMicro;
  }
}
