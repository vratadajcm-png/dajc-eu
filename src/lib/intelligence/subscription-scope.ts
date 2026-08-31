import { z } from 'zod';
import {
  intelligencePreferenceSchema,
  type IntelligencePreferences,
} from './preferences';

export const intelligenceSubjectSchema = z.object({
  organizationId: z.string().min(1).max(120),
  userId: z.string().min(1).max(120),
});

export type IntelligenceSubject = z.infer<typeof intelligenceSubjectSchema>;

export const scopedIntelligencePreferencesSchema = z.object({
  subject: intelligenceSubjectSchema,
  preferences: intelligencePreferenceSchema,
  revision: z.number().int().nonnegative(),
  updatedAt: z.string().datetime(),
});

export type ScopedIntelligencePreferences = z.infer<typeof scopedIntelligencePreferencesSchema>;

export interface IntelligencePreferenceStore {
  read(subject: IntelligenceSubject): Promise<ScopedIntelligencePreferences | null>;
  write(args: {
    subject: IntelligenceSubject;
    preferences: IntelligencePreferences;
    expectedRevision: number | null;
    updatedAt: string;
  }): Promise<ScopedIntelligencePreferences>;
}

export function intelligenceSubjectKey(subject: IntelligenceSubject): string {
  const parsed = intelligenceSubjectSchema.parse(subject);
  return `${parsed.organizationId}:${parsed.userId}`;
}

/**
 * Demo/test-only implementation. It models optimistic revision control so a future
 * DB adapter cannot silently overwrite concurrent preference changes.
 */
export class InMemoryIntelligencePreferenceStore implements IntelligencePreferenceStore {
  private values = new Map<string, ScopedIntelligencePreferences>();

  async read(subject: IntelligenceSubject): Promise<ScopedIntelligencePreferences | null> {
    const value = this.values.get(intelligenceSubjectKey(subject));
    return value ? structuredClone(value) : null;
  }

  async write(args: {
    subject: IntelligenceSubject;
    preferences: IntelligencePreferences;
    expectedRevision: number | null;
    updatedAt: string;
  }): Promise<ScopedIntelligencePreferences> {
    const subject = intelligenceSubjectSchema.parse(args.subject);
    const preferences = intelligencePreferenceSchema.parse(args.preferences);
    const updatedAt = z.string().datetime().parse(args.updatedAt);
    const key = intelligenceSubjectKey(subject);
    const current = this.values.get(key);

    if (current) {
      if (args.expectedRevision === null || args.expectedRevision !== current.revision) {
        throw new Error('Intelligence preference revision conflict');
      }
    } else if (args.expectedRevision !== null) {
      throw new Error('Intelligence preference revision conflict');
    }

    const next = scopedIntelligencePreferencesSchema.parse({
      subject,
      preferences,
      revision: (current?.revision ?? -1) + 1,
      updatedAt,
    });
    this.values.set(key, structuredClone(next));
    return structuredClone(next);
  }
}
