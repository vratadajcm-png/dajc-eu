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
import { accessRegisterProblems, connectorMatrix, connectorProblems } from '../src/lib/kb/connectors.mjs';

const args = process.argv.slice(2);
const report = args.includes('--report') ? args[args.indexOf('--report') + 1] : null;
const dir = mkdtempSync(join(tmpdir(), 'kb-audit-'));
const run = (script, extra) => spawnSync('node', [script, ...extra], { encoding: 'utf8', timeout: 55 * 60_000 });
const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };

const src = run('scripts/kb-sources-check.mjs', ['--out', join(dir, 'sources.json')]);
const mon = run('scripts/kb-monitor.mjs', ['--tier', 'monthly', '--report', join(dir, 'monitor.json')]);
const sources = readJson(join(dir, 'sources.json'));
const monitor = readJson(join(dir, 'monitor.json'));

const failures = [];
if (src.status !== 0 || !sources) failures.push('SOURCE_CHECK_FAILED');
if (mon.status !== 0 || !monitor) failures.push('EURLEX_MONITOR_FAILED');
const unreadable = monitor?.results?.filter((r) => r.outcome === 'UNREADABLE').map((r) => r.officialNumber) ?? [];
if (unreadable.length) failures.push(`EURLEX_UNREADABLE: ${unreadable.join(', ')}`);
const problems = [...connectorProblems(), ...accessRegisterProblems()];
const matrix = connectorMatrix();
const out = {
  auditedOn: new Date().toISOString().slice(0, 10),
  note: 'Monthly interval: a change may be caught up to a month after publication.',
  changes: monitor?.summary ?? null,
  newOrRepealed: monitor?.results?.filter((r) => ['NEW_CONSOLIDATION', 'NO_LONGER_IN_FORCE'].includes(r.outcome)) ?? [],
  connectorProblems: problems,
  jurisdictionsWithoutImplementedConnector: matrix.filter((m) => m.implemented === 0).map((m) => m.jurisdiction),
  failures,
  complete: false,
  completeReason: 'Coverage is complete only when every cell of the coverage matrix is COVERED or NOT_APPLICABLE; see kb:coverage.',
};
if (report) writeFileSync(report, `${JSON.stringify(out, null, 1)}\n`);
console.log(JSON.stringify({ ...out, newOrRepealed: out.newOrRepealed.length, jurisdictionsWithoutImplementedConnector: out.jurisdictionsWithoutImplementedConnector.length }, null, 1));
process.exit(failures.length || problems.length ? 1 : 0);
