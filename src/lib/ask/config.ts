// Server-only configuration for "Ask DAJC AI" (DAJC Intelligence, master
// plan §47, Phase 1: free questions with a limit, nothing is sold).
//
// Deny-by-default, fail-closed - the same philosophy as the Partner Portal
// gate (src/portal/config/gate.ts). The feature runs only when
// DAJC_ASK_ENABLED is the EXACT string "true" AND every required setting
// below is present and valid. A missing database URL, key, model name,
// price or budget leaves the feature off: without them neither the daily
// limit nor the monthly cost cap could be enforced.
//
// Keys are separate from the weekly article pipeline (§47.2). The pipeline's
// variables are only compared here, never read for use, so a copied key is
// rejected instead of silently sharing the pipeline's quota.

export type AskEnv = Record<string, string | undefined>;

export interface AskModelPrice {
  /** USD per 1M input tokens. */
  input: number;
  /** USD per 1M output tokens. */
  output: number;
}

export interface AskPricing {
  classifier: AskModelPrice;
  answer: AskModelPrice;
  verifier: AskModelPrice;
  /** USD per Perplexity Search API request. */
  searchRequest: number;
}

export interface AskConfig {
  dbUrl: string;
  openaiKey: string;
  classifierModel: string;
  answerModel: string;
  anthropicKey: string;
  verifierModel: string;
  perplexityKey: string;
  pricing: AskPricing;
  /** EUR per 1 USD. */
  usdToEur: number;
  monthlyBudgetEur: number;
  dailyBudgetEur: number | null;
  dailyQueryLimit: number;
  emailPepper: string;
  emailFrom: string;
  emailLive: boolean;
  resendKey: string | null;
  publicOrigin: string;
}

export const DEFAULT_DAILY_QUERY_LIMIT = 3;
export const SESSION_TTL_DAYS = 7;
const DEFAULT_EMAIL_FROM = 'DAJC <team@dajc.eu>';
const DEFAULT_PUBLIC_ORIGIN = 'https://www.dajc.eu';

// Compared only - see the header comment.
const PIPELINE_KEYS: Array<[ask: string, pipeline: string]> = [
  ['DAJC_ASK_OPENAI_API_KEY', 'OPENAI_API_KEY'],
  ['DAJC_ASK_ANTHROPIC_API_KEY', 'ANTHROPIC_API_KEY'],
  ['DAJC_ASK_PERPLEXITY_API_KEY', 'PERPLEXITY_API_KEY'],
];

const REQUIRED = [
  'DAJC_ASK_DB_URL',
  'DAJC_ASK_OPENAI_API_KEY',
  'DAJC_ASK_OPENAI_CLASSIFIER_MODEL',
  'DAJC_ASK_OPENAI_ANSWER_MODEL',
  'DAJC_ASK_ANTHROPIC_API_KEY',
  'DAJC_ASK_ANTHROPIC_VERIFIER_MODEL',
  'DAJC_ASK_PERPLEXITY_API_KEY',
  'DAJC_ASK_PRICING_USD',
  'DAJC_ASK_USD_EUR_RATE',
  'DAJC_ASK_MONTHLY_BUDGET_EUR',
  'DAJC_ASK_EMAIL_PEPPER',
] as const;

/** The central feature flag. Exactly "true" - anything else is off. */
export function isAskFlagOn(env: AskEnv = process.env): boolean {
  return env.DAJC_ASK_ENABLED === 'true';
}

function positiveNumber(value: string | undefined, max: number): number | null {
  if (value === undefined || value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 && parsed <= max ? parsed : null;
}

function parsePrice(value: unknown): AskModelPrice | null {
  if (!value || typeof value !== 'object') return null;
  const { input, output } = value as Record<string, unknown>;
  const ok = (n: unknown) => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1000;
  return ok(input) && ok(output) ? { input: input as number, output: output as number } : null;
}

export function parsePricing(raw: string | undefined): AskPricing | null {
  if (!raw) return null;
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const classifier = parsePrice(parsed?.classifier);
  const answer = parsePrice(parsed?.answer);
  const verifier = parsePrice(parsed?.verifier);
  const searchRequest = parsed?.searchRequest;
  if (!classifier || !answer || !verifier) return null;
  if (typeof searchRequest !== 'number' || !Number.isFinite(searchRequest) || searchRequest < 0 || searchRequest > 10) return null;
  return { classifier, answer, verifier, searchRequest };
}

function parseOrigin(raw: string | undefined): string | null {
  if (!raw) return DEFAULT_PUBLIC_ORIGIN;
  try {
    const url = new URL(raw);
    const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
    if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) return null;
    return url.origin;
  } catch {
    return null;
  }
}

// A flat shape rather than a union: the project compiles without strict mode,
// where discriminated unions on booleans do not narrow.
export interface AskConfigResult {
  ok: boolean;
  config: AskConfig | null;
  problems: string[];
}

/**
 * Validates every setting. `problems` names variables only, never values,
 * so it is safe to log.
 */
export function readAskConfig(env: AskEnv = process.env): AskConfigResult {
  const problems: string[] = [];
  for (const name of REQUIRED) {
    if (!env[name]?.trim()) problems.push(`${name} is missing`);
  }
  for (const [ask, pipeline] of PIPELINE_KEYS) {
    if (env[ask] && env[ask] === env[pipeline]) problems.push(`${ask} must be a separate key from the article pipeline's ${pipeline}`);
  }

  const pricing = parsePricing(env.DAJC_ASK_PRICING_USD);
  if (env.DAJC_ASK_PRICING_USD && !pricing) problems.push('DAJC_ASK_PRICING_USD is not valid pricing JSON');
  const usdToEur = positiveNumber(env.DAJC_ASK_USD_EUR_RATE, 10);
  if (env.DAJC_ASK_USD_EUR_RATE && usdToEur === null) problems.push('DAJC_ASK_USD_EUR_RATE must be a positive number');
  const monthlyBudgetEur = positiveNumber(env.DAJC_ASK_MONTHLY_BUDGET_EUR, 10_000);
  if (env.DAJC_ASK_MONTHLY_BUDGET_EUR && monthlyBudgetEur === null) problems.push('DAJC_ASK_MONTHLY_BUDGET_EUR must be a positive number');

  let dailyBudgetEur: number | null = null;
  if (env.DAJC_ASK_DAILY_BUDGET_EUR?.trim()) {
    dailyBudgetEur = positiveNumber(env.DAJC_ASK_DAILY_BUDGET_EUR, 10_000);
    if (dailyBudgetEur === null) problems.push('DAJC_ASK_DAILY_BUDGET_EUR must be a positive number');
  }

  let dailyQueryLimit = DEFAULT_DAILY_QUERY_LIMIT;
  if (env.DAJC_ASK_DAILY_QUERY_LIMIT?.trim()) {
    const limit = Number(env.DAJC_ASK_DAILY_QUERY_LIMIT);
    if (Number.isInteger(limit) && limit >= 1 && limit <= 50) dailyQueryLimit = limit;
    else problems.push('DAJC_ASK_DAILY_QUERY_LIMIT must be an integer from 1 to 50');
  }

  if (env.DAJC_ASK_EMAIL_PEPPER && env.DAJC_ASK_EMAIL_PEPPER.length < 32) problems.push('DAJC_ASK_EMAIL_PEPPER must be at least 32 characters');

  const publicOrigin = parseOrigin(env.DAJC_ASK_PUBLIC_ORIGIN);
  if (!publicOrigin) problems.push('DAJC_ASK_PUBLIC_ORIGIN must be an https origin');

  if (problems.length > 0 || !pricing || usdToEur === null || monthlyBudgetEur === null || !publicOrigin) {
    return { ok: false, config: null, problems };
  }

  return {
    ok: true,
    problems: [],
    config: {
      dbUrl: env.DAJC_ASK_DB_URL!.trim(),
      openaiKey: env.DAJC_ASK_OPENAI_API_KEY!.trim(),
      classifierModel: env.DAJC_ASK_OPENAI_CLASSIFIER_MODEL!.trim(),
      answerModel: env.DAJC_ASK_OPENAI_ANSWER_MODEL!.trim(),
      anthropicKey: env.DAJC_ASK_ANTHROPIC_API_KEY!.trim(),
      verifierModel: env.DAJC_ASK_ANTHROPIC_VERIFIER_MODEL!.trim(),
      perplexityKey: env.DAJC_ASK_PERPLEXITY_API_KEY!.trim(),
      pricing,
      usdToEur,
      monthlyBudgetEur,
      dailyBudgetEur,
      dailyQueryLimit,
      emailPepper: env.DAJC_ASK_EMAIL_PEPPER!,
      emailFrom: env.DAJC_ASK_EMAIL_FROM?.trim() || DEFAULT_EMAIL_FROM,
      emailLive: env.DAJC_ASK_EMAIL_MODE === 'live',
      resendKey: env.RESEND_API_KEY?.trim() || null,
      publicOrigin,
    },
  };
}

let warned = false;

/**
 * The configuration when the feature is effectively on, otherwise null.
 * Every route calls this; null means the route answers 404.
 */
export function getAskConfig(env: AskEnv = process.env): AskConfig | null {
  if (!isAskFlagOn(env)) return null;
  const result = readAskConfig(env);
  if (result.ok && result.config) return result.config;
  if (!warned) {
    warned = true;
    console.warn(`[ask] DAJC_ASK_ENABLED is "true" but the configuration is incomplete; the feature stays off: ${result.problems.join('; ')}`);
  }
  return null;
}
