/** Machine-readable export of the Driving Bans Source Registry. Metadata only; fetches nothing. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { dajcEuropeCoverage } from '../config/europe-coverage.mjs';
import { buildDrivingBanSourceCatalog } from '../config/driving-ban-sources/index.mjs';
import { validateSourceCatalog, catalogToCsv } from '../src/lib/driving-bans/source-registry.mjs';

const args = process.argv.slice(2);
const option = (name, fallback) => { const i = args.indexOf(name); return i < 0 ? fallback : args[i + 1]; };
const out = resolve(option('--output', 'artifacts/driving-bans'));
const catalog = buildDrivingBanSourceCatalog(new Date(option('--clock', new Date().toISOString())).toISOString());
validateSourceCatalog(catalog, dajcEuropeCoverage);
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'source-catalog.json'), JSON.stringify(catalog, null, 2) + '\n');
writeFileSync(join(out, 'source-catalog.csv'), catalogToCsv(catalog));
console.log(JSON.stringify(catalog.summary, null, 2));
