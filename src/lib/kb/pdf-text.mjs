// Text of an official PDF, page by page, for the DAJC legal library.
//
// PDFs from public sources are untrusted input. pdf.js (Mozilla) is built for
// that, and is used here with every optional feature off: no eval, no font
// loading, no scripting, no network; size, page count and time are capped.
// Only text is read - nothing is rendered.
//
// A page with (almost) no text layer is a scanned page. A document with too
// many of them is NOT indexed: it goes to the separate OCR path, which needs
// approval (DAJC owner decision), because OCR errors in a legal text are
// dangerous (a misread "7,5 t" or "§ 43").

export const PDF_LIMITS = Object.freeze({
  maxBytes: 50 * 1024 * 1024,
  maxPages: 2000,
  timeoutMs: 120_000,
  /** A page with fewer printable characters than this counts as scanned. */
  minCharsPerTextPage: 40,
  /** Share of scanned pages above which the whole document needs OCR. */
  maxScannedShare: 0.2,
});

let pdfjsPromise = null;
async function pdfjs() {
  pdfjsPromise ??= import('pdfjs-dist/legacy/build/pdf.mjs');
  return pdfjsPromise;
}

export function isPdf(bytes) {
  return bytes?.length > 5 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d; // %PDF-
}

/** Joins pdf.js text items into lines; whitespace normalised per line. */
export function itemsToText(items) {
  let text = '';
  for (const item of items) {
    if (typeof item?.str !== 'string') continue;
    text += item.str;
    if (item.hasEOL) text += '\n';
  }
  return text.split('\n').map((line) => line.replace(/[\s ]+/g, ' ').trim()).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function withTimeout(promise, ms) {
  let timer;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`PDF extraction exceeded ${ms} ms`)), ms); }),
  ]);
}

/**
 * Extracts the text of every page.
 * @returns {Promise<{ pageCount: number, pages: Array<{ pageNo: number, text: string, scanned: boolean }>, needsOcr: boolean, scannedPages: number[] }>}
 */
export async function extractPdfText(bytes, limits = PDF_LIMITS) {
  if (!isPdf(bytes)) throw new Error('not a PDF document');
  if (bytes.length > limits.maxBytes) throw new Error(`PDF larger than ${limits.maxBytes} bytes`);
  const { getDocument } = await pdfjs();
  const task = getDocument({
    data: Uint8Array.from(bytes),
    isEvalSupported: false,
    disableFontFace: true,
    useSystemFonts: false,
    enableXfa: false,
    stopAtErrors: false,
    verbosity: 0,
  });
  return withTimeout((async () => {
    const doc = await task.promise;
    try {
      if (doc.numPages > limits.maxPages) throw new Error(`PDF has more than ${limits.maxPages} pages`);
      const pages = [];
      for (let pageNo = 1; pageNo <= doc.numPages; pageNo++) {
        const page = await doc.getPage(pageNo);
        const content = await page.getTextContent({ includeMarkedContent: false });
        const text = itemsToText(content.items);
        const printable = text.replace(/\s+/g, '').length;
        pages.push({ pageNo, text, scanned: printable < limits.minCharsPerTextPage });
        page.cleanup();
      }
      const scannedPages = pages.filter((p) => p.scanned).map((p) => p.pageNo);
      const needsOcr = pages.length === 0 || scannedPages.length / pages.length > limits.maxScannedShare;
      return { pageCount: doc.numPages, pages, needsOcr, scannedPages };
    } finally {
      await doc.destroy();
    }
  })(), limits.timeoutMs).catch(async (error) => {
    await task.destroy().catch(() => undefined);
    throw error;
  });
}
