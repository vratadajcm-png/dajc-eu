// Data branches never supply executable code. Only the fixed JSON paths below
// are imported; writes use a detached worktree and a normal, non-force push.
import { scopeMonitoringDocument } from './geographic-scope.mjs';
import { execFileSync } from 'node:child_process';
import { appendFileSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

export const DATA_BRANCHES = {
  findings: { branch: 'automation/oversize-data', prefix: 'data/oversize/', pattern: /^data\/oversize\/\d{4}-W\d{2}\/(?:findings|coverage)\.json$/ },
  x: { branch: 'automation/x-publications', prefix: 'data/x-publications.json', pattern: /^data\/x-publications\.json$/ },
  linkedin: { branch: 'automation/linkedin-publications', prefix: 'data/linkedin-publications.json', pattern: /^data\/linkedin-publications\.json$/ },
};

function git(root, args) {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
}

function configFor(kind) {
  const config = DATA_BRANCHES[kind];
  if (!config) throw new Error('Unknown automation data kind');
  return config;
}

function remoteHead(root, config) {
  // Fail on network/auth errors. An absent branch is the only bootstrap case.
  const remote = git(root, ['ls-remote', '--heads', 'origin', `refs/heads/${config.branch}`]).trim();
  if (!remote) return null;
  const [sha, ref] = remote.split(/\s+/);
  if (!/^[a-f0-9]{40}$/.test(sha) || ref !== `refs/heads/${config.branch}`) throw new Error('Invalid automation branch response');
  git(root, ['fetch', '--no-tags', 'origin', `refs/heads/${config.branch}`]);
  const fetched = git(root, ['rev-parse', 'FETCH_HEAD']).trim();
  if (fetched !== sha) throw new Error('Automation branch changed while fetching; retry from a fresh read');
  return sha;
}

function validateJson(content, kind) {
  const value = JSON.parse(content);
  if ((kind === 'x' || kind === 'linkedin') && (value.schemaVersion !== 1 || !value.posts || typeof value.posts !== 'object' || Array.isArray(value.posts))) {
    throw new Error('Invalid X publication ledger (fail closed)');
  }
  if (kind === 'findings') return JSON.stringify(scopeMonitoringDocument(value).value, null, 2) + '\n';
  return content;
}

function assertSafePath(root, relative) {
  const components = relative.split('/');
  // Do not follow a symlink in a parent or destination, including a local one.
  for (let i = 1; i <= components.length; i++) {
    try {
      if (lstatSync(path.join(root, ...components.slice(0, i))).isSymbolicLink()) throw new Error('Automation data path contains a symlink');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
}

function safeWrite(root, relative, content) {
  assertSafePath(root, relative);
  const destination = path.join(root, relative);
  mkdirSync(path.dirname(destination), { recursive: true });
  writeFileSync(destination, content);
}

function statePath(root, kind) {
  return path.resolve(root, git(root, ['rev-parse', '--git-path', `dajc-automation-state/${kind}.json`]).trim());
}

function rememberHead(root, kind, sha) {
  const destination = statePath(root, kind);
  mkdirSync(path.dirname(destination), { recursive: true });
  writeFileSync(destination, JSON.stringify({ sha }));
}

export function loadAutomationData(kind, root = process.cwd()) {
  const config = configFor(kind);
  const sha = remoteHead(root, config);
  if (!sha) {
    rememberHead(root, kind, null);
    console.log(`${config.branch} is not initialized; using the reviewed data from main.`);
    return;
  }
  const entries = git(root, ['ls-tree', '-r', '-z', sha, '--', config.prefix]).split('\0').filter(Boolean);
  if ((kind === 'x' || kind === 'linkedin') && entries.length !== 1) throw new Error('X ledger branch is missing its ledger; refusing to use an empty fallback');
  const files = entries.map((entry) => {
    const [metadata, relative] = entry.split('\t');
    if (!/^100644 blob [a-f0-9]{40}$/.test(metadata) || !config.pattern.test(relative || '')) throw new Error('Unapproved automation data path or mode');
    return { relative, content: validateJson(git(root, ['show', `${sha}:${relative}`]), kind) };
  });
  // Validate every remote entry before changing any local file.
  for (const file of files) safeWrite(root, file.relative, file.content);
  rememberHead(root, kind, sha);
  console.log(`Loaded ${files.length} JSON files from ${config.branch}; no branch code was executed.`);
}

export function saveAutomationData(kind, root = process.cwd()) {
  const config = configFor(kind);
  const relatives = git(root, ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', config.prefix]).split('\0').filter(Boolean);
  if ((kind === 'x' || kind === 'linkedin') && relatives.length !== 1) throw new Error('Missing X ledger');
  const files = [...new Set(relatives)].map((relative) => {
    if (!config.pattern.test(relative)) throw new Error('Unapproved automation data path');
    assertSafePath(root, relative);
    const source = path.join(root, relative);
    if (!lstatSync(source).isFile() || lstatSync(source).isSymbolicLink()) throw new Error('Automation data must be regular files');
    return { relative, content: validateJson(readFileSync(source, 'utf8'), kind) };
  });
  const remote = remoteHead(root, config);
  let expected;
  try { expected = JSON.parse(readFileSync(statePath(root, kind), 'utf8')).sha; }
  catch { throw new Error('Load the automation branch before saving; no verified branch snapshot is available'); }
  if (remote !== expected) throw new Error('Automation data changed since load; refusing to overwrite another run');
  const temporary = mkdtempSync(path.join(tmpdir(), 'dajc-automation-'));
  const worktree = path.join(temporary, 'worktree');
  let attached = false;
  try {
    git(root, ['worktree', 'add', '--detach', worktree, remote || 'HEAD']);
    attached = true;
    for (const file of files) safeWrite(worktree, file.relative, file.content);
    git(worktree, ['add', '--', config.prefix]);
    const changed = git(worktree, ['diff', '--cached', '--no-renames', '--name-only', '-z']).split('\0').filter(Boolean);
    if (changed.some((relative) => !config.pattern.test(relative))) throw new Error('Refusing a data-branch commit outside its allowed paths');
    if (!changed.length && remote) {
      console.log(`No changes for ${config.branch}.`);
      return;
    }
    git(worktree, ['-c', 'user.name=dajc-bot', '-c', 'user.email=bot@users.noreply.github.com', 'commit', '--allow-empty', '-m', `data: update ${config.branch}`]);
    // Push errors stop the workflow before X can POST. Never force or rebase
    // an already reserved attempt onto a different remote ledger.
    git(worktree, ['push', 'origin', `HEAD:refs/heads/${config.branch}`]);
    rememberHead(root, kind, git(worktree, ['rev-parse', 'HEAD']).trim());
    console.log(`Persisted JSON data on ${config.branch}; main was not written.`);
  } finally {
    if (attached) git(root, ['worktree', 'remove', '--force', worktree]);
    rmSync(temporary, { recursive: true, force: true });
  }
}

export function automationSummary(message) {
  console.log(message);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${message}\n`);
}
