# Driving Bans – katalog zdrojů (Source Registry)

Katalog říká, odkud DAJC bere podklady pro zákazy jízd a jak by je v budoucnu
mohl získávat konektor. Obsahuje pouze metadata.

- Neobsahuje žádná pravidla a žádný zákaz nevytváří. Jediným registrem pravidel
  zůstává `data/driving-bans/canonical.json`.
- Jediným seznamem jurisdikcí zůstává `config/europe-coverage.mjs`. Katalog má
  přesně stejných 50 jurisdikcí ve stejném pořadí.
- Nemění stav ověření ani data ověření. Sestavení katalogu nechá `canonical.json`
  i veřejný snapshot beze změny (hlídá to test).

## Soubory

| Soubor | Účel |
| --- | --- |
| `src/lib/driving-bans/source-registry.mjs` | Čisté funkce bez sítě: sestavení, schéma (zod), odvození stavu, validace, CSV. |
| `config/driving-ban-sources/index.mjs` | Živý katalog sestavený ze stávajících registrů. |
| `config/driving-ban-sources/provider-candidates.mjs` | Kandidátní poskytovatelé dat, úřední strojová rozhraní, reference pro interoperabilitu. |
| `scripts/export-driving-ban-sources.mjs` | Export `source-catalog.json` a `source-catalog.csv`. |

Export spustíte příkazem `npm run driving-bans:sources`. Výstup se uloží do
`artifacts/driving-bans/`, adresář je v gitu ignorovaný. Cílový adresář lze změnit
přepínačem `--output`.

## Odkud záznamy pocházejí

| Původ (`origin`) | Zdroj | Použití (`evidence_use`) |
| --- | --- | --- |
| `CANONICAL` | zdroje v `canonical.json` | primární → `LEGAL_EVIDENCE`, sekundární → `CROSS_CHECK_ONLY` |
| `TARGETED_REVIEW` | cílená kontrola `source-reviews/2026-10-22.json` | `LEGAL_EVIDENCE` (zatím nepřevedeno na pravidla) |
| `OVERSIZE_MONITORING` | `config/oversize-sources/index.mjs` | `DISCOVERY_LEAD` – zprávy úřadů, nikdy samostatný právní důkaz |
| `PROVIDER_CANDIDATE` | `provider-candidates.mjs` | `FUTURE_CONNECTOR` |
| `MACHINE_INTERFACE` | `provider-candidates.mjs` | `MACHINE_INTERFACE` – úřední API k právním textům |

Úřední domény z `config/official-authority-domains.mjs` se zobrazují u jurisdikce
jako `official_domains`. Z domény se nikdy nesestavuje URL.

Záznam z cílené kontroly, který ukazuje na dokument už obsažený v katalogu, se
připojí jako alias. Kanonické identity se nikdy neslučují, protože na ně odkazují
pravidla.

## Pole záznamu

`source_id`, `jurisdiction`, `region`, `authority`, `name`, `url` (jen `https`,
jinak `null`), `url_reachability`, `role` (PRIMARY/SECONDARY), `origin`,
`evidence_use`, `categories`, `restriction_classes`, `legal_scope`,
`geographic_scope`, `document_version`, `acquisition` (způsob, formáty, požadavky
na přístup), `gates`, `licence`, `rights`, `commercial_use_note`,
`update_frequency`, `last_verified_at`, `availability`, `retrieval_method`,
`content_sha256`, `machine_interface_id`, `other_dajc_uses`, `blockers`,
`provenance_refs`, `connector_id`, `integration_status`.

Schéma je striktní: neznámé pole (například kontakt) se odmítne.

**Kategorie obsahu:** `STATUTORY_WEEKEND_HOLIDAY`, `NIGHT_SEASONAL`,
`REGIONAL_DIRECTIONAL`, `TEMPORARY_RESTRICTIONS_CLOSURES`, `WEIGHT_DIMENSION`,
`ADR_SPECIAL_TRANSPORT`, `EXCEPTIONS_PERMITS_DECISIONS`,
`AUXILIARY_TRAFFIC_INFRASTRUCTURE`. U kanonických zdrojů se kategorie odvozují
z kontrol rozsahu (`scope_checks`), u kterých je zdroj uveden jako důkaz. Kategorie
proto znamená „zdroj byl pro tuto oblast posouzen“, nikoli „obsahuje zákaz“. Kde se
kategorie odvodit nedá, zůstává seznam prázdný (nehádá se).

**Druhy omezení:** `LEGAL_DRIVING_BAN`, `TEMPORARY_TRAFFIC_RESTRICTION`,
`INFRASTRUCTURE_CONSTRAINT`, `PERMIT_CONDITION`. Nikdy se nesměšují. Mostní limity
z Maďarska jsou například jen `INFRASTRUCTURE_CONSTRAINT`.

**Práva (`rights`)** používají stejné hodnoty jako stávající kontrakt
`src/lib/intelligence/persistence-contract.ts` (`allowed` / `denied` / `unknown`).
Jiná hodnota než `unknown` je povolená jen při `licence.basis =
PUBLISHED_TERMS_VERIFIED`, tedy po ověření zveřejněných licenčních podmínek.

## Stav integrace

Stav se nezadává ručně. Odvozuje se z doložených faktů jako první nesplněná brána:

| Podmínka | Stav |
| --- | --- |
| technická dokumentace není doložena (nebo jde jen o ruční právní text) | `SOURCE_IDENTIFIED` |
| dokumentace doložena, přístup neznámý / nevyžádaný | `TECHNICALLY_DOCUMENTED` |
| přístup vyžaduje registraci nebo je požádáno | `ACCESS_PENDING` |
| přístup otevřený či udělený, licence neověřena | `LICENCE_PENDING` |
| vše doloženo, konektor neexistuje | `INTEGRATION_READY` |
| konektor je skutečně implementován (`IMPLEMENTED_CONNECTORS`) | `ACTIVE` |

V této fázi je `IMPLEMENTED_CONNECTORS` prázdné. Stav `ACTIVE` proto nemůže vzniknout.
Ruční nastavení stavu odmítne validace.

Podklad pro každou bránu se zaznamenává (`basis`): `VERIFIED_RESPONSE`,
`PUBLIC_DOCUMENTATION`, `PROVIDER_DOCUMENTATION`, `PRODUCTION_USE`, `NONE`.
Technický popis od poskytovatele se počítá jako dokumentace. Tvrzení poskytovatele
o licenci (`PROVIDER_STATEMENT`) licenci neověřuje.

## Kandidátní poskytovatelé

| Záznam | Stav | Hlavní blokace |
| --- | --- | --- |
| HU Magyar Közút – Útinform DATEX II 2.3 | `ACCESS_PENDING` | registrace a schválený odběr; ověřit CC BY 4.0 |
| HU Magyar Közút – podmínky mostů WFS/GML | `ACCESS_PENDING` | registrace; endpoint zatím neznámý; geodata nepatří do `canonical.json` |
| DE Mobilithek | `SOURCE_IDENTIFIED` | výběr konkrétních datových sad; licence podle vlastníka dat |
| DK Vejdirektoratet – Dataudveksleren | `SOURCE_IDENTIFIED` | identifikace datových sad; přihlášení eID/eIDAS |
| IT Open Data Hub – DATEX II (R&D) | `TECHNICALLY_DOCUMENTED` | licence a produkční podmínky neuzavřené; jen Jižní Tyrolsko |
| BE Transportdata.be, Brusel, Flandry (DATEX II, TN-ITS), Valonsko (PEREX) | `SOURCE_IDENTIFIED` / `TECHNICALLY_DOCUMENTED` | regionální působnost oddělená; PEREX vyžaduje administrativní krok |
| PL GUGiK, SI GURS, IS Vegagerðin | `SOURCE_IDENTIFIED` | identifikace služeb a vrstev |
| AT RIS open data, PL ELI API Sejmu | `LICENCE_PENDING` | rozhraní odpověděla strojově čitelně 27. 10. 2026; podmínky opětovného užití neověřeny |

NAPCORE a ERTICO jsou vedené jako reference pro interoperabilitu
(`interoperability_references`), ne jako zdroje dat konkrétní jurisdikce.

Do repozitáře nepatří jména, e-maily, telefony, přílohy ani obchodní podmínky
z korespondence. Validace odmítne e-mailové adresy a telefonní čísla v záznamech
poskytovatelů. URL je uvedena jen tehdy, když 27. 10. 2026 odpověděla. Jinak je
`null` (Flandry, Valonsko/PEREX, mostní WFS).

## Pravidla pro budoucí konektory

1. `source_id` je trvalý a nikdy se znovu nepoužije. Kanonické identifikátory zůstávají,
   kandidáti mají předponu `provider:`, rozhraní předponu `interface:`.
2. Konektor dostane vlastní `connector_id` a zapíše se do `IMPLEMENTED_CONNECTORS`
   až ve chvíli, kdy skutečně běží. Teprve pak může být stav `ACTIVE`.
3. Konektor nezapisuje do `canonical.json`. Vytváří návrhy pro kontrolní vrstvu (PR 2).
4. Geodata a syrové výstupy poskytovatelů se ukládají mimo `canonical.json`.
5. Licence se mění na ověřenou jen s odkazem na zveřejněné podmínky.

## Stav k 27. 10. 2026 (bez zdrojů přidaných v PR #80)

- 140 záznamů: 59 kanonických, 13 z cílené kontroly, 56 zpravodajských zdrojů Oversize,
  12 kandidátů a 2 strojová rozhraní.
- Stavy: 120 `SOURCE_IDENTIFIED`, 2 `TECHNICALLY_DOCUMENTED`, 2 `ACCESS_PENDING`,
  16 `LICENCE_PENDING`, 0 `INTEGRATION_READY`, 0 `ACTIVE`.
- 49 jurisdikcí má zdroj s URL, San Marino má jen úřední doménu.
- 30 jurisdikcí zatím nemá žádný primární právní podklad: AD, AL, AM, AZ, BA, BY,
  CY, DK, EE, FI, GE, IE, IS, KZ, LT, LV, MC, MD, MK, MT, NL, NO, RO, RS, RU, SE,
  SM, TR, UA, XK.
