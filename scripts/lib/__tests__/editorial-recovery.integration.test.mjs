import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { recoverEditorialEdition } from '../../recover-weekly-after-veto.mjs';
import { findingsFingerprint } from '../weekly-recovery.mjs';

const dirs = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
const hash = text => createHash('sha256').update(text).digest('hex');
function harness(mode) {
  const root = mkdtempSync(join(tmpdir(), 'dajc-recovery-')); dirs.push(root);
  const runnerTemp = join(root, 'runner'); mkdirSync(runnerTemp);
  const articlePath = 'src/content/news/eu-oversize/eu-oversize-weekly-2026-w47.md';
  const dir = join(root, 'src/content/news/eu-oversize'); mkdirSync(dir, { recursive: true });
  const target = join(root, articlePath);
  const vetoPath = join(runnerTemp, 'dajc-weekly-review-veto.json');
  const approvalPath = join(runnerTemp, 'dajc-weekly-review-approved.json');
  const urls = ['https://authority.example/a', 'https://authority.example/b', 'https://authority.example/c'];
  const calls = [];
  let generation = 1;
  const veto = (sources, bytes) => ({ articlePath, sha256: hash(bytes), sourceUrls: sources, review: {
    verdict: 'reject', blockingReasons: ['Unsupported date'], sourceChecks: sources.map((url, i) => ({ url, supported: i !== 0, reason: i ? 'Confirmed' : 'Date not supported' })),
  } });
  writeFileSync(target, 'initial rejected article');
  const originalVeto = JSON.stringify(veto(urls, 'initial rejected article')); writeFileSync(vetoPath, originalVeto);
  const run = (command, args, options) => {
    calls.push({ command, args, env: options.env });
    if (command === 'git') return '?? ' + articlePath;
    if (args[0] === 'scripts/generate-weekly-article.mjs') {
      generation++;
      writeFileSync(target, 'repaired version ' + generation);
      if (mode === 'build-failure') throw new Error('Build failed');
      return '';
    }
    if (args[0] === 'scripts/claude-weekly-review.mjs') {
      expect(existsSync(vetoPath)).toBe(false); // stale verdict is cleared before spending another call
      if (mode === 'api-failure') throw new Error('Reviewer API HTTP 503');
      const bytes = readFileSync(target, 'utf8');
      if (mode === 'success' || mode === 'second-success' && generation === 3) {
        writeFileSync(approvalPath, JSON.stringify({ articlePath, sha256: hash(bytes), review: { verdict: 'approve' } }));
        return '';
      }
      writeFileSync(vetoPath, JSON.stringify(veto(urls.slice(generation - 1), bytes)));
      throw new Error('Claude veto: Unsupported date');
    }
    throw new Error('Unexpected command');
  };
  return { root, runnerTemp, articlePath, target, vetoPath, approvalPath, calls, run, originalVeto };
}

describe('Editorial Recovery exercises generation → independent review without publication', () => {
  it('reverifies and independently approves repaired bytes with cumulative source exclusions', () => {
    const f = harness('second-success');
    const result = recoverEditorialEdition(f);
    expect(result.ok).toBe(true); expect(result.attempts).toBe(3);
    const gens = f.calls.filter(x => x.args[0] === 'scripts/generate-weekly-article.mjs');
    expect(gens).toHaveLength(2);
    expect(gens[0].args).toEqual(['scripts/generate-weekly-article.mjs', '--target-week', '2026-W47']);
    expect(gens[0].env.OVERSIZE_TARGET_WEEK).toBe('2026-W47');
    expect(JSON.parse(gens[1].env.OVERSIZE_EXCLUDE_SOURCE_URLS)).toEqual(['https://authority.example/a', 'https://authority.example/b']);
    const audit = JSON.parse(readFileSync(result.ledgerPath, 'utf8'));
    expect(audit.attempts.map(x => x.state)).toEqual(['EDITORIAL_REJECTED', 'EDITORIAL_REJECTED', 'EDITORIAL_APPROVED']);
    expect(readFileSync(join(f.runnerTemp, 'dajc-weekly-recovery/attempt-1.md'), 'utf8')).toBe('initial rejected article');
    expect(readFileSync(f.target, 'utf8')).toBe('repaired version 3');
    expect(f.calls.some(x => x.command === 'gh')).toBe(false);
  });
  it('stops after repeated vetoes, restores matching rejected bytes/veto and never grants approval', () => {
    const f = harness('reject');
    const result = recoverEditorialEdition(f);
    expect(result.ok).toBe(false); expect(result.attempts).toBe(3);
    expect(readFileSync(f.target, 'utf8')).toBe('initial rejected article');
    expect(readFileSync(f.vetoPath, 'utf8')).toBe(f.originalVeto);
    expect(existsSync(f.approvalPath)).toBe(false);
    const callsBefore = f.calls.length;
    expect(recoverEditorialEdition(f).ok).toBe(false);
    expect(f.calls.length).toBe(callsBefore + 1); // status only; no fourth generation/API call
  });
  it.each(['api-failure', 'build-failure'])('does not retry a %s as if it were an editorial verdict', mode => {
    const f = harness(mode);
    const result = recoverEditorialEdition(f);
    expect(result.ok).toBe(false); expect(result.attempts).toBe(2);
    expect(f.calls.filter(x => x.args[0] === 'scripts/generate-weekly-article.mjs')).toHaveLength(1);
    expect(existsSync(f.approvalPath)).toBe(false);
    expect(readFileSync(f.vetoPath, 'utf8')).toBe(f.originalVeto);
  });
  it('rejects stale veto hashes before any paid generation', () => {
    const f = harness('success'); writeFileSync(f.target, 'tampered article');
    expect(() => recoverEditorialEdition(f)).toThrow(/bound to current/);
    expect(f.calls).toHaveLength(1);
  });
  it('source refresh timestamps and result ordering cannot reset preparation identity', () => {
    const a = { sourceUrl: 'https://authority.example/a', summary: 'Actual law unchanged', lastCheckedAt: '2026-11-12', firstSeenAt: '2026-11-12' };
    const b = { sourceUrl: 'https://authority.example/b', summary: 'Other evidence' };
    expect(findingsFingerprint([a, b])).toBe(findingsFingerprint([b, { ...a, lastCheckedAt: '2026-11-16', status: 'active', id: 'new' }]));
    expect(findingsFingerprint([a])).not.toBe(findingsFingerprint([{ ...a, summary: 'Source evidence materially changed' }]));
  });
});
