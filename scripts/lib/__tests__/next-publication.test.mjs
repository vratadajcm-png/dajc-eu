import { describe, expect, it } from 'vitest';
import {
  formatNextPublicationLabel,
  pragueNoon,
  publicationSlotFor,
  targetWeekDateFor,
} from '../next-publication.mjs';
import { isoWeekLabel } from '../week.mjs';

describe('formatNextPublicationLabel', () => {
  it('is 7 days ahead, at noon, with the correct summer timezone abbreviation', () => {
    const label = formatNextPublicationLabel(new Date('2026-08-21T10:25:00Z'));
    expect(label).toBe('Friday, 28 August 2026 at 12:00 CEST');
  });

  it('maps a Saturday catch-up to the following Friday', () => {
    const label = formatNextPublicationLabel(new Date('2026-08-29T06:48:00Z'));
    expect(label).toBe('Friday, 4 September 2026 at 12:00 CEST');
  });

  it('uses CET in winter', () => {
    const label = formatNextPublicationLabel(new Date('2026-01-16T10:25:00Z'));
    expect(label).toBe('Friday, 23 January 2026 at 12:00 CET');
  });
});

describe('pragueNoon', () => {
  it('is 10:00 UTC in summer (CEST) and 11:00 UTC in winter (CET)', () => {
    expect(pragueNoon(2026, 9, 25).toISOString()).toBe('2026-09-25T10:00:00.000Z');
    expect(pragueNoon(2026, 11, 6).toISOString()).toBe('2026-11-06T11:00:00.000Z');
  });
});

describe('publicationSlotFor', () => {
  it('maps a Thursday preparation run to the next day at 12:00 Prague', () => {
    expect(publicationSlotFor(new Date('2026-09-24T03:17:00Z')).toISOString()).toBe('2026-09-25T10:00:00.000Z');
  });

  it('keeps a delayed Thursday-evening run on the same Friday', () => {
    expect(publicationSlotFor(new Date('2026-09-24T21:50:00Z')).toISOString()).toBe('2026-09-25T10:00:00.000Z');
  });

  it('maps Friday and Saturday catch-up runs to that Friday (already in the past)', () => {
    expect(publicationSlotFor(new Date('2026-09-25T14:02:00Z')).toISOString()).toBe('2026-09-25T10:00:00.000Z');
    expect(publicationSlotFor(new Date('2026-09-26T06:17:00Z')).toISOString()).toBe('2026-09-25T10:00:00.000Z');
  });

  it('uses the Prague calendar day, not the UTC one', () => {
    // Sunday 22:30 UTC is already Monday 00:30 in Prague -> the coming Friday.
    expect(publicationSlotFor(new Date('2026-09-27T22:30:00Z')).toISOString()).toBe('2026-10-02T10:00:00.000Z');
  });

  it('uses CET after the October DST change', () => {
    expect(publicationSlotFor(new Date('2026-11-05T03:17:00Z')).toISOString()).toBe('2026-11-06T11:00:00.000Z');
  });
});

describe('targetWeekDateFor', () => {
  it('targets the ISO week after the publication Friday', () => {
    expect(isoWeekLabel(targetWeekDateFor(new Date('2026-09-18T10:00:00Z')))).toBe('2026-W39');
  });
});
