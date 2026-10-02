import { describe, expect, it } from 'vitest';
import { buildFindingHistory, findingKey, mergeFindings } from '../findings.mjs';

const base = {
  country: 'Switzerland',
  region: null,
  location: 'ASTRA',
  type: 'escort_requirement',
  title: 'Bundesrat will schweizweite Vorgaben für private Ausnahmetransportbegleitungen',
  summary: 'Vernehmlassung bis 20. November 2026.',
  validFrom: null,
  validTo: null,
  impact: null,
  sourceUrl: 'https://www.astra.admin.ch/de/newnsb/lXxVvBz-pCb1SILobeHmP',
  sourceName: 'ASTRA - Medienmitteilungen',
  publishedAt: '2026-08-19',
  publishedAtSource: 'label',
};

describe('mergeFindings with cross-week discovery history', () => {
  // Regression: each ISO week starts an empty findings file, so every
  // evergreen page used to become "new" again every Monday.
  it('does not mark a page seen in an earlier week as new', () => {
    const history = buildFindingHistory([[{ ...base, firstSeenAt: '2026-08-24T06:00:00Z', status: 'active' }]]);
    const merged = mergeFindings(new Map(), [base], '2026-09-28T06:00:00Z', { history });
    const [finding] = [...merged.values()];
    expect(finding.status).toBe('active');
    expect(finding.firstSeenAt).toBe('2026-08-24T06:00:00Z');
  });

  it('marks a page never seen before as new', () => {
    const merged = mergeFindings(new Map(), [base], '2026-09-28T06:00:00Z', { history: new Map() });
    expect([...merged.values()][0].status).toBe('new');
  });

  it('retro-fixes this week\'s entries that history shows were seen earlier', () => {
    const existing = new Map([[findingKey(base), { ...base, status: 'new', firstSeenAt: '2026-09-28T06:00:00Z' }]]);
    const history = buildFindingHistory([[{ ...base, firstSeenAt: '2026-08-24T06:00:00Z' }]]);
    const merged = mergeFindings(existing, [], '2026-09-29T06:00:00Z', { history });
    const [finding] = [...merged.values()];
    expect(finding.status).toBe('active');
    expect(finding.firstSeenAt).toBe('2026-08-24T06:00:00Z');
  });

  it('keeps one record per URL when the classified type changes', () => {
    const existing = new Map([[findingKey({ ...base, type: 'bridge_restriction' }), { ...base, type: 'bridge_restriction', status: 'active', firstSeenAt: '2026-09-28T06:00:00Z' }]]);
    const merged = mergeFindings(existing, [base], '2026-09-29T06:00:00Z');
    expect(merged.size).toBe(1);
    expect([...merged.values()][0].type).toBe('escort_requirement');
  });

  it('keeps a known publication date when a later fetch cannot read it', () => {
    const existing = new Map([[findingKey(base), { ...base, status: 'active', firstSeenAt: '2026-09-28T06:00:00Z' }]]);
    const merged = mergeFindings(existing, [{ ...base, publishedAt: null, publishedAtSource: null }], '2026-09-29T06:00:00Z');
    expect([...merged.values()][0].publishedAt).toBe('2026-08-19');
  });
});
