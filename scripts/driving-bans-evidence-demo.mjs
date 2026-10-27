/** End-to-end offline demonstration on synthetic data in a throwaway store. Publishes nothing. */
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { importSubmission, validateStoredProposal, decideProposal, prepareStoredProposal, writeReviewReport, verifyAuditLog, loadProposal } from '../src/lib/driving-bans/evidence-store.mjs';

const args = process.argv.slice(2);
const store = args.includes('--store') ? resolve(args[args.indexOf('--store') + 1]) : mkdtempSync(join(tmpdir(), 'dajc-evidence-demo-'));
const fixture = resolve('tests/fixtures/driving-bans-evidence/demo');
const canonicalPath = resolve('data/driving-bans/canonical.json');
const canonicalBefore = readFileSync(canonicalPath, 'utf8');
const rawCanonical = JSON.parse(canonicalBefore);
const clock = minutes => new Date(Date.UTC(2026, 9, 27, 11, minutes));
const steps = [];
const step = (label, value) => { steps.push({ step: label, ...value }); console.log(`${String(steps.length).padStart(2)}. ${label}: ${JSON.stringify(value)}`); };

const imported = importSubmission({ submissionFile: join(fixture, 'submission.json'), root: fixture, store, now: clock(0), actor: 'demo' });
step('import', imported);
step('re-import of the same evidence', importSubmission({ submissionFile: join(fixture, 'submission.json'), root: fixture, store, now: clock(1), actor: 'demo' }));
const validated = validateStoredProposal({ store, proposalId: imported.proposal_id, rawCanonical, now: clock(2) });
step('deterministic validation', { state: validated.state, findings: validated.findings.map(f => f.code), changes: validated.diff.map(c => `${c.kind} ${c.ban_id || c.jurisdiction}`) });
step('human approval (local label, identity not verified)', { state: decideProposal({ store, proposalId: imported.proposal_id, action: 'APPROVE', reviewer: 'DAJC demo reviewer', reason: 'Synthetic walkthrough', now: clock(3) }).state });
try { prepareStoredProposal({ store, proposalId: imported.proposal_id, rawCanonical, now: clock(4) }); }
catch (error) { step('prepare without --allow-synthetic', { refused: error.message }); }
const prepared = prepareStoredProposal({ store, proposalId: imported.proposal_id, rawCanonical, now: clock(5), allowSynthetic: true });
step('prepare candidate dataset', { state: prepared.state, candidate: prepared.candidate });

// A second submission without any document cannot pass validation.
const thin = JSON.parse(readFileSync(join(fixture, 'submission.json'), 'utf8'));
thin.documents = []; thin.links = [{ url: 'https://example.invalid/demo-order', source_id: 'demo-synthetic-cz-order', title: 'Link only' }]; thin.summary = 'SYNTHETIC: link-only claim';
const thinDir = join(store, 'demo-input'); mkdirSync(thinDir, { recursive: true });
writeFileSync(join(thinDir, 'thin.json'), JSON.stringify(thin));
const thinImport = importSubmission({ submissionFile: join(thinDir, 'thin.json'), root: thinDir, store, now: clock(6), actor: 'demo' });
step('link-only submission', { state: validateStoredProposal({ store, proposalId: thinImport.proposal_id, rawCanonical, now: clock(7) }).state, findings: loadProposal(store, thinImport.proposal_id).findings.map(f => f.code) });

step('review report', writeReviewReport({ store, output: join(store, 'report'), now: clock(8) }));
step('audit log', verifyAuditLog(store));
step('canonical.json unchanged', { unchanged: readFileSync(canonicalPath, 'utf8') === canonicalBefore });
console.log(`Store: ${store}`);
if (readFileSync(canonicalPath, 'utf8') !== canonicalBefore) process.exitCode = 1;
