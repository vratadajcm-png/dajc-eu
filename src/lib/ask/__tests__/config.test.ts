import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { getAskConfig, isAskFlagOn, readAskConfig } from '../config';
import { handleLogin, handleLogout, handleQuery, handleStatus, handleVerify, type RouteContext } from '../handlers';
import { getAskRuntime } from '../runtime';
import { FULL_ENV } from './helpers';

function ctx(method = 'POST'): RouteContext {
  const url = new URL('https://www.dajc.eu/api/ask/query');
  return {
    request: new Request(url, { method, headers: { origin: 'https://www.dajc.eu', 'content-type': 'application/json' }, body: method === 'GET' ? undefined : '{}' }),
    url,
    cookies: { get: () => undefined, set: () => undefined, delete: () => undefined },
    clientAddress: '203.0.113.1',
  };
}

describe('Ask DAJC AI is off by default', () => {
  it('is off without any configuration', () => {
    expect(isAskFlagOn({})).toBe(false);
    expect(getAskConfig({})).toBeNull();
    expect(getAskRuntime({})).toBeNull();
  });

  it.each(['TRUE', '1', 'yes', ' true', 'true ', '', 'false'])('treats DAJC_ASK_ENABLED=%j as off', (value) => {
    expect(getAskConfig({ ...FULL_ENV, DAJC_ASK_ENABLED: value })).toBeNull();
  });

  it('is on only with the exact flag and a complete configuration', () => {
    const config = getAskConfig(FULL_ENV);
    expect(config).not.toBeNull();
    expect(config!.monthlyBudgetEur).toBe(20);
    expect(config!.dailyBudgetEur).toBe(2);
    expect(config!.dailyQueryLimit).toBe(3);
    expect(config!.answerModel).toBe('answer-model-from-env');
  });

  it('stays off without DAJC_ASK_DB_URL (the database is never assumed)', () => {
    const { DAJC_ASK_DB_URL: _omit, ...env } = FULL_ENV;
    expect(getAskConfig(env)).toBeNull();
    const result = readAskConfig(env);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.problems).toContain('DAJC_ASK_DB_URL is missing');
  });

  it.each([
    'DAJC_ASK_OPENAI_API_KEY', 'DAJC_ASK_ANTHROPIC_API_KEY', 'DAJC_ASK_PERPLEXITY_API_KEY',
    'DAJC_ASK_OPENAI_ANSWER_MODEL', 'DAJC_ASK_ANTHROPIC_VERIFIER_MODEL', 'DAJC_ASK_PRICING_USD',
    'DAJC_ASK_MONTHLY_BUDGET_EUR', 'DAJC_ASK_EMAIL_PEPPER',
  ])('stays off without %s', (name) => {
    const env = { ...FULL_ENV };
    delete env[name];
    expect(getAskConfig(env)).toBeNull();
  });

  it('never falls back to the article pipeline keys', () => {
    const env: Record<string, string> = { ...FULL_ENV, ANTHROPIC_API_KEY: 'pipeline', PERPLEXITY_API_KEY: 'pipeline', OPENAI_API_KEY: 'pipeline' };
    delete env.DAJC_ASK_ANTHROPIC_API_KEY;
    delete env.DAJC_ASK_PERPLEXITY_API_KEY;
    delete env.DAJC_ASK_OPENAI_API_KEY;
    expect(getAskConfig(env)).toBeNull();
  });

  it('rejects a key copied from the article pipeline', () => {
    const env = { ...FULL_ENV, ANTHROPIC_API_KEY: FULL_ENV.DAJC_ASK_ANTHROPIC_API_KEY };
    const result = readAskConfig(env);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.problems.join(' ')).toMatch(/separate key/);
  });

  it('rejects invalid pricing, budgets and limits', () => {
    expect(getAskConfig({ ...FULL_ENV, DAJC_ASK_PRICING_USD: '{"answer":1}' })).toBeNull();
    expect(getAskConfig({ ...FULL_ENV, DAJC_ASK_MONTHLY_BUDGET_EUR: '-5' })).toBeNull();
    expect(getAskConfig({ ...FULL_ENV, DAJC_ASK_DAILY_QUERY_LIMIT: '0' })).toBeNull();
    expect(getAskConfig({ ...FULL_ENV, DAJC_ASK_PUBLIC_ORIGIN: 'http://www.dajc.eu' })).toBeNull();
    expect(getAskConfig({ ...FULL_ENV, DAJC_ASK_EMAIL_PEPPER: 'short' })).toBeNull();
  });

  it('answers 404 on every route while off', async () => {
    for (const handler of [handleLogin, handleVerify, handleLogout, handleQuery]) {
      expect((await handler(ctx(), null)).status).toBe(404);
    }
    expect((await handleStatus(ctx('GET'), null)).status).toBe(404);
  });

  it('ships disabled in .env.example', () => {
    const example = readFileSync(new URL('../../../../.env.example', import.meta.url), 'utf8');
    expect(example).toMatch(/^DAJC_ASK_ENABLED=false$/m);
    for (const name of ['DAJC_ASK_OPENAI_API_KEY', 'DAJC_ASK_ANTHROPIC_API_KEY', 'DAJC_ASK_PERPLEXITY_API_KEY', 'DAJC_ASK_DB_URL', 'DAJC_ASK_EMAIL_PEPPER']) {
      expect(example).toMatch(new RegExp(`^${name}=$`, 'm'));
    }
  });

  it('the page itself refuses to render while off and is never indexed', () => {
    const page = readFileSync(new URL('../../../pages/intelligence/ask.astro', import.meta.url), 'utf8');
    expect(page).toMatch(/export const prerender = false/);
    expect(page).toMatch(/if \(!getAskConfig\(\)\)[\s\S]*status: 404/);
    expect(page).toMatch(/robots="noindex, nofollow"/);
    expect(page).toMatch(/X-Robots-Tag', 'noindex/);
  });
});
