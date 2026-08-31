import { z } from 'zod';

/**
 * M1 account-ready preference model.
 * This module intentionally has no persistence, authentication or billing dependency.
 * It defines the client/server contract that a future authenticated DAJC Intelligence
 * preference store can implement without changing the public Driving Bans feed.
 */
export const intelligencePreferenceSchema = z.object({
  jurisdictions: z.array(z.string().min(2).max(16)).max(100).default([]),
  corridors: z.array(z.object({
    id: z.string().min(1).max(80),
    label: z.string().min(1).max(120),
    jurisdictions: z.array(z.string().min(2).max(16)).min(1).max(30),
  })).max(30).default([]),
  vehicleProfile: z.object({
    grossWeightKg: z.number().int().positive().max(250_000).optional(),
    widthMm: z.number().int().positive().max(20_000).optional(),
    heightMm: z.number().int().positive().max(20_000).optional(),
    lengthMm: z.number().int().positive().max(100_000).optional(),
    axleCount: z.number().int().positive().max(40).optional(),
    adr: z.boolean().default(false),
    exceptionalTransport: z.boolean().default(false),
  }).default({ adr: false, exceptionalTransport: false }),
  alertTopics: z.array(z.enum([
    'driving-ban',
    'permit',
    'route-restriction',
    'border',
    'escort',
    'weather',
    'regulatory',
  ])).default(['driving-ban']),
  alertMode: z.enum(['off', 'material-only', 'all-relevant']).default('material-only'),
});

export type IntelligencePreferences = z.infer<typeof intelligencePreferenceSchema>;

export const intelligenceChangeSchema = z.object({
  id: z.string(),
  jurisdiction: z.string(),
  topic: z.enum([
    'driving-ban',
    'permit',
    'route-restriction',
    'border',
    'escort',
    'weather',
    'regulatory',
  ]),
  changeType: z.enum(['added', 'changed', 'extended', 'cancelled', 'newly-relevant']),
  materiality: z.enum(['low', 'medium', 'high', 'critical']),
  effectiveFrom: z.string().datetime().optional(),
  effectiveTo: z.string().datetime().optional(),
  sourceUrl: z.string().url().optional(),
  sourceLabel: z.string().optional(),
  observedAt: z.string().datetime(),
  summary: z.string(),
});

export type IntelligenceChange = z.infer<typeof intelligenceChangeSchema>;

export function isRelevantChange(
  change: IntelligenceChange,
  preferences: IntelligencePreferences,
): boolean {
  if (preferences.alertMode === 'off') return false;
  if (!preferences.alertTopics.includes(change.topic)) return false;

  const jurisdictionMatch =
    preferences.jurisdictions.length === 0 ||
    preferences.jurisdictions.includes(change.jurisdiction) ||
    preferences.corridors.some((corridor) => corridor.jurisdictions.includes(change.jurisdiction));

  if (!jurisdictionMatch) return false;
  if (preferences.alertMode === 'material-only') {
    return change.materiality === 'high' || change.materiality === 'critical';
  }
  return true;
}
