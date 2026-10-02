// Subprocess integration tests for the top-level pipeline script. These are
// slower than the pure-function unit tests elsewhere in this directory, but
// are the only way to genuinely exercise dry-run cleanup, overwrite
// protection, the OPENAI_API_KEY preflight and the end-to-end editorial
// contract (quality > count) as they actually run.
//
// OVERSIZE_NOW pins "now" to a fixed instant (read by
// scripts/generate-weekly-article.mjs) so the target week - and therefore
// the article filename these tests touch - is deterministic and never
// collides with real, already-published content.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isoWeekLabel } from '../week.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..', '..');
const GENERATE_SCRIPT = path.join(ROOT, 'scripts', 'generate-weekly-article.mjs');
const ARTICLES_DIR = path.join(ROOT, 'src', 'content', 'news', 'eu-oversize');

// Late July - deliberately NOT a week with real, already-published content.
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

const COUNTRIES = ['Germany', 'Czechia', 'Austria', 'Poland', 'Slovakia', 'Hungary', 'Switzerland', 'Slovenia', 'Croatia', 'Spain'];
const TYPES = ['permit_change', 'permit_system', 'escort_requirement', 'border_restriction', 'bridge_restriction', 'route_restriction'];

// A genuine, recently published exceptional-transport development.
function qualifyingFinding(n) {
  return {
    id: `integration-test-${n}`,
    country: COUNTRIES[n % COUNTRIES.length],
    region: null,
    location: 'Test road',
    type: TYPES[n % TYPES.length],
    title: `Synthetic exceptional transport permit change ref${n}`,
    summary: 'Synthetic exceptional transport road permit and heavy-haul route change for integration testing.',
    validFrom: null,
    validTo: null,
    impact: null,
    recommendedAction: null,
    publishedAt: '2026-07-29',
    publishedAtSource: 'jsonld',
    sourceName: `Synthetic Source ${n}`,
    sourceUrl: `https://example.test/news/integration-synthetic-${n}`,
    confidence: 'unverified',
    status: 'active',
    firstSeenAt: now.toISOString(),
    lastCheckedAt: now.toISOString(),
  };
}

// Material that must never be published, however short the edition is.
function fillerFindings() {
  return [
    { ...qualifyingFinding(900), title: 'Old exceptional transport permit simplification announced in May', publishedAt: '2026-05-06', status: 'new' },
    { ...qualifyingFinding(901), title: 'Undated exceptional transport permit information page', publishedAt: null, publishedAtSource: null },
    { ...qualifyingFinding(902), title: 'Tartu ja Elva vahel valmis uus jalakäijate tunnel', summary: 'Uus jalgratta- ja jalakäijate tunnel valmis.' },
    { ...qualifyingFinding(903), title: 'Izvanredni prijevoz', sourceUrl: 'https://example.test/hr/izvanredni-prijevoz' },
    { ...qualifyingFinding(904), title: 'Austria national holiday lorry driving ban on 26 October', summary: 'Lorries over 7.5 t may not drive on the national holiday.', type: 'driving_ban' },
    { ...qualifyingFinding(905), title: 'Roads administration homepage with latest exceptional transport news', sourceUrl: 'https://example.test/fr.html' },
  ];
}

function writeFindings(findings) {
  mkdirSync(findingsDir, { recursive: true });
  writeFileSync(findingsPath, JSON.stringify({ week: thisWeek, updatedAt: now.toISOString(), findings }, null, 2), 'utf-8');
}

let preexistingFindings = null;

beforeAll(() => {
  expect(existsSync(targetFilePath)).toBe(false); // sanity: must not collide with real content
  if (existsSync(findingsPath)) preexistingFindings = readFileSync(findingsPath, 'utf-8');
});

beforeEach(() => {
  writeFindings([...Array.from({ length: 40 }, (_, i) => qualifyingFinding(i + 1)), ...fillerFindings()]);
});

afterAll(() => {
  if (preexistingFindings) writeFileSync(findingsPath, preexistingFindings, 'utf-8');
  else rmSync(findingsPath, { force: true });
  rmSync(targetFilePath, { force: true }); // safety net only - no test should leave this behind
  rmSync(path.join(ARTICLES_DIR, `eu-oversize-weekly-preview-${nextWeekLabel.toLowerCase()}.md`), { force: true });
});

function dryRunArticle(stdout) {
  const match = stdout.match(/=== DRY RUN - ARTICLE THAT WOULD BE PUBLISHED \(not committed\) ===\n([\s\S]*?)=== END OF DRY RUN ARTICLE ===/);
  return match ? match[1] : '';
}

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
    'publishes exactly the qualifying items - 9 leads and no Rest of Europe - without padding',
    () => {
      writeFindings([...Array.from({ length: 9 }, (_, i) => qualifyingFinding(i + 1)), ...fillerFindings()]);
      const result = runGenerate(['--mock', '--dry-run', '--skip-build']);
      expect(result.code).toBe(0);
      expect(result.stdout).toMatch(/Lead reports: 9\b/);
      expect(result.stdout).toMatch(/Rest-of-Europe reports: 0\b/);
      expect(result.stdout).not.toMatch(/repair|supplement|attempt \d/i);
      const article = dryRunArticle(result.stdout);
      expect(article.match(/^### /gm)).toHaveLength(9);
      expect(article).not.toContain('Rest of Europe');
      for (const filler of ['announced in May', 'Undated exceptional', 'jalakäijate', 'Izvanredni prijevoz', 'driving ban', 'homepage']) {
        expect(article).not.toContain(filler);
      }
    },
    30_000
  );

  it(
    'caps a large week at 30 lead reports and 15 Rest-of-Europe updates',
    () => {
      writeFindings(Array.from({ length: 60 }, (_, i) => qualifyingFinding(i + 1)));
      const result = runGenerate(['--mock', '--dry-run', '--skip-build']);
      expect(result.code).toBe(0);
      expect(result.stdout).toMatch(/Lead reports: 30\b/);
      expect(result.stdout).toMatch(/Rest-of-Europe reports: 15\b/);
    },
    30_000
  );

  it(
    'publishes nothing when only old, undated, generic or out-of-scope material exists',
    () => {
      writeFindings(fillerFindings());
      const result = runGenerate(['--mock', '--dry-run', '--skip-build']);
      expect(result.code).toBe(0);
      expect(result.stdout).toMatch(/No article will be published/);
      expect(result.stdout).not.toMatch(/DRY RUN - ARTICLE THAT WOULD BE PUBLISHED/);
      expect(existsSync(targetFilePath)).toBe(false);
    },
    30_000
  );

  it(
    'can publish a separate preview without consuming the Friday final slug',
    () => {
      const previewPath = path.join(ARTICLES_DIR, `eu-oversize-weekly-preview-${nextWeekLabel.toLowerCase()}.md`);
      try {
        const result = runGenerate(['--mock', '--preview', '--skip-build']);
        expect(result.code).toBe(0);
        expect(existsSync(previewPath)).toBe(true);
        expect(existsSync(targetFilePath)).toBe(false);
        expect(readFileSync(previewPath, 'utf-8')).toMatch(/PREVIEW EDITION/);
      } finally {
        rmSync(previewPath, { force: true });
      }
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
