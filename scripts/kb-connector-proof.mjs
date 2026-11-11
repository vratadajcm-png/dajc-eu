#!/usr/bin/env node
// Runs every probe of config/legal-library/connector-probes.json and records
// the outcome in config/legal-library/connector-proofs.json. A connector is
// IMPLEMENTED only with a PROVEN probe of the same run; a failed probe sets it
// back to PLANNED (not reachable/not proven) with the reason. --write updates
// connectors.json statuses.
//   node scripts/kb-connector-proof.mjs [--write] [--out proofs.json]
import { readFileSync, writeFileSync } from 'node:fs';
import { officialRobots } from '../src/lib/kb/importer.mjs';
import { runProbe } from '../src/lib/kb/probe.mjs';

const args = process.argv.slice(2);
const out = args.includes('--out') ? args[args.indexOf('--out') + 1] : 'config/legal-library/connector-proofs.json';
const probes = JSON.parse(readFileSync('config/legal-library/connector-probes.json', 'utf8')).probes;
const results = [];
for (const p of probes) {
  const r = await runProbe(p, { robots: officialRobots() });
  results.push(r);
  console.log(`${r.outcome.padEnd(15)} ${p.id} ${r.bytes ?? ''} ${r.reason ?? r.missing ?? ''}`);
}
writeFileSync(out, `${JSON.stringify({ provenOn: new Date().toISOString().slice(0, 10), results }, null, 1)}\n`);
if (args.includes('--write')) {
  const path = 'config/legal-library/connectors.json';
  const file = JSON.parse(readFileSync(path, 'utf8'));
  for (const c of file.connectors) {
    const r = results.find((x) => x.id === c.id);
    if (!r) continue;
    if (r.outcome === 'PROVEN') Object.assign(c, { status: 'IMPLEMENTED', adapter: 'probe-fetch', basis: 'VERIFIED_LIVE', lastProof: { on: r.retrievedAt.slice(0, 10), sha256: r.sha256 } });
    else Object.assign(c, { status: c.status === 'IMPLEMENTED' && c.adapter === 'eurlex' ? 'IMPLEMENTED' : 'PLANNED', lastFailure: { on: r.retrievedAt.slice(0, 10), outcome: r.outcome, reason: r.reason ?? r.missing ?? r.status ?? null } });
  }
  writeFileSync(path, `${JSON.stringify(file, null, 1)}\n`);
}
