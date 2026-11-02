import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { aggregate, assertNoCredentials, buildLiveEvidence, main, runEvidence } from '../../../../scripts/ai-lab-live-evidence.mjs';
import { BENCHMARK_EVIDENCE, LIVE_EVIDENCE, MODEL_PROFILE, PROFILE_TASKS, applyModelProfile, liveEvidenceFor, modelCatalog, policyAssignments, proposePolicyUpdate, providerApiStatus, rankModels, recommendModels } from '../../ai/model-profile.mjs';
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
    expect(MODEL_PROFILE.ai_lab).toMatchObject({ name: 'DAJC AI Lab – Multi-Model Research & Testing', repository: 'vratadajcm-png/dajc-ai-lab', former_repository: 'vratadajcm-png/dajc-ai-bakeoff', live_evidence_file: 'data/ai-benchmark/live-checks-2026-10.json' });
    // The evidence keeps the name the repository had when the runs happened; links use the current name.
    expect(LIVE_EVIDENCE.source.repository).toBe(MODEL_PROFILE.ai_lab.former_repository);
    expect(recommendModels().live_evidence.source).toMatchObject({ repository: 'vratadajcm-png/dajc-ai-lab', repository_at_run_time: 'vratadajcm-png/dajc-ai-bakeoff' });
    expect(LIVE_EVIDENCE.totals).toMatchObject({ runs: 4, canonical_unchanged: true, promoted: false });
    expect(LIVE_EVIDENCE.totals.cost_usd).toBeLessThan(1.5);
    const status = providerApiStatus();
    expect(Object.keys(status).sort()).toEqual([...PROVIDER_IDS].sort());
    expect(status).toMatchObject({ anthropic: { status: 'ACCOUNT_BLOCKED', category: 'CREDIT_OR_BILLING', keys: 'vratadajcm-png/dajc-ai-lab' }, mistral: { status: 'ACCOUNT_BLOCKED' }, openai: { status: 'OK' }, gemini: { status: 'OK' }, xai: { status: 'OK' }, perplexity: { status: 'NOT_TESTED' } });
  });

  it('keeps the approved strategy: Flash-Lite first, GPT-6 Sol for complex documents and second readings, the check at another vendor', () => {
    const recommendation = recommendModels();
    expect(recommendation.extract.model).toBe('gemini-3.5-flash-lite');
    expect(recommendation.extract_complex.model).toBe('gpt-6-sol');
    expect(recommendation.escalation).toMatchObject({ model: 'gpt-6-sol', when: expect.stringMatching(/fails the deterministic checks/) });
    expect(recommendation.verify.vendor).not.toBe(recommendation.extract.vendor);
    expect(recommendation.extract.live).toMatchObject({ source: 'vratadajcm-png/dajc-ai-lab' });
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

describe('approved model policy', () => {
  const KEYS = { DAJC_RESEARCH_MODEL_PROFILE: MODEL_PROFILE.profile_id, DAJC_RESEARCH_OPENAI_API_KEY: 'k', DAJC_RESEARCH_GEMINI_API_KEY: 'k', DAJC_RESEARCH_XAI_API_KEY: 'k' };

  it('resolves the owner-approved strategy with an evidence level per role', () => {
    const policy = policyAssignments();
    expect(policy.extract.map((e: any) => e.model)).toEqual(['gemini-3.5-flash-lite', 'gpt-6-sol', 'grok-4.7']);
    expect(policy.extract_complex[0]).toMatchObject({ model: 'gpt-6-sol', level: 'LIVE_EXTRACTION_VERIFIED', eligible: true });
    expect(policy.explain[0]).toMatchObject({ model: 'gpt-6-luna', level: 'BENCHMARK_DIRECT', eligible: true });
    // Gemini checked the escalated extraction in the REVIEW_REQUIRED live run; its own first reading failed, so it is not live-verified for extraction.
    const catalog = modelCatalog();
    const lite = catalog.find((c: any) => c.model === 'gemini-3.5-flash-lite')!;
    expect(lite.tasks).toMatchObject({ verify: 'LIVE_EXTRACTION_VERIFIED', extract: 'BENCHMARK_INDIRECT', extract_complex: 'BENCHMARK_INDIRECT' });
    expect(lite).toMatchObject({ last_verified: '2026-10-30', policy_roles: ['extract', 'extract_complex', 'verify'], source: { lab: 'vratadajcm-png/dajc-ai-lab' } });
    for (const model of ['claude-sonnet-5-5', 'mistral-small-2603']) {
      const entry = catalog.find((c: any) => c.model === model)!;
      expect(Object.values(entry.tasks).every(level => level === 'UNAVAILABLE')).toBe(true);
      expect(entry.excluded_reason).toBeTruthy();
    }
    const recommendation = recommendModels();
    expect(recommendation).toMatchObject({ policy_id: MODEL_PROFILE.policy.policy_id, discover: { provider: 'perplexity' }, conflicts: { engine: expect.stringMatching(/^deterministic/) }, explain: { model: 'gpt-6-luna' }, explain_escalation: { model: 'gpt-6-sol' } });
    expect(MODEL_PROFILE.policy.tasks.articles.service).toMatch(/Weekly/);
  });

  // Scenario 22: new AI Lab evidence becomes a proposal for the owner; the policy and the applied settings stay as they are.
  it('turns new AI Lab evidence into a proposal only, never into a setting', () => {
    const policyBefore = JSON.stringify(MODEL_PROFILE.policy);
    const envBefore = applyModelProfile(KEYS);
    const live = structuredClone(LIVE_EVIDENCE);
    (live.runs as any[]).push({ run_id: 'synthetic', generated_at: '2026-11-02T03:00:00Z', calls: [], e2e: { drafts: [{ draft_id: 'rdraft-synthetic', state: 'REVIEW_REQUIRED', extraction: { provider: 'openai', model: 'gpt-5.4-mini', escalated_from: null }, cross_check: { provider: 'xai', model: 'grok-4.7' }, second_extraction: null }] } });
    const update = proposePolicyUpdate({ live });
    expect(update.applied).toBe(false);
    expect(update.proposals).toEqual(expect.arrayContaining([expect.objectContaining({ role: 'extract', kind: 'CANDIDATE_FOR_POLICY', model: 'openai/gpt-5.4-mini', level: 'LIVE_EXTRACTION_VERIFIED', note: expect.stringMatching(/approved by the owner/) })]));
    expect(JSON.stringify(MODEL_PROFILE.policy)).toBe(policyBefore);
    expect(recommendModels({ live }).extract.model).toBe('gemini-3.5-flash-lite');
    expect(applyModelProfile(KEYS, { live })).toEqual(envBefore);
    expect(Object.values(applyModelProfile(KEYS, { live }))).not.toContain('gpt-5.4-mini');
  });

  // Scenario 24: a top score in an unrelated benchmark gives no eligibility, even when someone lists the model in the policy.
  it('never uses a model for extraction because of a high score in an unrelated test', () => {
    const profile = structuredClone(MODEL_PROFILE);
    (profile.candidates.find((c: any) => c.model === 'gemini-3.5-flash') as any).evidence_category = 'general-chat-arena';
    profile.policy.tasks.extract.primary = 'gemini/gemini-3.5-flash';
    const evidence = structuredClone(BENCHMARK_EVIDENCE);
    evidence.models.find((m: any) => m.model === 'gemini-3.5-flash')!.consolidated.correct_rate_of_completed = 1;
    for (const task of PROFILE_TASKS) {
      const row = rankModels(task, { profile, evidence }).find((item: any) => item.model === 'gemini-3.5-flash')!;
      expect(row).toMatchObject({ score: null, evidence_level: 'NOT_BENCHMARKED', reason: expect.stringMatching(/general-chat-arena benchmark says nothing about/) });
    }
    expect(policyAssignments({ profile, evidence }).extract[0]).toMatchObject({ model: 'gemini-3.5-flash', eligible: false, level: 'NOT_BENCHMARKED' });
    expect(proposePolicyUpdate({ profile, evidence }).proposals).toEqual(expect.arrayContaining([expect.objectContaining({ role: 'extract', kind: 'POLICY_MODEL_NOT_ELIGIBLE', model: 'gemini/gemini-3.5-flash' })]));
    expect(recommendModels({ profile, evidence }).extract.model).not.toBe('gemini-3.5-flash');
    const env = applyModelProfile(KEYS, { profile, evidence });
    expect(Object.values(env)).not.toContain('gemini-3.5-flash');
    expect(env.DAJC_RESEARCH_GEMINI_MODEL).toBe('gemini-3.5-flash-lite');
  });
});
