# Driving Bans 2.0 – audit, konektory, Intelligence a DAJC AI

Čtvrtý krok Driving Bans 2.0. Navazuje na Source Registry (PR 1), ruční import
a schvalování (PR 2) a ověřování se zjišťováním změn (PR 3). Nic z tohoto kroku
se nepřipojuje k externí službě, nemění `canonical.json` a nic nezveřejňuje.

## Tři vrstvy

| Vrstva | Kdo ji vidí | Zdroj dat | Stav |
| --- | --- | --- | --- |
| Veřejná Driving Bans | všichni, zdarma | jen `canonical.json` přes `config/driving-ban-calendars/runtime.mjs` | v provozu, beze změny |
| Kontrolní vrstva | redakce DAJC | Source Registry, `data/driving-bans/staging/`, kontroly pravidel, audit | implementováno offline |
| Intelligence a DAJC AI | předplatitelé (budoucí) | publikovaný snapshot plus rozhodnutí kontrolní vrstvy | jen kontrakty, vypnuto |

Veřejná stránka, `/api/driving-bans.json` a `/api/driving-bans.ics` se nemění a
zůstávají zdarma. Lint (`npm run lint:driving-bans`) nově selže, pokud by
jakákoli veřejná stránka nebo API v `src/pages` importovala kontrakty
Intelligence nebo AI z tohoto kroku.

## Co je skutečně implementováno a co je jen rozhraní

| Oblast | Implementováno | Jen rozhraní nebo návrh |
| --- | --- | --- |
| Rozšířený audit | ano: nové výstupy, oddělení technické kontroly od právní | – |
| Feature flagy a oprávnění | ano: kód a testy | flagy nejsou nikde nastavené, produkt není vydaný |
| Vehicle-aware a route-aware | ano: čisté funkce nad snapshotem | žádné API, žádné UI |
| Upozornění a historie | ano: převod změn na existující `buildAlertCandidates` | žádné odesílání, žádné úložiště |
| DAJC AI | ano: read-only kontrakt nástrojů a formát odpovědi | žádný model, žádné AI API |
| Konektory | ano: rozhraní, validace a dva fixture adaptéry | žádný skutečný konektor (`IMPLEMENTED_CONNECTORS = []`) |
| Čtvrteční rutina | – | návrh v `DRIVING_BANS_THURSDAY_ROUTINE_PROPOSAL.md`, čeká na samostatné provedení |

## Rozšířený audit

`npm run driving-bans:audit -- --mode validate` (také `quick` a `daily`, obojí offline
a jen pro čtení) zachová všechny dosavadní výstupy a přidá:

| Soubor | Obsah |
| --- | --- |
| `source-catalog.json`, `.csv` | Source Registry k datu běhu |
| `rule-checks.json` | sémantická zjištění z `checkRules` |
| `evidence-findings.json` | zastaralé důkazy (`EXPIRED_EVIDENCE`) |
| `review-queue.json` | návrhy v kontrolní vrstvě a jejich stav |
| `jurisdiction-report.json`, `.csv` | přehled po jurisdikcích |
| `classified-changes.json` | klasifikované změny proti `--previous` |
| `audit-report.html` | statický přehled bez skriptů (CSP `default-src 'none'`) |

`summary.json` nově obsahuje `technical_check: TECHNICAL_CHECK_COMPLETE` a zvlášť
`legal_review: LEGAL_REVIEW_COMPLETE | LEGAL_REVIEW_INCOMPLETE`. Úspěšný technický
běh nikdy neobnoví `last_verified` ani `last_checked`. Dále obsahuje počty ověřených a
neověřených jurisdikcí, jurisdikce bez primárního právního zdroje, konflikty,
zastaralé důkazy, stav fronty návrhů s kontrolou hashového řetězce auditní stopy,
připravenost konektorů a datum posledního úplného průchodu registru (zatím `null`,
žádný úplný průchod není zaznamenán). `scripts/driving-bans-technical-status.mjs`
přidává `technical_check` a `legal_review: NOT_PERFORMED`.

## Feature flagy a oprávnění (`src/lib/intelligence/entitlements.ts`)

Vše je zakázáno, dokud neplatí všechny tři podmínky:

1. `DRIVING_BANS_INTELLIGENCE_RELEASED` je `true`. Dnes je `false` a změnit ho jde jen
   revidovanou změnou kódu.
2. Proměnná prostředí funkce má přesně hodnotu `"true"`:

   | Funkce | Proměnná |
   | --- | --- |
   | vehicle-aware | `DAJC_INTELLIGENCE_VEHICLE_AWARE_ENABLED` |
   | route-aware | `DAJC_INTELLIGENCE_ROUTE_AWARE_ENABLED` |
   | alerts | `DAJC_INTELLIGENCE_ALERTS_ENABLED` |
   | history | `DAJC_INTELLIGENCE_HISTORY_ENABLED` |
   | organisation-preferences | `DAJC_INTELLIGENCE_PREFERENCES_ENABLED` |
   | ai-assistant | `DAJC_AI_DRIVING_BANS_ENABLED` |

3. Ověřený subjekt má oprávnění své organizace, které funkci obsahuje a nevypršelo.

`handleEntitledRequest` vrací 404 u vypnuté funkce (neprozradí její existenci),
401 bez přihlášení a 403 bez oprávnění. Organizace se bere jen z ověřeného
subjektu, nikdy z URL, dotazu nebo těla požadavku. `requireSameTenant` a
`tenantRecords` oddělují data organizací.

## Vehicle-aware (`driving-bans-relevance.ts`)

`evaluateVehicleApplicability` porovná vozidlo s publikovanou událostí a vrátí
`APPLIES`, `DOES_NOT_APPLY` nebo `UNDETERMINED`.

- Kritérium (hmotnost, počet náprav, rozměr) se porovná jen tehdy, když text
  pravidla jednoznačně určuje veličinu: například největší povolenou hmotnost
  vozidla, soupravy nebo přívěsu, nebo skutečnou hmotnost.
- Když chybí údaj o vozidle nebo text pravidla neurčuje veličinu, výsledek je
  `UNDETERMINED`, nikdy `DOES_NOT_APPLY`.
- Výjimky se nikdy nevyhodnocují. Odpověď je jen vypíše a odkáže na úřad.

## Route-aware

`findRouteConflicts` porovná úseky trasy (jurisdikce, silnice, třída silnice,
čas průjezdu) s událostmi:

- `NETWORK_WIDE` a `ROAD_MATCH` mají jistotu `LIKELY`,
- `ROAD_CLASS_SCOPE` a `ROADS_NOT_SPECIFIED_BY_ROUTE` mají jistotu `POSSIBLE`.

Jurisdikce, která není úplně ověřená, nebo čas mimo ověřené období dá
`INSUFFICIENT_VERIFIED_DATA`, nikdy „bez zákazu“.

## Upozornění a historie (`driving-bans-alerts.ts`)

- `buildDrivingBansAlerts` převádí změny z `detectChanges` (PR 3) na
  `IntelligenceChange` a předává je stávajícímu `buildAlertCandidates`.
- `METADATA_ONLY` neupozorňuje.
- `SOURCE_UNAVAILABLE` se hlásí jako „Verification withdrawn (ban NOT cancelled)“.
- `expiringRuleNotices` hlásí pravidla, kterým brzy končí platnost.
- `buildRuleHistory` skládá historii pravidla napříč verzemi datasetu, například
  z historie gitu.

## DAJC AI (`driving-bans-ai-contract.ts`)

Read-only nástroje: `search_bans`, `evaluate_vehicle`, `check_route`,
`explain_rule`, `list_changes`, `list_exceptions`.

Zakázané akce: `approve_exception`, `issue_permit`, `modify_route`,
`modify_dataset`, `declare_authorisation_to_drive`. Neznámý nástroj vyhodí chybu.

Obě vstupní funkce sdílejí jedno vyhodnocení nad stejným publikovaným snapshotem.
Liší se jen tím, kdo smí volat a které nástroje:

| | Bezplatné „Zeptejte se DAJC AI“ | Placená DAJC AI |
| --- | --- | --- |
| Funkce | `answerFreeAskQuery` | `answerDrivingBansQuery` |
| Přístup | vlastní brána Ask: `DAJC_ASK_ENABLED`, přihlášení, denní limit | `authorizeFeature('ai-assistant')` na serveru při každém volání |
| Placené oprávnění | nevyžaduje se a nekontroluje | povinné, organizace jen z ověřeného subjektu |
| Nástroje | `FREE_ASK_TOOLS`: `search_bans` (bez vozidla), `explain_rule`, `list_exceptions` | všech šest |
| Práva ke zdroji | `canCreateDerivedIntelligence` bez organizace | `canCreateDerivedIntelligence` s organizací |

Nástroj mimo `FREE_ASK_TOOLS` vrátí v bezplatné vrstvě `NOT_ENTITLED`.
Porovnání s vozidlem, kontrola trasy a historie změn tak zůstávají placené.

Každá odpověď nese obálku: fakta, zdroje, platnost, verze pravidel, úplnost,
varování, `authority_check_required`, další krok a pevné upozornění.

U časově vymezeného dotazu nese úplnost pro každou jurisdikci `outcome`:

- `BAN_FOUND`: platí alespoň jeden ověřený právní zákaz jízdy.
- `NO_CONFIRMED_BAN`: jurisdikce je pro publikované období ověřená v plném rozsahu
  a žádný ověřený zákaz neplatí. Jde o výrok o registru, ne o dočasných
  dopravních omezeních nebo podmínkách povolení.
- `INSUFFICIENT_VERIFIED_DATA`: vše ostatní, včetně data mimo publikované období.
  Nedostatek dat nikdy neznamená, že zákaz neexistuje.

Žádný jazykový model se nevolá: kontrakt určuje, co smí model dostat a co smí odpovědět.

## Konektory (`driving-ban-connectors.ts`)

`DrivingBanConnector.retrieve({ now })` vrací `ConnectorResult`: záznamy s
původem, časem, licencí, územním rozsahem a normalizovaným návrhem omezení.

`validateConnectorResult` zajišťuje:

- provozní kanály (DATEX II, TN-ITS, OGC API, WFS, WMS, RSS/Atom) nesmí vytvořit
  `LEGAL_DRIVING_BAN`; smí jen `TEMPORARY_TRAFFIC_RESTRICTION`,
  `INFRASTRUCTURE_CONSTRAINT` nebo `PERMIT_CONDITION`,
- `complete` smí být jen výsledek se stavem `OK`.

`connectorResultToSubmission` převede výsledek na podání PR 2 s pravidly
`UNVERIFIED`. Konektor tedy nikdy nepublikuje: jeho výstup prochází stejnou frontou
a stejným lidským schválením jako ruční podklady.

Fixture adaptéry čtou jen z `tests/fixtures/driving-ban-connectors/`:

- `createDatex2FixtureConnector` odmítá `DOCTYPE` a `ENTITY` a platnost modeluje jako
  souvislý interval,
- `createRssFixtureConnector` čte RSS přes `rss-parser`.

Oba soubory jsou syntetické.

## Doporučené pořadí napojení API

Každý skutečný konektor potřebuje revidovanou změnu kódu, která ho přidá do
`IMPLEMENTED_CONNECTORS`. Před tím musí platit:

- Source Registry má pro zdroj `licence_status: VERIFIED` a schválený přístup,
- přístupové údaje jsou jen v proměnných prostředí,
- síťová politika prostředí povoluje jen daný host,
- výpadek zdroje vede na `SOURCE_UNAVAILABLE`.

| Pořadí | Zdroj | Důvod | Stav v registru |
| --- | --- | --- | --- |
| 1 | `interface:at-ris-ogd`, `interface:pl-sejm-eli` | právní texty strojově, hlídání změn otisků pro PR 3 | LICENCE_PENDING |
| 2 | `provider:hu-magyar-kozut-utinform-datex2` | HU je plně ověřené, DATEX II přidá dočasná omezení | ACCESS_PENDING |
| 3 | `provider:it-open-data-hub-datex2` | brennerský koridor, dokumentované rozhraní | TECHNICALLY_DOCUMENTED |
| 4 | `provider:be-flanders-datex2-tnits` | dokumentované DATEX II a TN-ITS | TECHNICALLY_DOCUMENTED |
| 5 | `provider:de-mobilithek` | velký objem, vyžaduje registraci a výběr nabídek | SOURCE_IDENTIFIED |
| 6 | DK, BE (Transportdata.be, Brusel, PEREX) | doplnění provozních omezení | SOURCE_IDENTIFIED |
| 7 | HU WFS mostů, GUGiK, GURS, Vegagerðin | infrastrukturní omezení jen pro route-aware | SOURCE_IDENTIFIED / ACCESS_PENDING |

NAPCORE a ERTICO jsou reference pro interoperabilitu, ne zdroje dat.

## Otevřené licenční a technické otázky

- **Licence:** ani u jednoho zdroje není ověřená licence pro odvozenou placenou
  službu (`licence_status` jinde než `VERIFIED`).
- **Magyar Közút:** přístup ve stavu registrace. Upřesnit podmínky dalšího
  šíření a frekvenci aktualizace.
- **Mobilithek:** vybrat konkrétní nabídky. Ověřit, zda licence povoluje komerční
  odvozené služby.
- **Primární právní důkazy:** 30 jurisdikcí zatím nemá primární právní zdroj v
  registru (viz `missing_primary_sources` v auditu). Konektor to nenahradí.
- **Identita schvalovatele:** lokální `approve` nese `identity_verified: false`.
  Oprávněné schválení zůstává na GitHubu.
- **Provoz Intelligence:** úložiště pro historii a preference organizací a
  odesílání upozornění zatím neexistují.
