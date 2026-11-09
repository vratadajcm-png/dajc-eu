// Cost ledger of the legal library: per connector, jurisdiction and phase
// (INITIAL_IMPORT, MONTHLY_AUDIT, AI_VERIFICATION). Public official sources
// cost no fee, so connector costs are recorded as 0 unless an invoice amount is
// given; AI cost comes from the provider's reported usage. A configurable
// budget per phase aborts the run when exceeded.

export const COST_PHASES = Object.freeze(['INITIAL_IMPORT', 'MONTHLY_AUDIT', 'AI_VERIFICATION']);

export class CostLimitExceeded extends Error {
  constructor(phase, limit, would) {
    super(`cost limit for ${phase} exceeded (limit $${limit}, would be $${would.toFixed(4)})`);
    this.name = 'CostLimitExceeded';
  }
}

export class CostLedger {
  constructor(limitsUsd = {}) {
    this.limits = limitsUsd;
    this.rows = [];
  }

  record({ phase, jurisdiction, connector = null, usd = 0, documents = 0, requests = 0 }) {
    if (!COST_PHASES.includes(phase)) throw new Error(`unknown phase ${phase}`);
    const limit = this.limits[phase];
    const would = this.total({ phase }) + usd;
    if (limit != null && would > limit) throw new CostLimitExceeded(phase, limit, would);
    this.rows.push({ phase, jurisdiction, connector, usd, documents, requests });
  }

  total(filter = {}) {
    return this.rows.filter((r) => Object.entries(filter).every(([k, v]) => r[k] === v)).reduce((s, r) => s + r.usd, 0);
  }

  report() {
    const by = (key) => Object.fromEntries([...new Set(this.rows.map((r) => r[key]).filter(Boolean))].map((v) => [v, this.total({ [key]: v })]));
    return { totalUsd: this.total(), byPhase: by('phase'), byJurisdiction: by('jurisdiction'), byConnector: by('connector'), limits: this.limits };
  }
}

/** Limits from the environment, e.g. DAJC_KB_LIMIT_MONTHLY_AUDIT_USD. */
export function limitsFromEnv(env = process.env) {
  const out = {};
  for (const p of COST_PHASES) {
    const v = Number(env[`DAJC_KB_LIMIT_${p}_USD`]);
    if (Number.isFinite(v) && v >= 0 && env[`DAJC_KB_LIMIT_${p}_USD`] !== undefined) out[p] = v;
  }
  return out;
}
