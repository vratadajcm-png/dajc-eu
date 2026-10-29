/**
 * Turns a retrieved official document into analysable text plus metadata.
 * The text is data for the models, never instructions: it is wrapped by
 * wrapUntrusted() with a per-call nonce, and suspicious instruction-like
 * passages are flagged for the reviewer (they stay in the evidence as found).
 */

export const MAX_TEXT_CHARS = 300_000;

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', sect: '§', auml: 'ä', ouml: 'ö', uuml: 'ü', Auml: 'Ä', Ouml: 'Ö', Uuml: 'Ü', szlig: 'ß', eacute: 'é', egrave: 'è', agrave: 'à', ccedil: 'ç' };
export function decodeEntities(value) {
  return String(value).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code) => {
    if (code[0] === '#') { const n = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : Number(code.slice(1)); return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : ''; }
    return ENTITIES[code] ?? match;
  });
}

/**
 * Text of an HTML page: scripts, styles, templates and comments removed. Collapsed
 * (hidden) sections are kept: legal portals fold provisions that way, and dropping
 * them would lose law. Instruction-like text is flagged by scanForInstructions instead.
 */
export function htmlToText(html) {
  return decodeEntities(String(html)
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|template|svg|iframe|object)\b[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<(br|p|div|li|tr|h[1-6]|section|article|table|dt|dd)\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' '))
    .replace(/[ \t\f\v ]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim();
}

const meta = (html, pattern) => { const match = pattern.exec(html); return match ? decodeEntities(match[1]).trim() : null; };

/** Metadata the page states about itself (ELI, Dublin Core, html lang). */
export function htmlMetadata(html) {
  const head = String(html).slice(0, 200_000);
  const prop = name => meta(head, new RegExp(`<meta[^>]+(?:property|name)=["']${name}["'][^>]*content=["']([^"']+)["']`, 'i')) ?? meta(head, new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["']${name}["']`, 'i'));
  return {
    title: meta(head, /<title[^>]*>([\s\S]*?)<\/title>/i),
    language: meta(head, /<html[^>]*\blang=["']([a-z]{2,3})(?:-[a-z]+)?["']/i)?.toLowerCase() ?? null,
    eli: (prop('eli:is_realized_by') ?? prop('eli:realizes') ?? prop('eli:uri_schema')) ? { work: prop('eli:realizes'), expression: prop('eli:is_realized_by'), version: prop('eli:version'), date_document: prop('eli:date_document'), date_publication: prop('eli:date_publication') } : null,
    published: prop('eli:date_publication') ?? prop('dcterms.issued') ?? prop('DC.date.issued') ?? prop('article:published_time'),
    modified: prop('eli:version_date') ?? prop('dcterms.modified') ?? prop('DC.date.modified') ?? prop('article:modified_time'),
  };
}

/** Phrases by which a document would try to steer a model. Flagged, never obeyed. */
const INJECTION_PATTERNS = [
  /ignore (?:all |any |the )?(?:previous|prior|above|earlier) (?:instructions|rules|prompts)/i,
  /disregard (?:all |the )?(?:previous|prior|above) /i,
  /\b(?:system|developer) (?:prompt|message|instructions?)\b/i,
  /\byou are (?:now )?(?:an? )?(?:ai|assistant|language model|chatgpt|claude|gemini|grok)\b/i,
  /\b(?:mark|set|record|classify) (?:this|it|the)(?: (?:rule|document|jurisdiction|ban|source))? as (?:verified|primary_verified|no[_ ]ban|approved)\b/i,
  /\bset (?:no[_ ]ban|primary_verified|coverage_complete)\b/i,
  /<\/?(?:system|instructions?|assistant)>/i,
  /\bBEGIN (?:SYSTEM|INSTRUCTIONS)\b/,
];
export function scanForInstructions(text) {
  const hits = [];
  for (const pattern of INJECTION_PATTERNS) {
    const match = pattern.exec(text);
    if (match) hits.push(text.slice(Math.max(0, match.index - 60), match.index + match[0].length + 60).replace(/\s+/g, ' ').trim());
  }
  return hits;
}

/** Decode retrieved bytes into text for HTML, XML, JSON and plain text; PDFs stay binary for native PDF input. */
export function documentText(fetched) {
  if (fetched.kind === 'PDF') return { text: null, metadata: { title: null, language: fetched.content_language ?? null, eli: null, published: null, modified: fetched.last_modified ?? null } };
  const label = fetched.charset && /^(utf-8|utf8|iso-8859-\d+|windows-125\d)$/.test(fetched.charset) ? fetched.charset : 'utf-8';
  let raw;
  try { raw = new TextDecoder(label, { fatal: label.startsWith('utf') }).decode(fetched.bytes); } catch { raw = new TextDecoder('windows-1252').decode(fetched.bytes); }
  if (fetched.kind === 'HTML_SNAPSHOT') {
    const metadata = htmlMetadata(raw);
    return { text: htmlToText(raw).slice(0, MAX_TEXT_CHARS), metadata: { ...metadata, language: metadata.language ?? fetched.content_language ?? null, modified: metadata.modified ?? fetched.last_modified ?? null } };
  }
  const text = fetched.kind === 'XML_DATA' ? decodeEntities(raw.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim() : raw;
  return { text: text.slice(0, MAX_TEXT_CHARS), metadata: { title: null, language: fetched.content_language ?? null, eli: null, published: null, modified: fetched.last_modified ?? null } };
}

/** Normalised form for verbatim quote checks: Unicode NFKC, unified quotes and dashes, collapsed whitespace, case folded. */
export function normalizeForQuote(value) {
  return String(value ?? '').normalize('NFKC').replace(/[‘’‚‛]/g, "'").replace(/[“”„‟«»]/g, '"').replace(/[‐-―−]/g, '-').replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * Wrap untrusted text with a random nonce the document cannot predict; any
 * occurrence of the marker prefix inside the text is neutralised first.
 */
export function wrapUntrusted(label, text, nonce) {
  const safe = String(text).replace(/<<<\s*(?:END\s+)?UNTRUSTED/gi, '<< UNTRUSTED-MARKER-REMOVED');
  return `<<<UNTRUSTED ${label} ${nonce}>>>\n${safe}\n<<<END UNTRUSTED ${label} ${nonce}>>>`;
}
