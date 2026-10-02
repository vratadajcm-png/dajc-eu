// Detects fetched "text" that is really a binary document (a PDF read as
// HTML, an image, ...). Such bytes must never be treated as source content:
// random byte sequences can match relevance keywords, and they would reach
// the model as a meaningless summary.

export function looksBinary(text) {
  const value = String(text || '');
  if (!value) return false;
  if (/^\s*%PDF-/.test(value)) return true;
  const sample = value.slice(0, 2000);
  let suspicious = 0;
  for (const ch of sample) {
    const code = ch.codePointAt(0);
    if (code === 0xfffd || (code < 32 && code !== 9 && code !== 10 && code !== 13)) suspicious += 1;
  }
  return suspicious / sample.length > 0.02;
}

/** The text itself, or null when it is binary noise. */
export function readableText(text) {
  return looksBinary(text) ? null : text;
}
