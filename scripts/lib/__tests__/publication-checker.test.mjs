import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const sourceRoot = fileURLToPath(new URL('../../../', import.meta.url));
const cleanup = [];
function fixture(overrides = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'dajc-checker-test-')); cleanup.push(root);
  for (const relative of ['scripts/check-weekly-publication.mjs', 'scripts/lib/edition-plan.mjs', 'scripts/lib/week.mjs', 'scripts/lib/next-publication.mjs', 'scripts/lib/publish-gate.mjs', 'scripts/lib/weekly-recovery.mjs']) {
    mkdirSync(path.dirname(path.join(root, relative)), { recursive: true }); copyFileSync(path.join(sourceRoot, relative), path.join(root, relative));
  }
  const bin = path.join(root, 'bin'); mkdirSync(bin);
  writeFileSync(path.join(bin, 'gh'), `#!${process.execPath}\nimport { appendFileSync } from 'node:fs';\nappendFileSync(process.env.CALLS, JSON.stringify(process.argv.slice(2))+'\\n');\nconsole.log(process.env.PULLS || '[]');\n`, { mode: 0o755 });
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: 'test/repo', GH_TOKEN: 'synthetic',
    GITHUB_OUTPUT: path.join(root, 'outputs'), GITHUB_STEP_SUMMARY: '', OVERSIZE_TARGET_WEEK: '', OVERSIZE_CHECK_MODE: '', OVERSIZE_PREVIEW: '', OVERSIZE_CORRECTION: '',
    OVERSIZE_RECOVERY_ALLOWED: '1', OVERSIZE_NOW: '2026-11-16T12:00:00Z', CALLS: path.join(root, 'calls'), ...overrides };
  const run = args => execFileSync(process.execPath, [path.join(root, 'scripts/check-weekly-publication.mjs'), ...(args || [])], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  return { root, env, run, outputs: () => readFileSync(env.GITHUB_OUTPUT, 'utf8') };
}
afterEach(() => { for (const root of cleanup.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe('publication idempotency and read-only recovery decisions', () => {
  it('targets upcoming W48 by default and explicit missed W47 on Monday', () => {
    const next = fixture(); next.run(); expect(next.outputs()).toContain('week=2026-W48'); expect(next.outputs()).toContain('public_due=false');
    const late = fixture({ OVERSIZE_TARGET_WEEK: '2026-W47' }); late.run(); expect(late.outputs()).toContain('week=2026-W47'); expect(late.outputs()).toContain('overdue=true');
  });
  it('watchdog selects latest due W47 instead of upcoming W48', () => {
    const f = fixture({ OVERSIZE_CHECK_MODE: 'watchdog' }); f.run(); expect(f.outputs()).toContain('week=2026-W47'); expect(f.outputs()).toContain('overdue=true');
  });
  it('rejects invalid target ISO week before querying GitHub or paid APIs', () => {
    const f = fixture(); expect(() => f.run(['--target-week', '2027-W53'])).toThrow();
  });
  it('keeps an approved open PR pending without another generation', () => {
    const f = fixture({ PULLS: JSON.stringify([{ state: 'OPEN', url: 'https://github.test/pull/1', headRefName: 'automation/weekly-2026-w48', headRefOid: 'a'.repeat(40), body: '<!-- DAJC_WEEKLY_STATE:EDITORIAL_APPROVED -->\n<!-- DAJC_WEEKLY_ATTEMPT:123-1 -->' }]) });
    f.run(); expect(f.outputs()).toContain('needed=false'); expect(f.outputs()).toContain('pending_pr=true'); expect(f.outputs()).toContain('approved_pr=https://github.test/pull/1'); expect(f.outputs()).toContain(`pr_head=${'a'.repeat(40)}`);
  });
  it('never resumes rejected, forged-marker or draft publication PRs', () => {
    for (const override of [{ body: '<!-- DAJC_WEEKLY_STATE:EDITORIAL_REJECTED -->' }, { isDraft: true }, { headRefOid: '' }, { body: '<!-- DAJC_WEEKLY_STATE:EDITORIAL_APPROVED -->' }]) {
      const f = fixture({ PULLS: JSON.stringify([{ state: 'OPEN', url: 'https://github.test/pull/1', headRefName: 'automation/weekly-2026-w48', headRefOid: 'a'.repeat(40), body: '<!-- DAJC_WEEKLY_STATE:EDITORIAL_APPROVED -->\n<!-- DAJC_WEEKLY_ATTEMPT:123-1 -->', ...override }]) });
      f.run(); expect(f.outputs()).toContain('approved_pr=\n'); expect(f.outputs()).toContain('pr_head=\n');
    }
  });
  it('allows controlled replacement of a rejected PR and keeps the original open for audit', () => {
    const url = 'https://github.test/pull/1';
    const f = fixture({ OVERSIZE_TARGET_WEEK: '2026-W47', PULLS: JSON.stringify([{ state: 'OPEN', url, headRefName: 'automation/weekly-2026-w47', body: 'Editorial status: REJECTED_BY_CLAUDE', createdAt: '2026-11-12T12:00:00Z', updatedAt: '2026-11-12T12:00:00Z' }]) });
    f.run(); expect(f.outputs()).toContain('needed=true'); expect(f.outputs()).toContain(`replaces_pr=${url}`);
    const calls = readFileSync(f.env.CALLS, 'utf8').trim().split('\n').map(JSON.parse);
    expect(calls.every(call => call[0] === 'pr' && call[1] === 'list')).toBe(true);
  });
  it('treats an existing main article as an idempotent no-op, leaving public proof to verifier', () => {
    const f = fixture(); const folder = path.join(f.root, 'src/content/news/eu-oversize'); mkdirSync(folder, { recursive: true }); writeFileSync(path.join(folder, 'eu-oversize-weekly-2026-w48.md'), 'fixture');
    f.run(); expect(f.outputs()).toContain('needed=false'); expect(f.outputs()).toContain('article_exists=true');
  });
});
