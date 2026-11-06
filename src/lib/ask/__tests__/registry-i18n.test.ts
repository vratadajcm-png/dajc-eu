// Czech wording of the shared Driving Bans contract's fixed texts. The guard
// test reads the contract's sources: a new warning, disclaimer or next step
// without a Czech template fails here instead of reaching Czech users in
// English unnoticed.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AI_DISCLAIMER } from '../../intelligence/driving-bans-ai-contract';
import { evaluateDrivingBansQuery, QUERY_DISCLAIMER, readPublishedView } from '../../intelligence/driving-bans-query';
import { localizeRegistryAnswer, registryTextCs } from '../paid/registry-i18n';

const SOURCES = [
  'src/lib/intelligence/driving-bans-query.ts',
  'src/lib/intelligence/driving-bans-relevance.ts',
  'src/lib/intelligence/driving-bans-ai-contract.ts',
  'src/lib/intelligence/driving-bans-adapter.ts',
];

const SAMPLE: Array<[RegExp, string]> = [
  [/jurisdiction|^code$/, 'CZ'],
  [/^input\.at$/, '2026-11-01T10:00:00.000Z'],
  [/^view\.window\.from$/, '2026-01-01'],
  [/^view\.window\.to$/, '2026-12-31'],
  [/^input\.ban_id$/, 'cz-sunday-ban'],
  [/^dajcCoverageCount$/, '27'],
  [/^tool$/, 'check_route'],
];

/** User-facing sentences of the contract with sample values for their placeholders. */
function contractTexts(): Array<{ file: string; text: string }> {
  const out: Array<{ file: string; text: string }> = [];
  for (const file of SOURCES) {
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(/'([^'\n]{30,})'|`([^`\n]{30,})`/g)) {
      const raw = match[1] ?? match[2];
      if (!raw.endsWith('.') || !raw.includes(' ')) continue;
      const text = raw.replace(/\$\{([^}]+)\}/g, (_, expr: string) => {
        const sample = SAMPLE.find(([pattern]) => pattern.test(expr.trim()));
        if (!sample) throw new Error(`${file}: no sample value for \${${expr}} in "${raw}" - add one to SAMPLE and a Czech template`);
        return sample[1];
      });
      out.push({ file, text });
    }
  }
  return out;
}

describe('Czech wording of the Driving Bans registry texts', () => {
  it('has a template for every fixed text of the shared contract (drift guard)', () => {
    const texts = contractTexts();
    expect(texts.length).toBeGreaterThanOrEqual(20);
    // Route gap reasons reach users prefixed with their segment.
    const missing = texts.filter(({ text }) => registryTextCs(text) === null && registryTextCs(`Segment 2 (CZ): ${text}`) === null);
    expect(missing).toEqual([]);
  });

  it('translates with the same facts and leaves unknown texts in English', () => {
    expect(registryTextCs('DE: insufficient verified data for this period; this is not evidence that there is no ban.'))
      .toBe('DE: pro toto období není k dispozici dost ověřených údajů; neznamená to, že zákaz neplatí.');
    expect(registryTextCs('Segment 3 (AT): Segment time is outside the published window 2026-01-01-2026-12-31.'))
      .toBe('Úsek 3 (AT): čas úseku je mimo zveřejněné období 2026-01-01 až 2026-12-31.');
    expect(registryTextCs(AI_DISCLAIMER)).toMatch(/^DAJC AI vysvětluje/);
    expect(registryTextCs(QUERY_DISCLAIMER)).toMatch(/^DAJC uvádí/);
    expect(registryTextCs('A brand new warning nobody translated.')).toBeNull();
    // A changed sentence must not be half-matched.
    expect(registryTextCs('DE: insufficient verified data for this period.')).toBeNull();
  });

  it('localizes a real registry answer for Czech and leaves English untouched', () => {
    const view = readPublishedView(new Date('2026-11-05T10:00:00Z'));
    const from = view.window.from;
    const answer = evaluateDrivingBansQuery({ tool: 'search_bans', input: { jurisdictions: ['CZ', 'DE', 'AT', 'PL', 'SK', 'HU'], from: `${from}T00:00:00.000Z`, to: `${from}T23:00:00.000Z` }, view, disclaimer: AI_DISCLAIMER });
    expect(answer.warnings.length).toBeGreaterThan(0);
    expect(localizeRegistryAnswer(answer, 'en')).toBe(answer);
    const cs = localizeRegistryAnswer(answer, 'cs');
    expect(cs.disclaimer).toMatch(/^DAJC AI vysvětluje/);
    expect(cs.warnings).toHaveLength(answer.warnings.length);
    for (const [i, warning] of cs.warnings.entries()) expect(warning, answer.warnings[i]).not.toBe(answer.warnings[i]);
    // Facts, sources and outcomes are never rewritten.
    expect(cs.facts).toBe(answer.facts);
    expect(cs.completeness).toBe(answer.completeness);
    expect(cs.status).toBe(answer.status);
  });
});
