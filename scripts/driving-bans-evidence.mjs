/** Offline CLI for manual Driving Bans evidence: import, validate, decide, prepare, report. Never writes canonical.json. */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { drivingBanSourceCatalog } from '../config/driving-ban-sources/index.mjs';
import { importSubmission, validateStoredProposal, decideProposal, prepareStoredProposal, listProposals, loadProposal, writeReviewReport, verifyAuditLog } from '../src/lib/driving-bans/evidence-store.mjs';

const CANONICAL = resolve('data/driving-bans/canonical.json');
const { values, positionals } = parseArgs({ allowPositionals: true, options: {
  store: { type: 'string', default: 'data/driving-bans/staging' }, root: { type: 'string' }, reviewer: { type: 'string' }, reason: { type: 'string' },
  output: { type: 'string', default: 'artifacts/driving-bans/review' }, clock: { type: 'string' }, 'allow-synthetic': { type: 'boolean', default: false },
} });
const [command, target] = positionals;
const store = resolve(values.store);
if (store === dirname(CANONICAL)) throw new Error('The evidence store must be its own directory, not the canonical data directory');
const now = values.clock ? new Date(values.clock) : new Date();
const rawCanonical = () => JSON.parse(readFileSync(CANONICAL, 'utf8'));
const print = value => console.log(JSON.stringify(value, null, 2));
const brief = p => ({ proposal_id: p.proposal_id, state: p.state, jurisdiction: p.submission.jurisdiction, synthetic: p.submission.synthetic, findings: p.findings.map(f => f.code), changes: p.diff.length });

switch (command) {
  case 'import': print(importSubmission({ submissionFile: resolve(target), root: resolve(values.root || dirname(resolve(target))), store, now })); break;
  case 'validate': print(brief(validateStoredProposal({ store, proposalId: target, rawCanonical: rawCanonical(), now, catalogSources: drivingBanSourceCatalog.entries }))); break;
  case 'approve': case 'reject': print(brief(decideProposal({ store, proposalId: target, action: command.toUpperCase(), reviewer: values.reviewer, reason: values.reason, now }))); break;
  case 'prepare': print(brief(prepareStoredProposal({ store, proposalId: target, rawCanonical: rawCanonical(), now, allowSynthetic: values['allow-synthetic'], catalogSources: drivingBanSourceCatalog.entries }))); break;
  case 'list': print(listProposals(store).map(brief)); break;
  case 'show': print(loadProposal(store, target)); break;
  case 'report': print(writeReviewReport({ store, output: resolve(values.output), now })); break;
  case 'verify-log': { const result = verifyAuditLog(store); print(result); if (!result.ok) process.exitCode = 1; break; }
  default:
    console.error('Usage: driving-bans-evidence.mjs <import FILE [--root DIR] | validate ID | approve ID --reviewer L --reason R | reject ID --reviewer L --reason R | prepare ID [--allow-synthetic] | list | show ID | report [--output DIR] | verify-log> [--store DIR]');
    process.exitCode = 2;
}
