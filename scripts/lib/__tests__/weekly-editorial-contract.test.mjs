// Static contract checks for the EU Oversize Weekly pipeline: no count
// forcing, no supplement/retry loops, no Driving Bans calendar import.
import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as openaiClient from '../openai-client.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..', '..');
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf-8');

const WEEKLY_FILES = [
  'scripts/generate-weekly-article.mjs',
  ...readdirSync(path.join(ROOT, 'scripts', 'lib')).filter((f) => f.endsWith('.mjs')).map((f) => `scripts/lib/${f}`),
];

describe('quality over count', () => {
  it('the LLM prompt and schema contain no minimum-count instruction', () => {
    const source = read('scripts/lib/openai-client.mjs');
    expect(source).not.toMatch(/hard (?:editorial )?minimum|Minimum 20|Minimum 10|at least 10|at least 6 distinct|reach the 20|Return 20-30/i);
    expect(source).toMatch(/There is NO minimum number of reports/);
    expect(source).toMatch(/Maximum 30/);
    expect(source).toMatch(/Maximum 15/);
  });

  it('exports no lead or Rest-of-Europe supplement generators', () => {
    expect(Object.keys(openaiClient).sort()).toEqual(['generateArticleWithOpenAI', 'generateRequiredItemsWithOpenAI']);
  });

  it('has no repair loop, tier rebalancing or retry-until-padded runner', () => {
    for (const file of WEEKLY_FILES) {
      const source = read(file);
      expect(source, file).not.toMatch(/Lead repair attempt|Rest-of-Europe repair|rebalanceArticleTiers|roundupNeedsSupplement|generateLeadSupplement|generateRoundupSupplement/);
    }
    expect(existsSync(path.join(ROOT, 'scripts', 'run-weekly-publisher.mjs'))).toBe(false);
    expect(existsSync(path.join(ROOT, 'scripts', 'apply-weekly-editorial-policy.mjs'))).toBe(false);
  });

  it('no one-time emergency validation step from an earlier Weekly policy remains in CI', () => {
    expect(read('.github/workflows/news-ci.yml')).not.toMatch(/One-time|fix\/weekly-policy-strict-10x6/);
  });

  it('workflows run the generator once and never patch source files at runtime', () => {
    for (const workflow of ['.github/workflows/publish-weekly-oversize.yml', '.github/workflows/watchdog-weekly-oversize.yml']) {
      const yaml = read(workflow);
      expect(yaml, workflow).toMatch(/node scripts\/generate-weekly-article\.mjs/);
      expect(yaml, workflow).not.toMatch(/run-weekly-publisher|apply-weekly-editorial-policy/);
    }
  });

  it('the canonical spec defines counts as capacities, not minimums', () => {
    const spec = read('docs/DAJC_WEEKLY_INTELLIGENCE_SPEC.md');
    expect(spec).toMatch(/QUALITY > COUNT/);
    expect(spec).not.toMatch(/Minimum: 20|Minimum: 10|minimum 10 concise reports from minimum 6 jurisdictions/i);
  });
});

describe('Driving Bans isolation', () => {
  it('no Weekly pipeline file imports the DAJC Driving Bans calendar', () => {
    for (const file of WEEKLY_FILES) {
      expect(read(file), file).not.toMatch(/driving-ban-calendars|resolveDrivingBanFindings/);
    }
    expect(existsSync(path.join(ROOT, 'scripts', 'lib', 'driving-ban-calendar.mjs'))).toBe(false);
  });
});
