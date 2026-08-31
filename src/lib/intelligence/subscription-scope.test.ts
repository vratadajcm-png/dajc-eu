import { describe, expect, it } from 'vitest';
import { intelligencePreferenceSchema } from './preferences';
import {
  InMemoryIntelligencePreferenceStore,
  intelligenceSubjectKey,
} from './subscription-scope';

const defaults = intelligencePreferenceSchema.parse({ jurisdictions: ['DE'] });

describe('DAJC Intelligence preference tenant/user scope', () => {
  it('uses organization and user together as the preference identity', () => {
    expect(intelligenceSubjectKey({ organizationId: 'org-a', userId: 'user-1' }))
      .toBe('org-a:user-1');
  });

  it('keeps two users in the same organization isolated', async () => {
    const store = new InMemoryIntelligencePreferenceStore();
    await store.write({
      subject: { organizationId: 'org-a', userId: 'user-1' },
      preferences: defaults,
      expectedRevision: null,
      updatedAt: '2026-08-31T13:00:00.000Z',
    });
    expect(await store.read({ organizationId: 'org-a', userId: 'user-2' })).toBeNull();
  });

  it('keeps the same user identifier isolated between organizations', async () => {
    const store = new InMemoryIntelligencePreferenceStore();
    await store.write({
      subject: { organizationId: 'org-a', userId: 'user-1' },
      preferences: defaults,
      expectedRevision: null,
      updatedAt: '2026-08-31T13:00:00.000Z',
    });
    expect(await store.read({ organizationId: 'org-b', userId: 'user-1' })).toBeNull();
  });

  it('requires optimistic revision match before an update', async () => {
    const store = new InMemoryIntelligencePreferenceStore();
    const created = await store.write({
      subject: { organizationId: 'org-a', userId: 'user-1' },
      preferences: defaults,
      expectedRevision: null,
      updatedAt: '2026-08-31T13:00:00.000Z',
    });
    expect(created.revision).toBe(0);

    await expect(store.write({
      subject: created.subject,
      preferences: intelligencePreferenceSchema.parse({ jurisdictions: ['FR'] }),
      expectedRevision: 99,
      updatedAt: '2026-08-31T14:00:00.000Z',
    })).rejects.toThrow('revision conflict');

    const updated = await store.write({
      subject: created.subject,
      preferences: intelligencePreferenceSchema.parse({ jurisdictions: ['FR'] }),
      expectedRevision: created.revision,
      updatedAt: '2026-08-31T14:00:00.000Z',
    });
    expect(updated.revision).toBe(1);
    expect(updated.preferences.jurisdictions).toEqual(['FR']);
  });
});
