import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadAutomationData, saveAutomationData } from '../automation-data.mjs';

const temporary = [];
function git(root, args) { return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); }
function put(root, relative, value) {
  mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
  writeFileSync(path.join(root, relative), typeof value === 'string' ? value : JSON.stringify(value));
}
function fixture() {
  const base = mkdtempSync(path.join(tmpdir(), 'dajc-data-test-'));
  temporary.push(base);
  const remote = path.join(base, 'remote.git');
  const root = path.join(base, 'first');
  execFileSync('git', ['init', '--bare', '-b', 'main', remote], { stdio: 'ignore' });
  execFileSync('git', ['clone', remote, root], { stdio: 'ignore' });
  git(root, ['config', 'user.name', 'Test']);
  git(root, ['config', 'user.email', 'test@example.invalid']);
  put(root, 'data/x-publications.json', { schemaVersion: 1, posts: {} });
  put(root, 'data/oversize/2026-W42/findings.json', { findings: ['reviewed'] });
  put(root, 'src/do-not-import.mjs', 'throw new Error("Data branch code must never execute");\n');
  git(root, ['add', '.']);
  git(root, ['commit', '-m', 'reviewed baseline']);
  git(root, ['push', 'origin', 'main']);
  const main = git(root, ['rev-parse', 'HEAD']).trim();
  // This server enforces main protection even against our test bot.
  const hook = path.join(remote, 'hooks/pre-receive');
  writeFileSync(hook, '#!/bin/sh\nwhile read old new ref; do\n  if [ "$ref" = "refs/heads/main" ]; then exit 1; fi\ndone\n', { mode: 0o755 });
  return { base, remote, root, main };
}
afterEach(() => { for (const directory of temporary.splice(0)) rmSync(directory, { recursive: true, force: true }); });

describe('durable automation branches with protected main', () => {
  it('persists pending then published ledger state while main stays unchanged', () => {
    const f = fixture();
    loadAutomationData('x', f.root);
    put(f.root, 'data/x-publications.json', { schemaVersion: 1, posts: { w42: { status: 'pending', reservedByRunId: '123' } } });
    saveAutomationData('x', f.root);
    let ledger = JSON.parse(git(f.remote, ['show', 'automation/x-publications:data/x-publications.json']));
    expect(ledger.posts.w42.status).toBe('pending');
    ledger.posts.w42 = { status: 'published', postId: '123456' };
    put(f.root, 'data/x-publications.json', ledger);
    saveAutomationData('x', f.root);
    ledger = JSON.parse(git(f.remote, ['show', 'automation/x-publications:data/x-publications.json']));
    expect(ledger.posts.w42.status).toBe('published');
    expect(git(f.remote, ['rev-parse', 'main']).trim()).toBe(f.main);
    expect(git(f.remote, ['diff', '--name-only', 'main', 'automation/x-publications']).trim()).toBe('data/x-publications.json');
  });

  it('loads a pending attempt in a fresh runner, preserving the duplicate barrier', () => {
    const f = fixture();
    loadAutomationData('x', f.root);
    put(f.root, 'data/x-publications.json', { schemaVersion: 1, posts: { w42: { status: 'pending' } } });
    saveAutomationData('x', f.root);
    const fresh = path.join(f.base, 'fresh');
    execFileSync('git', ['clone', f.remote, fresh], { stdio: 'ignore' });
    loadAutomationData('x', fresh);
    expect(JSON.parse(readFileSync(path.join(fresh, 'data/x-publications.json'))).posts.w42.status).toBe('pending');
  });

  it('rejects a stale writer instead of losing another run\'s reservation', () => {
    const f = fixture();
    const second = path.join(f.base, 'second');
    execFileSync('git', ['clone', f.remote, second], { stdio: 'ignore' });
    loadAutomationData('x', f.root);
    loadAutomationData('x', second);
    put(f.root, 'data/x-publications.json', { schemaVersion: 1, posts: { first: { status: 'pending' } } });
    saveAutomationData('x', f.root);
    put(second, 'data/x-publications.json', { schemaVersion: 1, posts: { second: { status: 'pending' } } });
    expect(() => saveAutomationData('x', second)).toThrow('changed since load');
    expect(JSON.parse(git(f.remote, ['show', 'automation/x-publications:data/x-publications.json'])).posts).toEqual({ first: { status: 'pending' } });
  });

  it('fails if reservation persistence is rejected by the remote', () => {
    const f = fixture();
    loadAutomationData('x', f.root);
    writeFileSync(path.join(f.remote, 'hooks/pre-receive'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
    put(f.root, 'data/x-publications.json', { schemaVersion: 1, posts: { w42: { status: 'pending' } } });
    expect(() => saveAutomationData('x', f.root)).toThrow();
    expect(git(f.remote, ['show-ref', '--heads']).trim()).toBe(`${f.main} refs/heads/main`);
  });

  it('persists and imports monitoring JSON without importing branch code', () => {
    const f = fixture();
    loadAutomationData('findings', f.root);
    put(f.root, 'data/oversize/2026-W42/findings.json', { findings: ['latest'] });
    put(f.root, 'src/do-not-import.mjs', 'throw new Error("Unreviewed local code");\n');
    saveAutomationData('findings', f.root);
    expect(git(f.remote, ['show', 'automation/oversize-data:src/do-not-import.mjs'])).toContain('must never execute');
    loadAutomationData('findings', f.root);
    expect(JSON.parse(readFileSync(path.join(f.root, 'data/oversize/2026-W42/findings.json'))).findings).toEqual(['latest']);
    expect(readFileSync(path.join(f.root, 'src/do-not-import.mjs'), 'utf8')).toContain('Unreviewed local code');
    expect(git(f.remote, ['rev-parse', 'main']).trim()).toBe(f.main);
  });

  it('refuses malformed JSON and unknown data paths before a branch push', () => {
    const f = fixture();
    loadAutomationData('findings', f.root);
    put(f.root, 'data/oversize/2026-W42/findings.json', 'invalid json');
    expect(() => saveAutomationData('findings', f.root)).toThrow();
    put(f.root, 'data/oversize/2026-W42/findings.json', {});
    put(f.root, 'data/oversize/unapproved.mjs', 'throw new Error("unapproved");');
    expect(() => saveAutomationData('findings', f.root)).toThrow('Unapproved');
  });

  it('refuses a remote ledger symlink and never falls back to main\'s empty ledger', () => {
    const f = fixture();
    git(f.root, ['switch', '-c', 'automation/x-publications']);
    const blob = execFileSync('git', ['-C', f.root, 'hash-object', '-w', '--stdin'], { encoding: 'utf8', input: '/tmp/not-a-ledger' }).trim();
    git(f.root, ['update-index', '--cacheinfo', '120000', blob, 'data/x-publications.json']);
    git(f.root, ['commit', '-m', 'invalid remote ledger']);
    git(f.root, ['push', 'origin', 'automation/x-publications']);
    git(f.root, ['reset', '--hard', 'main']);
    expect(() => loadAutomationData('x', f.root)).toThrow('Unapproved');
    expect(JSON.parse(readFileSync(path.join(f.root, 'data/x-publications.json'))).posts).toEqual({});
  });
});
