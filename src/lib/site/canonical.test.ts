import { describe, expect, it } from 'vitest';
import { canonicalPathname, canonicalSiteUrl } from './canonical';

describe('canonical public URLs', () => {
  it('preserves root while removing duplicate trailing slashes', () => {
    expect(canonicalPathname('/')).toBe('/');
    expect(canonicalPathname('/platform/')).toBe('/platform');
    expect(canonicalPathname('/news/eu-oversize/weekly///')).toBe('/news/eu-oversize/weekly');
  });
  it('does not change distinct paths or create a new host', () => {
    expect(canonicalSiteUrl('/platform/integrations/')).toBe('https://www.dajc.eu/platform/integrations');
    expect(canonicalSiteUrl('/')).toBe('https://www.dajc.eu/');
    expect(() => canonicalPathname('https://wrong.example')).toThrow();
  });
});
