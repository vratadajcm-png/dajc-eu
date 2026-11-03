/**
 * Local text of an official PDF, page by page, so that every quote a model takes
 * from it can be found again by code (normalizeForQuote) on the page it names.
 * pdf.js runs without evaluating code or loading fonts; the document is data only.
 * A PDF without a usable text layer (a scan) yields null: its quotes cannot be
 * checked by code, so it stays with a person.
 */
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { normalizeForQuote } from './documents.mjs';

export const MAX_PDF_PAGES = 400;
/** Below this many characters of text the PDF counts as scanned (no text layer). */
export const MIN_PDF_TEXT_CHARS = 200;
const PAGE_MARKER = page => `[[DAJC PAGE ${page}]]`;

/** Text of each page, or null when the PDF cannot be parsed or has no text layer. */
export async function readPdfPages(bytes, { maxPages = MAX_PDF_PAGES } = {}) {
  let task = null;
  try {
    task = getDocument({ data: new Uint8Array(bytes), isEvalSupported: false, disableFontFace: true, useSystemFonts: false, stopAtErrors: false, verbosity: 0 });
    const pdf = await task.promise;
    if (pdf.numPages > maxPages) return null;
    const pages = [];
    for (let number = 1; number <= pdf.numPages; number++) {
      const page = await pdf.getPage(number);
      const content = await page.getTextContent();
      pages.push(content.items.map(item => ('str' in item ? item.str + (item.hasEOL ? '\n' : '') : '')).join('').replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim());
      page.cleanup();
    }
    return pages.join('').length >= MIN_PDF_TEXT_CHARS ? pages : null;
  } catch {
    return null;
  } finally {
    await task?.destroy();
  }
}

/** One text for the models, with a marker before each page so they can name the page of a quote. */
export const pdfDocumentText = pages => pages.map((text, index) => `${PAGE_MARKER(index + 1)}\n${text}`).join('\n\n');

/** True when the quote appears verbatim (after normalization) on the given 1-based page. */
export function quoteOnPage(pages, page, quote) {
  if (!Number.isInteger(page) || page < 1 || page > pages.length || typeof quote !== 'string' || !quote.trim()) return false;
  return normalizeForQuote(pages[page - 1]).includes(normalizeForQuote(quote));
}
