// Shared fixtures for the Ask DAJC AI tests. No network, no real keys:
// providers and page fetches are fakes, and the driving-ban dataset is a
// small synthetic fixture so these tests never depend on (or block) the
// weekly data updates in data/.

import type { AskConfig } from '../config';
import type { CanonicalLike } from '../own-data';
import type { FetchPage } from '../official-sources';
import type { JsonCallParams, ModelResult, Providers } from '../providers';
import type { Classification, DraftOutput, VerifyOutput } from '../prompts';

export const FULL_ENV: Record<string, string> = {
  DAJC_ASK_ENABLED: 'true',
  DAJC_ASK_DB_URL: 'postgres://dajc_ask_app:secret@db.example.test:5432/postgres',
  DAJC_ASK_OPENAI_API_KEY: 'test-openai-key-not-real',
  DAJC_ASK_OPENAI_CLASSIFIER_MODEL: 'classifier-model-from-env',
  DAJC_ASK_OPENAI_ANSWER_MODEL: 'answer-model-from-env',
  DAJC_ASK_ANTHROPIC_API_KEY: 'test-anthropic-key-not-real',
  DAJC_ASK_ANTHROPIC_VERIFIER_MODEL: 'verifier-model-from-env',
  DAJC_ASK_PERPLEXITY_API_KEY: 'test-perplexity-key-not-real',
  DAJC_ASK_PRICING_USD: JSON.stringify({ classifier: { input: 0.2, output: 1.25 }, answer: { input: 0.75, output: 4.5 }, verifier: { input: 2, output: 10 }, searchRequest: 0.005 }),
  DAJC_ASK_USD_EUR_RATE: '0.92',
  DAJC_ASK_MONTHLY_BUDGET_EUR: '20',
  DAJC_ASK_DAILY_BUDGET_EUR: '2',
  DAJC_ASK_DAILY_QUERY_LIMIT: '3',
  DAJC_ASK_EMAIL_PEPPER: 'test-pepper-0123456789abcdef0123456789abcdef',
};

export function testConfig(overrides: Partial<AskConfig> = {}): AskConfig {
  return {
    dbUrl: FULL_ENV.DAJC_ASK_DB_URL,
    openaiKey: FULL_ENV.DAJC_ASK_OPENAI_API_KEY,
    classifierModel: 'classifier-model-from-env',
    answerModel: 'answer-model-from-env',
    anthropicKey: FULL_ENV.DAJC_ASK_ANTHROPIC_API_KEY,
    verifierModel: 'verifier-model-from-env',
    perplexityKey: FULL_ENV.DAJC_ASK_PERPLEXITY_API_KEY,
    pricing: JSON.parse(FULL_ENV.DAJC_ASK_PRICING_USD),
    usdToEur: 0.92,
    monthlyBudgetEur: 20,
    dailyBudgetEur: 2,
    dailyQueryLimit: 3,
    emailPepper: FULL_ENV.DAJC_ASK_EMAIL_PEPPER,
    emailFrom: 'DAJC <team@dajc.eu>',
    emailLive: false,
    resendKey: null,
    publicOrigin: 'https://www.dajc.eu',
    ...overrides,
  };
}

// --- Synthetic driving-ban dataset -------------------------------------------

const RULE_BASE = {
  verification_state: 'PRIMARY_VERIFIED',
  verified_at: '2026-09-26T15:25:00.000Z',
  review_window: { from: '2026-09-01', to: '2026-11-30' },
  status: 'ACTIVE',
  sequence: 0,
  restriction_types: ['general'],
  supersedes: [],
  regions: [],
  direction: 'Both directions',
  exceptions: ['Perishable goods.'],
  valid_from: '2026-01-01',
  valid_to: '2026-12-31',
  weight_threshold: { operator: '>', value: 7500, unit: 'kg', applies_to: 'maximum authorised mass' },
  vehicle_scope: 'Lorries over 7.5 t.',
  roads: ['Motorways', 'Class I roads'],
};

export const FIXTURE_CANONICAL: CanonicalLike = {
  window: { from: '2026-09-01', to: '2026-11-30' },
  sources: [
    { source_id: 'cz-law', url: 'https://www.mdcr.gov.cz/zakon-361', role: 'PRIMARY' },
    { source_id: 'at-law', url: 'https://www.ris.bka.gv.at/stvo-42', role: 'PRIMARY' },
    { source_id: 'blog', url: 'https://truckblog.example.com/bans', role: 'SECONDARY' },
  ],
  rules: [
    {
      ...RULE_BASE,
      ban_id: 'cz-sunday',
      jurisdiction: 'CZ',
      title: 'Sunday and public holiday driving ban',
      timezone: 'Europe/Prague',
      legal_basis: 'Act 361/2000 Sb. §43',
      source_id: 'cz-law',
      source_url: 'https://www.mdcr.gov.cz/zakon-361',
      source_authority: 'Czech Ministry of Transport',
      source_version: 'test',
      schedule: { kind: 'weekly', weekdays: [0], start_time: '13:00', end_time: '22:00', end_day_offset: 0 },
    },
    {
      ...RULE_BASE,
      ban_id: 'at-weekend',
      jurisdiction: 'AT',
      title: 'Weekend driving ban',
      timezone: 'Europe/Vienna',
      legal_basis: 'StVO §42',
      source_id: 'at-law',
      source_url: 'https://www.ris.bka.gv.at/stvo-42',
      source_authority: 'RIS',
      source_version: 'test',
      schedule: { kind: 'weekly', weekdays: [0], start_time: '00:00', end_time: '22:00', end_day_offset: 0 },
    },
  ],
  jurisdictions: [
    { jurisdiction: 'CZ', verification_state: 'PRIMARY_VERIFIED', coverage_complete: true, ban_state: 'HAS_BAN', source_ids: ['cz-law'] },
    { jurisdiction: 'AT', verification_state: 'UNVERIFIED', coverage_complete: false, ban_state: 'HAS_BAN', source_ids: ['at-law', 'blog'] },
    { jurisdiction: 'DE', verification_state: 'UNVERIFIED', coverage_complete: false, ban_state: 'UNKNOWN', source_ids: [] },
    { jurisdiction: 'PL', verification_state: 'UNVERIFIED', coverage_complete: false, ban_state: 'UNKNOWN', source_ids: [] },
  ],
};

// A Sunday inside the fixture window, and "today" for the tests.
export const SUNDAY = '2026-11-01';
export const NOW = new Date('2026-10-25T10:00:00Z');

// --- Fake providers ------------------------------------------------------------

export interface FakeScenario {
  classification?: Partial<Classification>;
  draft?: (params: JsonCallParams) => DraftOutput;
  verify?: (params: JsonCallParams) => VerifyOutput;
  searchResults?: Array<{ url: string; title: string }>;
  failOn?: 'classifier' | 'answer' | 'verifier' | 'search';
}

export interface FakeProviders extends Providers {
  calls: { openai: JsonCallParams[]; anthropic: JsonCallParams[]; search: Array<{ queries: string[]; domains: string[] }> };
}

const USAGE = { inputTokens: 1000, outputTokens: 200 };

/** Verifier that marks every item SUPPORTED, impersonal. */
export function supportAll(params: JsonCallParams): VerifyOutput {
  const ids = [...params.user.matchAll(/<item-[0-9a-f]+ id="(C\d+)"/g)].map((m) => m[1]);
  return { results: ids.map((id) => ({ id, verdict: 'SUPPORTED' as const, personal_advice: false })) };
}

export function fakeProviders(scenario: FakeScenario = {}): FakeProviders {
  const calls: FakeProviders['calls'] = { openai: [], anthropic: [], search: [] };
  return {
    calls,
    async openaiJson<T>(params: JsonCallParams): Promise<ModelResult<T>> {
      calls.openai.push(params);
      if (params.schemaName === 'dajc_question') {
        if (scenario.failOn === 'classifier') throw new Error('provider down');
        const json = {
          language: 'en', in_scope: true, case_assessment: false, jurisdictions: ['CZ'], topic: 'driving_ban',
          dates: [SUNDAY], vehicle: { weight_t: null, width_m: null, height_m: null, length_m: null }, search_terms: ['zákaz jízdy nákladních vozidel'],
          ...scenario.classification,
        };
        return { json: json as T, usage: USAGE };
      }
      if (scenario.failOn === 'answer') throw new Error('provider down');
      const draft = scenario.draft ? scenario.draft(params) : { claims: [], covers_question: false };
      return { json: draft as T, usage: USAGE };
    },
    async anthropicJson<T>(params: JsonCallParams): Promise<ModelResult<T>> {
      calls.anthropic.push(params);
      if (scenario.failOn === 'verifier') throw new Error('provider down');
      return { json: (scenario.verify ? scenario.verify(params) : supportAll(params)) as T, usage: USAGE };
    },
    async search({ queries, domains }) {
      calls.search.push({ queries, domains });
      if (scenario.failOn === 'search') throw new Error('provider down');
      return scenario.searchResults || [];
    },
  };
}

/** The id of the first DAJC record in a draft prompt. */
export function firstOwnSourceId(params: JsonCallParams): string {
  return params.user.match(/id="(dajc:[^"]+)"/)?.[1] || 'missing';
}

/** First line of the record text, quoted verbatim. */
export function ownRecordQuote(params: JsonCallParams): string {
  const id = firstOwnSourceId(params);
  const body = params.user.split(`id="${id}"`)[1] || '';
  return body.split('\n').find((line) => line.startsWith('Restriction:'))?.trim() || 'missing';
}

export function htmlPage(title: string, body: string): string {
  return `<!doctype html><html><head><title>${title}</title></head><body><nav>Menu</nav><main><h1>${title}</h1><p>${body}</p></main><footer>Footer</footer></body></html>`;
}

export function fakeFetchPage(pages: Record<string, { html: string; finalUrl?: string }>): FetchPage & { requested: string[] } {
  const requested: string[] = [];
  const fn = (async (url: string) => {
    requested.push(url);
    const page = pages[url];
    if (!page) return { ok: false, error: 'HTTP 404' };
    return { ok: true, text: page.html, finalUrl: page.finalUrl || url };
  }) as FetchPage & { requested: string[] };
  fn.requested = requested;
  return fn;
}
