import { describe, expect, it } from 'vitest';
import {
  appendHistory,
  detectIntelligenceChanges,
  fingerprintSnapshotItem,
  type IntelligenceSnapshotItem,
} from './change-detection';

const observedAt = '2026-08-31T13:00:00.000Z';
const base: IntelligenceSnapshotItem = {
  key: 'DE:weekend:2026-09-05',
  jurisdiction: 'DE',
  topic: 'driving-ban',
  materiality: 'high',
  effectiveFrom: '2026-09-05T07:00:00.000Z',
  effectiveTo: '2026-09-05T20:00:00.000Z',
  sourceUrl: 'https://example.com/de-ban',
  sourceLabel: 'Authority source',
  summary: 'German HGV restriction window.',
  payload: { routeScope: ['A1', 'A2'], thresholdKg: 7500 },
};

describe('DAJC Intelligence change detection', () => {
  it('does not create history for identical snapshots', () => {
    expect(detectIntelligenceChanges({ previous: [base], current: [base], observedAt })).toEqual([]);
  });

  it('detects a new restriction', () => {
    const history = detectIntelligenceChanges({ previous: [], current: [base], observedAt });
    expect(history).toHaveLength(1);
    expect(history[0].change.changeType).toBe('added');
  });

  it('detects a material content change', () => {
    const current = { ...base, summary: 'German HGV restriction window changed.' };
    const history = detectIntelligenceChanges({ previous: [base], current: [current], observedAt });
    expect(history[0].change.changeType).toBe('changed');
    expect(history[0].previousFingerprint).not.toBe(history[0].currentFingerprint);
  });

  it('classifies a later effective end as extended', () => {
    const current = { ...base, effectiveTo: '2026-09-05T22:00:00.000Z' };
    const history = detectIntelligenceChanges({ previous: [base], current: [current], observedAt });
    expect(history[0].change.changeType).toBe('extended');
  });

  it('suppresses cancellations when the current snapshot is not confirmed complete', () => {
    const history = detectIntelligenceChanges({ previous: [base], current: [], observedAt });
    expect(history).toEqual([]);
  });

  it('detects disappearance as cancelled only for a confirmed complete snapshot', () => {
    const history = detectIntelligenceChanges({
      previous: [base],
      current: [],
      observedAt,
      currentSnapshotComplete: true,
    });
    expect(history[0].change.changeType).toBe('cancelled');
    expect(history[0].currentFingerprint).toBeUndefined();
  });

  it('fingerprints payload objects deterministically regardless of key order', () => {
    const a = { ...base, payload: { b: 2, a: { d: 4, c: 3 } } };
    const b = { ...base, payload: { a: { c: 3, d: 4 }, b: 2 } };
    expect(fingerprintSnapshotItem(a)).toBe(fingerprintSnapshotItem(b));
  });

  it('appends history without rewriting or duplicating existing events', () => {
    const detected = detectIntelligenceChanges({ previous: [], current: [base], observedAt });
    const once = appendHistory([], detected);
    const twice = appendHistory(once, detected);
    expect(twice).toEqual(once);
    expect(twice).toHaveLength(1);
  });
});
