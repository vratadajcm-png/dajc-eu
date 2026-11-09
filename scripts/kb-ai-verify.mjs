#!/usr/bin/env node
// AI verification of library versions (protocol src/lib/kb/ai-verify/protocol.mjs).
//
//   DAJC_KB_AI_VERIFIER_DB_URL=...                         role dajc_kb_ai_verifier (never the importer, never the owner)
//   DAJC_KB_AI_EXTRACT_PROVIDER=openai DAJC_KB_AI_VERIFY_PROVIDER=anthropic   two different vendors
//   DAJC_RESEARCH_<P>_API_KEY, DAJC_RESEARCH_<P>_MODEL[_EXTRACT|_VERIFY], DAJC_RESEARCH_PRICING_USD   (src/lib/ai/providers.mjs)
//   DAJC_KB_AI_RUN_BUDGET_USD=10                           hard cap for the whole run
//   node scripts/kb-ai-verify.mjs [--source eu-eurlex] [--only <officialNumber>] [--lang cs] [--online] [--estimate] [--dry-run]
//       [--reverify] [--max-versions N] [--expect-role dajc_kb_ai_verifier] [--expect-environment dev] [--report report.json]
//
// --estimate prices the worst case of every call without calling any AI.
// --dry-run calls the AI (and is billed) but records nothing.
// Unchanged AI_VERIFIED versions are skipped (their SHA-256 cannot change)
// unless --reverify. Every result is decided by the database
// (dajc_kb.apply_ai_verification). Keys and the connection string are never
// printed; exit code 1 unless every processed version passed.

import { readFileSync, writeFileSync } from 'node:fs';
import { createProvider } from '../src/lib/ai/providers.mjs';
import { archiveFromEnv } from '../src/lib/kb/archive.mjs';
import { Budget, estimateCost } from '../src/lib/kb/ai-verify/budget.mjs';
import { chunkProvisions, verifyVersionWithAi } from '../src/lib/kb/ai-verify/engine.mjs';
import { documentHeader, EXTRACTION_SYSTEM, LIMITS, PROTOCOL, provisionBlocks, VERIFICATION_SYSTEM } from '../src/lib/kb/ai-verify/protocol.mjs';
import { readVersionForVerification, recordVerificationRun } from '../src/lib/kb/ai-verify/store.mjs';
import { assertDatabaseTarget, maskInGitHubActions, redact } from '../src/lib/kb/db-guard.mjs';
import { postgresQuery, searchLibrary } from '../src/lib/kb/search.mjs';
import { eurlexStatusReader, verifyEntry } from '../src/lib/kb/verify-entry.mjs';

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const env = process.env;
const onDate = value('--date') || new Date().toISOString().slice(0, 10);
const dbUrl = env.DAJC_KB_AI_VERIFIER_DB_URL || '';
maskInGitHubActions(dbUrl);
if (!dbUrl) throw new Error('DAJC_KB_AI_VERIFIER_DB_URL is not set (role dajc_kb_ai_verifier)');

const manifest = JSON.parse(readFileSync(value('--manifest') || 'config/legal-library/manifest.json', 'utf8'));
const verification = JSON.parse(readFileSync(value('--verification') || 'config/legal-library/verification.json', 'utf8'));
const entries = manifest.entries.filter((e) => (!value('--source') || e.sourceId === value('--source'))
  && (!value('--only') || e.officialNumber === value('--only')) && (!value('--lang') || e.version.language === value('--lang')))
  .slice(0, value('--max-versions') ? Number(value('--max-versions')) : undefined);
if (entries.length === 0) throw new Error('no manifest entry matches the filters');
const online = flag('--online');
const archive = env.DAJC_KB_ARCHIVE ? archiveFromEnv() : null;
if (!archive && !online) throw new Error('layer 1 needs DAJC_KB_ARCHIVE or --online');

const extractor = createProvider(env.DAJC_KB_AI_EXTRACT_PROVIDER || 'openai', { env });
const verifier = createProvider(env.DAJC_KB_AI_VERIFY_PROVIDER || 'anthropic', { env });
console.log(`protocol ${PROTOCOL}; extraction ${extractor.id}/${extractor.modelFor('extract') || 'no model'} (${extractor.configured ? 'configured' : 'NOT configured'}); `
  + `verification ${verifier.id}/${verifier.modelFor('verify') || 'no model'} (${verifier.configured ? 'configured' : 'NOT configured'})`);
if (extractor.vendor === verifier.vendor) throw new Error('extraction and independent verification must use providers of different vendors');
const budget = new Budget(Number(env.DAJC_KB_AI_RUN_BUDGET_USD || 0));

const { default: postgres } = await import('postgres');
const sql = postgres(dbUrl, { max: 1, prepare: false, onnotice: () => undefined });
try {
  const target = await assertDatabaseTarget(sql, { role: value('--expect-role'), environment: value('--expect-environment') });
  console.log(`target: role ${target.role}${target.environment ? `, environment ${target.environment}` : ''}; check day ${onDate}; budget $${budget.limitUsd}`);
} catch (error) {
  console.error(`REFUSED  ${redact(error?.message || error, dbUrl).slice(0, 300)}`);
  await sql.end({ timeout: 5 }).catch(() => undefined);
  process.exit(2);
}

const eurlexStatus = eurlexStatusReader();
const search = (input) => searchLibrary(postgresQuery(sql), input);
const report = [];
let estimateTotal = 0;
for (const entry of entries) {
  const name = `${entry.officialNumber} [${entry.version.language}]`;
  const line = { name, officialNumber: entry.officialNumber, language: entry.version.language };
  try {
    const deterministic = await verifyEntry({
      sql, entry, archive, online, onDate, searchChecks: verification.checks, modelSources: verification.modelSources, eurlexStatus, redactError: (m) => redact(m, dbUrl),
    });
    if (!deterministic.row) {
      report.push({ ...line, outcome: 'SKIPPED', note: 'not imported' });
      console.log(`SKIP     ${name}: not imported`);
      continue;
    }
    const row = deterministic.row;
    if (['HUMAN_VERIFIED', 'REJECTED'].includes(row.provenance) || (row.provenance === 'AI_VERIFIED' && !flag('--reverify'))) {
      report.push({ ...line, versionId: row.id, outcome: 'SKIPPED', note: `already ${row.provenance}` });
      console.log(`SKIP     ${name}: ${row.provenance} (unchanged content; --reverify to check again)`);
      continue;
    }
    const stored = await readVersionForVerification(sql, row.id);
    if (flag('--estimate')) {
      const citable = stored.provisions.filter((p) => ['ARTICLE', 'SECTION', 'ANNEX'].includes(p.anchor_type));
      let cost = 0;
      for (const chunk of chunkProvisions(citable)) {
        const text = `${documentHeader(stored.version)}\n${provisionBlocks(chunk)}`;
        cost += estimateCost(extractor.priceFor('extract'), { promptChars: EXTRACTION_SYSTEM.length + text.length, maxOutputTokens: LIMITS.extractionOutputTokens }) ?? NaN;
        cost += estimateCost(verifier.priceFor('verify'), { promptChars: VERIFICATION_SYSTEM.length + text.length * 1.5, maxOutputTokens: LIMITS.verificationOutputTokens }) ?? NaN;
      }
      cost += (estimateCost(extractor.priceFor('extract'), { promptChars: 12_000, maxOutputTokens: LIMITS.blindOutputTokens + LIMITS.questionsOutputTokens }) ?? NaN)
        + (estimateCost(verifier.priceFor('verify'), { promptChars: 9_000, maxOutputTokens: LIMITS.blindOutputTokens }) ?? NaN);
      estimateTotal += cost;
      report.push({ ...line, versionId: row.id, outcome: 'ESTIMATED', maxCostUsd: Number(cost.toFixed(4)), deterministic: deterministic.passed ? 'PASS' : 'FAIL' });
      console.log(`ESTIMATE ${name}: at most $${cost.toFixed(4)} (${citable.length} provisions); layer 1 ${deterministic.passed ? 'PASS' : 'FAIL'}`);
      continue;
    }
    const result = await verifyVersionWithAi({
      version: stored.version, provisions: stored.provisions, firstPagesText: stored.firstPagesText, contentDigest: stored.contentDigest,
      deterministic, extractor, verifier, budget, search, onDate, modelSources: verification.modelSources,
    });
    let decision = 'NOT_RECORDED (dry run)';
    if (!flag('--dry-run')) decision = (await recordVerificationRun(sql, result)).decision;
    const layers = Object.fromEntries(Object.entries(result.layers).map(([k, l]) => [k, l.status]));
    report.push({ ...line, versionId: row.id, outcome: result.outcome, decision, layers, problems: Object.fromEntries(Object.entries(result.layers).map(([k, l]) => [k, l.problems])),
      claims: result.claims.length, supported: result.claims.filter((c) => c.verdict === 'SUPPORTED').length, costUsd: result.costUsd,
      models: { extraction: `${result.extractionProvider}/${result.extractionModel}`, verification: `${result.verificationProvider}/${result.verificationModel}` }, notes: result.notes });
    console.log(`${result.outcome.padEnd(8)} ${name}: ${decision}; ${Object.entries(layers).map(([k, s]) => `${k} ${s === 'PASS' ? '✓' : s === 'SKIPPED' ? '-' : '✗'}`).join('  ')}; `
      + `${result.claims.length} claims; $${result.costUsd.toFixed(4)}`);
    for (const [k, l] of Object.entries(result.layers)) for (const p of l.problems.slice(0, 5)) console.log(`      ${k}: ${p}`);
    if (result.notes) console.log(`      note: ${result.notes}`);
    if (result.outcome === 'ERROR' && /budget/.test(result.notes || '')) break;
  } catch (error) {
    report.push({ ...line, outcome: 'ERROR', note: redact(error?.message || error, dbUrl).slice(0, 300) });
    console.error(`ERROR    ${name}: ${redact(error?.message || error, dbUrl).slice(0, 300)}`);
  }
}
await sql.end();

const counted = report.filter((r) => !['SKIPPED', 'ESTIMATED'].includes(r.outcome));
const passed = counted.filter((r) => r.outcome === 'PASS').length;
if (flag('--estimate')) console.log(`\nEstimated worst case: $${estimateTotal.toFixed(4)} for ${report.filter((r) => r.outcome === 'ESTIMATED').length} versions (list prices from DAJC_RESEARCH_PRICING_USD).`);
else console.log(`\n${passed}/${counted.length} processed versions passed; spent $${budget.spentUsd.toFixed(4)} of $${budget.limitUsd} (list prices, not an invoice).`);
if (value('--report')) writeFileSync(value('--report'), `${JSON.stringify({ protocol: PROTOCOL, checkedOn: onDate, spentUsd: Number(budget.spentUsd.toFixed(6)), results: report }, null, 2)}\n`);
process.exitCode = flag('--estimate') || passed === counted.length ? 0 : 1;
