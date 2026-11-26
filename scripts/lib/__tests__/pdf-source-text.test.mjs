import { describe, expect, it, vi, afterEach } from 'vitest';
import { extractPdfSourceText, MAX_PDF_SOURCE_BYTES } from '../pdf-source-text.mjs';
import { extractDetailText, fetchTextWithRetry } from '../fetch-source.mjs';

const validPdfStub = Buffer.concat([Buffer.from('%PDF-1.4\n', 'ascii'), Buffer.alloc(256, 32)]);
const enough = 'Polish Ministry of Infrastructure official notice. Drivers with ADR tank certificates transporting LPG domestically in tank vehicles may drive up to 11 hours daily and 60 hours weekly. The 6 November to 6 December 2026 interval is explicit.';

afterEach(() => vi.unstubAllGlobals());

describe('bounded original PDF evidence (not model prose)', () => {
  it('invokes pdftotext without shell, receives a binary buffer and returns readable source text', () => {
    let invoked = false;
    const text = extractPdfSourceText(validPdfStub, { run: (exe, args, opts) => {
      invoked = true;
      expect(exe).toBe('pdftotext');
      expect(args).toContain('-nopgbrk');
      expect(opts.input.equals(validPdfStub)).toBe(true);
      expect(opts.shell).toBeUndefined();
      return enough;
    } });
    expect(invoked).toBe(true);
    expect(text).toContain('ADR tank certificates');
  });

  it('rejects malformed, oversized, unreadable or unavailable binaries (fail closed)', () => {
    expect(() => extractPdfSourceText(Buffer.from('not a pdf'), { run: () => enough })).toThrow(/invalid signature/);
    expect(() => extractPdfSourceText(Buffer.concat([Buffer.from('%PDF-1.4'), Buffer.alloc(MAX_PDF_SOURCE_BYTES)]), { run: () => enough })).toThrow(/size/);
    expect(() => extractPdfSourceText(validPdfStub, { run: () => { throw new Error('missing executable'); } })).toThrow(/unavailable/);
    expect(() => extractPdfSourceText(validPdfStub, { run: () => 'Unreadable' })).toThrow(/insufficient/);
  });

  it('keeps source excerpts longer for independent legal-claim reviews without changing monitor default', () => {
    const original = enough.repeat(16);
    expect(extractDetailText(original).length).toBe(1800);
    expect(extractDetailText(original, 8000).length).toBeGreaterThan(3000);
  });

  it('PDF fetch does not treat a broken PDF as a verified original page', async () => {
    vi.stubGlobal('fetch', async () => new Response(Buffer.from('not a PDF'), {
      status: 200, headers: { 'content-type': 'application/pdf' },
    }));
    const result = await fetchTextWithRetry('https://eli.gov.pl/api/acts/MP/2026/1107/text.pdf', '*/*');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/PDF source rejected/);
  });
});
