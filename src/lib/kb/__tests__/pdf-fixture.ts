// Builds small, valid PDF files for tests (no network, no binary fixtures).
// Text pages use Helvetica with WinAnsi (ASCII content); an empty page stands
// for a scanned page without a text layer.

function escape(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

export function makePdf(pages: string[][]): Uint8Array {
  const objects: string[] = [];
  const pageIds: number[] = [];
  // 1 catalog, 2 pages, 3 font, then per page: page + content
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
  let next = 4;
  for (const lines of pages) {
    const pageId = next++;
    const contentId = next++;
    pageIds.push(pageId);
    const body = lines.length === 0 ? '' : `BT /F1 10 Tf 14 TL 50 800 Td ${lines.map((l) => `(${escape(l)}) Tj T*`).join(' ')} ET`;
    objects[contentId] = `<< /Length ${body.length} >>\nstream\n${body}\nendstream`;
    objects[pageId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`;
  }
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (let id = 1; id < objects.length; id++) {
    offsets[id] = out.length;
    out += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xref = out.length;
  out += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id++) out += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}

/** A small regulation: header line on every page, recitals, articles, an annex. */
export function regulationPdf(): Uint8Array {
  const header = (n: number) => `32099R0001 - EN - 01.01.2026 - 001.001 - ${n}`;
  return makePdf([
    [header(1), 'REGULATION (XX) No 1/2099', 'Whereas the driving times should be harmonised,', 'HAVE ADOPTED THIS REGULATION:', 'Article 1', 'This Regulation applies to carriage of goods', 'by vehicles whose maximum permissible mass exceeds 3,5 tonnes.'],
    [header(2), 'Article 2', 'After a driving period of four and a half hours a driver shall take', 'an uninterrupted break of not less than 45 minutes,', 'unless the driver takes a rest period, as referred to in', 'Article 1 of this Regulation.', 'Article 3', 'Vehicles over 7,5 t shall not be driven on Sundays.'],
    [header(3), 'ANNEX I', 'Maximum width of vehicles: 2,55 m.', 'Maximum height of vehicles: 4,00 m.'],
  ]);
}
