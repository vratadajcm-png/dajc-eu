#!/usr/bin/env node
// Offline, deterministic check that no "Ask DAJC AI" secret, secret name or
// AI provider endpoint reaches the files served to browsers. Runs after
// `npm run build` in Application CI (owner decision: no network, < 30 s).
//
// Scanned: the static client output (.vercel/output/static, dist/). Not
// scanned: .vercel/output/functions - server code is expected to read its
// own environment. If real secret values are present in this process's
// environment (local runs), their values are searched for too.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

export const CLIENT_OUTPUT_DIRS = ['.vercel/output/static', 'dist'];

export const FORBIDDEN_MARKERS = [
  'DAJC_ASK_',
  'api.openai.com',
  'api.anthropic.com',
  'api.perplexity.ai',
  'RESEND_API_KEY',
];

export const SECRET_ENV_NAMES = [
  'DAJC_ASK_OPENAI_API_KEY',
  'DAJC_ASK_ANTHROPIC_API_KEY',
  'DAJC_ASK_PERPLEXITY_API_KEY',
  'DAJC_ASK_EMAIL_PEPPER',
  'DAJC_ASK_DB_URL',
  'RESEND_API_KEY',
];

const TEXT_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.html', '.htm', '.css', '.json', '.map', '.txt', '.xml', '.svg', '.webmanifest']);
const MAX_FILE_BYTES = 20 * 1024 * 1024;

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else if (entry.isFile()) yield path;
  }
}

/** Returns every forbidden marker or secret value found in text files under `dir`. */
export function scanClientOutput(dir, { markers = FORBIDDEN_MARKERS, secretValues = [] } = {}) {
  const findings = [];
  let files = 0;
  for (const file of walk(dir)) {
    if (!TEXT_EXTENSIONS.has(extname(file).toLowerCase()) || statSync(file).size > MAX_FILE_BYTES) continue;
    files += 1;
    const text = readFileSync(file, 'utf8');
    for (const marker of markers) if (text.includes(marker)) findings.push({ file: relative(dir, file), marker });
    for (const value of secretValues) if (text.includes(value)) findings.push({ file: relative(dir, file), marker: '<secret value from the environment>' });
  }
  return { files, findings };
}

function main() {
  const dirs = CLIENT_OUTPUT_DIRS.filter((dir) => existsSync(dir) && statSync(dir).isDirectory());
  if (dirs.length === 0) {
    console.error('check-ask-bundle: no build output found - run `npm run build` first.');
    process.exit(1);
  }
  const secretValues = SECRET_ENV_NAMES.map((name) => process.env[name]).filter((value) => typeof value === 'string' && value.length >= 12);
  let failed = false;
  for (const dir of dirs) {
    const { files, findings } = scanClientOutput(dir, { secretValues });
    console.log(`check-ask-bundle: scanned ${files} client files in ${dir}`);
    for (const finding of findings) {
      failed = true;
      console.error(`::error::${dir}/${finding.file} contains ${finding.marker}`);
    }
  }
  if (failed) process.exit(1);
  console.log('check-ask-bundle: no Ask DAJC AI secret or provider endpoint in client output.');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
