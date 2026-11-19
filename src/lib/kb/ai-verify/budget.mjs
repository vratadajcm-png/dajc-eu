// Cost control of AI verification: every call is priced before it is sent
// (prompt characters / 3 as input tokens, the full output allowance) and
// refused when it could exceed the run budget; after the call the provider's
// reported token usage is priced with the configured list prices. Prices are
// reference rates from DAJC_RESEARCH_PRICING_USD, not invoices.

export class BudgetExceeded extends Error {
  constructor(needed, remaining) {
    super(`AI verification budget exhausted (next call up to $${needed.toFixed(4)}, $${remaining.toFixed(4)} left)`);
    this.name = 'BudgetExceeded';
  }
}

export function estimateCost(price, { promptChars, maxOutputTokens }) {
  if (!price) return null;
  return (Math.ceil(promptChars / 3) * price.input + maxOutputTokens * price.output) / 1e6;
}

export function actualCost(price, usage) {
  if (!price) return 0;
  return ((usage?.inputTokens || 0) * price.input + (usage?.outputTokens || 0) * price.output) / 1e6;
}

export class Budget {
  constructor(limitUsd) {
    if (!(Number.isFinite(limitUsd) && limitUsd > 0)) throw new Error('an AI verification budget in USD is required');
    this.limitUsd = limitUsd;
    this.spentUsd = 0;
    this.calls = [];
  }

  get remainingUsd() {
    return Math.max(0, this.limitUsd - this.spentUsd);
  }

  /** Reserves the estimate; throws BudgetExceeded when it does not fit. */
  admit(estimate) {
    if (estimate == null) throw new Error('no price configured for this model');
    if (estimate > this.remainingUsd) throw new BudgetExceeded(estimate, this.remainingUsd);
  }

  record(entry) {
    this.spentUsd += entry.costUsd;
    this.calls.push(entry);
    return entry;
  }
}
