// Evidence-first text extraction for official PDFs in the Weekly pipeline.
// Convert only a real, bounded PDF response; never substitute AI/HTML summaries.
// No shell, network, upload or persistent files are involved.
import { execFileSync } from 'node:child_process';

export const MAX_PDF_SOURCE_BYTES = 8 * 1024 * 1024;
export const MAX_PDF_SOURCE_TEXT = 32 * 1024;

export function extractPdfSourceText(input, { run = execFileSync } = {}) {
  const bytes = Buffer.isBuffer(input) ? input : Buffer.from(input || []);
  if (bytes.byteLength < 100 || bytes.byteLength > MAX_PDF_SOURCE_BYTES ||
      bytes.subarray(0, 5).toString('ascii') !== '%PDF-') {
    throw new Error('PDF source rejected: invalid signature or size');
  }
  let extracted;
  try {
    extracted = run('pdftotext', ['-f', '1', '-l', '10', '-enc', 'UTF-8', '-nopgbrk', '-', '-'], {
      input: bytes, encoding: 'utf8', timeout: 15_000,
      maxBuffer: MAX_PDF_SOURCE_TEXT * 2,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch {
    throw new Error('PDF source unreadable: pdftotext is unavailable or extraction failed');
  }
  const clean = String(extracted || '').replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ').trim();
  if (clean.length < 120) throw new Error('PDF source unreadable: insufficient searchable text');
  return clean.slice(0, MAX_PDF_SOURCE_TEXT);
}
