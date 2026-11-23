import { describe, expect, it } from 'vitest';
import { formatWeeklyFailure, previousFailureState } from '../../report-weekly-failure.mjs';
const context = { repo: 'example/dajc', week: '2026-W47', runId: '100' };
const info = (workflow, step) => ({ name: workflow, jobs: [{ name: 'publish', steps: [{ name: 'Checkout', conclusion: 'success' }, { name: step, conclusion: 'failure' }] }] });

describe('durable weekly operational failure alert', () => {
  it('identifies an API credential failure without inventing an editorial rejection', () => {
    const result = formatWeeklyFailure({ ...context, runInfo: info('Publish Weekly', 'Pre-flight — API credentials'), annotations: ['ANTHROPIC_API_KEY is not configured'] });
    expect(result.body).toContain('publish → Pre-flight — API credentials (failure)');
    expect(result.body).toContain('ANTHROPIC_API_KEY is not configured');
    expect(result.state.editorialReasons).toEqual([]);
    expect(result.body).not.toContain('Independent Claude blocking reasons');
  });
  it('retains the original structured Claude veto when a later watchdog reports missing delivery', () => {
    const initial = formatWeeklyFailure({ ...context, runInfo: info('Publisher', 'Claude final editorial approval'),
      veto: { review: { verdict: 'reject', blockingReasons: ['The Italian notice has no dated authority confirmation.', 'The 12 t threshold is unsupported.'] } } });
    const later = formatWeeklyFailure({ ...context, runId: '101', runInfo: info('Watchdog', 'Verify latest due edition on production independently'),
      annotations: ['ARTICLE_MISSING: 2026-W47 has no merged article'], previousBody: initial.body });
    expect(later.body).toContain('ARTICLE_MISSING');
    expect(later.body).toContain('Independent Claude blocking reasons (https://github.com/example/dajc/actions/runs/100)');
    expect(later.state.editorialReasons).toEqual(initial.state.editorialReasons);
    expect(later.state.runs.map(r => r.url)).toEqual(['https://github.com/example/dajc/actions/runs/100', 'https://github.com/example/dajc/actions/runs/101']);
    expect(previousFailureState(later.body, context.repo)).toEqual({ runs: later.state.runs, editorialReasons: later.state.editorialReasons, editorialRun: later.state.editorialRun });
  });
  it('deduplicates repeated run updates and retains only the eight most recent distinct runs', () => {
    let previousBody = '';
    let result;
    for (let runId = 100; runId <= 110; runId++) {
      result = formatWeeklyFailure({ ...context, runId: String(runId), previousBody, runInfo: info('Publisher', 'Generate') });
      previousBody = result.body;
    }
    result = formatWeeklyFailure({ ...context, runId: '110', previousBody, runInfo: info('Publisher', 'Generate') });
    expect(result.state.runs).toHaveLength(8);
    expect(result.state.runs[0].url).toMatch(/\/103$/);
    expect(new Set(result.state.runs.map(r => r.url)).size).toBe(8);
  });
  it('migrates old generic issue bodies without losing their run URL', () => {
    const previousBody = 'Run: https://github.com/example/dajc/actions/runs/99';
    const result = formatWeeklyFailure({ ...context, previousBody, runInfo: info('Watchdog', 'Verify production') });
    expect(result.state.runs[0].url).toMatch(/\/99$/);
    expect(result.state.runs[1].url).toMatch(/\/100$/);
  });
  it('redacts credential-shaped content in diagnostics, model reasons and stored machine evidence', () => {
    const result = formatWeeklyFailure({ ...context, runInfo: info('Publisher', 'Review'),
      annotations: ['Authorization: Bearer pretendSecret123'],
      veto: { review: { verdict: 'reject', blockingReasons: ['untrusted page says sk-ant-pretendToken123 and pplx-pretendToken456'] } } });
    expect(result.body).not.toContain('pretendSecret123');
    expect(result.body).not.toContain('pretendToken');
    expect(result.body).toContain('[REDACTED]');
  });
});
