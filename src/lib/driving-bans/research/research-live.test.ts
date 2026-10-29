import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { canonicalDrivingBans } from '../../../../config/driving-ban-calendars/runtime.mjs';
import { compareWithRegistry, estimateBudget, main, sectionOf, LIVE_TARGETS } from '../../../../scripts/driving-bans-research-live.mjs';
import { researchEnvironment } from './config.mjs';
import { htmlToText } from './documents.mjs';
import { createMockAiFetch, testEnv } from '../../../../tests/fixtures/driving-bans-research/mock-ai.mjs';
import { DOCUMENTS, extraction, restatementRule } from '../../../../tests/fixtures/driving-bans-research/cz-scenarios.mjs';

// The live harness itself is exercised here with a stubbed fetch: these are NOT live API tests.
const nativeFetch = globalThis.fetch;
const dirs: string[] = [];
afterEach(() => { globalThis.fetch = nativeFetch; for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
const PROFILE_ENV = testEnv({ DAJC_RESEARCH_MODEL_PROFILE: 'bakeoff-2026-10-25', DAJC_RESEARCH_RUN_BUDGET_USD: '1.5', DAJC_RESEARCH_MONTHLY_BUDGET_USD: '5' });

describe('live check harness (offline)', () => {
  it('plans for free: configuration, routes and a capped budget estimate', async () => {
    const plan: any = await main(['plan'], PROFILE_ENV);
    expect(plan.readiness.enabled).toBe(true);
    expect(plan.budget.total_usd_estimate).toBeGreaterThan(0);
    expect(plan.budget.total_usd_estimate).toBeLessThan(1.5);
    expect(plan.budget.rows.e2e.map((row: any) => row.provider)).toHaveLength(2);
    expect(new Set(plan.budget.rows.e2e.map((row: any) => row.provider)).size).toBe(2);
    expect(JSON.stringify(plan)).not.toMatch(/test-key/);
    expect(estimateBudget(researchEnvironment({})).total_usd_estimate).toBe(0);
  });

  it('refuses every paid check while research is off', async () => {
    expect(await main(['smoke'], {})).toMatchObject({ status: 'DISABLED' });
    await expect(main(['everything'], PROFILE_ENV)).rejects.toThrow(/Usage/);
  });

  it('cuts the reference provision and compares an extraction with the verified registry rule', () => {
    const text = htmlToText(DOCUMENTS.restatement.replace('<h2>§ 43 Omezení jízdy některých vozidel</h2>', '<h2>§ 43</h2><p>Omezení jízdy některých vozidel</p>')) + '\n§ 44\nPravidla';
    const section = sectionOf(text, LIVE_TARGETS.scenario.section)!;
    expect(section.startsWith('§ 43')).toBe(true);
    expect(section).not.toMatch(/§ 44/);
    const rule = canonicalDrivingBans.rules.find((item: any) => item.ban_id === 'cz-sunday');
    expect(compareWithRegistry(extraction([restatementRule()]), rule)).toEqual({ matched: true, differences: [] });
    const wrong = restatementRule(); wrong.schedule = { ...wrong.schedule, end_time: '21:00' };
    expect(compareWithRegistry(extraction([wrong]), rule)).toEqual({ matched: false, differences: ['end 21:00 vs 22:00'] });
  });

  it('runs the smoke and failover checks through the real code paths (stubbed transport)', async () => {
    const ai = createMockAiFetch({ brain: { extract: () => ({ ok: true, echo: 'DAJC' }), search: () => [{ url: 'https://www.ris.bka.gv.at/x', title: 'x' }] } });
    globalThis.fetch = (async (url: string, init: any) => {
      const body = JSON.parse(init.body);
      if (body.model === 'dajc-nonexistent-model-check') return new Response(JSON.stringify({ type: 'error', error: { type: 'not_found_error', message: 'model: dajc-nonexistent-model-check' } }), { status: 404 });
      return ai.fetchFn(url, init);
    }) as typeof fetch;
    const out = mkdtempSync(join(tmpdir(), 'dajc-live-')); dirs.push(out);
    const before = readFileSync('data/driving-bans/canonical.json', 'utf8');
    const smoke: any = await main(['smoke', '--out', out], PROFILE_ENV);
    expect(smoke).toMatchObject({ checks: ['smoke'], canonical_unchanged: true, promoted: false });
    const smokeResult = JSON.parse(readFileSync(join(out, 'smoke.json'), 'utf8'));
    expect(smokeResult.results.map((r: any) => [r.provider, r.outcome])).toEqual(expect.arrayContaining([['anthropic', 'OK'], ['openai', 'OK'], ['gemini', 'OK'], ['xai', 'OK'], ['mistral', 'OK'], ['perplexity', 'OK']]));
    const fallback: any = await main(['fallback', '--out', out], PROFILE_ENV);
    expect(fallback.canonical_unchanged).toBe(true);
    const result = JSON.parse(readFileSync(join(out, 'fallback.json'), 'utf8'));
    expect(result.outcomes.map((o: any) => o.served_by)).toEqual([result.second, result.second]);
    expect(result.first_provider_requests).toBe(1);
    expect(result.first_provider_state.blocked).toBe('MODEL_NOT_FOUND');
    expect(readFileSync('data/driving-bans/canonical.json', 'utf8')).toBe(before);
  });
});
