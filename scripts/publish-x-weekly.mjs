#!/usr/bin/env node
// DAJC X publisher: deliberate two-phase reservation prevents automatic duplicate posts.
import { appendFile, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildPostText, checkPublicArticle, checkXAccount, currentPublication, frontmatterFields,
  postingDecision, publishToX, readXCredentials, validateArticle,
} from './lib/x-publishing.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LEDGER = path.join(ROOT, 'data/x-publications.json');

async function output(name, value) {
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
}

async function loadLedger() {
  const data = JSON.parse(await readFile(LEDGER, 'utf8'));
  if (data.schemaVersion !== 1 || !data.posts || typeof data.posts !== 'object' || Array.isArray(data.posts)) {
    throw new Error('Invalid X publication ledger (fail closed)');
  }
  return data;
}

async function saveLedger(data) {
  await writeFile(LEDGER, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

async function main() {
  const stage = process.argv[2];
  if (!['--dry-run', '--prepare', '--publish'].includes(stage) || process.argv.length !== 3) {
    throw new Error('Usage: node scripts/publish-x-weekly.mjs --dry-run | --prepare | --publish');
  }
  const now = process.env.DAJC_X_NOW && stage === '--dry-run' ? new Date(process.env.DAJC_X_NOW) : new Date();
  if (!Number.isFinite(now.getTime())) throw new Error('Invalid dry-run time');
  const edition = currentPublication(now);
  if (!edition) {
    console.log('No Friday edition is eligible at the current time; nothing to share.');
    await output('send', 'false');
    return;
  }
  const markdownPath = path.join(ROOT, 'src/content/news/eu-oversize', `${edition.slug}.md`);
  let markdown;
  try { markdown = await readFile(markdownPath, 'utf8'); }
  catch (error) {
    if (error.code === 'ENOENT') {
      console.log('Target weekly article does not exist yet; next run will check again.');
      await output('send', 'false');
      return;
    }
    throw error;
  }
  const article = validateArticle(frontmatterFields(markdown), edition, now);
  const text = buildPostText(article);
  const ledger = await loadLedger();
  const record = ledger.posts[article.slug];
  const runId = process.env.GITHUB_RUN_ID;

  if (stage === '--dry-run') {
    console.log(`DRY RUN: ${article.url}\n\n${text}\n\nLedger: ${postingDecision(record)}`);
    return;
  }
  if (!runId || !/^\d+$/.test(runId)) throw new Error('Live posting requires a GitHub Actions run ID');
  // All secret-bearing operations happen on the Actions runner, never on dajc.eu.
  const credentials = readXCredentials();

  if (stage === '--prepare') {
    const decision = postingDecision(record);
    if (decision !== 'new') {
      console.log(`Skipping X publication: ${decision}. Pending entries require manual reconciliation, not retries.`);
      await output('send', 'false');
      return;
    }
    const ready = await checkPublicArticle(article.url, article.title);
    if (!ready) {
      console.log('Public page still returns 404; waiting for a later scheduled run.');
      await output('send', 'false');
      return;
    }
    await checkXAccount(credentials); // Reject a wrong-account token before reserving an irreversible attempt.
    ledger.posts[article.slug] = {
      status: 'pending',
      sourceUrl: article.url,
      reservedByRunId: runId,
      reservedAt: now.toISOString(),
    };
    await saveLedger(ledger);
    console.log(`Reserved ${article.slug} for one X API attempt. Commit this reservation BEFORE publishing.`);
    await output('send', 'true');
    return;
  }

  if (record?.status !== 'pending' || record.reservedByRunId !== runId) {
    throw new Error('No reservation owned by this run; refusing to post');
  }
  const posted = await publishToX(text, credentials);
  ledger.posts[article.slug] = {
    status: 'published',
    sourceUrl: article.url,
    postId: posted.id,
    postUrl: posted.url,
    publishedAt: new Date().toISOString(),
  };
  await saveLedger(ledger);
  console.log(`Published and recorded ${posted.url}. Commit the updated ledger.`);
}

main().catch((error) => {
  console.error(`::error::DAJC X publisher: ${error.message}`);
  process.exitCode = 1;
});
