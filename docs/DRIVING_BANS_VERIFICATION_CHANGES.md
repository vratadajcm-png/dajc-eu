# Driving Bans – ověřování a detekce změn

Rozšíření `src/lib/driving-bans/`. Nejde o druhý „Intelligence Engine“.
`src/lib/intelligence/change-detection.ts` dál porovnává jednotlivé výskyty pro
upozornění odběratelů. Tato vrstva klasifikuje změny pravidel v registru a staví
na stávajícím `diffCanonical`.

| Soubor | Účel |
| --- | --- |
| `src/lib/driving-bans/rule-checks.mjs` | sémantické kontroly nad datasetem (`checkRules`) |
| `src/lib/driving-bans/legal-changes.mjs` | klasifikace změn (`detectChanges`) a zastaralé důkazy (`assessEvidence`) |
| `scripts/driving-bans-changes.mjs` | porovnání dvou datasetů: `npm run driving-bans:changes -- --after kandidat.json` |

## Druhy omezení

Pravidlo může nést `restriction_class`:

- `LEGAL_DRIVING_BAN` (výchozí pro všechna stávající kalendářová pravidla),
- `TEMPORARY_TRAFFIC_RESTRICTION`,
- `INFRASTRUCTURE_CONSTRAINT`,
- `PERMIT_CONDITION`.

Do veřejného kalendáře (web, JSON, ICS, Intelligence) a do stavu `HAS_BAN` vstupují
jen `LEGAL_DRIVING_BAN`. Ostatní druhy lze evidovat, ale jako zákaz jízdy se nikdy
nezobrazí. Neznámý druh odmítne `validateCanonical`.

## Kontroly (`checkRules`)

| Kód | Co znamená | Dopad na návrh z PR 2 |
| --- | --- | --- |
| `SOURCE_CONFLICT` | různé zdroje dávají pro stejný rozsah a den jiné hodiny | `CONFLICT` |
| `DUPLICATE_SEMANTIC_EVENT` | dvě pravidla dávají totožnou událost | `CONFLICT` |
| `WEIGHT_UNIT_SUSPECT` | hmotnost v kg mimo 1 000–100 000 (pravděpodobně tuny) | `INSUFFICIENT_EVIDENCE` |
| `WEIGHT_TEXT_MISMATCH` | zakódovaná hmotnost není uvedena v popisu vozidel | `INSUFFICIENT_EVIDENCE` |
| `NATIONAL_RULE_SEPARATE_REGIME` | celostátní pravidlo bez `regions`/`excluded_regions` v zemi s regiony s vlastním režimem (ES: Katalánsko, Baskicko; PT: Azory, Madeira) | `INSUFFICIENT_EVIDENCE` |
| `UNKNOWN_RESTRICTION_CLASS`, `CALENDAR_EXPANSION_FAILED` | neznámý druh, nemožný místní čas | `INSUFFICIENT_EVIDENCE` |
| `TIMEZONE_NOT_EXPECTED` | časové pásmo nepatří jurisdikci | jen poznámka pro posuzovatele |
| `SUPERSEDED_STILL_ACTIVE` | nahrazené pravidlo je stále `ACTIVE` | jen poznámka |
| `REGIONAL_OVERLAP` | regionální varianta se kryje s celostátním pravidlem s jinými hodinami | jen poznámka |
| `REVIEW_WINDOW_SHORTER_THAN_SPAN` | pravidlo je ověřené jen do části období | informativní |

Proti návrhu se počítají jen nálezy, které návrh nově přináší (`newFindings`).
Na udržovaném datasetu `checkRules` nehlásí nic k posouzení. Kontroly přechodu
na letní čas a nemožných místních časů zůstávají v `localToUtc`.

## Typy změn (`detectChanges`)

| Typ | Změna práva | Stav kontroly |
| --- | --- | --- |
| `NEW_RULE`, `AMENDED_RULE`, `CANCELLED_RULE`, `SUPERSEDED_RULE` | ano | `REVIEW_REQUIRED` |
| `NEW_EXCEPTION`, `REMOVED_EXCEPTION` | ano | `REVIEW_REQUIRED` |
| `SOURCE_UNAVAILABLE` | ne – zákaz se neruší | `REVIEW_REQUIRED` |
| `SOURCE_CONFLICT` | ne – rozpor ve zdrojích | `REVIEW_REQUIRED` |
| `REVIEW_REQUIRED` | ne – např. zmizelý záznam, výjimka bez nového důkazu | `REVIEW_REQUIRED` |
| `METADATA_ONLY` | ne – verze zdroje, čas kontroly, URL, metoda stažení | `INFORMATIONAL` (změna obsahu `content_sha256` → `REVIEW_REQUIRED`) |
| `COVERAGE_STATUS` | ne – změna stavu ověření jurisdikce | `INFORMATIONAL` |
| `EXPIRED_EVIDENCE` | ne – z `assessEvidence` k danému okamžiku | `REVIEW_REQUIRED` |

Každá změna obsahuje:

- `change_id` (stabilní otisk), `type`, `legal_change`,
- `jurisdiction`, `ban_id` / `source_id`, `field`, `before`, `after`,
- `detected_at`, `sources`,
- `legal_effective_from` (jen když je doložená: platnost nového pravidla nebo datum v záznamu o zrušení),
- `user_impact`, `reason`, `review_state`.

Zásady:

- Porovnání datasetu se sebou samým vrací prázdný seznam. Opakovaný import stejného důkazu proto nevytvoří žádnou změnu.
- Změna webové stránky, HTTP hlavičky nebo verze zdroje sama o sobě nikdy není změnou práva.
- Ztracený zdroj (`invalidateSources`) vede na `SOURCE_UNAVAILABLE`, nikdy na `CANCELLED_RULE`.
- Zmizelý záznam pravidla je `REVIEW_REQUIRED`, ne zrušení.

Na skutečné změně z fáze 0 (PR #80) dává klasifikace 42 právních změn
(19 nových pravidel, 8 úprav, 9 nových a 6 odebraných výjimek), 153 změn jen
metadat a 39 změn stavu pokrytí.
