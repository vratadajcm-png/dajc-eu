#!/usr/bin/env node
// One deduplicated operational alert per edition; never sends credentials.
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
const repo = process.env.GITHUB_REPOSITORY;
if (!/^[\w.-]+\/[\w.-]+$/.test(repo || '')) throw new Error('Invalid repository');
const week = /^\d{4}-W\d{2}$/.test(process.env.TARGET_WEEK || '') ? process.env.TARGET_WEEK : 'target-unresolved';
const title = `[Weekly BLOCKED] ${week}`;
const run = `https://github.com/${repo}/actions/runs/${process.env.GITHUB_RUN_ID}`;
const gh = (args) => execFileSync('gh', args, { encoding: 'utf8' }).trim();
const issues = JSON.parse(gh(['issue', 'list', '--repo', repo, '--state', 'open', '--search', `in:title "${title}"`, '--json', 'number,title,url']));
const body = `The protected publication pipeline failed for ${week}.\n\nRun: ${run}\n\nInspect the first failed step and the weekly-editorial artifact for exact source/review/CI/deployment/public-delivery reasons. Publication remains blocked; no alternative publication or branch-protection bypass is permitted. A successful workflow alone does not prove public delivery.`;
const existing = issues.find((i) => i.title === title);
const url = existing ? (gh(['issue', 'edit', String(existing.number), '--repo', repo, '--body', body]), existing.url) : gh(['issue', 'create', '--repo', repo, '--title', title, '--body', body]);
console.log(`::error::Publication BLOCKED: ${url}; evidence: ${run}`);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `\nPublication BLOCKED: ${url}\nEvidence: ${run}\n`);
