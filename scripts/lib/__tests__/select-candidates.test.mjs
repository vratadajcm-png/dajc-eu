import { describe, expect, it } from 'vitest';
import { dedupeNearDuplicates, selectCandidates } from '../select-candidates.mjs';

const now = new Date('2026-10-01T10:00:00Z');
const ctx = { now, weekStart: new Date('2026-10-05T00:00:00Z'), weekEnd: new Date('2026-10-11T00:00:00Z'), previousEditions: new Map() };

function finding(n, overrides = {}) {
  return {
    country: 'Spain',
    type: 'permit_change',
    title: `Exceptional transport permit portal update ref${n}`,
    summary: 'New online permit procedure for exceptional transport movements.',
    sourceUrl: `https://authority.example/news/item-${n}`,
    sourceName: `Authority ${n}`,
    publishedAt: '2026-09-29',
    status: 'active',
    lastCheckedAt: '2026-10-01T06:00:00Z',
    ...overrides,
  };
}

describe('selectCandidates', () => {
  it('returns only eligible findings and explains every exclusion', () => {
    const { selected, rejected } = selectCandidates([
      finding(1),
      finding(2, { publishedAt: '2026-05-06' }),
      finding(3, { publishedAt: null }),
      finding(4, { status: 'expired' }),
    ], ctx);
    expect(selected.map((f) => f.sourceUrl)).toEqual([finding(1).sourceUrl]);
    expect(rejected.map((r) => r.reason)).toEqual([
      expect.stringMatching(/older than the 14-day freshness window/),
      expect.stringMatching(/undated material/),
      'status expired',
    ]);
  });

  it('ranks Central Europe first among comparable eligible items', () => {
    const { selected } = selectCandidates([finding(1, { country: 'Spain' }), finding(2, { country: 'Czechia' })], ctx);
    expect(selected[0].country).toBe('Czechia');
  });

  it('keeps one record per URL', () => {
    const older = finding(1, { lastCheckedAt: '2026-09-29T06:00:00Z', title: 'Old wording of exceptional transport permit item' });
    const { selected } = selectCandidates([older, finding(1)], ctx);
    expect(selected).toHaveLength(1);
    expect(selected[0].title).toBe(finding(1).title);
  });
});

describe('dedupeNearDuplicates', () => {
  it('collapses pages of one development (contained title wording)', () => {
    const a = finding(1, { country: 'Norway', title: 'Batteridrevne hjullastere imponerer i tunnel', publishedAt: '2026-09-29' });
    const b = finding(2, { country: 'Norway', title: 'Batteridrevne hjullastere', publishedAt: '2026-09-30' });
    expect(dedupeNearDuplicates([a, b])).toEqual([b]);
  });

  it('keeps different restrictions on one road apart', () => {
    const a = finding(1, { country: 'Germany', title: 'A3: Vollsperrung zwischen Kreuz Köln-Ost und Dreieck Heumar für Lkw' });
    const b = finding(2, { country: 'Germany', title: 'A3: Vollsperrung zwischen Kreuz Köln-Ost und Kreuz Leverkusen für Lkw' });
    expect(dedupeNearDuplicates([a, b])).toHaveLength(2);
  });
});
