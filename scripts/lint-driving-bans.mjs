import { dajcCoverageCount, dajcCoverageCodes } from '../config/europe-coverage.mjs';
/** Scoped syntax, provenance and consumer-boundary lint; not an external legal review. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {canonicalDrivingBans, getDrivingBansSnapshot} from '../config/driving-ban-calendars/runtime.mjs';
const files = ['src/lib/driving-bans/core.mjs','config/driving-ban-calendars/canonical.mjs','config/driving-ban-calendars/index.mjs','config/driving-ban-calendars/runtime.mjs','tests/driving-bans-cases.mjs','tests/driving-bans-production-cases.mjs','tests/run-driving-bans.mjs','scripts/lint-driving-bans.mjs','scripts/audit-driving-bans.mjs','src/lib/driving-bans/source-registry.mjs','config/driving-ban-sources/index.mjs','config/driving-ban-sources/provider-candidates.mjs','scripts/export-driving-ban-sources.mjs','src/lib/driving-bans/review-workflow.mjs','src/lib/driving-bans/evidence-store.mjs','scripts/driving-bans-evidence.mjs','scripts/driving-bans-evidence-demo.mjs','src/lib/driving-bans/rule-checks.mjs','src/lib/driving-bans/legal-changes.mjs','scripts/driving-bans-changes.mjs','src/lib/driving-bans/audit-report.mjs','scripts/driving-bans-technical-status.mjs'];
for (const file of files) execFileSync(process.execPath,['--check',file],{stdio:'inherit'});
for (const source of canonicalDrivingBans.sources) assert(!new URL(source.url).hostname.endsWith('.invalid'),'Synthetic source cannot be production evidence');
for (const file of ['src/pages/driving-bans.astro','src/pages/api/driving-bans.ics.ts','src/pages/api/driving-bans.json.ts','src/lib/intelligence/driving-bans-adapter.ts']) {
  const code=readFileSync(file,'utf8');
  assert(code.includes('driving-ban-calendars/runtime.mjs'),`${file}: missing canonical boundary`);
  assert(!/from\s+['"][^'"]*(?:driving-bans-legacy|verified-sep-oct-2026|current-exceptions|public-holidays|tests\/fixtures|driving-bans\/staging|evidence-store|review-workflow)/.test(code),`${file}: archived, test or unapproved staging evidence imported at runtime`);
}
// Intelligence and AI contracts stay unreleased: no public page or API route may import them.
for (const file of execFileSync('git',['ls-files','src/pages'],{encoding:'utf8'}).split('\n').filter(name=>/\.(astro|ts|mjs|js)$/.test(name))) {
  assert(!/from\s+['"][^'"]*(?:driving-bans-relevance|driving-bans-ai-contract|driving-bans-query|driving-bans-intelligence-api|driving-ban-connectors|driving-bans-alerts|intelligence\/entitlements|driving-bans\/research\/|lib\/ai\/)/.test(readFileSync(file,'utf8')),`${file}: unreleased Driving Bans Intelligence, research or AI module imported by a public route`);
}
// Research prepares drafts only: syntax of every research module, and none writes the canonical dataset.
for (const file of ['src/lib/ai/providers.mjs','src/lib/ai/orchestrator.mjs','src/lib/driving-bans/research/safe-fetch.mjs','src/lib/driving-bans/research/documents.mjs','src/lib/driving-bans/research/discovery.mjs','src/lib/driving-bans/research/extraction.mjs','src/lib/driving-bans/research/cross-check.mjs','src/lib/driving-bans/research/proposal.mjs','src/lib/driving-bans/research/pipeline.mjs','src/lib/driving-bans/research/promote.mjs','src/lib/driving-bans/research/config.mjs','scripts/driving-bans-research.mjs']) execFileSync(process.execPath,['--check',file],{stdio:'inherit'});
for (const file of execFileSync('git',['ls-files','src/lib/driving-bans/research','src/lib/ai','scripts/driving-bans-research.mjs'],{encoding:'utf8'}).split('\n').filter(name=>/\.mjs$/.test(name))) {
  assert(!/(?:writeFileSync|appendFileSync|renameSync|copyFileSync)\([^)]*canonical/i.test(readFileSync(file,'utf8')),`${file}: research must never write canonical.json`);
}
assert.equal(getDrivingBansSnapshot().jurisdictions.length,dajcCoverageCount);
console.log('Driving Bans scoped lint: syntax, production provenance, canonical consumer boundaries PASS');
