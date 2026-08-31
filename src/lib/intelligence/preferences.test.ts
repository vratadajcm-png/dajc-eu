import { describe, expect, it } from 'vitest';
import {
  intelligencePreferenceSchema,
  isRelevantChange,
  type IntelligenceChange,
} from './preferences';

const baseChange: IntelligenceChange = {
  id: 'change-1',
  jurisdiction: 'DE',
  topic: 'driving-ban',
  changeType: 'changed',
  materiality: 'high',
  observedAt: '2026-08-31T12:00:00.000Z',
  summary: 'Restriction window changed.',
};

describe('DAJC Intelligence preference model', () => {
  it('creates safe defaults', () => {
    const preferences = intelligencePreferenceSchema.parse({});
    expect(preferences.alertMode).toBe('material-only');
    expect(preferences.alertTopics).toEqual(['driving-ban']);
    expect(preferences.vehicleProfile.adr).toBe(false);
  });

  it('matches a selected jurisdiction', () => {
    const preferences = intelligencePreferenceSchema.parse({ jurisdictions: ['DE'] });
    expect(isRelevantChange(baseChange, preferences)).toBe(true);
  });

  it('matches a jurisdiction through a saved corridor', () => {
    const preferences = intelligencePreferenceSchema.parse({
      jurisdictions: ['CZ'],
      corridors: [{ id: 'cz-de', label: 'CZ → DE', jurisdictions: ['CZ', 'DE'] }],
    });
    expect(isRelevantChange(baseChange, preferences)).toBe(true);
  });

  it('rejects an unrelated jurisdiction', () => {
    const preferences = intelligencePreferenceSchema.parse({ jurisdictions: ['FR'] });
    expect(isRelevantChange(baseChange, preferences)).toBe(false);
  });

  it('rejects medium materiality in material-only mode', () => {
    const preferences = intelligencePreferenceSchema.parse({ jurisdictions: ['DE'] });
    expect(isRelevantChange({ ...baseChange, materiality: 'medium' }, preferences)).toBe(false);
  });

  it('allows medium materiality in all-relevant mode', () => {
    const preferences = intelligencePreferenceSchema.parse({
      jurisdictions: ['DE'],
      alertMode: 'all-relevant',
    });
    expect(isRelevantChange({ ...baseChange, materiality: 'medium' }, preferences)).toBe(true);
  });
});
