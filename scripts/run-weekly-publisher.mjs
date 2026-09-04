#!/usr/bin/env node
// Runs the weekly generator with a bounded retry only for the one recoverable
// failure mode that is inherently non-deterministic: OpenAI returning too few
// substantive lead reports to satisfy the hard 20-lead quality floor.
//
// The quality gate itself is never weakened. Any other failure (configuration,
// source verification, build, schema, etc.) is returned immediately.

import { spawnSync } from 'node:child_process';

const MAX_ATTEMPTS = Number.parseInt(process.env.DAJC_WEEKLY_GENERATION_ATTEMPTS || '4', 10);
const args = process.argv.slice(2);

function runOnce(attempt) {
  console.log(`\n=== Weekly generation attempt ${attempt}/${MAX_ATTEMPTS} ===`);
  const result = spawnSync(
    process.execPath,
    ['scripts/generate-weekly-article.mjs', ...args],
    {
      encoding: 'utf-8',
      env: process.env,
      maxBuffer: 32 * 1024 * 1024,
    }
  );

  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);

  return {
    status: result.status ?? 1,
    output: `${result.stdout || ''}\n${result.stderr || ''}`,
    error: result.error,
  };
}

if (!Number.isInteger(MAX_ATTEMPTS) || MAX_ATTEMPTS < 1 || MAX_ATTEMPTS > 6) {
  console.error('DAJC_WEEKLY_GENERATION_ATTEMPTS must be an integer from 1 to 6.');
  process.exit(1);
}

for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
  const result = runOnce(attempt);

  if (result.error) {
    console.error(`Weekly generator could not start: ${result.error.message || result.error}`);
    process.exit(1);
  }

  if (result.status === 0) {
    if (attempt > 1) {
      console.log(`Weekly generation recovered successfully on attempt ${attempt}.`);
    }
    process.exit(0);
  }

  const leadFloorFailure = /article has only \d+ lead reports - DAJC Weekly requires at least 20 substantive verified lead topics/i.test(result.output);
  if (!leadFloorFailure) {
    console.error('Weekly generator failed for a non-retryable reason; not retrying.');
    process.exit(result.status || 1);
  }

  if (attempt < MAX_ATTEMPTS) {
    console.warn('Lead-floor quality gate was not met. Retrying synthesis from the same verified source set without weakening the gate.');
  }
}

console.error(`Weekly generator still did not satisfy the 20-lead quality floor after ${MAX_ATTEMPTS} attempts. No article was published.`);
process.exit(1);
