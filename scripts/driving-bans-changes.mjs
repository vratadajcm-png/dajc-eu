/** Classified changes between two canonical datasets (e.g. a prepared candidate against canonical.json). Reads files only. */
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { dajcEuropeCoverage } from '../config/europe-coverage.mjs';
import { hydrateCanonical, validateCanonical } from '../src/lib/driving-bans/core.mjs';
import { detectChanges, CHANGE_TYPES } from '../src/lib/driving-bans/legal-changes.mjs';
import { migrateCanonicalCoverage } from './lib/geographic-migration.mjs';

const { values } = parseArgs({ options: { before: { type: 'string', default: 'data/driving-bans/canonical.json' }, after: { type: 'string' }, clock: { type: 'string' }, json: { type: 'boolean', default: false } } });
if (!values.after) { console.error('Usage: driving-bans-changes.mjs --after CANDIDATE.json [--before canonical.json] [--json]'); process.exit(2); }
const load = file => { const data = hydrateCanonical(migrateCanonicalCoverage(JSON.parse(readFileSync(file, 'utf8'))).data, dajcEuropeCoverage); validateCanonical(data, dajcEuropeCoverage); return data; };
const changes = detectChanges(load(values.before), load(values.after), { detectedAt: new Date(values.clock || Date.now()).toISOString() });
if (values.json) console.log(JSON.stringify(changes, null, 2));
else {
  const counts = Object.fromEntries(CHANGE_TYPES.map(type => [type, changes.filter(item => item.type === type).length]).filter(([, n]) => n));
  console.log(JSON.stringify({ total: changes.length, legal_changes: changes.filter(item => item.legal_change).length, by_type: counts }, null, 2));
  for (const item of changes.filter(entry => entry.legal_change || entry.review_state === 'REVIEW_REQUIRED')) console.log(`${item.type.padEnd(18)} ${item.jurisdiction ?? '--'} ${item.ban_id ?? item.source_id ?? ''} ${item.field ?? ''}`);
}
