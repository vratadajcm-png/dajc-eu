import { describe, expect, it } from 'vitest';
import { isNewsEntryPublic } from '../news';

describe('isNewsEntryPublic', () => {
  const friday = new Date('2026-09-25T10:00:00.000Z'); // 12:00 CEST

  it('hides a prepared article until its Friday 12:00 slot', () => {
    const data = { status: 'published' as const, publishedAt: friday };
    expect(isNewsEntryPublic(data, new Date('2026-09-24T15:00:00Z'))).toBe(false);
    expect(isNewsEntryPublic(data, new Date('2026-09-25T09:59:59Z'))).toBe(false);
    expect(isNewsEntryPublic(data, friday)).toBe(true);
    expect(isNewsEntryPublic(data, new Date('2026-09-25T10:01:00Z'))).toBe(true);
  });

  it('keeps date-only legacy articles public', () => {
    const data = { status: 'published' as const, publishedAt: new Date('2026-09-18') };
    expect(isNewsEntryPublic(data, new Date('2026-09-18T10:00:00Z'))).toBe(true);
  });

  it('never shows drafts', () => {
    const data = { status: 'draft' as const, publishedAt: new Date('2026-01-01') };
    expect(isNewsEntryPublic(data, friday)).toBe(false);
  });
});
