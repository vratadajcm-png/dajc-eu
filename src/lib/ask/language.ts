// Deterministic language check for the priority test languages (§47.7:
// EN, CS, SK, PL, DE first). It is deliberately conservative: it answers
// only when the evidence is clear and returns null otherwise, so it can
// overrule the classifier for these languages and catch an answer written
// in the wrong language, but never blocks a language it does not know.

export type DetectedLanguage = 'en' | 'cs' | 'sk' | 'pl' | 'de';

const LETTERS: Record<DetectedLanguage, RegExp> = {
  cs: /[ěřů]/giu,
  sk: /[ľĺŕôä]/giu,
  pl: /[ąęłńśźż]/giu,
  de: /[öüß]/giu,
  en: /(?!)/gu,
};

const WORDS: Record<DetectedLanguage, string[]> = {
  en: ['the', 'is', 'are', 'there', 'what', 'when', 'which', 'for', 'and', 'on', 'in', 'of', 'to', 'from', 'with', 'by', 'at', 'or', 'be', 'may', 'not', 'must', 'only', 'over', 'between', 'except', 'does', 'do', 'trucks', 'truck', 'lorries', 'lorry', 'vehicles', 'vehicle', 'goods', 'ban', 'driving', 'drive', 'allowed', 'permitted', 'prohibited', 'applies', 'apply', 'public', 'holidays', 'sundays', 'sunday', 'roads', 'road'],
  cs: ['je', 'jsou', 'platí', 'kdy', 'jaký', 'jaké', 'jaká', 'pro', 'na', 'v', 've', 'se', 'od', 'do', 'zákaz', 'jízdy', 'nákladní', 'nákladních', 'vozidla', 'vozidel', 'nad', 'může', 'mohou', 'nesmí', 'nesmějí', 'neděli', 'svátky', 'dálnicích', 'silnicích', 'hodin', 'také', 'které', 'nebo', 'a'],
  sk: ['je', 'sú', 'platí', 'kedy', 'aký', 'aké', 'pre', 'na', 'v', 'vo', 'sa', 'od', 'do', 'zákaz', 'jazdy', 'nákladné', 'vozidlá', 'vozidiel', 'nad', 'nesmú', 'nedeľu', 'sviatky', 'diaľniciach', 'ktoré', 'alebo', 'a'],
  pl: ['jest', 'są', 'czy', 'kiedy', 'jaki', 'jakie', 'dla', 'na', 'w', 'we', 'się', 'od', 'do', 'nie', 'mogą', 'zakaz', 'ruchu', 'ciężarówek', 'pojazdy', 'pojazdów', 'powyżej', 'niedziele', 'niedzielę', 'święta', 'dróg', 'godz', 'które', 'lub', 'i'],
  de: ['ist', 'sind', 'gibt', 'es', 'der', 'die', 'das', 'den', 'dem', 'für', 'am', 'an', 'im', 'und', 'von', 'bis', 'uhr', 'zu', 'wann', 'welche', 'lkw', 'fahrverbot', 'über', 'gilt', 'auf', 'mit', 'nicht', 'dürfen', 'sonntags', 'feiertagen', 'ein', 'eine'],
};

const WORD_SETS = Object.fromEntries(
  Object.entries(WORDS).map(([lang, words]) => [lang, new Set(words)]),
) as Record<DetectedLanguage, Set<string>>;

/** Text in parentheses is where original terms go ("(Fahrverbot)"); ignore it. */
export function withoutParentheticals(text: string): string {
  return text.replace(/\([^)]*\)/g, ' ').replace(/"[^"]*"|„[^“"]*[“"]/g, ' ');
}

export function detectLanguage(text: string): DetectedLanguage | null {
  const cleaned = withoutParentheticals(text).toLowerCase();
  const tokens = cleaned.match(/\p{L}+/gu) || [];
  if (tokens.length < 3) return null;
  const scores = {} as Record<DetectedLanguage, number>;
  for (const lang of Object.keys(WORDS) as DetectedLanguage[]) {
    const letters = (cleaned.match(LETTERS[lang]) || []).length;
    const words = tokens.filter((token) => WORD_SETS[lang].has(token)).length;
    scores[lang] = words + letters * 2;
  }
  // ä alone is shared by German and Slovak; ö/ü/ß decide German.
  if (/[ä]/u.test(cleaned) && !/[ľĺŕô]/u.test(cleaned) && /[öüß]/u.test(cleaned)) scores.sk -= 2;
  const ranked = (Object.entries(scores) as Array<[DetectedLanguage, number]>).sort((a, b) => b[1] - a[1]);
  const [best, second] = ranked;
  if (best[1] < 3 || best[1] - second[1] < 2) return null;
  return best[0];
}
