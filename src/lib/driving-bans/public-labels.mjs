// Public wording for the /driving-bans page. The machine codes stay in the JSON API;
// the page shows these texts instead, so internal review codes never reach customers.

const BAN_STATES = {
  HAS_BAN: ['Verified bans', 'Ověřené zákazy'],
  NO_BAN: ['No driving bans (verified)', 'Bez zákazu (ověřeno)'],
  UNKNOWN: ['Not yet determined', 'Zatím nezjištěno'],
};

const VERIFICATION_STATES = {
  PRIMARY_VERIFIED: ['Verified from official sources', 'Ověřeno z úředních zdrojů'],
  CROSSCHECKED: ['Cross-checked, not yet confirmed by an official source', 'Křížově ověřeno, zatím bez potvrzení úředním zdrojem'],
  UNVERIFIED: ['Verification in progress', 'Ověření probíhá'],
  SOURCE_UNAVAILABLE: ['Official source unavailable', 'Úřední zdroj nedostupný'],
};

// Ordered: the first matching category wins; anything unmatched is an incomplete review.
const OPEN_ITEM_CATEGORIES = [
  { key: 'window', match: /^ACTIVE_WINDOW_NOT_REVERIFIED$/,
    en: 'The current period has not yet been re-verified against official sources.',
    cs: 'Aktuální období zatím nebylo znovu ověřeno z úředních zdrojů.' },
  { key: 'exemptions', match: /EXEMPTION|EXCEPTION(?!AL)|EASING|LOW_WATER/,
    en: 'The validity of some exemptions or relaxations is not confirmed by an official source.',
    cs: 'Platnost některých výjimek nebo úlev není potvrzena úředním zdrojem.' },
  { key: 'source', match: /SOURCE_UNAVAILABLE|NOT_RETRIEVED/,
    en: 'An official source could not be retrieved. This does not mean that a restriction was cancelled.',
    cs: 'Úřední zdroj se nepodařilo získat. Neznamená to, že omezení bylo zrušeno.' },
  { key: 'short_notice', match: /ADHOC|SHORT_NOTICE|CONDITION_TRIGGERED|NOT_YET_KNOWN/,
    en: 'Authorities may announce further restrictions at short notice (for example in hot weather or around holidays).',
    cs: 'Úřady mohou vyhlásit další omezení s krátkým předstihem (například při vedru nebo kolem svátků).' },
  { key: 'not_in_calendar', match: /NOT_(?:EVENT_)?ENCODED|NOT_ENUMERATED/,
    en: 'Some restrictions (for example regional, ADR or oversize transport rules) are not yet in the calendar.',
    cs: 'Některá omezení (například regionální, pro ADR nebo nadrozměrné přepravy) zatím nejsou v kalendáři.' },
];
const REVIEW_INCOMPLETE = {
  key: 'review',
  en: 'The review of official sources for this jurisdiction is not complete yet.',
  cs: 'Kontrola úředních zdrojů pro tuto jurisdikci zatím není úplná.',
};

const pick = (pair, cs) => (cs ? pair[1] : pair[0]);

export const banStateText = (state, cs = false) => pick(BAN_STATES[state] ?? BAN_STATES.UNKNOWN, cs);
export const verificationStateText = (state, cs = false) => pick(VERIFICATION_STATES[state] ?? VERIFICATION_STATES.UNVERIFIED, cs);

export const openItemCategory = code => OPEN_ITEM_CATEGORIES.find(category => category.match.test(code)) ?? REVIEW_INCOMPLETE;

/** Distinct public explanations for a jurisdiction's open review codes, in a stable order. */
export function openItemTexts(codes, cs = false) {
  const keys = new Set(codes.map(code => openItemCategory(code).key));
  return [...OPEN_ITEM_CATEGORIES, REVIEW_INCOMPLETE].filter(category => keys.has(category.key)).map(category => (cs ? category.cs : category.en));
}
