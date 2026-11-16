#!/usr/bin/env node
// One operational alert per edition. Persist bounded evidence across independent
// publisher/watchdog updates; never replace an editorial veto with a generic error.
import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const clean = value => String(value || '')
  .replace(/\b(?:sk-ant-|pplx-|github_pat_|gh[pousr]_)[A-Za-z0-9_-]+/g, '[REDACTED]')
  .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9+/=_-]+/gi, '$1 [REDACTED]')
  .replace(/[\r\n]+/g, ' ').slice(0, 1600);
const unique = values => [...new Set(values.filter(Boolean))];

export function previousFailureState(body, repo) {
  let state = {};
  try { state = JSON.parse(String(body || '').match(/<!-- DAJC_WEEKLY_ALERT_STATE:([\s\S]*?) -->/)?.[1] || '{}'); } catch { /* legacy alert below */ }
  const prefix = `https://github.com/${repo}/actions/runs/`;
  const legacyRuns = (String(body || '').match(/https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/actions\/runs\/\d+/g) || []).filter(url => url.startsWith(prefix));
  const safeRun = r => ({ url: r.url, workflow: clean(r.workflow), failedSteps: Array.isArray(r.failedSteps) ? r.failedSteps.map(clean).slice(0, 20) : [], annotations: Array.isArray(r.annotations) ? r.annotations.map(clean).slice(0, 12) : [] });
  return {
    runs: Array.isArray(state.runs) ? state.runs.filter(r => r && typeof r.url === 'string' && r.url.startsWith(prefix) && /^\d+$/.test(r.url.slice(prefix.length))).slice(-8).map(safeRun) : unique(legacyRuns).map(url => ({ url, failedSteps: [], annotations: [] })),
    editorialReasons: Array.isArray(state.editorialReasons) ? state.editorialReasons.map(clean).filter(Boolean) : [],
    editorialRun: typeof state.editorialRun === 'string' && state.editorialRun.startsWith(prefix) ? state.editorialRun : '',
  };
}

export function formatWeeklyFailure({ repo, week, runId, runInfo = {}, previousBody = '', veto = null, annotations = [] }) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo || '') || !/^\d+$/.test(String(runId || ''))) throw new Error('Invalid failure evidence repository/run');
  const prior = previousFailureState(previousBody, repo);
  const run = `https://github.com/${repo}/actions/runs/${runId}`;
  const failedSteps = unique((runInfo.jobs || []).flatMap(job => (job.steps || [])
    .filter(step => ['failure', 'cancelled', 'timed_out'].includes(step.conclusion))
    .map(step => `${clean(job.name)} → ${clean(step.name)} (${step.conclusion})`)));
  const editorialReasons = veto?.review?.verdict === 'reject' && Array.isArray(veto.review.blockingReasons)
    ? unique(veto.review.blockingReasons.map(clean)) : prior.editorialReasons;
  const editorialRun = veto?.review?.verdict === 'reject' ? run : prior.editorialRun;
  const current = { url: run, workflow: clean(runInfo.name), failedSteps, annotations: unique(annotations.map(clean)).slice(0, 12) };
  const runs = [...prior.runs.filter(r => r.url !== run), current].slice(-8);
  const state = { schemaVersion: 1, runs, editorialReasons, editorialRun };
  const lines = [
    `The protected publication pipeline is BLOCKED for ${week}.`, '',
    `Latest evidence: ${run}`, '',
    'Failed steps:', ...((failedSteps.length ? failedSteps : ['Run/job API did not expose a failed step; inspect the linked run.']).map(s => `- ${s}`)),
  ];
  if (current.annotations.length) lines.push('', 'Failure diagnostics:', ...current.annotations.map(s => `- ${s}`));
  if (editorialReasons.length) lines.push('', `Independent Claude blocking reasons (${editorialRun || 'earlier preparation'}):`, ...editorialReasons.map(reason => `- ${reason}`));
  lines.push('', 'Recent distinct failing runs (up to 8):', ...runs.map(r => `- ${r.url}${r.workflow ? ` — ${clean(r.workflow)}` : ''}${r.failedSteps?.length ? `: ${r.failedSteps.map(clean).join('; ')}` : ''}`), '',
    'Publication remains blocked. Source verification, independent editorial approval, protected CI, merge, Vercel deployment and public index/article/RSS verification must pass. A successful workflow alone does not prove public delivery.', '',
    `<!-- DAJC_WEEKLY_ALERT_STATE:${JSON.stringify(state).replace(/</g, '\\u003c').replace(/>/g, '\\u003e')} -->`);
  return { body: lines.join('\n'), state };
}

async function main() {
  const repo = process.env.GITHUB_REPOSITORY;
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo || '')) throw new Error('Invalid repository');
  const week = /^\d{4}-W\d{2}$/.test(process.env.TARGET_WEEK || '') ? process.env.TARGET_WEEK : 'target-unresolved';
  const title = `[Weekly BLOCKED] ${week}`;
  const runId = process.env.GITHUB_RUN_ID;
  if (!/^\d+$/.test(runId || '')) throw new Error('Invalid workflow run');
  const gh = args => execFileSync('gh', args, { encoding: 'utf8', timeout: 30000, maxBuffer: 4 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const issues = JSON.parse(gh(['issue', 'list', '--repo', repo, '--state', 'open', '--search', `in:title "${title}"`, '--json', 'number,title,url,body']));
  const existing = issues.find(i => i.title === title);
  let runInfo = {}, annotations = [], veto = null;
  try {
    runInfo = JSON.parse(gh(['run', 'view', runId, '--repo', repo, '--json', 'name,jobs,status,conclusion']));
    for (const job of (runInfo.jobs || []).filter(j => j.steps?.some(s => s.conclusion === 'failure')).slice(0, 4)) {
      // Annotations carry GitHub's concrete error messages; raw logs and env
      // dumps are never copied into a public issue.
      try {
        const detail = JSON.parse(gh(['api', `repos/${repo}/actions/jobs/${job.databaseId}`]));
        const checkId = String(detail.check_run_url || '').match(/\/check-runs\/(\d+)$/)?.[1];
        if (checkId) annotations.push(...JSON.parse(gh(['api', `repos/${repo}/check-runs/${checkId}/annotations?per_page=20`])).map(a => a.message));
      } catch { /* exact failed step is still evidence if annotations unavailable */ }
    }
  } catch { annotations.push('GitHub run/job diagnostics unavailable; use the linked workflow evidence.'); }
  if (process.env.RUNNER_TEMP) {
    try { veto = JSON.parse(readFileSync(path.join(process.env.RUNNER_TEMP, 'dajc-weekly-review-veto.json'), 'utf8')); } catch { /* watchdog retains the prior veto */ }
  }
  const { body } = formatWeeklyFailure({ repo, week, runId, runInfo, previousBody: existing?.body || '', veto, annotations });
  const url = existing ? (gh(['issue', 'edit', String(existing.number), '--repo', repo, '--body', body]), existing.url) : gh(['issue', 'create', '--repo', repo, '--title', title, '--body', body]);
  console.log(`::error::Publication BLOCKED: ${url}; evidence: https://github.com/${repo}/actions/runs/${runId}`);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `\nPublication BLOCKED: ${url}\nFailed steps and retained editorial evidence: ${url}\n`);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error('Blocked-publication alert failed: ' + clean(error.message)); process.exitCode = 1; });
}
