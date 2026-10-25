// Deterministic checks on every drafted statement, independent of any model
// (the same principle as scripts/lib/date-validation.mjs: only plain code
// can guarantee a rule, a prompt can only ask for it).
//
// A statement is shown only when ALL of these hold:
//   - it cites a source from the allowed set fetched for this question;
//   - its quote appears verbatim in that source's text;
//   - every number in it appears in the quote (no invented values);
//   - for DAJC's own verified data it contains no digits at all, because
//     dates, times and weights from our data are inserted by template;
//   - it contains no personal or case-assessing wording ("you can",
//     "vám hrozí pokuta", ...) - DAJC gives information about rules, never
//     legal advice (§47.3, zákon č. 85/1996 Sb.).
// The whole answer is dropped when it is not written in the question's
// language (checked for the languages detectLanguage() knows).

import { detectLanguage } from './language';

export interface DraftClaim {
  text: string;
  source_id: string;
  quote: string;
}

export interface GuardSource {
  id: string;
  /** 'own' = DAJC verified data (template facts), 'web' = official page. */
  kind: 'own' | 'web';
  text: string;
}

export interface GuardResult {
  kept: DraftClaim[];
  dropped: Array<{ claim: DraftClaim; reason: string }>;
}

const MIN_QUOTE_CHARS = 12;
const MAX_QUOTE_CHARS = 600;
const MAX_CLAIM_CHARS = 700;

function phrase(pattern: string, flags = 'iu'): RegExp {
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${pattern})(?![\\p{L}\\p{N}])`, flags);
}

// Second-person and case-assessing wording. Rules are described
// impersonally ("vehicles over 7.5 t may not ..."), never addressed to the
// reader. Over-matching only drops a statement; it never shows a wrong one.
export const FORBIDDEN_PATTERNS: RegExp[] = [
  // Czech
  phrase('(?:vy\\s+)?můžete'), phrase('nemůžete'), phrase('smíte'), phrase('nesmíte'), phrase('musíte'),
  phrase('vám\\s+hrozí'), phrase('hrozí\\s+vám'), phrase('dostanete\\s+pokutu'), phrase('budete\\s+(?:pokutován[aiy]?|potrestán[aiy]?)'),
  phrase('váš\\s+případ'), phrase('ve\\s+vašem\\s+případě'),
  // Slovak
  phrase('môžete'), phrase('nemôžete'), phrase('smiete'), phrase('nesmiete'), phrase('vám\\s+hrozí'), phrase('dostanete\\s+pokutu'),
  phrase('vo\\s+vašom\\s+prípade'),
  // Polish
  phrase('możesz'), phrase('nie\\s+możesz'), phrase('może\\s+pan(?:i)?'), phrase('mogą\\s+państwo'), phrase('musisz'),
  phrase('grozi\\s+(?:ci|panu|pani|państwu)'), phrase('nie\\s+wolno\\s+(?:ci|panu|pani)'), phrase('w\\s+pana\\s+przypadku'),
  // German - case-sensitive: polite "Sie/Ihnen" only, not "sie dürfen" (they may).
  phrase('Sie\\s+(?:dürfen|können|müssen)', 'u'), phrase('Ihnen\\s+droht', 'u'), phrase('droht\\s+Ihnen', 'u'),
  phrase('in\\s+Ihrem\\s+Fall', 'u'), phrase('du\\s+darfst'), phrase('du\\s+kannst'), phrase('dir\\s+droht'),
  // English
  phrase('you\\s+(?:can|may|must|could|should|are\\s+allowed|are\\s+not\\s+allowed|will\\s+be\\s+fined|could\\s+be\\s+fined|face\\s+a\\s+fine|risk\\s+a\\s+fine)'),
  phrase('in\\s+your\\s+case'),
  // French, Italian, Spanish
  phrase('vous\\s+(?:pouvez|devez|risquez)'), phrase('dans\\s+votre\\s+cas'),
  phrase('lei\\s+può'), phrase('potete'), phrase('lei\\s+rischia'), phrase('nel\\s+suo\\s+caso'),
  phrase('usted\\s+puede'), phrase('puedes'), phrase('le\\s+multarán'), phrase('en\\s+su\\s+caso'),
];

export function forbiddenPhrase(text: string): string | null {
  for (const pattern of FORBIDDEN_PATTERNS) {
    const match = text.match(pattern);
    if (match) return match[0];
  }
  return null;
}

/** Whitespace, quotes, dashes and case folded so a quote survives HTML-to-text differences. */
export function normalizeForMatch(text: string): string {
  return String(text || '')
    .normalize('NFKC')
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟«»]/g, '"')
    .replace(/[‐-―−]/g, '-')
    .replace(/[   ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase();
}

export function quoteFound(quote: string, sourceText: string): boolean {
  const q = normalizeForMatch(quote);
  if (q.length < MIN_QUOTE_CHARS) return false;
  return normalizeForMatch(sourceText).includes(q);
}

/**
 * Numbers in a text: decimals normalized ("7,5" and "7.50" -> "7.5") plus
 * every bare digit run, so "22:00" in a statement matches "22.00 Uhr" in
 * the source.
 */
function numberSet(text: string): Set<string> {
  const values = new Set<string>();
  for (const match of String(text).matchAll(/\d+(?:[.,]\d+)?/g)) {
    values.add(String(parseFloat(match[0].replace(',', '.'))));
    for (const run of match[0].split(/[.,]/)) values.add(String(parseInt(run, 10)));
  }
  return values;
}

function claimNumbers(text: string): string[] {
  return [...String(text).matchAll(/\d+(?:[.,]\d+)?/g)].map((m) => String(parseFloat(m[0].replace(',', '.'))));
}

export function numbersSupported(claimText: string, quote: string): boolean {
  const available = numberSet(quote);
  return claimNumbers(claimText).every((n) => available.has(n));
}

export function checkClaims(claims: DraftClaim[], sources: GuardSource[], { language }: { language: string }): GuardResult {
  const byId = new Map(sources.map((s) => [s.id, s]));
  const kept: DraftClaim[] = [];
  const dropped: GuardResult['dropped'] = [];
  for (const raw of claims || []) {
    const claim = {
      text: String(raw?.text || '').trim(),
      source_id: String(raw?.source_id || '').trim(),
      quote: String(raw?.quote || '').trim(),
    };
    const source = byId.get(claim.source_id);
    let reason: string | null = null;
    if (!claim.text || claim.text.length > MAX_CLAIM_CHARS) reason = 'empty or oversized statement';
    else if (!source) reason = 'source is not in the allowed set';
    else if (claim.quote.length > MAX_QUOTE_CHARS || !quoteFound(claim.quote, source.text)) reason = 'quote not found in the source';
    else if (source.kind === 'own' && /\d/.test(claim.text)) reason = 'own-data facts must come from the template, not the model';
    else if (source.kind === 'web' && !numbersSupported(claim.text, claim.quote)) reason = 'a number is not in the quoted source text';
    else {
      const phraseHit = forbiddenPhrase(claim.text);
      if (phraseHit) reason = `personal or case-assessing wording ("${phraseHit}")`;
    }
    if (reason) dropped.push({ claim, reason });
    else kept.push(claim);
  }

  // Language of the answer must be the language of the question.
  if (kept.length > 0) {
    const detected = detectLanguage(kept.map((c) => c.text).join(' '));
    if (detected && detected !== language) {
      return { kept: [], dropped: [...dropped, ...kept.map((claim) => ({ claim, reason: `answer language ${detected} differs from question language ${language}` }))] };
    }
  }
  return { kept, dropped };
}

/** Free text shown outside statements (none today) must pass the same wording rule. */
export function assertNoForbiddenWording(texts: string[]): boolean {
  return texts.every((text) => forbiddenPhrase(text) === null);
}
