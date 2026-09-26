/** Scoped syntax, provenance and consumer-boundary lint; not an external legal review. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {canonicalDrivingBans, getDrivingBansSnapshot} from '../config/driving-ban-calendars/runtime.mjs';
const files = ['src/lib/driving-bans/core.mjs','config/driving-ban-calendars/canonical.mjs','config/driving-ban-calendars/index.mjs','config/driving-ban-calendars/runtime.mjs','tests/driving-bans-cases.mjs','tests/run-driving-bans.mjs','scripts/lint-driving-bans.mjs','scripts/audit-driving-bans.mjs'];
for (const file of files) execFileSync(process.execPath,['--check',file],{stdio:'inherit'});
for (const source of canonicalDrivingBans.sources) assert(!new URL(source.url).hostname.endsWith('.invalid'),'Synthetic source cannot be production evidence');
for (const file of ['src/pages/driving-bans.astro','src/pages/api/driving-bans.ics.ts','src/pages/api/driving-bans.json.ts','src/lib/intelligence/driving-bans-adapter.ts']) {
  const code=readFileSync(file,'utf8');
  assert(code.includes('driving-ban-calendars/runtime.mjs'),`${file}: missing canonical boundary`);
  assert(!/from\s+['"][^'"]*(?:driving-bans-legacy|verified-sep-oct-2026|current-exceptions|public-holidays|tests\/fixtures)/.test(code),`${file}: archived/test evidence imported at runtime`);
}
assert.equal(getDrivingBansSnapshot().jurisdictions.length,104);
console.log('Driving Bans scoped lint: syntax, production provenance, canonical consumer boundaries PASS');
