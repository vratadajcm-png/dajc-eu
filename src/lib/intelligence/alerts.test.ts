import { describe, expect, it } from 'vitest';
import {
  buildAlertCandidates,
  hasImmediateChannel,
  removeDeliveredCandidates,
  type IntelligenceAlertRecipient,
} from './alerts';
import type { IntelligenceChange } from './preferences';

const change: IntelligenceChange = {
  id: 'DE:driving-ban:1',
  jurisdiction: 'DE',
  topic: 'driving-ban',
  changeType: 'changed',
  materiality: 'high',
  observedAt: '2026-08-31T13:00:00.000Z',
  summary: 'Restriction changed.',
};

const recipient: IntelligenceAlertRecipient = {
  id: 'recipient-1',
  organizationId: 'org-1',
  preferences: {
    jurisdictions: ['DE'],
    corridors: [],
    vehicleProfile: { adr: false, exceptionalTransport: false },
    alertTopics: ['driving-ban'],
    alertMode: 'material-only',
  },
  channels: ['in-app', 'email'],
};

describe('DAJC Intelligence alert pipeline', () => {
  it('creates one candidate for a relevant change', () => {
    const candidates = buildAlertCandidates({
      changes: [change],
      recipients: [recipient],
      createdAt: '2026-08-31T13:01:00.000Z',
    });
    expect(candidates).toHaveLength(1);
    expect(candidates[0].recipientId).toBe('recipient-1');
    expect(candidates[0].dedupeKey).toBe('recipient-1:DE:driving-ban:1');
  });

  it('does not create a candidate for an unrelated jurisdiction', () => {
    const candidates = buildAlertCandidates({
      changes: [change],
      recipients: [{
        ...recipient,
        preferences: { ...recipient.preferences, jurisdictions: ['FR'] },
      }],
      createdAt: '2026-08-31T13:01:00.000Z',
    });
    expect(candidates).toEqual([]);
  });

  it('filters already delivered candidates by dedupe key', () => {
    const candidates = buildAlertCandidates({
      changes: [change],
      recipients: [recipient],
      createdAt: '2026-08-31T13:01:00.000Z',
    });
    expect(removeDeliveredCandidates(candidates, [candidates[0].dedupeKey])).toEqual([]);
  });

  it('marks push and webhook recipients as immediate-channel capable', () => {
    expect(hasImmediateChannel({ ...recipient, channels: ['push'] })).toBe(true);
    expect(hasImmediateChannel({ ...recipient, channels: ['webhook'] })).toBe(true);
    expect(hasImmediateChannel(recipient)).toBe(false);
  });
});
