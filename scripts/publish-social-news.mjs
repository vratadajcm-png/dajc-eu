#!/usr/bin/env node
// Single-attempt publisher for approved DAJC News, with durable, per-channel
// reservations. A timeout after the POST is AMBIGUOUS: no blind retry.
import { readFile, writeFile, appendFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectSocialCandidates, selectNextSocialArticle, candidateKey } from './lib/social-publication.mjs';
import { checkPublicArticle, checkXAccount, publishToX, readXCredentials } from './lib/x-publishing.mjs';
import { linkedinConfig, publishToLinkedIn } from './lib/linkedin-publishing.mjs';
import { readBufferConfig, checkBufferChannel, publishViaBuffer } from './lib/buffer-publishing.mjs';
import { createClaudeSocialCopy, validateSocialCopy } from './lib/claude-social-copy.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHANNELS = {
  x: { file: 'data/x-publications.json' },
  linkedin: { file: 'data/linkedin-publications.json' },
};

async function output(name, value) {
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, name + '=' + value + '\n');
}
async function ledgerFromFile(filename) {
  const ledger = JSON.parse(await readFile(path.join(ROOT, filename), 'utf8'));
  if (ledger.schemaVersion !== 1 || !ledger.posts || typeof ledger.posts !== 'object' || Array.isArray(ledger.posts)) {
    throw new Error('Invalid social ledger (fail closed)');
  }
  return ledger;
}
async function saveLedger(filename, ledger) {
  await writeFile(path.join(ROOT, filename), JSON.stringify(ledger, null, 2) + '\n');
}
function getConfig(channel) {
  if (process.env.DAJC_SOCIAL_BACKEND === 'buffer') return readBufferConfig(channel);
  if (!process.env.DAJC_SOCIAL_BACKEND || process.env.DAJC_SOCIAL_BACKEND === 'direct') {
    return channel === 'x' ? readXCredentials() : linkedinConfig();
  }
  throw new Error('Unsupported publishing backend');
}
async function post(channel, text, credentials) {
  if (credentials.backend === 'buffer') return publishViaBuffer(text, credentials);
  return channel === 'x' ? publishToX(text, credentials) : publishToLinkedIn(text, credentials);
}
function getText(channel, article) {
  return channel === 'x' ? article.x : article.linkedin;
}
function runId() {
  const id = process.env.GITHUB_RUN_ID;
  if (!/^\d+$/.test(id || '')) throw new Error('Live posting requires a GitHub Actions run ID');
  return id;
}
async function main() {
  const [channel, stage, extra] = process.argv.slice(2);
  if (!(channel in CHANNELS) || !['--dry-run', '--prepare', '--publish'].includes(stage) || extra) {
    throw new Error('Usage: node scripts/publish-social-news.mjs x|linkedin --dry-run|--prepare|--publish');
  }

  const now = new Date();
  const candidates = collectSocialCandidates(ROOT, now);
  if (stage === '--dry-run') {
    console.log('DRY RUN for ' + channel + ': ' + candidates.length + ' recent, public, approved articles; no API calls');
    for (const article of candidates) console.log('[' + candidateKey(article) + ']\n' + getText(channel, article) + '\n');
    await output('send', 'false');
    return;
  }

  const id = runId();
  const ledgerConfig = CHANNELS[channel];
  const ledger = await ledgerFromFile(ledgerConfig.file);
  if (stage === '--prepare') {
    const article = selectNextSocialArticle(candidates, ledger);
    if (!article) {
      console.log('No eligible new article for ' + channel + '.');
      await output('send', 'false');
      return;
    }
    const publicPage = await checkPublicArticle(article.url, article.title);
    if (!publicPage) {
      console.log('Article not publicly deployed yet; a scheduled run may pick it up later.');
      await output('send', 'false');
      return;
    }
    const credentials = getConfig(channel);
    if (credentials.backend === 'buffer') await checkBufferChannel(credentials);
    else if (channel === 'x') await checkXAccount(credentials);
    // For LinkedIn, only an explicit company URN passes config validation;
    // the API enforces whether the token may post for that organization.
    // Generate social copy only after the article has been independently
    // confirmed public and the official account has been verified.
    const copy = await createClaudeSocialCopy(channel, article);
    const key = candidateKey(article);
    ledger.posts[key] = {
      approvedText: copy,
      status: 'pending',
      sourceUrl: article.url,
      reservedByRunId: id,
      reservedAt: now.toISOString(),
    };
    await saveLedger(ledgerConfig.file, ledger);
    await output('send', 'true');
    console.log('Reserved one verified public article for ' + channel + ': ' + key);
    return;
  }

  const matches = Object.entries(ledger.posts)
    .filter(([, record]) => record?.status === 'pending' && record.reservedByRunId === id);
  if (matches.length !== 1) throw new Error('Expected exactly one reservation owned by this run; refusing POST');
  const [key, record] = matches[0];
  const article = candidates.find((candidate) => candidateKey(candidate) === key);
  if (!article || article.url !== record.sourceUrl) throw new Error('Reserved article no longer eligible: manual reconciliation required');
  if (!await checkPublicArticle(article.url, article.title)) throw new Error('Reserved article not served publicly: refusing POST');

  const credentials = getConfig(channel);
  const approvedText = validateSocialCopy(channel, article, record.approvedText);
  const confirmed = await post(channel, approvedText, credentials);
  ledger.posts[key] = {
    status: confirmed.status || 'published',
    sourceUrl: article.url,
    postId: confirmed.id,
    postUrl: confirmed.url,
    publishedAt: new Date().toISOString(),
  };
  await saveLedger(ledgerConfig.file, ledger);
  console.log('Social publishing transaction recorded for ' + channel + ': ' + (confirmed.url || 'Buffer post ' + confirmed.id) + ', status ' + ledger.posts[key].status);
}

main().catch((error) => {
  console.error('::error::DAJC social publisher: ' + error.message);
  process.exitCode = 1;
});
