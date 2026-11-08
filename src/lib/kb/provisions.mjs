// Splits the page texts of an official document into citable provisions
// (Article / Článek / Artikel / Artykuł / Článok, § sections, Annexes), each
// with the PDF pages it spans, so an answer can cite "Article 7, page 7".
//
// Deliberately conservative:
//   - an anchor must stand alone on its line ("Článek 7", "Article 8a",
//     "§ 43", "PŘÍLOHA I"); a cross-reference inside a sentence ("podle
//     článku 7") never starts a provision;
//   - text before the first anchor is PREAMBLE (recitals, title) and is never
//     offered as a rule to cite;
//   - running page headers/footers (e.g. "02006R0561 — CS — 31.12.2024 — ...")
//     and EUR-Lex amendment markers (▼B, ►M3, ◄) are removed;
//   - long provisions are cut into chunks that keep the same anchor.
// Mass thresholds mentioned in a provision are only recorded as hints
// (mass_mentions); which mass band a rule applies to is a reviewer decision.

const ARTICLE_WORDS = 'Article|Article premier|Artikel|Článek|Článok|Artykuł|Articolo|Artículo|Artigo|Artikkel|Artiklan|Člen|Članak|Cikk|Straipsnis|Pants|Paragrahv|Art\\.';
const ANNEX_WORDS = 'ANNEX|ANHANG|PŘÍLOHA|PRÍLOHA|ZAŁĄCZNIK|ANNEXE|ALLEGATO|ANEXO|BIJLAGE|BILAGA|LIITE|MELLÉKLET|PRILOGA|PRILOG|Příloha|Príloha|Załącznik|Anhang|Annex|Anlage';
// An anchor alone on its line, or followed on the same line by a title
// ("§ 30 Umweltschutz, Sonn- und Feiertagsfahrverbot"). A title must start
// with a capital letter and must not be a reference ("§ 30 Absatz 3", "§ 4 odst. 2").
const ANCHORS = [
  { type: 'ARTICLE', re: new RegExp(`^(${ARTICLE_WORDS})\\s+(\\d{1,3}[a-z]?)(?:\\s+(\\p{Lu}.{1,118}))?$`, 'u') },
  { type: 'SECTION', re: /^§\s*(\d{1,4}[a-z]?)(?:\s+(\p{Lu}.{1,118}))?$/u },
  { type: 'ANNEX', re: new RegExp(`^(${ANNEX_WORDS})(?:\\s+(?:č\\.\\s*|Nr\\.\\s*|nr\\s+)?([IVXLC]{1,6}[A-Z]?|\\d{1,3}[a-z]?))?(?:\\s+(\\(.{1,118}\\)|\\p{Lu}.{1,118}))?$`, 'u') },
];
const REFERENCE_TITLE = /^(Abs|Absatz|Satz|Nr|Nummer|Buchst|Odst|Odstavec|Písm|Ods|Ust|Pkt|Ziff|Paragraph|Paragraf|Sb|Z\.)\b/iu;

const MARKERS = /[▼►◄]\s*(?:[A-Z]\d{0,3}|C\d{0,3})?/gu;
const MAX_CHUNK_CHARS = 3500;
const MASS_RE = /(?<![\d.,])(\d{1,3}(?:[.,]\d{1,2})?)\s*(?:t|tun|tuny|tunách|tonnes?|tons?|Tonnen|ton|tonach|tony|tonami)(?![\p{L}])/giu;

function normaliseRunningLine(line) {
  return line.replace(/\d+/g, '#').replace(/\s+/g, ' ').trim();
}

/** Lines repeated on most pages (running headers and footers). */
export function runningLines(pages) {
  if (pages.length < 3) return new Set();
  const counts = new Map();
  for (const page of pages) {
    const lines = page.text.split('\n').map((l) => l.trim()).filter(Boolean);
    const edges = new Set([...lines.slice(0, 2), ...lines.slice(-2)].map(normaliseRunningLine));
    for (const line of edges) counts.set(line, (counts.get(line) || 0) + 1);
  }
  return new Set([...counts.entries()].filter(([line, n]) => n >= Math.max(3, pages.length * 0.5) && line.length > 3).map(([line]) => line));
}

export function cleanLine(line) {
  return line.replace(MARKERS, '').replace(/\s+/g, ' ').trim();
}

export function massMentions(text) {
  const values = new Set();
  for (const match of String(text).matchAll(MASS_RE)) {
    const value = Number(match[1].replace(',', '.'));
    if (value >= 0.5 && value <= 100) values.add(value);
  }
  return [...values].sort((a, b) => a - b);
}

function sectionNumber(value) {
  const m = String(value || '').match(/^(\d+)([a-z]?)$/);
  return m ? Number(m[1]) + (m[2] ? (m[2].charCodeAt(0) - 96) / 100 : 0) : null;
}

function matchAnchor(line, last) {
  for (const anchor of ANCHORS) {
    const m = line.match(anchor.re);
    if (!m) continue;
    if (anchor.type === 'ANNEX') {
      if (m[3] && !m[3].startsWith('(') && REFERENCE_TITLE.test(m[3])) return null;
      return { type: 'ANNEX', number: m[2] || null, label: m[2] ? `${m[1]} ${m[2]}` : m[1], title: m[3] || null };
    }
    const number = anchor.type === 'SECTION' ? m[1] : m[2];
    const title = anchor.type === 'SECTION' ? m[2] : m[3];
    if (title) {
      // With a title on the line, accept only a real next provision: numbers grow and the title is not a reference.
      if (REFERENCE_TITLE.test(title)) return null;
      const previous = last[anchor.type];
      if (previous != null && sectionNumber(number) != null && sectionNumber(number) <= previous) return null;
    }
    const label = anchor.type === 'SECTION' ? `§ ${number}` : `${m[1]} ${number}`;
    return { type: anchor.type, number, label, title: title || null };
  }
  return null;
}

/**
 * @param {Array<{ pageNo: number, text: string }>} pages
 * @returns {Array<{ ordinal: number, anchorType: string, anchorLabel: string, anchorNumber: string|null, heading: string|null, pageFrom: number, pageTo: number, text: string, massMentions: number[] }>}
 */
export function splitProvisions(pages) {
  const running = runningLines(pages);
  const blocks = [];
  let current = { anchor: { type: 'PREAMBLE', number: null, label: 'Preamble', title: null }, pageFrom: pages[0]?.pageNo ?? 1, pageTo: pages[0]?.pageNo ?? 1, lines: [] };
  const last = { ARTICLE: null, SECTION: null };
  for (const page of pages) {
    for (const raw of page.text.split('\n')) {
      if (running.has(normaliseRunningLine(raw.trim()))) continue;
      const line = cleanLine(raw);
      if (!line) continue;
      const anchor = matchAnchor(line, last);
      if (anchor) {
        if (anchor.type in last && sectionNumber(anchor.number) != null) last[anchor.type] = sectionNumber(anchor.number);
        if (current.lines.length > 0 || current.anchor.type !== 'PREAMBLE') blocks.push(current);
        current = { anchor, pageFrom: page.pageNo, pageTo: page.pageNo, lines: [] };
        continue;
      }
      current.lines.push(line);
      current.pageTo = page.pageNo;
    }
  }
  blocks.push(current);

  const provisions = [];
  for (const block of blocks) {
    if (block.lines.length === 0) continue;
    // Only a title printed on the anchor line itself; no guessing from the body
    // (a wrapped first sentence looks like a title, and no line may be lost).
    const heading = block.anchor.title || null;
    const body = block.lines.join('\n');
    const chunks = chunk(body, MAX_CHUNK_CHARS);
    chunks.forEach((text, index) => {
      provisions.push({
        ordinal: provisions.length + 1,
        anchorType: block.anchor.type,
        anchorLabel: block.anchor.label,
        anchorNumber: block.anchor.number,
        heading,
        pageFrom: index === 0 ? block.pageFrom : estimatePage(block, chunks, index),
        pageTo: block.pageTo,
        text,
        massMentions: massMentions(text),
      });
    });
  }
  return provisions;
}

function chunk(text, max) {
  if (text.length <= max) return [text];
  const parts = [];
  let rest = text;
  while (rest.length > max) {
    let cut = rest.lastIndexOf('\n', max);
    if (cut < max * 0.5) cut = rest.lastIndexOf('. ', max) + 1;
    if (cut <= 0) cut = max;
    parts.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) parts.push(rest);
  return parts;
}

// The page of a later chunk is not known exactly; the whole span is kept so
// the citation never points before the text.
function estimatePage(block) {
  return block.pageFrom;
}
