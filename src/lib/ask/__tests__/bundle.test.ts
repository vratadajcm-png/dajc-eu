// No key in the client bundle, no use of the article pipeline's keys, and
// read-only access to data/. Static checks over the source; the built
// output is checked by scripts/check-ask-bundle.mjs in Application CI.

import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { scanClientOutput } from '../../../../scripts/check-ask-bundle.mjs';

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const ASK_DIR = join(ROOT, 'src/lib/ask');

function filesUnder(dir: string, filter = (name: string) => /\.(ts|mjs|astro)$/.test(name)): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === '__tests__' ? [] : filesUnder(path, filter);
    return filter(entry.name) ? [path] : [];
  });
}

const askSources = filesUnder(ASK_DIR);
const askRoutes = [...filesUnder(join(ROOT, 'src/pages/api/ask')), join(ROOT, 'src/pages/intelligence/ask.astro')];

describe('no key in the client bundle', () => {
  const clientFiles = filesUnder(join(ASK_DIR, 'client'));

  it('the browser scripts import only each other and read no environment', () => {
    expect(clientFiles.map((f) => f.split('/').pop()).sort()).toEqual(['account-panel.ts', 'ask-form.ts']);
    for (const file of clientFiles) {
      const client = readFileSync(file, 'utf8');
      // Only sibling browser modules - never server code, config or a provider client.
      for (const match of client.matchAll(/^\s*import\s+(?!type\b)[^;]*from\s+'([^']+)'/gm)) expect(match[1], file).toMatch(/^\.\/[a-z-]+$/);
      expect(client, file).not.toMatch(/process\.env|import\.meta\.env/);
      expect(client, file).not.toMatch(/DAJC_ASK_|DAJC_AI_|api\.openai\.com|api\.anthropic\.com|api\.perplexity\.ai|api\.stripe\.com|Bearer|x-api-key|innerHTML|outerHTML|insertAdjacentHTML|eval\(/);
    }
  });

  it('the page ships only the browser scripts to the client', () => {
    const page = readFileSync(join(ROOT, 'src/pages/intelligence/ask.astro'), 'utf8');
    const script = page.match(/<script>([\s\S]*?)<\/script>/)?.[1] || '';
    expect(script.match(/import .* from '([^']+)'/g)).toEqual([
      "import { initAskForm } from '../../lib/ask/client/ask-form'",
      "import { initAccountPanel } from '../../lib/ask/client/account-panel'",
    ]);
    // data-strings carries only interface texts.
    expect(page).toMatch(/data-strings=\{JSON\.stringify\(strings\)\}/);
    expect(page).toMatch(/const strings = dictionary\(lang\)/);
  });

  it('no Ask variable is ever exposed with the PUBLIC_ prefix', () => {
    for (const file of [...askSources, ...askRoutes, join(ROOT, '.env.example'), join(ROOT, 'astro.config.mjs')]) {
      expect(readFileSync(file, 'utf8'), file).not.toMatch(/PUBLIC_DAJC_ASK|import\.meta\.env\.DAJC_ASK/);
    }
  });

  it('the build scanner finds a leaked marker or secret value and passes clean output', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ask-bundle-'));
    mkdirSync(join(dir, '_astro'));
    writeFileSync(join(dir, '_astro', 'clean.js'), 'fetch("/api/ask/query")');
    writeFileSync(join(dir, 'index.html'), '<html>DAJC</html>');
    expect(scanClientOutput(dir).findings).toEqual([]);
    writeFileSync(join(dir, '_astro', 'leak.js'), 'const k="sk-test-secret-value-123";fetch("https://api.openai.com/v1/responses")');
    const { findings } = scanClientOutput(dir, { secretValues: ['sk-test-secret-value-123'] });
    expect(findings.map((f) => f.marker).sort()).toEqual(['<secret value from the environment>', 'api.openai.com']);
  });
});

describe('separation from the weekly article pipeline', () => {
  it('never reads the pipeline keys', () => {
    for (const file of askSources) {
      expect(readFileSync(file, 'utf8'), file).not.toMatch(/process\.env\.(?:ANTHROPIC_API_KEY|PERPLEXITY_API_KEY|OPENAI_API_KEY|CLAUDE_\w+)/);
    }
  });

  it('does not call the pipeline search function (it defaults to the pipeline keys)', () => {
    for (const file of askSources) {
      expect(readFileSync(file, 'utf8'), file).not.toMatch(/searchWithPerplexitySearch|discoverWithWebSearch|article-writer/);
    }
  });

  it('only reads data/ - no writes and no pipeline store', () => {
    for (const file of [...askSources, ...askRoutes]) {
      const text = readFileSync(file, 'utf8');
      expect(text, file).not.toMatch(/writeFile|appendFile|mkdir|rmSync|unlink|scripts\/lib\/store\.mjs|saveWeekFindings/);
      expect(text, file).not.toMatch(/from 'node:fs'|from 'fs'/);
    }
  });

  it('model names come from the environment only', () => {
    for (const file of askSources) {
      expect(readFileSync(file, 'utf8'), file).not.toMatch(/['"](?:gpt-[\w.-]+|claude-(?:opus|sonnet|haiku|fable)[\w.-]*|sonar[\w-]*)['"]/);
    }
  });
});
