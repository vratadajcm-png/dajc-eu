import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { aggregate, assertNoCredentials, buildLiveEvidence, main, runEvidence } from '../../../../scripts/ai-lab-live-evidence.mjs';
import { LIVE_EVIDENCE, MODEL_PROFILE, applyModelProfile, liveEvidenceFor, providerApiStatus, rankModels, recommendModels } from '../../ai/model-profile.mjs';
import { PROVIDER_IDS } from '../../ai/providers.mjs';

// SYNTHETIC artifacts in the shape of the AI Lab workflow "DAJC-eu research live check" (no API calls here).
const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
const audit = (provider: string, model: string, outcome = 'OK', extra: any = {}) => ({ task: 'extract', purpose: 'smoke test', provider, requested_model: model, model: outcome === 'OK' ? model : null, outcome, input_tokens: 10, output_tokens: 5, cost_usd: outcome === 'OK' ? 0.001 : 0, latency_ms: 900, ...extra });
function artifact(files: Record<string, any>, drafts: any[] = []) {
  const dir = mkdtempSync(join(tmpdir(), 'dajc-ai-lab-')); dirs.push(dir);
  for (const [name, value] of Object.entries(files)) writeFileSync(join(dir, name), typeof value === 'string' ? value : JSON.stringify(value));
  mkdirSync(join(dir, 'research-store', 'drafts'), { recursive: true });
  for (const draft of drafts) writeFileSync(join(dir, 'research-store', 'drafts', `${draft.draft_id}.json`), JSON.stringify(draft));
  return dir;
}
const summary = { generated_at: '2026-10-30T03:00:00Z', checks: ['smoke', 'e2e'], total_cost_usd: 0.02, run_budget_usd: 1.5, providers_blocked_for_run: { anthropic: 'CREDIT_OR_BILLING' }, canonical_unchanged: true, promoted: false };
const smoke = { check: 'smoke', results: [
  { provider: 'anthropic', outcome: 'FAILED', audit: [audit('anthropic', 'claude-sonnet-5-5', 'FAILED', { error_category: 'CREDIT_OR_BILLING', http_status: 400, blocked_for_run: 'CREDIT_OR_BILLING' })] },
  { provider: 'gemini', outcome: 'OK', served_model: 'gemini-3.5-flash-lite', audit: [audit('gemini', 'gemini-3.5-flash-lite')] },
] };
const draft = { draft_id: 'rdraft-0123456789abcdef', jurisdiction: 'AT', state: 'REVIEW_REQUIRED', phases: ['DISCOVERED', 'REVIEW_REQUIRED'], document: { kind: 'TEXT_EXCERPT', parts: [{}, {}] },
  extraction: { provider: 'openai', model: 'gpt-6-sol', escalated_from: 'gemini-3.5-flash-lite', rules: [{ evidence: [{ field: 'weight', quote: 'mehr als 7,5 t' }] }] },
  cross_check: { provider: 'gemini', model: 'gemini-3.5-flash-lite', overall: 'CONSISTENT', ok: true }, second_extraction: { provider: 'xai', model: 'grok-4.7', agreed: true },
  findings: [{ code: 'ESCALATED_EXTRACTION', blocking_state: 'NOTE', message: 'free text' }] };
const e2e = { check: 'e2e', jurisdiction: 'AT', steps: { retrieval: { discovered: 2, retrieved: 1, unavailable: [{ url: 'x' }] }, independent_check: { performed: 1, agreed: 1 } }, drafts: [], audit: [audit('openai', 'gpt-6-sol', 'OK', { task: 'extract', purpose: 'legal rule extraction (escalated)' })] };

describe('DAJC AI Lab live evidence import', () => {
  it('keeps metadata only: no prompts, quotes, rules or provider messages', () => {
    const run = runEvidence(artifact({ 'summary.json': summary, 'smoke.json': smoke, 'e2e.json': e2e }, [draft]), { runId: '1', commit: 'abc1234' });
    const text = JSON.stringify(run);
    expect(text).not.toMatch(/mehr als 7,5 t|free text|"rules"|"quote"/);
    expect(run.e2e!.drafts[0]).toMatchObject({ state: 'REVIEW_REQUIRED', document: { kind: 'TEXT_EXCERPT', parts: 2 }, extraction: { provider: 'openai', escalated_from: 'gemini-3.5-flash-lite' }, notes: ['ESCALATED_EXTRACTION'] });
    expect(run.smoke).toEqual([expect.objectContaining({ provider: 'anthropic', outcome: 'FAILED', blocked_for_run: 'CREDIT_OR_BILLING' }), expect.objectContaining({ provider: 'gemini', outcome: 'OK' })]);
  });

  it('refuses an artifact with anything that looks like a credential, without repeating it', () => {
    const leaked = { ...smoke, results: [{ ...smoke.results[1], note: 'Authorization: Bearer abcdefghijklmnopqrstuvwxyz0123456789' }] };
    const dir = artifact({ 'summary.json': summary, 'smoke.json': leaked });
    expect(() => runEvidence(dir, { runId: '2', commit: null })).toThrow(/credential-like content/);
    try { runEvidence(dir, { runId: '2', commit: null }); } catch (error: any) { expect(error.message).not.toMatch(/abcdefghij/); }
    for (const sample of ['sk-proj-' + 'a'.repeat(30), 'AIza' + 'b'.repeat(35), 'xai-' + 'c'.repeat(30), '"x-api-key": "secret-value-1"']) expect(() => assertNoCredentials(sample, 't')).toThrow();
    expect(() => assertNoCredentials(JSON.stringify(LIVE_EVIDENCE), 'committed evidence')).not.toThrow();
  });

  it('keeps API failures apart from quality and ignores the deliberate unknown model', () => {
    const fallback = { first: 'openai', second: 'xai', outcomes: [{ served_by: 'xai' }], first_provider_requests: 1, first_provider_state: { blocked: 'MODEL_NOT_FOUND' }, audit: [audit('openai', 'dajc-nonexistent-model-check', 'FAILED', { error_category: 'MODEL_NOT_FOUND' }), audit('xai', 'grok-4.7')] };
    const run = runEvidence(artifact({ 'summary.json': summary, 'smoke.json': smoke, 'fallback.json': fallback, 'e2e.json': e2e }, [draft]), { runId: '3', commit: null });
    const { models, providers } = aggregate([run]);
    expect(models.find(m => m.model === 'claude-sonnet-5-5')).toMatchObject({ calls: 1, ok: 0, failed_by_category: { CREDIT_OR_BILLING: 1 }, extraction: { readings: 0 } });
    expect(models.some(m => m.model === 'dajc-nonexistent-model-check')).toBe(false);
    expect(models.find(m => m.model === 'gpt-6-sol')).toMatchObject({ used_in_review_required_draft: 1 });
    expect(providers.find(p => p.provider === 'anthropic')).toMatchObject({ last_account_block: { category: 'CREDIT_OR_BILLING' } });
    expect(buildLiveEvidence({ repository: 'o/r', runs: [run] }).totals).toMatchObject({ runs: 1, canonical_unchanged: true, promoted: false });
    expect(() => main(['--repository', 'not a repo', '--run', '1=x'])).toThrow(/Usage/);
  });
});

describe('model catalog with AI Lab evidence', () => {
  it('records the AI Lab, its live runs and the account state of all six providers', () => {
    expect(MODEL_PROFILE.ai_lab).toMatchObject({ name: 'DAJC AI Lab – Multi-Model Research & Testing', planned_repository: 'vratadajcm-png/dajc-ai-lab', live_evidence_file: 'data/ai-benchmark/live-checks-2026-10.json' });
    expect(MODEL_PROFILE.ai_lab.repository).toBe(LIVE_EVIDENCE.source.repository);
    expect(LIVE_EVIDENCE.totals).toMatchObject({ runs: 4, canonical_unchanged: true, promoted: false });
    expect(LIVE_EVIDENCE.totals.cost_usd).toBeLessThan(1.5);
    const status = providerApiStatus();
    expect(Object.keys(status).sort()).toEqual([...PROVIDER_IDS].sort());
    expect(status).toMatchObject({ anthropic: { status: 'ACCOUNT_BLOCKED', category: 'CREDIT_OR_BILLING' }, mistral: { status: 'ACCOUNT_BLOCKED' }, openai: { status: 'OK' }, gemini: { status: 'OK' }, xai: { status: 'OK' }, perplexity: { status: 'NOT_TESTED' } });
  });

  it('keeps the approved strategy: Flash-Lite first, GPT-6 Sol for complex documents and second readings, the check at another vendor', () => {
    const recommendation = recommendModels();
    expect(recommendation.extract.model).toBe('gemini-3.5-flash-lite');
    expect(recommendation.extract_complex.model).toBe('gpt-6-sol');
    expect(recommendation.escalation).toMatchObject({ model: 'gpt-6-sol', when: expect.stringMatching(/fails the deterministic checks/) });
    expect(recommendation.verify.vendor).not.toBe(recommendation.extract.vendor);
    expect(recommendation.extract.live).toMatchObject({ source: LIVE_EVIDENCE.source.repository });
    expect(liveEvidenceFor('openai', 'gpt-6-sol')!.used_in_review_required_draft).toBeGreaterThan(0);
  });

  it('never ranks an account failure as quality: Anthropic and Mistral stay unscored, with their API state attached', () => {
    const ranked = rankModels('extract');
    for (const model of ['claude-sonnet-5-5', 'mistral-small-2603']) {
      const row = ranked.find(item => item.model === model)!;
      expect(row).toMatchObject({ score: null, status: 'NOT_BENCHMARKED' });
      expect(row.live).toMatchObject({ ok: 0 });
    }
    // The live evidence changes no setting the profile applies.
    const env = applyModelProfile({ DAJC_RESEARCH_MODEL_PROFILE: MODEL_PROFILE.profile_id, DAJC_RESEARCH_OPENAI_API_KEY: 'k', DAJC_RESEARCH_GEMINI_API_KEY: 'k' });
    expect(env).toMatchObject({ DAJC_RESEARCH_GEMINI_MODEL: 'gemini-3.5-flash-lite', DAJC_RESEARCH_OPENAI_MODEL: 'gpt-6-sol', DAJC_RESEARCH_OPENAI_REASONING_EFFORT: 'none' });
    expect(env.DAJC_RESEARCH_ROUTE_EXTRACT_COMPLEX).toMatch(/^openai,/);
  });
});
