import { scopeFindings } from './geographic-scope.mjs';
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
    return new Map(scopeFindings(parsed.findings || []).kept.map((f) => [f.id, f]));
  } catch (err) {
    if (err.code === 'ENOENT') return new Map();
    throw err;
  }
}

export async function saveWeekFindings(weekLabel, findingsByKey, meta = {}) {
  await mkdir(weekDir(weekLabel), { recursive: true });
  const findings = scopeFindings([...findingsByKey.entries()]
    .map(([id, finding]) => ({ id, ...finding }))).kept
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

/** When a week's findings were last written, or null when there are none. */
export async function loadWeekUpdatedAt(weekLabel) {
  try {
    const parsed = JSON.parse(await readFile(findingsPath(weekLabel), 'utf-8'));
    const updatedAt = new Date(parsed.updatedAt);
    return Number.isNaN(updatedAt.getTime()) ? null : updatedAt;
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

/**
 * Whether findings written at `updatedAt` are fresh enough to reuse instead of
 * paying for another discovery run (publication retries reuse the preparation
 * run's data). A non-positive or missing limit never reuses.
 */
export function isRecentRefresh(updatedAt, now, maxAgeHours) {
  if (!updatedAt || !(maxAgeHours > 0)) return false;
  const age = now.getTime() - updatedAt.getTime();
  return age >= 0 && age < maxAgeHours * 60 * 60 * 1000;
}
