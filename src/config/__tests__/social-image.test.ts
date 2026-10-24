import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SOCIAL_IMAGES, socialImageForNews } from '../social-image';

function pngSize(path: string) {
  const png = readFileSync(path);
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

describe('social preview images', () => {
  it('point at committed 1200x630 PNGs that match the declared size', () => {
    for (const image of Object.values(SOCIAL_IMAGES)) {
      const file = new URL(image.url).pathname.replace(/^\//, 'public/');
      expect(existsSync(file)).toBe(true);
      expect(pngSize(file)).toEqual({ width: image.width, height: image.height });
      expect(image.alt.length).toBeGreaterThan(10);
    }
  });

  it('gives EU Oversize Weekly its own image and other news the news image', () => {
    expect(socialImageForNews('EU Oversize Weekly')).toBe('weekly');
    expect(socialImageForNews('DAJC Platform Updates')).toBe('news');
    expect(socialImageForNews('Driving Bans Reference')).toBe('news');
  });
});
