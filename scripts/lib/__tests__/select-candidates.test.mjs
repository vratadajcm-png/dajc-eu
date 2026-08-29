import { describe, expect, it } from 'vitest';
import { selectCandidates } from '../select-candidates.mjs';

function finding(overrides = {}) {
  return {
    country: 'Switzerland',
    type: 'escort_requirement',
    title: 'Current operational item',
    summary: '19 August 2026 current operational transport change.',
    status: 'new',
    sourceName: 'Official source',
    sourceUrl: 'https://example.test/current',
    ...overrides,
  };
}

describe('selectCandidates', () => {
  it('drops stale stored findings before they consume per-source slots', () => {
    const stale = Array.from({ length: 6 }, (_, i) =>
      finding({
        title: `Archived restriction ${i}`,
        summary: `Restriction published in 2024 for route A${i}.`,
        sourceUrl: `https://example.test/stale-${i}`,
      })
    );
    const current = finding({
      title: 'Nationwide private exceptional-transport escort consultation',
      summary: '19 August 2026: proposed nationwide rules for private exceptional-transport escorts.',
      sourceUrl: 'https://example.test/escort-2026',
    });

    const selected = selectCandidates([...stale, current]);
    expect(selected.some((x) => x.sourceUrl === current.sourceUrl)).toBe(true);
    expect(selected.some((x) => /stale/.test(x.sourceUrl))).toBe(false);
  });

  it('prioritises exceptional-transport and escort changes', () => {
    const generic = finding({
      type: 'infrastructure',
      title: 'Current infrastructure report',
      summary: 'A general 2026 infrastructure report for freight.',
      sourceName: 'Source A',
      sourceUrl: 'https://example.test/generic',
    });
    const escort = finding({
      title: 'Private exceptional-transport escort rules',
      summary: 'New 2026 rules proposed for exceptional-transport escort operations.',
      sourceName: 'Source B',
      sourceUrl: 'https://example.test/escort',
    });

    const selected = selectCandidates([generic, escort]);
    expect(selected[0].sourceUrl).toBe(escort.sourceUrl);
  });
});
