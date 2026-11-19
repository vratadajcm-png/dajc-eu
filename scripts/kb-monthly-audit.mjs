#!/usr/bin/env node
// The ONE scheduled legal-library audit (monthly, all 50 jurisdictions).
//
//   node scripts/kb-monthly-audit.mjs [--report audit.json]
//
// Checks: EUR-Lex consolidations/repeals (delta: only changes are reported),
// reachability and robots.txt of every registered source, connector plan
// consistency, access-register hygiene, and the coverage statement. Never
// reports an incomplete archive as complete; a monthly interval does not
// guarantee catching a change on its publication day, so the report carries the
// audit date. Does not touch the separate weekly Driving Bans monitoring and
// writes nothing to the database. Archive SHA-256 integrity and AI
// re-verification of changed documents run via kb:verify / kb:ai-verify
// against Neon (they need DATABASE_URL and are not part of this offline step).

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { accessRegisterProblems, connectorMatrix, connectorProblems, loadAccessRegister, loadConnectors } from '../src/lib/kb/connectors.mjs';
import { DISCOVERY } from '../src/lib/kb/discovery.mjs';
import { officialRobots } from '../src/lib/kb/importer.mjs';
import { runProbe } from '../src/lib/kb/probe.mjs';
import { PoliteClient } from '../src/lib/kb/acquire/polite-fetch.mjs';
import { GII_TOC_URL, parseGiiToc, selectDeLaws } from '../src/lib/kb/acquire/de-gii.mjs';
import { discoverAtChanges, risClient } from '../src/lib/kb/acquire/at-ris.mjs';
import { discoverHrChanges, nnClient } from '../src/lib/kb/acquire/hr-nn.mjs';
import { dajcEuropeCoverage } from '../config/europe-coverage.mjs';
import { classifyError } from '../src/lib/kb/acquire/outcomes.mjs';
import { legalSources } from '../src/lib/kb/legal-sources.mjs';

const args = process.argv.slice(2);
const report = args.includes('--report') ? args[args.indexOf('--report') + 1] : null;
const dir = mkdtempSync(join(tmpdir(), 'kb-audit-'));
const run = (script, extra) => spawnSync('node', [script, ...extra], { encoding: 'utf8', timeout: 55 * 60_000 });
const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };

const src = run('scripts/kb-sources-check.mjs', ['--out', join(dir, 'sources.json')]);
const mon = run('scripts/kb-monitor.mjs', ['--tier', 'monthly', '--report', join(dir, 'monitor.json')]);
const sources = readJson(join(dir, 'sources.json'));
const monitor = readJson(join(dir, 'monitor.json'));

// Official-publisher comparison: every probe is re-acquired and compared (SHA-256) with the stored proof.
const stored = readJson('config/legal-library/connector-proofs.json')?.results ?? [];
const probes = readJson('config/legal-library/connector-probes.json')?.probes ?? [];
const connectors = loadConnectors();
const probeResults = [];
for (const p of probes) probeResults.push(await runProbe(p, { robots: officialRobots() }));
const delta = [];
const regressions = [];
for (const r of probeResults) {
  const before = stored.find((x) => x.id === r.id);
  const connector = connectors.find((c) => c.id === r.id);
  if (r.outcome === 'PROVEN' && before?.outcome === 'PROVEN' && before.sha256 !== r.sha256) delta.push({ id: r.id, jurisdiction: connector?.jurisdiction, change: 'CHANGED_DOCUMENT', previous: before.sha256, current: r.sha256, url: r.url });
  else if (r.outcome === 'PROVEN' && before?.outcome !== 'PROVEN') delta.push({ id: r.id, jurisdiction: connector?.jurisdiction, change: 'NEWLY_ACQUIRED', current: r.sha256, url: r.url });
  else if (r.outcome !== 'PROVEN' && before?.outcome === 'PROVEN') regressions.push({ id: r.id, jurisdiction: connector?.jurisdiction, outcome: r.outcome, reason: r.reason ?? null });
}
// Discovery of new or amended acts (only where a working API is implemented).
const since = new Date(Date.now() - 35 * 86_400_000).toISOString().slice(0, 10);
const discovered = [];
const discoveryErrors = [];
for (const [code, fn] of Object.entries(DISCOVERY)) {
  try { discovered.push(...await fn({ year: new Date().getUTCFullYear(), since, robots: officialRobots() })); } catch (e) { discoveryErrors.push(`${code}: ${String(e.message).slice(0, 120)}`); }
}
// Catalogue-based discovery (publisher catalogues, not test documents). Outcomes are classified, never blurred.
const catalogue = {};
const classify = (e) => ({ outcome: classifyError(e), reason: String(e.message).slice(0, 200) });
try {
  const toc = parseGiiToc(new TextDecoder().decode((await new PoliteClient({ minIntervalMs: 1500 }).get(GII_TOC_URL)).bytes));
  const laws = selectDeLaws(toc);
  catalogue.DE = { outcome: 'OK', catalogueEntries: toc.length, relevantLaws: laws.length, slugs: laws.map((l) => l.slug) };
} catch (e) { catalogue.DE = classify(e); }
try { catalogue.HR = { outcome: 'OK', changedEntries: (await discoverHrChanges(nnClient(), { since })).length, importAllowed: false, note: 'reuse terms not verified' }; } catch (e) { catalogue.HR = classify(e); }
try { catalogue.AT = { outcome: 'OK', changedDocuments: (await discoverAtChanges(risClient(), { from: since, to: new Date().toISOString().slice(0, 10) })).length }; } catch (e) { catalogue.AT = classify(e); }
const proven = new Set(probeResults.filter((r) => r.outcome === 'PROVEN').map((r) => connectors.find((c) => c.id === r.id)?.jurisdiction));
const failures = [];
if (src.status !== 0 || !sources) failures.push('SOURCE_CHECK_FAILED');
if (regressions.length) failures.push(`CONNECTOR_REGRESSION: ${regressions.map((r) => r.id).join(', ')}`);
if (discoveryErrors.length) failures.push('DISCOVERY_FAILED');
if (mon.status !== 0 || !monitor) failures.push('EURLEX_MONITOR_FAILED');
const unreadable = monitor?.results?.filter((r) => r.outcome === 'UNREADABLE').map((r) => r.officialNumber) ?? [];
if (unreadable.length) failures.push(`EURLEX_UNREADABLE: ${unreadable.join(', ')}`);
const problems = [...connectorProblems(), ...accessRegisterProblems()];
const matrix = connectorMatrix();
const jurisdictions = dajcEuropeCoverage.map(([code, name]) => {
  const own = connectors.filter((c) => c.jurisdiction === code);
  const ownProbes = probeResults.filter((r) => own.some((c) => c.id === r.id));
  const sourceChecks = (sources?.results ?? []).filter((r) => r.jurisdiction === code);
  return {
    jurisdiction: code, name,
    connectors: own.map((c) => ({ id: c.id, status: c.status, format: c.format, kind: c.kind })),
    registeredSources: legalSources.filter((x) => x.jurisdiction === code).map((x) => x.id),
    sourceAvailability: sourceChecks.map((r) => ({ sourceId: r.sourceId, domain: r.domain, classification: r.classification, homeStatus: r.home?.status ?? null, homeError: r.home?.error ?? null, robotsStatus: r.robots?.status ?? null, robotsRootAllowed: r.robots?.rootAllowed ?? null, crawlDelaySec: r.robots?.crawlDelaySec ?? null, retrievedAt: r.home?.retrievedAt ?? null })),
    acquisitionProofs: ownProbes.map((r) => ({ id: r.id, url: r.url, outcome: r.outcome, classification: r.classification ?? null, status: r.status ?? null, bytes: r.bytes ?? null, sha256: r.sha256 ?? null, retrievedAt: r.retrievedAt, reason: r.reason ?? null })),
    catalogueDiscovery: catalogue[code] ?? { outcome: 'NOT_IMPLEMENTED' },
    regressions: regressions.filter((r) => r.jurisdiction === code),
    documentChanges: delta.filter((d) => d.jurisdiction === code),
    status: proven.has(code) || catalogue[code]?.outcome === 'OK' ? 'PARTIAL_EVIDENCE' : 'NOT_VERIFIED',
    note: 'An unreadable source is never evidence that legislation is unchanged.',
  };
});
const out = {
  auditedOn: new Date().toISOString().slice(0, 10),
  note: 'Monthly interval: a change may be caught up to a month after publication.',
  changes: monitor?.summary ?? null,
  newOrRepealed: monitor?.results?.filter((r) => ['NEW_CONSOLIDATION', 'NO_LONGER_IN_FORCE'].includes(r.outcome)) ?? [],
  connectorProblems: problems,
  jurisdictionsWithoutImplementedConnector: matrix.filter((m) => m.implemented === 0).map((m) => m.jurisdiction),
  officialComparison: { probes: probeResults.length, proven: probeResults.filter((r) => r.outcome === 'PROVEN').length, outcomes: Object.fromEntries(probeResults.map((r) => [r.id, r.outcome])) },
  deltaQueueForAiVerification: delta,
  newOrAmendedActsDiscovered: discovered,
  connectorRegressions: regressions,
  catalogueDiscovery: catalogue,
  discoveryErrors,
  discoveryImplementedFor: [...new Set([...Object.keys(DISCOVERY), ...Object.entries(catalogue).filter(([, v]) => v.outcome === 'OK').map(([k]) => k)])],
  discoveryNotImplementedFor: dajcEuropeCoverage.map(([c]) => c).filter((c) => !(c in DISCOVERY) && catalogue[c]?.outcome !== 'OK'),
  jurisdictionsWithoutProvenAcquisition: dajcEuropeCoverage.map(([c]) => c).filter((c) => !proven.has(c)),
  environment: process.env.GITHUB_ACTIONS === 'true' ? 'GitHub Actions runner' : 'local or sandbox',
  runUrl: process.env.GITHUB_RUN_ID ? `https://github.com/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}` : null,
  sourceCheckSummary: sources?.summary ?? null,
  eurLex: monitor ?? null,
  jurisdictions,
  accessRegister: loadAccessRegister().available ? 'AVAILABLE' : 'PRIVATE_REGISTER_NOT_CONFIGURED',
  failures,
  complete: false,
  completeReason: 'Coverage is complete only when every cell of the coverage matrix is COVERED or NOT_APPLICABLE; see kb:coverage.',
};
if (report) writeFileSync(report, `${JSON.stringify(out, null, 1)}\n`);
console.log(JSON.stringify({ ...out, newOrRepealed: out.newOrRepealed.length, newOrAmendedActsDiscovered: out.newOrAmendedActsDiscovered.length, discoveryNotImplementedFor: out.discoveryNotImplementedFor.length, jurisdictionsWithoutProvenAcquisition: out.jurisdictionsWithoutProvenAcquisition.length, jurisdictionsWithoutImplementedConnector: out.jurisdictionsWithoutImplementedConnector.length }, null, 1));
process.exit(failures.length || problems.length ? 1 : 0);
