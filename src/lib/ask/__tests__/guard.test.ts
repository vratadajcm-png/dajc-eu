import { describe, expect, it } from 'vitest';
import { checkClaims, forbiddenPhrase, numbersSupported, quoteFound, type GuardSource } from '../guard';
import { detectLanguage } from '../language';

const WEB: GuardSource = {
  id: 'S1',
  kind: 'web',
  text: 'An Sonn- und Feiertagen ist das Fahren mit Lastkraftwagen mit einem höchsten zulässigen Gesamtgewicht von mehr als 7,5 t von 00.00 bis 22.00 Uhr verboten.',
};
const OWN: GuardSource = {
  id: 'dajc:cz-sunday-2026-11-01',
  kind: 'own',
  text: 'DAJC verified driving-ban record. Country: Czechia (CZ).\nRestriction: Sunday and public holiday driving ban.\nLocal time: 2026-11-01 13:00 – 2026-11-01 22:00 (Europe/Prague).',
};
const QUOTE = 'mit einem höchsten zulässigen Gesamtgewicht von mehr als 7,5 t von 00.00 bis 22.00 Uhr verboten';

describe('deterministic statement checks', () => {
  it('drops a statement whose source is not in the allowed set', () => {
    const result = checkClaims([{ text: 'Lorries over 7.5 t may not drive on Sundays.', source_id: 'S9', quote: QUOTE }], [WEB], { language: 'en' });
    expect(result.kept).toHaveLength(0);
    expect(result.dropped[0].reason).toMatch(/allowed set/);
  });

  it('drops a statement whose quote is not in the source', () => {
    const result = checkClaims([{ text: 'Lorries over 7.5 t may not drive on Sundays.', source_id: 'S1', quote: 'Lkw dürfen sonntags immer fahren' }], [WEB], { language: 'en' });
    expect(result.kept).toHaveLength(0);
    expect(result.dropped[0].reason).toMatch(/quote not found/);
  });

  it('drops a statement with a number the quote does not contain', () => {
    const result = checkClaims([{ text: 'Lorries over 12 t may not drive on Sundays from 00:00 to 22:00 (Fahrverbot).', source_id: 'S1', quote: QUOTE }], [WEB], { language: 'en' });
    expect(result.kept).toHaveLength(0);
    expect(result.dropped[0].reason).toMatch(/number/);
  });

  it('keeps a statement whose numbers are all in the quote, across 7,5/7.5 and 22.00/22:00 formats', () => {
    const result = checkClaims([{ text: 'Lorries over 7.5 t may not drive on Sundays and public holidays from 00:00 to 22:00 (Fahrverbot).', source_id: 'S1', quote: QUOTE }], [WEB], { language: 'en' });
    expect(result.kept).toHaveLength(1);
  });

  it('never lets the model write own-data facts: digits citing DAJC data are dropped', () => {
    const result = checkClaims([{ text: 'V Česku platí v neděli od 13:00 zákaz jízdy.', source_id: OWN.id, quote: 'Restriction: Sunday and public holiday driving ban.' }], [OWN], { language: 'cs' });
    expect(result.kept).toHaveLength(0);
    expect(result.dropped[0].reason).toMatch(/template/);
    const ok = checkClaims([{ text: 'V Česku platí v uvedený den zákaz jízdy nákladních vozidel (Sunday and public holiday driving ban).', source_id: OWN.id, quote: 'Restriction: Sunday and public holiday driving ban.' }], [OWN], { language: 'cs' });
    expect(ok.kept).toHaveLength(1);
  });

  it('accepts a quote despite whitespace, case and typographic differences', () => {
    expect(quoteFound('MIT EINEM   höchsten zulässigen Gesamtgewicht', WEB.text)).toBe(true);
    expect(quoteFound('kurz', WEB.text)).toBe(false);
    expect(numbersSupported('3.5 m', 'Breite 3,50 m')).toBe(true);
  });
});

describe('information about rules only - no "you can" / "you risk a fine"', () => {
  it.each([
    'Vy můžete v neděli jet.',
    'Můžete jet po dálnici.',
    'Vám hrozí pokuta 5 000 Kč.',
    'Hrozí vám pokuta.',
    'Musíte mít povolení.',
    'Môžete jazdiť v nedeľu.',
    'You can drive on Sunday.',
    'You will be fined if you drive.',
    'In your case the ban does not apply.',
    'Sie dürfen am Sonntag fahren.',
    'Ihnen droht ein Bußgeld.',
    'Może pan jechać w niedzielę.',
    'Grozi panu mandat.',
    'Możesz jechać autostradą.',
    'Vous pouvez circuler le dimanche.',
    'Your transport of perishable goods is exempt from the ban.',
    'The exception applies to this transport.',
    'Vaše přeprava je ze zákazu vyjmuta.',
    'Výjimka se na tuto přepravu vztahuje.',
    'Na túto prepravu sa výnimka vzťahuje.',
    'Twój pojazd jest zwolniony z zakazu.',
    'Ihr Lkw ist vom Fahrverbot ausgenommen.',
    'Diese Fahrt ist erlaubt.',
  ])('rejects %j', (text) => {
    expect(forbiddenPhrase(text)).not.toBeNull();
  });

  it.each([
    'Nákladní vozidla nad 7,5 t nesmějí v neděli jezdit po dálnicích.',
    'Lorries over 7.5 t may not drive on Sundays.',
    'Lkw über 7,5 t dürfen sonntags nicht fahren; sie dürfen nur mit Ausnahmegenehmigung fahren.',
    'Pojazdy powyżej 12 t nie mogą poruszać się w niedziele.',
    'Za porušení zákazu stanoví zákon pokutu.',
    'Zákaz se nevztahuje na přepravu zkazitelných potravin.',
    'Perishable goods are listed as an exception to the Sunday ban.',
    'Vom Fahrverbot ausgenommen sind Fahrten mit leicht verderblichen Lebensmitteln.',
  ])('keeps impersonal %j', (text) => {
    expect(forbiddenPhrase(text)).toBeNull();
  });

  it('drops such a statement even when its source supports it', () => {
    const result = checkClaims([{ text: 'Vy můžete jezdit, pokud vozidlo nepřesahuje limit.', source_id: 'S1', quote: QUOTE }], [WEB], { language: 'cs' });
    expect(result.kept).toHaveLength(0);
    expect(result.dropped[0].reason).toMatch(/personal/);
  });
});

describe('answer language', () => {
  it.each([
    ['cs', 'Platí v Rakousku zákaz jízdy pro nákladní vozidla nad 7,5 t v neděli?'],
    ['en', 'Is there a truck driving ban in Austria on Sunday?'],
    ['pl', 'Czy w Austrii obowiązuje zakaz ruchu ciężarówek w niedzielę?'],
    ['de', 'Gibt es am Sonntag ein Lkw-Fahrverbot in Österreich?'],
    ['sk', 'Platí v Rakúsku zákaz jazdy pre nákladné vozidlá v nedeľu?'],
  ])('detects %s', (lang, text) => {
    expect(detectLanguage(text)).toBe(lang);
  });

  it('ignores original terms in parentheses', () => {
    expect(detectLanguage('V neděli platí zákaz jízdy (Fahrverbot für Lastkraftwagen über die Grenze) pro nákladní vozidla.')).toBe('cs');
  });

  it('drops an answer written in another language than the question', () => {
    const claims = [{ text: 'Lorries over 7.5 t may not drive on Sundays and public holidays (Fahrverbot).', source_id: 'S1', quote: QUOTE }];
    expect(checkClaims(claims, [WEB], { language: 'pl' }).kept).toHaveLength(0);
    expect(checkClaims(claims, [WEB], { language: 'en' }).kept).toHaveLength(1);
  });
});
