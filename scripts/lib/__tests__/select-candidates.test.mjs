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

  it('reserves a same-week critical item even after its status becomes active', () => {
    const critical = finding({
      status: 'active',
      firstSeenAt: '2026-08-27T08:00:00Z',
      title: 'Nationwide private exceptional-transport escort rules',
      summary: 'A new rule changes private escorts for exceptional transports.',
      sourceUrl: 'https://example.test/critical-active',
    });
    const noise = Array.from({ length: 40 }, (_, i) =>
      finding({
        type: 'bridge_restriction',
        title: `Current bridge report ${i}`,
        summary: 'Current 2026 freight infrastructure information.',
        sourceName: `Noise ${i}`,
        sourceUrl: `https://example.test/noise-${i}`,
      })
    );
    const selected = selectCandidates([...noise, critical], {
      discoveryWindowStart: new Date('2026-08-24T00:00:00Z'),
    });
    expect(selected.some((item) => item.sourceUrl === critical.sourceUrl)).toBe(true);
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
