// Czech wording of the fixed texts the shared Driving Bans contract returns
// (warnings, disclaimer, next step). The contract itself stays English and
// unchanged; paid DAJC AI shows its deterministic registry answer in the
// interface language. Every translation is a fixed template with the same
// meaning - no AI, no paraphrase of legal content. A text without a template
// stays in English (never guessed); registry-i18n.test.ts fails when the
// shared contract gains a text that has no template here.

import type { UiLang } from '../i18n';

type Template = [pattern: RegExp, cs: (...groups: string[]) => string];

const J = '([A-Z]{2}(?:-[A-Z0-9]{1,3})?)';
const DATE = '(\\d{4}-\\d{2}-\\d{2})';

export const REGISTRY_TEMPLATES_CS: Template[] = [
  [new RegExp(`^${J}: insufficient verified data for this period; this is not evidence that there is no ban\\.$`),
    (j) => `${j}: pro toto období není k dispozici dost ověřených údajů; neznamená to, že zákaz neplatí.`],
  [new RegExp(`^${J}: a verified ban applies, but the coverage of the whole jurisdiction is not confirmed; this list may be incomplete\\.$`),
    (j) => `${j}: platí ověřený zákaz, ale pokrytí celé jurisdikce není potvrzeno; tento seznam může být neúplný.`],
  [/^No verified legal driving ban applies in the DAJC registry, which is verified in full for this period\. Temporary traffic restrictions, roadworks and permit conditions are not part of the registry\.$/,
    () => 'V registru DAJC, který je pro toto období ověřen v plném rozsahu, neplatí žádný ověřený zákonný zákaz jízdy. Dočasná dopravní omezení, stavební práce a podmínky povolení nejsou součástí registru.'],
  [/^For at least one listed rule it could not be determined whether it applies to this vehicle \(missing or ambiguous vehicle data or legal criterion\); treat it as applying until checked\.$/,
    () => 'U alespoň jednoho uvedeného pravidla nebylo možné určit, zda se vztahuje na toto vozidlo (chybějící nebo nejednoznačné údaje o vozidle nebo právní kritérium); dokud to neověříte, považujte ho za platné.'],
  [new RegExp(`^${J}: verification of the whole jurisdiction is incomplete; further restrictions may exist\\.$`),
    (j) => `${j}: ověření celé jurisdikce není úplné; mohou platit další omezení.`],
  [/^Exceptions are listed but not evaluated; their conditions must be checked for the actual vehicle and load\.$/,
    () => 'Výjimky jsou uvedeny, ale nejsou vyhodnoceny; jejich podmínky je nutné ověřit pro konkrétní vozidlo a náklad.'],
  [new RegExp(`^${J}: no verified ban applies at (\\S+) for this vehicle, but coverage does not prove that none exists\\.$`),
    (j, at) => `${j}: v čase ${at} se na toto vozidlo nevztahuje žádný ověřený zákaz, ale pokrytí neprokazuje, že žádný neexistuje.`],
  [new RegExp(`^Segment (\\d+) \\(${J}\\): Jurisdiction coverage is not completely verified for this segment; missing events are not evidence of no ban\\.$`),
    (n, j) => `Úsek ${n} (${j}): pokrytí jurisdikce není pro tento úsek plně ověřeno; chybějící události neznamenají, že zákaz neplatí.`],
  [new RegExp(`^Segment (\\d+) \\(${J}\\): Segment time is outside the published window ${DATE}-${DATE}\\.$`),
    (n, j, from, to) => `Úsek ${n} (${j}): čas úseku je mimo zveřejněné období ${from} až ${to}.`],
  [/^Some conflicts are POSSIBLE only: the route roads or the rule scope \(road class, region, vehicle data\) cannot be matched exactly\.$/,
    () => 'Některé střety jsou jen MOŽNÉ: silnice na trase nebo rozsah pravidla (třída silnice, region, údaje o vozidle) nelze přesně spárovat.'],
  [/^(\d+)-jurisdiction primary coverage is incomplete for the requested period; missing records are not NO_BAN\.$/,
    (n) => `Primární pokrytí ${n} jurisdikcí není pro požadované období úplné; chybějící záznamy neznamenají, že zákaz neplatí.`],
  [/^(\S+) has no verified event in the published period\.$/,
    (id) => `${id}: ve zveřejněném období nemá žádnou ověřenou událost.`],
  [/^No reviewed change log is available\.$/,
    () => 'Není k dispozici žádný zkontrolovaný záznam změn.'],
  [new RegExp(`^${J}: no reviewed source is recorded for the published period\\.$`),
    (j) => `${j}: pro zveřejněné období není zaznamenán žádný zkontrolovaný zdroj.`],
  [new RegExp(`^${J}: no verified rule in the published period\\.$`),
    (j) => `${j}: ve zveřejněném období není žádné ověřené pravidlo.`],
  [/^Rule is not marked for exceptional transport; the permit may still restrict times\.$/,
    () => 'Pravidlo není označeno pro nadrozměrnou přepravu; povolení může časy jízdy přesto omezovat.'],
  [/^Check the national ADR regime separately\.$/,
    () => 'Národní režim ADR ověřte zvlášť.'],
  [/^(\S+) is part of paid DAJC AI and needs a server-side entitlement\.$/,
    (tool) => `${tool} je součástí placené DAJC AI a vyžaduje oprávnění ověřené na serveru.`],
  [/^Source rights do not allow derived answers\.$/,
    () => 'Práva ke zdroji neumožňují odvozené odpovědi.'],
  // Disclaimers and next steps.
  [/^DAJC AI explains published, verified Driving Bans data\. It does not grant exceptions or permits and does not confirm that a journey is authorised; check permit conditions and the competent authority\.$/,
    () => 'DAJC AI vysvětluje zveřejněné a ověřené údaje o zákazech jízdy. Neuděluje výjimky ani povolení a nepotvrzuje, že je jízda povolena; ověřte podmínky povolení a příslušný úřad.'],
  [/^DAJC lists published, verified Driving Bans data\. It does not grant exceptions or permits and does not confirm that a journey is authorised; check permit conditions and the competent authority\.$/,
    () => 'DAJC uvádí zveřejněné a ověřené údaje o zákazech jízdy. Neuděluje výjimky ani povolení a nepotvrzuje, že je jízda povolena; ověřte podmínky povolení a příslušný úřad.'],
  [/^Check the competent authority or official source before travelling\.$/,
    () => 'Před jízdou ověřte údaje u příslušného úřadu nebo v oficiálním zdroji.'],
  [/^Confirm the listed restriction, exceptions and permit conditions with the official source\.$/,
    () => 'Uvedené omezení, výjimky a podmínky povolení ověřte v oficiálním zdroji.'],
  [/^Re-check before departure; data is refreshed after each review\.$/,
    () => 'Před odjezdem údaje znovu ověřte; aktualizují se po každé kontrole.'],
  [/^No data returned\.$/,
    () => 'Nebyla vrácena žádná data.'],
];

/** The Czech text for a fixed contract text, or null when there is no template. */
export function registryTextCs(text: string): string | null {
  for (const [pattern, cs] of REGISTRY_TEMPLATES_CS) {
    const match = pattern.exec(text);
    if (match) return cs(...match.slice(1));
  }
  return null;
}

interface LocalisableAnswer {
  warnings: string[];
  disclaimer: string;
  next_step: string;
}

/** A copy of the registry answer with its fixed texts in the interface language. */
export function localizeRegistryAnswer<T extends LocalisableAnswer>(answer: T, lang: UiLang): T {
  if (lang !== 'cs') return answer;
  const tr = (text: string) => (typeof text === 'string' ? registryTextCs(text) ?? text : text);
  return { ...answer, warnings: answer.warnings.map(tr), disclaimer: tr(answer.disclaimer), next_step: tr(answer.next_step) };
}
