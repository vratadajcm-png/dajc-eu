import { describe, expect, it } from 'vitest';
import { looksBinary, readableText } from '../text-quality.mjs';

describe('looksBinary', () => {
  it('detects a PDF read as text', () => {
    expect(looksBinary('%PDF-1.7 %�� 1 0 obj >/Metadata 58 0 R')).toBe(true);
  });
  it('detects replacement-character noise', () => {
    expect(looksBinary(`x��]Yo9~7���${'�'.repeat(20)} ${'a'.repeat(200)}`)).toBe(true);
  });
  it('keeps normal multilingual text', () => {
    const text = 'Slovenská správa ciest začala 14. septembra 2026 opravovať most nad železničnou traťou pri Zlatých Moravciach.';
    expect(looksBinary(text)).toBe(false);
    expect(readableText(text)).toBe(text);
  });
});
