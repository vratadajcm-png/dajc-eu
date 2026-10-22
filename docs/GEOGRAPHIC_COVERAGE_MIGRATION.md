# DAJC – migrace geografického pokrytí na 50 jurisdikcí

Stav: připraveno na vývojové větvi `fix/geographic-coverage-50-20261022` od main
`95772f61a875497d927398d18d580237c7914065`. Bez merge, release a nasazení.

## Rozsah

Jediným aktivním registrem je `config/europe-coverage.mjs`. Ostatní kontroly
odvozují počet, identitu a názvy z něj. Samostatný akceptační test porovnává
přesnou uživatelem schválenou množinu, takže nestačí libovolných 50 položek.

XK je provozní kód bez stanoviska k diplomatickému uznání. KZ/RU/TR mají pouze
evropský a návazný mezinárodní koridorový rozsah. AM/AZ/GE zůstávají zahrnuty.

### Ponecháno: 50

| Kód | Název v registru |
| --- | --- |
| AD | Andorra |
| AL | Albania |
| AM | Armenia |
| AT | Austria |
| AZ | Azerbaijan |
| BA | Bosnia and Herzegovina |
| BE | Belgium |
| BG | Bulgaria |
| BY | Belarus |
| CH | Switzerland |
| CY | Cyprus |
| CZ | Czechia |
| DE | Germany |
| DK | Denmark |
| EE | Estonia |
| ES | Spain |
| FI | Finland |
| FR | France |
| GE | Georgia |
| GR | Greece |
| HR | Croatia |
| HU | Hungary |
| IE | Ireland |
| IS | Iceland |
| IT | Italy |
| KZ | Kazakhstan (European transport scope) |
| LI | Liechtenstein |
| LT | Lithuania |
| LU | Luxembourg |
| LV | Latvia |
| MC | Monaco |
| MD | Moldova |
| ME | Montenegro |
| MK | North Macedonia |
| MT | Malta |
| NL | Netherlands |
| NO | Norway |
| PL | Poland |
| PT | Portugal |
| RO | Romania |
| RS | Serbia |
| RU | Russia (European transport scope) |
| SE | Sweden |
| SI | Slovenia |
| SK | Slovakia |
| SM | San Marino |
| TR | Türkiye (European transport scope) |
| UA | Ukraine |
| UK | United Kingdom |
| XK | Kosovo |

### Vyřazeno jako samostatná jurisdikce: 54

Regionální podmínky zůstávají pod zemí s přesným rozsahem; vyřazené závislé nebo
sporné území nedostává automaticky předpisy mateřské země.

| Kód | Původní název |
| --- | --- |
| AB | Abkhazia |
| ALDERNEY | Alderney |
| AW | Aruba |
| AX | Åland Islands |
| AZO | Azores |
| BAS | Basque Country |
| BL | Saint-Barthélemy |
| BQ-BO | Bonaire |
| BQ-SA | Saba |
| BQ-SE | Sint Eustatius |
| BRU | Brussels-Capital Region |
| CAN | Canary Islands |
| CAT | Catalonia |
| CEU | Ceuta |
| CLIPPERTON | Clipperton |
| CW | Curaçao |
| ENG | England |
| FBIH | Federation of Bosnia and Herzegovina |
| FLA | Flanders |
| FO | Faroe Islands |
| GAG | Gagauzia |
| GAL | Galicia |
| GF | French Guiana |
| GG | Guernsey |
| GI | Gibraltar |
| GL | Greenland (European jurisdiction link) |
| GP | Guadeloupe |
| IM | Isle of Man |
| JANMAYEN | Jan Mayen |
| JE | Jersey |
| MAD | Madeira |
| MF | Saint-Martin |
| MLL | Melilla |
| MQ | Martinique |
| NC | New Caledonia |
| NCY | Northern Cyprus |
| NIR | Northern Ireland |
| PF | French Polynesia |
| PM | Saint-Pierre-et-Miquelon |
| RE | Réunion |
| RSBA | Republika Srpska |
| RSM | Republic of San Marino road jurisdiction |
| SBA | Akrotiri and Dhekelia |
| SCT | Scotland |
| SO | South Ossetia |
| SVALBARD | Svalbard |
| SX | Sint Maarten |
| TF | French Southern and Antarctic Lands |
| TRN | Transnistria |
| VA | Vatican City |
| WAL | Wallonia |
| WF | Wallis and Futuna |
| WLS | Wales |
| YT | Mayotte |

## Změny a výsledek migrace

- 104 → 50 aktivních jurisdikcí; čtvrteční manifest používá přesně jejich kódy.
- Zachováno všech 182 kanonických pravidel včetně 168 ACTIVE a 14 SUPERSEDED.
  Test porovnává všechna původní pole pravidel, profily, hmotnosti, výjimky,
  směry, silnice, regiony, časy ověření a výsledné události/UID před a po změně.
  Žádné existující pravidlo nemělo vyřazený kód; nebylo nutné odhadovat platnost.
- 54 vyřazených přehledů jurisdikcí a 411 zastaralých řádků týdenního pokrytí
  přesunuto mimo aktivní monitoring. Původní soubory jsou v odděleném archivu.
- Z aktivních nálezů odstraněno 65 položek: 34 Jersey, 24 Vatikán, 6 Guernsey
  a 1 neurčitý nález „European Union“ bez přiřazení ke sledovaným zemím.
  Poslední položka vyžaduje ruční určení působnosti; není převedena odhadem.
- Zachováno 6 nálezů Madeiry pod PT s regionem Madeira. Sedmi nálezům zdroje
  Roads of the Federation of Bosnia and Herzegovina je zachován výslovný
  regionální rozsah pod BA. Regionální podmínky se nemění na celostátní.
- Oficiální zdroje 84 → 56. Odstraněno 28 zdrojových položek vyřazených území.
  Dva neodkazované kanonické zdroje (`li-asv`, `cesmad-2026`) jsou jen v archivu;
  žádná používaná evidence nebyla ztracena. Reference zdrojů a supersesí se validují.
- Vyhledávání má nadále 19 skupin se dvěma tematickými dotazy na skupinu.
  Počet AI volání touto úpravou neklesá na polovinu. Zužuje se jejich rozsah,
  odstraňuje se sběr 28 zdrojových položek a nevyhovující vstupy pro syntézu.
- Načítání automatické datové větve, ukládání nálezů, výběr kandidátů,
  generování briefingu a adaptéry/předvolby/alerty Intelligence vynucují centrální
  rozsah. Staré datové větve nemohou vrátit vyřazené území do aktivní syntézy.
- JSON API a ICS vracejí tutéž verzi pokrytí. ICS odmítne staré samostatné kódy
  (např. ENG, CAT, AZO, JE) místo tichého převodu na širší zemi.
- Existující práce s povoleními, trasami, dopravou, mýtem a doprovody zůstává
  v monitorovacích tématech. V tomto repozitáři nejsou samostatné produkční
  databáze Permit Hub nebo Routing s geografickými číselníky; ty se nevytvářejí.

## Záloha, opakování a obnovení

Před úpravami bylo zkopírováno 23 původních souborů do
`archive/geographic-coverage-20261022/original/`; `manifest.json` obsahuje
SHA-256 každého souboru a výchozí commit. Další aplikační dávky mají vlastní
neměnné zálohy a manifesty v `batches/`. Archiv není vstupem runtime, plánů,
AI dotazů ani veřejného exportu. Testy mohou archiv číst jako regresní důkaz.

Náhled migrace: `npm run migrate:geographic-coverage`.
Aplikace v připravené pracovní kopii: `npm run migrate:geographic-coverage -- --apply`.
Skript nejdřív připraví a zvaliduje celý plán, zálohuje všechna dotčená data a
pak atomicky nahrazuje jednotlivé soubory. Druhý běh nad výsledkem je beze změn.
Nalezená osiřelá supersese běh zastaví před zápisem. Nesledovatelná pravidla
odloží s požadavkem na ruční přiřazení, místo aby rozšířil jejich působnost.

Obnovení po případném schváleném nasazení musí vrátit kód i příslušná aktivní
data společně, nejlépe revertem migračního commitu po kontrole mezitím vzniklých
změn. Jednotlivé originály lze ověřit SHA-256 a obnovit z manifestu. Archiv se
nikdy nesmí přidat do runtime importů. Nespouštět starý monitor po nové migraci.

Partner Portal SQL schéma obsahuje identity partnerů, přístupy a audit, nikoli
aktivní geografický registr monitoringu. Nebylo změněno. Neproběhl žádný zásah do
externí databáze, obchodních dokladů, vydaných povolení ani auditní historie.
Intelligence má v tomto repozitáři paměťové implementace; vyřazené aktuální
snapshoty/čekající alerty se nevyužívají, historické položky zůstávají čitelné.

## Ověření

- Přesná množina 50 kódů, unikátnost, úplný rozklad vyhledávacích skupin.
- Regionální migrace pro UK/BE/ES/PT; zákaz zdědění předpisů závislými územími.
- Zachování všech 182 pravidel a událostí v původním posouzeném období.
- Skutečné obsluhy JSON a ICS: shoda registru, UID, UTC časů, rozsahu měsíců,
  verze pokrytí, odmítnutí nesledovaných kalendářových filtrů.
- Záloha před zápisem, idempotence a zachování kontrolních součtů archivu.
- Automatické kontroly i staré vstupy jsou omezeny centrálním registrem.
- Lokální sada: 630/630 testů v 57 souborech. Oba linty prošly. Typová kontrola: 0 chyb a 0 varování (64 informativních hints). Produkční build prošel. Stav vzdáleného CI bude v Pull Requestu.

Čtvrteční technický audit a jeho pravidla zůstávají aktivní v konfiguraci.
Při kontrolním čase 22. 10. 2026 10:00 UTC: 17 HAS_BAN, 0 NO_BAN, 33 UNKNOWN,
11 záznamů s úplným rozsahem ověření, 556 událostí v říjnu–listopadu a 318
nadcházejících událostí. Nejnovější zaznamenaná kontrola je stará 21,1 dne;
kontrola čerstvosti s limitem 8 dní proto správně neprojde. Technický průchod
neznamená aktuální právní ověření. Tato migrace neprovádí nové rešerše předpisů,
neposouvá jejich data ověření a nezmění UNKNOWN na NO_BAN.

## Body k dalšímu ověření

| Oblast | Zachovaný nebo nově výslovný požadavek |
| --- | --- |
| AT | Zemské zákazy na vedlejších komunikacích, tyrolský seznam zboží pro sektorální zákaz, podmínky povolení. |
| DE | Aktuálnost zemských výjimek pro nízký stav vody; německý celostátní zákaz se nemění. |
| ES | Regionální působnost Katalánska a Baskicka, regionální svátky a Annex V pro nadrozměrnou/ADR přepravu; žádný automatický přenos pravidel DGT. |
| BE / UK | Rozdíly mezi regiony zůstávají součástí kontroly země; původní neúplné ověření se nepovyšuje. |
| PT | Madeira/Azory pod PT s vlastním regionálním rozsahem; současné mezery svátků a ADR zůstávají. |
| KZ / RU / TR | Přesné přiřazení mezinárodnímu/evropskému koridoru musí mít zdroj a kontrolora; jinak nález zůstává diagnostikou k ověření. |
| Nález „European Union“ | Jeden historický neověřený nález je archivován k ručnímu určení dotčených zemí. |

Ostatní existující mezery zůstávají ve `coverage_failures`; nebyly automaticky uzavřeny.

## Aktivace a hranice schválení

Tato větev nevytváří veřejný release ani nasazení. `vercel.json` vypíná automatické
nasazení pouze této vývojové větve (podle oficiální konfigurace Vercel:
https://vercel.com/docs/project-configuration/git-configuration).

Main, živý web, produkční databáze a existující
větev `automation/oversize-data` se nyní nemění. Teprve po výslovném schválení
merge/aktivace začne produkce používat tuto konfiguraci. Následný běžný běh
monitoru normalizuje datovou větev přes nový vstupní filtr. Existující externí čtvrteční úloha
byla na následný pokyn uživatele upravena: do sloučení čte centrální registr
z aktuální hlavy PR #46, poté z main; nikdy nespouští původní rozsah 104. Nevzniká žádná nová paralelní úloha.

PR kontrola porovnává navržený dataset lokálně; ručně spuštěná produkční akceptace
na main nadále kontroluje skutečné veřejné HTTP odpovědi. PR tak nevyžaduje
zakázané předčasné nasazení jen kvůli porovnání 50 proti dosud živým 104.

## Přehled změněných souborů

- `.github/workflows/application-ci.yml`
- `.github/workflows/driving-bans-production-acceptance.yml`
- `.github/workflows/driving-bans-technical-only.yml`
- `.github/workflows/driving-bans-thursday.yml`
- `.gitignore`
- `config/driving-ban-calendars/canonical.mjs`
- `config/driving-ban-calendars/verification.mjs`
- `config/europe-coverage.mjs`
- `config/oversize-sources/index.mjs`
- `data/driving-bans/canonical.json`
- `data/driving-bans/source-reviews/2026-10-22.json`
- `data/oversize/2026-W34/findings.json`
- `data/oversize/2026-W35/coverage.json`
- `data/oversize/2026-W35/findings.json`
- `data/oversize/2026-W36/coverage.json`
- `data/oversize/2026-W36/findings.json`
- `data/oversize/2026-W37/coverage.json`
- `data/oversize/2026-W37/findings.json`
- `data/oversize/2026-W38/coverage.json`
- `data/oversize/2026-W38/findings.json`
- `data/oversize/2026-W39/coverage.json`
- `data/oversize/2026-W39/findings.json`
- `data/oversize/2026-W40/coverage.json`
- `data/oversize/2026-W40/findings.json`
- `data/oversize/2026-W41/coverage.json`
- `data/oversize/2026-W41/findings.json`
- `data/oversize/2026-W42/coverage.json`
- `data/oversize/2026-W42/findings.json`
- `docs/DRIVING_BANS_CANONICAL.md`
- `docs/DRIVING_BANS_OFFICIAL_WEB_REVIEW.md`
- `docs/DRIVING_BANS_TEST_MIGRATION.md`
- `docs/GEOGRAPHIC_COVERAGE_MIGRATION.md`
- `docs/NEWS_AUTOMATION.md`
- `package.json`
- `scripts/audit-driving-bans.mjs`
- `scripts/audit-geographic-coverage.mjs`
- `scripts/driving-bans-technical-status.mjs`
- `scripts/lib/__tests__/automation-data.test.mjs`
- `scripts/lib/__tests__/geographic-coverage.test.mjs`
- `scripts/lib/__tests__/publication-pr.test.mjs`
- `scripts/lib/__tests__/web-search.test.mjs`
- `scripts/lib/automation-data.mjs`
- `scripts/lib/cross-validate.mjs`
- `scripts/lib/fetch-source.mjs`
- `scripts/lib/generated-item-filter.mjs`
- `scripts/lib/geographic-migration.mjs`
- `scripts/lib/geographic-scope.mjs`
- `scripts/lib/mock-generator.mjs`
- `scripts/lib/openai-client.mjs`
- `scripts/lib/select-candidates.mjs`
- `scripts/lib/store.mjs`
- `scripts/lib/web-search.mjs`
- `scripts/lint-driving-bans.mjs`
- `scripts/migrate-geographic-coverage.mjs`
- `scripts/oversize-monitor.mjs`
- `scripts/verify-driving-bans-production.mjs`
- `src/lib/driving-bans/core.mjs`
- `src/lib/driving-bans/coverage-api.test.ts`
- `src/lib/intelligence/alerts.ts`
- `src/lib/intelligence/delivery.ts`
- `src/lib/intelligence/driving-bans-adapter.ts`
- `src/lib/intelligence/engine.ts`
- `src/lib/intelligence/geographic-coverage.test.ts`
- `src/lib/intelligence/preferences.ts`
- `src/lib/intelligence/source-adapter.ts`
- `src/lib/intelligence/store.ts`
- `src/pages/api/driving-bans.ics.ts`
- `src/pages/api/driving-bans.json.ts`
- `src/pages/driving-bans.astro`
- `tests/driving-bans-cases.mjs`
- `tests/driving-bans-production-cases.mjs`
- `vercel.json`
- `vitest.config.ts`

Archiv: 58 souborů pod `archive/geographic-coverage-20261022/`, včetně originálů, manifestů SHA-256, zpráv aplikačních dávek a seznamu vyřazených zdrojů. Úplný výčet je také ve Files changed připraveného PR.


## Následné upřesnění uživatele 22. 10. 2026

AT/DE/ES/BE/UK/PT se ověřují na oficiálních webech. Cílená kontrola 13 úředních
zdrojů je v `DRIVING_BANS_OFFICIAL_WEB_REVIEW.md`; nejde o nový úplný sweep ani
o nové kalendářové události. KZ/RU/TR jsou upřesněny na dálnice a hlavní silnice
v již schváleném koridorovém rozsahu. Původních 182 pravidel a jejich ověřovací
data zůstávají beze změny. Stará organizační poznámka ES byla opravena se zálohou.
Plán kontroly se exportuje z centrálního registru; existující čtvrteční úloha má
stejné načasování a zůstává read-only. Celkem 73 implementačních/datových/dokumentačních
souborů a 58 archivních souborů v celém PR.
