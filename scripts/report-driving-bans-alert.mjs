#!/usr/bin/env node
// One operational alert issue for Driving Bans monitoring. Updates the open
// issue instead of creating duplicates. Contains only hashes, states, URLs of
// official sources and run links - never document bodies or credentials.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, appendFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ALERT_TITLE = '[Driving Bans] monitoring alert';
const clean = (value) => String(value ?? '').replace(/\b(?:gh[pousr]_|github_pat_|sk-ant-|pplx-)[A-Za-z0-9_-]+/g, '[REDACTED]').replace(/[\r\n]+/g, ' ').slice(0, 600);

export function formatDrivingBansAlert({ repo, runId, kind, monitorMarkdown = '', gateFailed = false }) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo || '') || !/^\d+$/.test(String(runId || ''))) throw new Error('Invalid repository/run');
  if (!['monitor', 'gate'].includes(kind)) throw new Error('Invalid alert kind');
  const run = `https://github.com/${repo}/actions/runs/${runId}`;
  const lines = [
    `Latest evidence: ${run}`, '',
    kind === 'gate'
      ? 'The Thursday technical gate failed (stale sweep, reviewed span not containing the active rolling window, lint or tests). Driving Bans stay fail-closed: unverified periods are shown as UNKNOWN, never NO_BAN.'
      : 'The official-source monitor found changed official documents or degraded retrieval. Nothing in the registry was changed; last reviewed data stays in force.',
    '', ...String(monitorMarkdown || '').split('\n').slice(0, 120).map((line) => line.slice(0, 600)), '',
    'Required next step: legal review of the listed sources through the canonical registry PR gate. A green workflow alone is not legal verification.',
  ];
  if (gateFailed) lines.push('', 'Gate status: FAILED');
  return lines.join('\n');
}

function main() {
  const repo = process.env.GITHUB_REPOSITORY;
  const runId = process.env.GITHUB_RUN_ID;
  const kind = process.argv[2];
  const mdPath = process.argv[3] && existsSync(process.argv[3]) ? process.argv[3] : null;
  const body = formatDrivingBansAlert({ repo, runId, kind, monitorMarkdown: mdPath ? readFileSync(mdPath, 'utf8') : '', gateFailed: kind === 'gate' });
  const gh = (args) => execFileSync('gh', args, { encoding: 'utf8', timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const issues = JSON.parse(gh(['issue', 'list', '--repo', repo, '--state', 'open', '--search', `in:title "${ALERT_TITLE}"`, '--json', 'number,title,url']));
  const existing = issues.find((issue) => issue.title === ALERT_TITLE);
  const url = existing ? (gh(['issue', 'edit', String(existing.number), '--repo', repo, '--body', body]), existing.url) : gh(['issue', 'create', '--repo', repo, '--title', ALERT_TITLE, '--body', body]);
  console.log(`::warning::Driving Bans alert updated: ${url}`);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `\nDriving Bans alert: ${url}\n`);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error('Driving Bans alert failed: ' + clean(error.message)); process.exitCode = 1; }
}
