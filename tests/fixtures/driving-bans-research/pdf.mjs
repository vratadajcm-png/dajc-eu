// SYNTHETIC TEST FIXTURE: builds small, real PDF files with a text layer for the
// research tests. The documents are invented and must never be used as evidence.

// Czech letters outside WinAnsi get their own codes through /Differences; pdf.js maps
// the glyph names back to Unicode, as it does for real gazette PDFs.
const DIFFERENCES = [['č', 'ccaron'], ['ř', 'rcaron'], ['ž', 'zcaron'], ['š', 'scaron'], ['ě', 'ecaron'], ['ů', 'uring'], ['ň', 'ncaron'], ['ť', 'tcaron'], ['ď', 'dcaron'], ['Č', 'Ccaron'], ['Ř', 'Rcaron'], ['Ž', 'Zcaron'], ['Š', 'Scaron'], ['Ě', 'Ecaron'], ['Ů', 'Uring']];
const WIN_ANSI = { 'á': 0xe1, 'é': 0xe9, 'í': 0xed, 'ó': 0xf3, 'ú': 0xfa, 'ý': 0xfd, 'Á': 0xc1, 'É': 0xc9, 'Í': 0xcd, 'Ó': 0xd3, 'Ú': 0xda, 'Ý': 0xdd, 'ä': 0xe4, 'ö': 0xf6, 'ü': 0xfc, 'ß': 0xdf, '§': 0xa7, '–': 0x96 };
const FIRST = 0x80;
const codeOf = new Map([...Object.entries(WIN_ANSI), ...DIFFERENCES.map(([char], index) => [char, FIRST + index])]);

function encode(line) {
  let out = '';
  for (const char of line) {
    if (char === '\\' || char === '(' || char === ')') out += `\\${char}`;
    else if (char.charCodeAt(0) >= 0x20 && char.charCodeAt(0) < 0x7f) out += char;
    else if (codeOf.has(char)) out += `\\${codeOf.get(char).toString(8).padStart(3, '0')}`;
    else throw new Error(`Character ${char} is not encodable in the synthetic PDF`);
  }
  return out;
}

/** A PDF with one page per entry; each page is an array of text lines. */
export function makePdf(pages) {
  const objects = [];
  const pageIds = pages.map((_, index) => 4 + index * 2);
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map(id => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`;
  objects[3] = `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding << /Type /Encoding /BaseEncoding /WinAnsiEncoding /Differences [${FIRST} ${DIFFERENCES.map(([, name]) => `/${name}`).join(' ')}] >> >>`;
  pages.forEach((lines, index) => {
    const content = ['BT', '/F1 10 Tf', '14 TL', '40 800 Td', ...lines.map(line => `(${encode(line)}) Tj T*`), 'ET'].join('\n');
    objects[pageIds[index]] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${pageIds[index] + 1} 0 R >>`;
    objects[pageIds[index] + 1] = `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`;
  });
  let body = '%PDF-1.4\n%\xe2\xe3\xcf\xd3\n';
  const offsets = [];
  for (let id = 1; id < objects.length; id++) {
    offsets[id] = Buffer.byteLength(body, 'latin1');
    body += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(body, 'latin1');
  body += `xref\n0 ${objects.length}\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}`;
  body += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, 'latin1');
}

/** A PDF whose pages carry no text layer at all (as a scanned document would). */
export function makeScannedPdf(pageCount = 1) {
  return makePdf(Array.from({ length: pageCount }, () => []));
}
