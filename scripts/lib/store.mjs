import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '..', '..');
export const DATA_DIR = path.join(ROOT, 'data', 'oversize');

export function weekDir(weekLabel) {
  return path.join(DATA_DIR, weekLabel);
}

export function findingsPath(weekLabel) {
  return path.join(weekDir(weekLabel), 'findings.json');
}

/** Loads a week's findings as a Map keyed by finding id (the dedup key). */
export async function loadWeekFindings(weekLabel) {
  try {
    const raw = await readFile(findingsPath(weekLabel), 'utf-8');
    const parsed = JSON.parse(raw);
    return new Map((parsed.findings || []).map((f) => [f.id, f]));
  } catch (err) {
    if (err.code === 'ENOENT') return new Map();
    throw err;
  }
}

export async function saveWeekFindings(weekLabel, findingsByKey, meta = {}) {
  await mkdir(weekDir(weekLabel), { recursive: true });
  const findings = [...findingsByKey.entries()]
    .map(([id, finding]) => ({ id, ...finding }))
    .sort((a, b) => (a.firstSeenAt < b.firstSeenAt ? 1 : -1));

  const payload = {
    week: weekLabel,
    updatedAt: new Date().toISOString(),
    ...meta,
    findings,
  };
  await writeFile(findingsPath(weekLabel), JSON.stringify(payload, null, 2), 'utf-8');
  return payload;
}
