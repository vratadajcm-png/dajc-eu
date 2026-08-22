// Subprocess integration tests for the top-level pipeline script. These are
// slower than the pure-function unit tests elsewhere in this directory, but
// are the only way to genuinely exercise dry-run cleanup, overwrite
// protection, and the OPENAI_API_KEY preflight as they actually run.
//
// OVERSIZE_NOW pins "now" to a fixed instant (read by
// scripts/generate-weekly-article.mjs) so the target week - and therefore
// the article filename these tests touch - is deterministic and never
// collides with the real, already-published eu-oversize-weekly-2026-w35.md.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isoWeekLabel } from '../week.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..', '..');
const GENERATE_SCRIPT = path.join(ROOT, 'scripts', 'generate-weekly-article.mjs');
const ARTICLES_DIR = path.join(ROOT, 'src', 'content', 'news', 'eu-oversize');

// Early August - deliberately NOT the real, already-published W35
// (24-30 August 2026), but still inside the Slovak/Hungarian summer-ban
// season so the official calendar layer alone contributes several
// candidates in mock mode.
const NOW_ISO = '2026-07-31T10:00:00Z';
const now = new Date(NOW_ISO);
const thisWeek = isoWeekLabel(now);
const nextWeekDate = new Date(now);
nextWeekDate.setUTCDate(nextWeekDate.getUTCDate() + 7);
const nextWeekLabel = isoWeekLabel(nextWeekDate);
const slug = `eu-oversize-weekly-${nextWeekLabel.toLowerCase()}`;
const targetFilePath = path.join(ARTICLES_DIR, `${slug}.md`);
const findingsDir = path.join(ROOT, 'data', 'oversize', thisWeek);
const findingsPath = path.join(findingsDir, 'findings.json');

function runGenerate(args, envOverrides = {}) {
  try {
    const stdout = execFileSync('node', [GENERATE_SCRIPT, ...args], {
      cwd: ROOT,
      env: { ...process.env, OVERSIZE_NOW: NOW_ISO, ...envOverrides },
      encoding: 'utf-8',
    });
    return { code: 0, stdout };
  } catch (err) {
    return { code: err.status ?? 1, stdout: `${err.stdout || ''}${err.stderr || ''}` };
  }
}

function syntheticCandidate(n, type) {
  return {
    id: `integration-test-${n}`,
    country: 'Testland',
    region: null,
    location: 'Test road',
    type,
    title: `Synthetic candidate ${n} for integration testing`,
    summary: 'Synthetic candidate for integration testing only - not a real transport restriction.',
    validFrom: null,
    validTo: null,
    impact: null,
    recommendedAction: null,
    sourceName: `Synthetic Source ${n}`,
    sourceUrl: `https://example.test/integration-synthetic-${n}`,
    confidence: 'unverified',
    status: 'new',
    firstSeenAt: now.toISOString(),
    lastCheckedAt: now.toISOString(),
  };
}

let preexistingFindings = null;

beforeAll(() => {
  expect(existsSync(targetFilePath)).toBe(false); // sanity: must not collide with real content

  if (existsSync(findingsPath)) preexistingFindings = readFileSync(findingsPath, 'utf-8');
  mkdirSync(findingsDir, { recursive: true });
  writeFileSync(
    findingsPath,
    JSON.stringify(
      {
        week: thisWeek,
        updatedAt: now.toISOString(),
        findings: [
          syntheticCandidate(1, 'permit_change'),
          syntheticCandidate(2, 'permit_system'),
          syntheticCandidate(3, 'escort_requirement'),
        ],
      },
      null,
      2
    ),
    'utf-8'
  );
});

afterAll(() => {
  if (preexistingFindings) writeFileSync(findingsPath, preexistingFindings, 'utf-8');
  else rmSync(findingsPath, { force: true });
  rmSync(targetFilePath, { force: true }); // safety net only - no test should leave this behind
});

describe('generate-weekly-article.mjs (mock, subprocess)', () => {
  it(
    'a successful dry run leaves no article file behind, and no throwaway file either',
    () => {
      const result = runGenerate(['--mock', '--dry-run', '--skip-build']);
      expect(result.code).toBe(0);
      expect(result.stdout).toMatch(/DRY RUN - ARTICLE THAT WOULD BE PUBLISHED/);
      expect(existsSync(targetFilePath)).toBe(false);
      const leftoverDryRunFiles = readdirSync(ARTICLES_DIR).filter((f) => f.startsWith(`_dry-run-${slug}`));
      expect(leftoverDryRunFiles).toEqual([]);
    },
    30_000
  );

  it(
    'refuses to overwrite an already-published article for the target week',
    () => {
      mkdirSync(ARTICLES_DIR, { recursive: true });
      writeFileSync(targetFilePath, '---\ntitle: "pre-existing"\n---\n\nDO NOT OVERWRITE\n', 'utf-8');
      try {
        const result = runGenerate(['--mock', '--skip-build']);
        expect(result.code).toBe(0);
        expect(result.stdout).toMatch(/already exists/);
        expect(readFileSync(targetFilePath, 'utf-8')).toContain('DO NOT OVERWRITE');
      } finally {
        rmSync(targetFilePath, { force: true });
      }
    },
    30_000
  );

  it(
    'fails hard (non-zero exit) on a real run with no OPENAI_API_KEY, before writing anything',
    () => {
      const result = runGenerate([], { OPENAI_API_KEY: '' });
      expect(result.code).not.toBe(0);
      expect(result.stdout).toMatch(/OPENAI_API_KEY/);
      expect(existsSync(targetFilePath)).toBe(false);
    },
    30_000
  );
});
