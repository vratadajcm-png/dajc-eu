/**
 * Offline hand-off of Ask DAJC AI review-queue leads into the Driving Bans review layer.
 * Input: a JSON array exported from dajc_ask.review_queue (docs/ASK_DAJC_AI.md).
 * Leads land as INSUFFICIENT_EVIDENCE proposals; nothing is approved or published.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { drivingBanSourceCatalog } from '../config/driving-ban-sources/index.mjs';
import { importWebLeads } from '../src/lib/driving-bans/web-leads.mjs';

const CANONICAL = resolve('data/driving-bans/canonical.json');
const { values, positionals } = parseArgs({ allowPositionals: true, options: { store: { type: 'string', default: 'data/driving-bans/staging' }, clock: { type: 'string' } } });
if (positionals.length !== 1) {
  console.error('Usage: driving-bans-web-leads.mjs <review-queue.json> [--store DIR] [--clock ISO]');
  process.exit(2);
}
const store = resolve(values.store);
if (store === dirname(CANONICAL)) throw new Error('The evidence store must be its own directory, not the canonical data directory');
const leads = JSON.parse(readFileSync(resolve(positionals[0]), 'utf8'));
if (!Array.isArray(leads)) throw new Error('Expected a JSON array of review-queue rows');
const results = importWebLeads({ leads, store, rawCanonical: JSON.parse(readFileSync(CANONICAL, 'utf8')), catalogSources: drivingBanSourceCatalog.entries, now: values.clock ? new Date(values.clock) : new Date() });
console.log(JSON.stringify(results, null, 2));
