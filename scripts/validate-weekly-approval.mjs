#!/usr/bin/env node
// No API keys: protected CI verifies durable independent approval of exact content.
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { publicationApprovalValid } from './lib/publication-approval.mjs';
const index = process.argv.indexOf('--base');
if (index < 0) {
  console.log('No PR base provided; historical editions are not reapproved.');
  process.exit(0);
}
const base = process.argv[index + 1];
if (!/^[\w/.-]+$/.test(base || '') || base.startsWith('-')) throw new Error('Invalid CI base');
const changed = execFileSync('git', ['diff', '--name-only', '--diff-filter=AM', `${base}...HEAD`, '--', 'src/content/news/eu-oversize'], { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
for (const articlePath of changed) {
  const match = articlePath.match(/^src\/content\/news\/eu-oversize\/eu-oversize-weekly-(\d{4}-w\d{2})\.md$/);
  if (!match) continue;
  const targetWeek = match[1].toUpperCase(), raw = readFileSync(articlePath, 'utf8');
  const folder = `data/oversize/${targetWeek}/publication`;
  let records = [];
  try { records = readdirSync(folder).filter(n => /^\d+-\d+\.json$/.test(n)).map(n => JSON.parse(readFileSync(`${folder}/${n}`, 'utf8'))); } catch { /* fail closed below */ }
  if (!records.some(record => publicationApprovalValid(record, { articlePath, targetWeek, raw }))) {
    throw new Error(`Publication BLOCKED: no independent exact-byte Claude approval for ${articlePath}`);
  }
  console.log(`Verified durable independent approval: ${articlePath}`);
}
