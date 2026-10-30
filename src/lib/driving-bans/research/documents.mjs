/**
 * Turns a retrieved official document into analysable text plus metadata.
 * The text is data for the models, never instructions: it is wrapped by
 * wrapUntrusted() with a per-call nonce, and suspicious instruction-like
 * passages are flagged for the reviewer (they stay in the evidence as found).
 */
import { createHash } from 'node:crypto';

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

// Frequent function words of the official languages of tracked jurisdictions (Latin script).
const LANGUAGE_WORDS = {
  cs: 'a je se na pro nebo podle které který jsou také až od do', sk: 'a je sa na pre alebo podľa ktoré ktorý sú tiež až od do',
  de: 'der die und das von für mit nicht auf ist den im des zu', fr: 'le la les des et du pour est dans par sur une aux', it: 'il di che della per sono dei nel delle gli alle è',
  es: 'el los las de que del por para con una y en', pt: 'os das dos não para com uma em pelo ao à que', nl: 'de het van een en voor op niet zijn met dat te',
  pl: 'i w z na się nie do oraz jest dla od lub', hu: 'a az és hogy nem egy is vagy szerint között', sl: 'in je za na se ali ki od do so',
  hr: 'i je za na se ili od do su koji prema', ro: 'și de în la cu pentru din care sau este', en: 'the and of to for is in on with by or',
  da: 'og af til er for med på ikke den det', sv: 'och av till är för med på inte den det som', no: 'og av til er for med på ikke som den',
  fi: 'ja on ei tai että kanssa mukaan joka', et: 'ja on ei või ning kui mis see', lv: 'un ir par no uz ar vai kas līdz', lt: 'ir yra iki dėl su arba kad nuo', tr: 've bir bu ile için olan veya göre',
};
// Letters that set a language apart from its neighbours (č, š, ž or ä alone would not).
const LANGUAGE_LETTERS = { cs: 'řěů', sk: 'ľĺŕô', de: 'ßü', pl: 'łąęśźżń', hu: 'őű', ro: 'șțăâ', tr: 'ğış', lt: 'ėųį', lv: 'āēīļņķģ', da: 'æø', no: 'æø', sv: 'å', pt: 'ãõ', es: 'ñ', hr: 'đ' };
const LANGUAGE_SETS = Object.entries(LANGUAGE_WORDS).map(([code, words]) => [code, new Set(words.split(' ')), new Set(LANGUAGE_LETTERS[code] ?? '')]);

/**
 * Language of a document: the one it declares (html lang, Content-Language), else the
 * function words and distinctive letters of its text when one language clearly leads; null
 * when unclear (other scripts, too little text), which the orchestrator treats as untested.
 * @returns {{ language: string | null, source: 'declared' | 'detected' | null }}
 */
export function identifyLanguage(text, declared = null) {
  const stated = typeof declared === 'string' ? /^([a-z]{2,3})(?:[-_][a-z0-9]+)?$/i.exec(declared.split(',')[0].trim())?.[1]?.toLowerCase() : null;
  if (stated) return { language: stated, source: 'declared' };
  const sample = String(text ?? '').slice(0, 20_000).toLowerCase();
  const words = sample.match(/\p{L}+/gu) ?? [];
  const score = (set, letters) => words.reduce((sum, word) => sum + (set.has(word) ? 1 : 0), 0) + [...sample].reduce((sum, char) => sum + (letters.has(char) ? 1 : 0), 0);
  const scores = LANGUAGE_SETS.map(([code, set, letters]) => [code, score(set, letters)]).sort((a, b) => b[1] - a[1]);
  const [[code, top], [, second]] = scores;
  return top >= 5 && top >= second * 1.5 ? { language: code, source: 'detected' } : { language: null, source: null };
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

/**
 * One act published as several official documents (RIS publishes the preamble and each
 * paragraph of a Land order separately): their texts in publication order, each headed by
 * its URL and SHA-256, read and quote-checked as one TEXT_EXCERPT so that the operative
 * provision, its exceptions and its entry into force are seen together. Every part stays
 * stored as retrieved. Null when a part has no text (PDF).
 */
export function composeDocumentParts(parts) {
  const texts = parts.map(part => documentText(part));
  if (!parts.length || texts.some(item => item.text === null)) return null;
  const text = parts.map((part, index) => `[Part ${index + 1} of ${parts.length}: ${part.final_url} sha256:${part.sha256}]\n${texts[index].text}`).join('\n\n').slice(0, MAX_TEXT_CHARS);
  const bytes = Buffer.from(text, 'utf8');
  return {
    ok: true, kind: 'TEXT_EXCERPT', content_type: 'text/plain; charset=utf-8', charset: 'utf-8', bytes, byte_length: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'),
    url: parts[0].url, final_url: parts[0].final_url, retrieved_at: parts.map(part => part.retrieved_at).sort().at(-1), last_modified: null, etag: null,
    content_language: texts[0].metadata.language ?? null, title: texts[0].metadata.title ?? null,
    parts: parts.map(part => ({ url: part.url, final_url: part.final_url, sha256: part.sha256, kind: part.kind, byte_length: part.byte_length, retrieved_at: part.retrieved_at })),
  };
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
