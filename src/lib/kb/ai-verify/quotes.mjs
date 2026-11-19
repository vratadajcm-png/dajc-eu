// Evidence helpers: a quote counts only if it can be located in the stored
// official text. Models often normalise spacing, hyphenation or quotation marks,
// so a quote is matched on letters and digits only and then replaced by the
// exact passage of the stored text - which is what the database checks
// verbatim (dajc_kb.guard_verification_claims).

// EUR-Lex amendment markers (as in provisions.mjs): never part of the wording.
const MARKER = /[▼►◄]\s*(?:[A-Z]\d{0,3}|C\d{0,3})?/gu;

/** Letters and digits of `text` (lower case) with the index of each in the original; markers skipped. */
function skeleton(text) {
  const chars = [];
  const index = [];
  const source = String(text ?? '');
  const skip = new Uint8Array(source.length);
  for (const m of source.matchAll(MARKER)) skip.fill(1, m.index, m.index + m[0].length);
  for (let i = 0; i < source.length; i++) {
    if (skip[i]) continue;
    const c = source[i];
    if (/[\p{L}\p{N}]/u.test(c)) {
      chars.push(c.toLocaleLowerCase('und'));
      index.push(i);
    }
  }
  return { text: chars.join(''), index };
}

/**
 * The exact passage of `body` that `quote` stands for, or null. Spacing,
 * punctuation, case and amendment markers (▼M1) do not matter; the quote must
 * cover at least `minChars` letters and digits. The first occurrence is used
 * (the claim is about this provision either way).
 */
export function locateQuote(body, quote, { minChars = 8 } = {}) {
  const needle = skeleton(quote).text;
  if (needle.length < minChars) return null;
  const hay = skeleton(body);
  const at = hay.text.indexOf(needle);
  if (at < 0) return null;
  const start = hay.index[at];
  const end = hay.index[at + needle.length - 1] + 1;
  return String(body).slice(start, end);
}

/** Numbers printed with digits in a passage ("4,5", "45", "3.5", "40 000"). */
export function numbersIn(text) {
  const out = [];
  for (const m of String(text ?? '').matchAll(/\d+(?:[  ]\d{3})*(?:[.,]\d+)?/g)) {
    const raw = m[0].replace(/[  ]/g, '');
    const n = Number(raw.replace(',', '.'));
    if (Number.isFinite(n)) out.push(n);
    // "4.000" style thousands separators: also accept the integer reading.
    if (/^\d{1,3}[.,]\d{3}$/.test(raw)) out.push(Number(raw.replace(/[.,]/, '')));
  }
  return out;
}

/**
 * Whether every quantity of a claim is printed in its quote. Quantities can
 * also be written in words ("four and a half hours", "čtyřech a půl"), which
 * cannot be checked here; those are left to the independent verifier.
 * @returns {{ checked: boolean, missing: number[] }}
 */
export function quantitiesInQuote(values, quote) {
  const printed = numbersIn(quote);
  if (printed.length === 0) return { checked: false, missing: [] };
  const missing = (values || []).map((v) => Number(v.quantity)).filter((q) => !printed.some((n) => Math.abs(n - q) < 1e-9));
  return { checked: true, missing };
}

/** Two readings of quantities agree when they hold the same (quantity, unit) pairs. */
export function sameQuantities(a, b) {
  const key = (list) => [...new Set((list || []).map((v) => `${Number(v.quantity)}|${v.unit}`))].sort().join(',');
  return key(a) === key(b);
}

