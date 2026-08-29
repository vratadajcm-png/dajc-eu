#!/usr/bin/env node
// Cheap, dependency-free idempotency check for the weekly publisher.
// Runs immediately after checkout, before npm ci and before any OpenAI
// preflight/call. A delayed Friday trigger or Saturday catch-up therefore
// becomes a clear no-op once the target week's article already exists.

import { appendFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { isoWeekLabel } from './lib/week.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

function targetFor(now = new Date()) {
  const nextWeekDate = new Date(now);
  nextWeekDate.setUTCDate(nextWeekDate.getUTCDate() + 7);
  const nextWeekLabel = isoWeekLabel(nextWeekDate);
  const slug = `eu-oversize-weekly-${nextWeekLabel.toLowerCase()}`;
  const relativePath = path.join('src', 'content', 'news', 'eu-oversize', `${slug}.md`);
  return { nextWeekLabel, relativePath, absolutePath: path.join(ROOT, relativePath) };
}

async function main() {
  const now = process.env.OVERSIZE_NOW ? new Date(process.env.OVERSIZE_NOW) : new Date();
  const target = targetFor(now);
  const needed = !existsSync(target.absolutePath);

  console.log(`Target weekly article: ${target.relativePath}`);
  console.log(needed
    ? 'Publication needed: target article does not exist.'
    : 'Publication not needed: target article already exists; this run is an idempotent no-op.');

  if (process.env.GITHUB_OUTPUT) {
    await appendFile(
      process.env.GITHUB_OUTPUT,
      `needed=${needed ? 'true' : 'false'}\ntarget=${target.relativePath}\nweek=${target.nextWeekLabel}\n`
    );
  }

  if (process.env.GITHUB_STEP_SUMMARY && !needed) {
    await appendFile(
      process.env.GITHUB_STEP_SUMMARY,
      `### EU Oversize Weekly - already published\n\n` +
      `Target \u0060${target.relativePath}\u0060 already exists. This delayed/duplicate/catch-up run correctly did no publication work.\n`
    );
  }
}

main().catch((err) => {
  console.error('Weekly publication idempotency check failed:', err);
  process.exitCode = 1;
});
