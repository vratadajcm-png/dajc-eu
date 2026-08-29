import { describe, expect, it } from 'vitest';
import { formatNextPublicationLabel } from '../next-publication.mjs';

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
