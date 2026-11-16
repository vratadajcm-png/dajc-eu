#!/usr/bin/env node
// Exactly one source-safe recovery attempt, never an unbounded synthesis loop.
// The old vetoed article is restored for human review whenever recovery fails.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { resolve, relative, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { selectRejectedSourceUrls } from './lib/weekly-recovery.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const path = process.argv[2];
if (!path || isAbsolute(path) || !/^src\/content\/news\/eu-oversize\/eu-oversize-weekly-\d{4}-w\d{2}\.md$/.test(path)) {
  throw new Error('Recovery requires the exact final weekly article path');
}
const target = resolve(root, path);
if (relative(root, target).startsWith('..') || !existsSync(target)) throw new Error('Recovery article missing or outside repository');
if (!process.env.RUNNER_TEMP) throw new Error('Trusted runner directory missing');
const vetoPath = join(process.env.RUNNER_TEMP, 'dajc-weekly-review-veto.json');
const approvalPath = join(process.env.RUNNER_TEMP, 'dajc-weekly-review-approved.json');
if (!existsSync(vetoPath)) throw new Error('No structured Claude veto. Recovery is not authorised');
const before = readFileSync(target);
const status = execFileSync('git', ['status', '--porcelain', '--untracked-files=all', '--', path], { cwd: root, encoding: 'utf8' }).trim();
if (!status.startsWith('?? ') || !status.endsWith(path)) throw new Error('Refusing to modify a tracked or already-staged article');
const veto = JSON.parse(readFileSync(vetoPath, 'utf8'));
const currentHash = createHash('sha256').update(before).digest('hex');
if (veto.articlePath !== path || veto.sha256 !== currentHash || !Array.isArray(veto.sourceUrls)) throw new Error('Editorial veto is not bound to current article bytes');
const blocked = selectRejectedSourceUrls(veto.review, veto.sourceUrls);
if (blocked.length === 0) throw new Error('Reviewer gave no unambiguously unsupported source URL; fail closed for human review');
if (blocked.length === veto.sourceUrls.length) throw new Error('Reviewer rejected every cited source; no safe automatic edition remains');
console.log('Editorial recovery: one retry, excluding '+blocked.length+' rejected verified source URL(s).');
if (existsSync(approvalPath)) throw new Error('Unexpected prior approval receipt; refusing recovery');
unlinkSync(target);
try {
  execFileSync(process.execPath, ['scripts/generate-weekly-article.mjs'], {
    cwd: root, stdio: 'inherit', env: { ...process.env, OVERSIZE_EXCLUDE_SOURCE_URLS: JSON.stringify(blocked) }, timeout: 900000,
  });
  if (!existsSync(target)) throw new Error('Regeneration produced no article');
  execFileSync(process.execPath, ['scripts/claude-weekly-review.mjs', path], {
    cwd: root, stdio: 'inherit', env: process.env, timeout: 420000,
  });
  if (!existsSync(approvalPath)) throw new Error('Editorial recovery did not produce an approval receipt');
  console.log('Recovered edition independently approved by Claude. Protected CI and merge remain mandatory.');
} catch (error) {
  if (existsSync(approvalPath)) unlinkSync(approvalPath);
  writeFileSync(target, before);
  console.error('Recovery failed; original rejected draft restored for human review:', error.message);
  process.exitCode = 1;
}
