// Questions that ask DAJC AI to CONFIRM something only an authority, a permit
// or the road signs on site can confirm: that a route or road is passable,
// that an oversize transport is authorised, or that a legal exception
// applies to the asker. Plain code, not a model: whatever the classifier
// says, such a question always gets the fixed notice
// `noConfirmationNotice` ("DAJC AI nepotvrzuje průjezdnost trasy ...").
//
// Over-matching only adds that notice; it never removes or changes an
// answer. The statements themselves are held back by guard.ts
// (CONFIRMATION_PATTERNS), the draft prompt and the independent check.

function phrase(pattern: string): RegExp {
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${pattern})`, 'iu');
}

export const CONFIRMATION_REQUEST_PATTERNS: RegExp[] = [
  // Czech
  phrase('průjezdn\\p{L}*'), phrase('projed(?:u|eme|e)'), phrase('(?:můžu|mohu|můžeme|smím|smíme)\\s+(?:tam\\s+|tudy\\s+|tu\\s+|touto\\s+trasou\\s+)?(?:jet|projet|vjet|pokračovat|jezdit)'),
  phrase('(?:je|bude)\\s+(?:to|tato\\s+(?:trasa|přeprava|jízda)|moje\\s+(?:trasa|přeprava|jízda))\\s+(?:povolen\\p{L}*|legální|v\\s+pořádku|možn\\p{L}*)'),
  phrase('potřebuj(?:i|u|eme)\\s+(?:na\\s+to\\s+)?(?:povolení|výjimku)'), phrase('(?:mám|máme)\\s+nárok\\s+na\\s+výjimku'),
  phrase('(?:vztahuje|platí)\\s+se\\s+na\\s+(?:mě|nás|mne|můj|moji|naš\\p{L}*)\\s*(?:\\p{L}+\\s+)?výjimk\\p{L}*'), phrase('platí\\s+pro\\s+(?:mě|nás)\\s+výjimk\\p{L}*'), phrase('spadá(?:m|me)?\\s+pod\\s+výjimku'),
  // Slovak
  phrase('prejazdn\\p{L}*'), phrase('priechodn\\p{L}*'), phrase('(?:môžem|môžeme|smiem|smieme)\\s+(?:tam\\s+|tadiaľ\\s+)?(?:ísť|prejsť|prejazdiť|jazdiť|pokračovať)'),
  phrase('potrebuj(?:em|eme)\\s+(?:na\\s+to\\s+)?(?:povolenie|výnimku)'), phrase('vzťahuje\\s+sa\\s+na\\s+(?:mňa|nás)\\s+výnimk\\p{L}*'),
  // Polish
  phrase('przejezdn\\p{L}*'), phrase('czy\\s+(?:mogę|możemy|wolno\\s+mi|wolno\\s+nam)\\s+(?:tam\\s+|tędy\\s+)?(?:przejechać|jechać|wjechać)'),
  phrase('(?:potrzebuję|potrzebujemy)\\s+(?:zezwolenia|pozwolenia|wyjątku)'), phrase('czy\\s+(?:mnie|nas)\\s+dotyczy\\s+wyjątek'), phrase('przysługuje\\s+(?:mi|nam)\\s+wyjątek'),
  // German
  phrase('befahrbar'), phrase('passierbar'), phrase('(?:darf|kann)\\s+ich\\s+(?:dort\\s+|hier\\s+)?(?:fahren|durchfahren|weiterfahren|einfahren)'),
  phrase('brauche\\s+ich\\s+(?:eine\\s+|die\\s+)?(?:Genehmigung|Ausnahmegenehmigung|Erlaubnis)'), phrase('gilt\\s+die\\s+Ausnahme\\s+für\\s+(?:mich|uns)'), phrase('bin\\s+ich\\s+(?:davon\\s+)?ausgenommen'),
  // English
  phrase('passable'), phrase('(?:can|may)\\s+(?:i|we)\\s+(?:still\\s+)?(?:drive|go|pass|use|take|travel|continue|enter)'), phrase('am\\s+i\\s+(?:allowed|permitted|authori[sz]ed|exempt)'),
  phrase('do\\s+(?:i|we)\\s+need\\s+(?:a\\s+|an\\s+)?(?:special\\s+)?(?:permit|authori[sz]ation|exemption)'),
  phrase('is\\s+(?:my|our|this|the)\\s+(?:route|transport|load|journey|trip|move)\\s+(?:ok|okay|fine|clear|allowed|legal|permitted|authori[sz]ed|possible)'),
  phrase('(?:does|would)\\s+(?:the|an|this)\\s+(?:exception|exemption|derogation)\\s+apply\\s+to\\s+(?:me|us|my|our)'),
];

/** True when the question asks DAJC AI to confirm passability, an authorisation or an exception. */
export function asksForConfirmation(question: string): boolean {
  const text = String(question || '');
  return CONFIRMATION_REQUEST_PATTERNS.some((pattern) => pattern.test(text));
}
