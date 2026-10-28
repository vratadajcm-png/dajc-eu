// Page text for answers. scripts/lib/fetch-source.mjs extractDetailText()
// keeps 1,800 characters - enough to classify a news item, too little to
// read a legal text - so this module extracts the full main text instead
// and then picks the passages relevant to the question. scripts/lib stays
// unchanged.

const DROP_BLOCKS = /<(script|style|noscript|svg|nav|header|footer|form|template|iframe)\b[^>]*>[\s\S]*?<\/\1>/gi;
const BLOCK_TAGS = /<\/?(?:p|div|li|ul|ol|tr|td|th|table|h[1-6]|section|article|main|br|dd|dt|dl|blockquote|pre)\b[^>]*>/gi;

export function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, n) => safeCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => safeCodePoint(parseInt(n, 16)))
    .replace(/&amp;/gi, '&');
}

function safeCodePoint(n: number): string {
  return Number.isInteger(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : ' ';
}

function stripToText(html: string): string {
  return decodeEntities(html.replace(BLOCK_TAGS, '\n').replace(/<[^>]+>/g, ' '))
    .replace(/[ \t\f\v ]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

/** Main readable text of an HTML page: the longest <main>/<article>, else <body>. */
export function htmlToText(html: string, maxChars = 200_000): string {
  const cleaned = String(html || '').slice(0, 3_000_000).replace(/<!--[\s\S]*?-->/g, ' ').replace(DROP_BLOCKS, ' ');
  const scopes: string[] = [];
  for (const tag of ['main', 'article']) {
    const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'gi');
    let match: RegExpExecArray | null;
    while ((match = re.exec(cleaned))) {
      const text = stripToText(match[1]);
      if (text.length >= 200) scopes.push(text);
    }
  }
  const body = cleaned.match(/<body\b[^>]*>([\s\S]*)<\/body>/i)?.[1] ?? cleaned;
  const text = scopes.sort((a, b) => b.length - a.length)[0] || stripToText(body);
  return text.slice(0, maxChars);
}

export function pageTitle(html: string): string | null {
  const raw = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  const title = raw ? stripToText(raw).replace(/\s+/g, ' ').trim() : '';
  return title.length >= 4 && title.length <= 300 ? title : null;
}

/**
 * The parts of a long text around the search terms, in original order,
 * at most `maxChars`. Short texts are returned whole.
 */
export function selectPassages(text: string, terms: string[], maxChars: number, windowChars = 700): string {
  if (text.length <= maxChars) return text;
  const lower = text.toLocaleLowerCase();
  const words = [...new Set(terms.flatMap((term) => term.toLocaleLowerCase().split(/[^\p{L}\p{N}]+/u)).filter((w) => w.length >= 4))];
  const hits: number[] = [];
  for (const word of words) {
    let from = 0;
    while (hits.length < 400) {
      const index = lower.indexOf(word, from);
      if (index < 0) break;
      hits.push(index);
      from = index + word.length;
    }
  }
  if (hits.length === 0) return text.slice(0, maxChars);
  hits.sort((a, b) => a - b);
  const ranges: Array<[number, number]> = [];
  for (const hit of hits) {
    const start = Math.max(0, hit - windowChars);
    const end = Math.min(text.length, hit + windowChars);
    const last = ranges[ranges.length - 1];
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else ranges.push([start, end]);
  }
  let out = '';
  for (const [start, end] of ranges) {
    const piece = text.slice(start, end);
    if (out.length + piece.length + 5 > maxChars) {
      out += (out ? '\n[…]\n' : '') + piece.slice(0, Math.max(0, maxChars - out.length - 5));
      break;
    }
    out += (out ? '\n[…]\n' : '') + piece;
  }
  return out;
}
