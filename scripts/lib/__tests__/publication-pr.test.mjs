import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadAutomationData } from '../automation-data.mjs';

const sourceRoot = fileURLToPath(new URL('../../../', import.meta.url));
const cleanup = [];
const git = (root, args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
function put(root, relative, text) {
  mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
  writeFileSync(path.join(root, relative), text);
}
function fixture() {
  const base = mkdtempSync(path.join(tmpdir(), 'dajc-pr-test-'));
  cleanup.push(base);
  const remote = path.join(base, 'remote.git');
  const root = path.join(base, 'runner');
  execFileSync('git', ['init', '--bare', '-b', 'main', remote], { stdio: 'ignore' });
  execFileSync('git', ['clone', remote, root], { stdio: 'ignore' });
  git(root, ['config', 'user.name', 'Test']);
  git(root, ['config', 'user.email', 'test@example.invalid']);
  for (const relative of ['scripts/check-weekly-publication.mjs', 'scripts/publish-gate-commit.mjs', 'scripts/lib/publish-gate.mjs', 'scripts/lib/automation-data.mjs', 'scripts/lib/geographic-scope.mjs', 'config/europe-coverage.mjs', 'config/oversize-sources/index.mjs', 'scripts/lib/next-publication.mjs', 'scripts/lib/week.mjs', 'scripts/lib/source-policy.mjs', 'config/official-authority-domains.mjs']) {
    mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
    copyFileSync(path.join(sourceRoot, relative), path.join(root, relative));
  }
  put(root, 'data/oversize/2026-W42/findings.json', '{"findings":[]}');
  put(root, 'src/content/news/eu-oversize/example-template.md', 'reviewed template');
  git(root, ['add', '.']);
  git(root, ['commit', '-m', 'reviewed code']);
  git(root, ['push', 'origin', 'main']);
  const main = git(root, ['rev-parse', 'HEAD']).trim();
  writeFileSync(path.join(remote, 'hooks/pre-receive'), '#!/bin/sh\nwhile read old new ref; do\n  if [ "$ref" = "refs/heads/main" ]; then exit 1; fi\ndone\n', { mode: 0o755 });
  const bin = path.join(base, 'bin');
  mkdirSync(bin);
  const log = path.join(base, 'gh.jsonl');
  writeFileSync(path.join(bin, 'gh'), `#!${process.execPath}\nimport { appendFileSync, readFileSync } from 'node:fs';\nconst args = process.argv.slice(2);\nconst bodyIndex = args.indexOf('--body-file');\nappendFileSync(process.env.GH_TEST_LOG, JSON.stringify({args, token: process.env.GH_TOKEN, body: bodyIndex < 0 ? null : readFileSync(args[bodyIndex + 1], 'utf8')}) + '\\n');\nif(args[0] === 'pr' && args[1] === 'create') { if (process.env.GH_TOKEN === 'expired-owner-token') process.exit(1); console.log('https://github.com/example/dajc/pull/9001'); }\nif(args[0] === 'pr' && args[1] === 'list') console.log(process.env.GH_TEST_PULLS || (process.env.GH_TEST_PENDING === '1' ? '[{"url":"https://github.com/example/dajc/pull/9001","headRefName":"automation/weekly-2026-w43"}]' : '[]'));\n`, { mode: 0o755 });
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, GH_TOKEN: 'synthetic-test-token', GITHUB_REPOSITORY: 'example/dajc', GH_TEST_LOG: log, GITHUB_ACTIONS: 'true', GITHUB_OUTPUT: path.join(base, 'outputs'), GITHUB_STEP_SUMMARY: path.join(base, 'summary'), OVERSIZE_NOW: '2026-10-15T10:00:00Z', OVERSIZE_CORRECTION: '', OVERSIZE_PREVIEW: '' };
  return { base, root, remote, main, env, log };
}
function run(f, script, env = {}) {
  return execFileSync(process.execPath, [path.join(f.root, 'scripts', script)], { cwd: f.root, env: { ...f.env, ...env }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}
afterEach(() => { for (const directory of cleanup.splice(0)) rmSync(directory, { recursive: true, force: true }); });

describe('reviewed weekly publication', () => {
  it('opens a PR and explicitly dispatches CI, without writing protected main', () => {
    const f = fixture();
    loadAutomationData('findings', f.root);
    put(f.root, 'src/content/news/eu-oversize/eu-oversize-weekly-2026-w43.md', 'validated article fixture');
    const output = run(f, 'publish-gate-commit.mjs');
    const calls = readFileSync(f.log, 'utf8').trim().split('\n').map(JSON.parse);
    expect(calls[0].args.slice(0, 2)).toEqual(['pr', 'create']);
    expect(calls[0].body).toContain('Waiting for human review');
    expect(calls[0].body).toContain('This run has not published the article');
    expect(calls.slice(1).map((call) => call.args)).toEqual([
      ['workflow', 'run', 'application-ci.yml', '--repo', 'example/dajc', '--ref', 'automation/weekly-2026-w43'],
      ['workflow', 'run', 'news-ci.yml', '--repo', 'example/dajc', '--ref', 'automation/weekly-2026-w43'],
    ]);
    expect(output).toContain('Article published this run: **no**');
    expect(git(f.remote, ['rev-parse', 'main']).trim()).toBe(f.main);
    expect(git(f.remote, ['diff', '--name-only', 'main', 'automation/weekly-2026-w43']).trim()).toBe('src/content/news/eu-oversize/eu-oversize-weekly-2026-w43.md');
  });

  it('opens a vetoed autonomous edition for human review instead of losing it', () => {
    const f = fixture();
    loadAutomationData('findings', f.root);
    put(f.root, 'src/content/news/eu-oversize/eu-oversize-weekly-2026-w43.md', 'validated article fixture');
    const runnerTemp = mkdtempSync(path.join(f.base, 'runner-temp-'));
    const output = run(f, 'publish-gate-commit.mjs', { DAJC_AUTONOMOUS_WEEKLY: '1', RUNNER_TEMP: runnerTemp });
    expect(output).toContain('::warning::Claude did not approve the edition');
    expect(readFileSync(f.env.GITHUB_OUTPUT, 'utf8')).toContain('auto_merge=false');
    const calls = readFileSync(f.log, 'utf8').trim().split('\n').map(JSON.parse);
    expect(calls[0].body).toContain('Waiting for human review');
  });

  function approvedEdition(f) {
    loadAutomationData('findings', f.root);
    const article = 'validated article fixture';
    const relative = 'src/content/news/eu-oversize/eu-oversize-weekly-2026-w43.md';
    put(f.root, relative, article);
    const runnerTemp = mkdtempSync(path.join(f.base, 'runner-temp-'));
    writeFileSync(path.join(runnerTemp, 'dajc-weekly-review-approved.json'), JSON.stringify({
      articlePath: relative, targetWeek: '2026-W43', sha256: createHash('sha256').update(article).digest('hex'),
      researchProvider: 'perplexity-search', claudeModel: 'claude-sonnet-5-5', leadCount: 1, sourceCount: 1,
    }));
    return runnerTemp;
  }

  it('opens a Claude-approved edition with the owner token so its CI runs and the release step can merge it', () => {
    const f = fixture();
    const runnerTemp = approvedEdition(f);
    run(f, 'publish-gate-commit.mjs', { DAJC_AUTONOMOUS_WEEKLY: '1', RUNNER_TEMP: runnerTemp, DAJC_WEEKLY_PR_TOKEN: 'synthetic-owner-token' });
    const outputs = readFileSync(f.env.GITHUB_OUTPUT, 'utf8');
    expect(outputs).toContain('auto_merge=true');
    expect(outputs).toContain('unattended=true');
    expect(outputs).toContain('pr_url=https://github.com/example/dajc/pull/9001');
    const calls = readFileSync(f.log, 'utf8').trim().split('\n').map(JSON.parse);
    const create = calls.find((call) => call.args[0] === 'pr' && call.args[1] === 'create');
    expect(create.token).toBe('synthetic-owner-token');
    expect(create.body).toContain('The workflow merges it once application-validate and news-validate pass');
    // The PR's own pull_request CI is what the ruleset counts.
    expect(calls.some((call) => call.args[0] === 'workflow')).toBe(false);
    expect(calls.some((call) => call.args[0] === 'pr' && call.args[1] === 'merge')).toBe(false);
    expect(git(f.remote, ['rev-parse', 'main']).trim()).toBe(f.main);
  });

  it('falls back to a bot PR for human review when the owner token is rejected', () => {
    const f = fixture();
    const runnerTemp = approvedEdition(f);
    const output = run(f, 'publish-gate-commit.mjs', { DAJC_AUTONOMOUS_WEEKLY: '1', RUNNER_TEMP: runnerTemp, DAJC_WEEKLY_PR_TOKEN: 'expired-owner-token' });
    expect(output).toContain('::warning::DAJC_WEEKLY_PR_TOKEN could not open the PR');
    expect(readFileSync(f.env.GITHUB_OUTPUT, 'utf8')).toContain('unattended=false');
    const calls = readFileSync(f.log, 'utf8').trim().split('\n').map(JSON.parse);
    const opened = calls.filter((call) => call.args[0] === 'pr' && call.args[1] === 'create');
    expect(opened.map((call) => call.token)).toEqual(['expired-owner-token', 'synthetic-test-token']);
    expect(opened[1].body).toContain('approve the pending workflows, then merge to publish');
    expect(calls.filter((call) => call.args[0] === 'workflow').map((call) => call.args[2])).toEqual(['application-ci.yml', 'news-ci.yml']);
  });

  it('leaves a Claude-approved edition for a human when the bot must open the PR (W45)', () => {
    const f = fixture();
    const runnerTemp = approvedEdition(f);
    const output = run(f, 'publish-gate-commit.mjs', { DAJC_AUTONOMOUS_WEEKLY: '1', RUNNER_TEMP: runnerTemp });
    const outputs = readFileSync(f.env.GITHUB_OUTPUT, 'utf8');
    expect(outputs).toContain('auto_merge=true');
    expect(outputs).toContain('unattended=false');
    const calls = readFileSync(f.log, 'utf8').trim().split('\n').map(JSON.parse);
    expect(calls[0].token).toBe('synthetic-test-token');
    expect(calls[0].body).toContain('Claude approved the exact final article');
    expect(calls[0].body).toContain('approve the pending workflows, then merge to publish');
    expect(calls.slice(1).map((call) => call.args[2])).toEqual(['application-ci.yml', 'news-ci.yml']);
    expect(output).toContain('Article published this run: **no**');
    expect(git(f.remote, ['rev-parse', 'main']).trim()).toBe(f.main);
  });

  it('does not regenerate an edition already awaiting approval', () => {
    const f = fixture();
    const outputFile = path.join(f.base, 'outputs');
    const output = run(f, 'check-weekly-publication.mjs', { GH_TEST_PENDING: '1', GITHUB_OUTPUT: outputFile });
    expect(readFileSync(outputFile, 'utf8')).toContain('needed=false');
    expect(output).toContain('no regeneration or additional AI spend');
    expect(git(f.remote, ['show-ref', '--heads']).trim()).toBe(`${f.main} refs/heads/main`);
  });

  it('recognises a regenerated retry PR and reports it overdue after the Friday slot', () => {
    const f = fixture();
    const outputFile = path.join(f.base, 'outputs');
    const pulls = JSON.stringify([
      { url: 'https://github.com/example/dajc/pull/63', headRefName: 'automation/weekly-2026-w43-retry-40074547124' },
      { url: 'https://github.com/example/dajc/pull/39', headRefName: 'automation/weekly-2026-w42' },
    ]);
    // Friday 16 October 13:00 CEST - one hour after the W43 slot.
    const output = run(f, 'check-weekly-publication.mjs', { GH_TEST_PULLS: pulls, GITHUB_OUTPUT: outputFile, OVERSIZE_NOW: '2026-10-16T11:00:00Z' });
    const outputs = readFileSync(outputFile, 'utf8');
    expect(outputs).toContain('needed=false');
    expect(outputs).toContain('overdue=true');
    expect(outputs).toContain('stale_prs=https://github.com/example/dajc/pull/39');
    expect(output).toContain('::error::EU Oversize Weekly 2026-W43 is past its Friday 12:00');
  });

  it('is not overdue while the PR still has time before the slot', () => {
    const f = fixture();
    const outputFile = path.join(f.base, 'outputs');
    run(f, 'check-weekly-publication.mjs', { GH_TEST_PENDING: '1', GITHUB_OUTPUT: outputFile });
    expect(readFileSync(outputFile, 'utf8')).toContain('overdue=false');
  });

  it('keeps the findings of a prepared edition on the data branch as well', () => {
    const f = fixture();
    loadAutomationData('findings', f.root);
    put(f.root, 'data/oversize/2026-W42/findings.json', '{"findings":[{"id":"n307","country":"Netherlands","jurisdiction":"NL"}]}');
    put(f.root, 'src/content/news/eu-oversize/eu-oversize-weekly-2026-w43.md', 'validated article fixture');
    run(f, 'publish-gate-commit.mjs');
    expect(git(f.remote, ['show', 'automation/oversize-data:data/oversize/2026-W42/findings.json'])).toContain('n307');
    expect(git(f.remote, ['rev-parse', 'main']).trim()).toBe(f.main);
  });

  it('stores a data-only run separately and never opens a publication PR', () => {
    const f = fixture();
    loadAutomationData('findings', f.root);
    put(f.root, 'data/oversize/2026-W42/findings.json', '{"findings":[{"id":"fresh","country":"Czechia","jurisdiction":"CZ"}]}');
    expect(run(f, 'publish-gate-commit.mjs')).toContain('No article was generated or published');
    expect(git(f.remote, ['rev-parse', 'main']).trim()).toBe(f.main);
    expect(git(f.remote, ['show', 'automation/oversize-data:data/oversize/2026-W42/findings.json'])).toContain('fresh');
  });

  it('rejects a generator change to source code before pushing or creating a PR', () => {
    const f = fixture();
    put(f.root, 'scripts/lib/week.mjs', 'throw new Error("unapproved code");');
    expect(() => run(f, 'publish-gate-commit.mjs')).toThrow();
    expect(git(f.remote, ['show-ref', '--heads']).trim()).toBe(`${f.main} refs/heads/main`);
  });

  it('rejects a staged rename from source code into an otherwise allowed data path', () => {
    const f = fixture();
    git(f.root, ['mv', 'scripts/lib/week.mjs', 'data/oversize/2026-W42/coverage.json']);
    put(f.root, 'src/content/news/eu-oversize/eu-oversize-weekly-2026-w43.md', 'validated article fixture');
    expect(() => run(f, 'publish-gate-commit.mjs')).toThrow();
    expect(git(f.remote, ['show-ref', '--heads']).trim()).toBe(`${f.main} refs/heads/main`);
  });
});
