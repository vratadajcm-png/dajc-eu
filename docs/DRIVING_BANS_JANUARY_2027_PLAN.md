# Driving Bans – plán ověření ledna 2027 (50 jurisdikcí)

Stav: schváleno vlastníkem 2. 11. 2026 · Sestaveno 2. 11. 2026 z datasetu PR #80
(`2026-10-27.r4-nov-dec-priority.geo50`) · Nic se tímto dokumentem nemění v registru.

## Proč a do kdy

- Od **1. 12. 2026 00:00 (Praha)** pokrývá zveřejněný snapshot prosinec 2026 a leden 2027.
- Výpočet nad `main` + #80: k 1. 12. je plně ověřených **0 z 50** zemí, pokud leden
  nebude ověřený. Jurisdikce je úplná jen tehdy, když je ověřené celé aktivní období.
- **Termín:** datový PR „leden 2027“ (stejně jako #80) připravit k revizi do
  **25. 11.** a sloučit do **30. 11.**
- **Další termín:** od **1. 1. 2027** pokrývá snapshot leden a únor. Únor 2027 musí
  být ověřený do 31. 12. 2026.
- **Předpoklad:** #80 je sloučený (ověřené období datasetu do 31. 12. 2026).

## Kalendář ledna 2027 (vypočteno)

| Den | Datum |
| --- | --- |
| čtvrtek | 31. 12. 2026 (předvečer Nového roku) |
| pátek | 1. 1. 2027 |
| sobota, neděle | 2.–3. 1., 9.–10. 1., 16.–17. 1., 23.–24. 1., 30.–31. 1. |
| středa | 6. 1. |
| čtvrtek | 7. 1. |

Zákazy, které začínají večer před svátkem (např. FR a HU od 22 h), začínají
31. 12. 2026. Proto se musí ověřit i přechod roku.

## Postup (stejný jako u #80)

1. Jen primární zdroje: úřední věstník, právní databáze, ministerstvo, policie,
   správce silnic. Sekundární zdroje slouží jen jako vodítka.
2. Každý dokument: URL, čas stažení, HTTP stav, SHA-256. Záznam
   `data/driving-bans/source-reviews/<datum>-jan-2027.json`.
3. Období pravidla se prodlužuje jen po přečtení platného textu. Opravy zvyšují
   `sequence`. Identita pravidel zůstává.
4. Fail-closed: nepřečtený nebo nedostupný zdroj nikdy neznamená „bez zákazu“.
5. Pokud budou do té doby sloučené #81–#84, použije se kontrolní vrstva:
   `submission.json`, import, validace, lidské schválení a `prepare`. Jinak jeden datový
   PR jako #80.
6. Zdroje s ochranou proti robotům se neobcházejí. Pro Rakousko se používá úřední
   rozhraní RIS OGD (`data.bka.gv.at`), stejně jako v #80.

## Kategorie A – 11 plně ověřených zemí: rozšířit o leden

Kandidátní data v posledním sloupci pochází ze zadání jednorázové úlohy z 15. 12.
**Nejsou ověřená.** Slouží jen jako kontrolní seznam.

| Kód | Primární základ v #80 | Co ověřit pro leden | Kandidáti (neověřeno) |
| --- | --- | --- | --- |
| CH | VRV čl. 91 | dny zákazu v lednu, noční zákaz | 1. 1. |
| CZ | zákon 361/2000 § 43, zákon 245/2000 | svátky v lednu, čas 13–22 h | 1. 1. |
| FR | arrêté 16. 4. 2021 | přechod roku od 22 h předvečera, víkendy, roční zimní kalendář (pokud se týká ledna), Île-de-France | 31. 12. 22 h – 1. 1. 22 h |
| HR | Naredba NN 64/2009, NN 110/2019 | zda jsou lednové svátky dny omezení | – |
| HU | vládní nařízení 190/2008 | přechod roku, výjimka EURO 3+ (v registru 4. 11. 2026 – 1. 3. 2027) | 1. 1. |
| IT | DM 12. 12. 2025 č. 325 (jen rok 2026) | **vyžaduje kalendářní dekret na rok 2027** | – |
| LI | VRV čl. 89 | dny zákazu v lednu | – |
| LU | nařízení z 19. 7. 1997 (stránka policie) | lednové svátky a směry | – |
| PL | Dz.U. 2023 poz. 2423, Dz.U. 2025 poz. 296 | lednové svátky nad 12 t, večer před svátkem | 1. 1., 6. 1. |
| SI | Odredba UL 75/2011, 195/2021, 67/2025 | svátky a dny pracovního volna | 1. 1., 2. 1. |
| SK | zákon 8/2009 § 39, zákon 241/1993 | dny pracovního klidu | 1. 1., 6. 1. |

**Blokující závislost IT:** dekret pro rok 2026 byl podepsán 12. 12. 2025. Pokud
dekret pro rok 2027 nevyjde do 25. 11., Itálie bude od 1. 12. neúplná. Zobrazí se
jako „ověření probíhá“, ne jako „bez zákazu“.

## Kategorie B – AT a DE: dokončit otevřené body a přidat leden

| Kód | Otevřené body v registru | Leden |
| --- | --- | --- |
| AT | zemské předpisy pro vedlejší silnice; seznam zboží sektorového zákazu v Tyrolsku; režim povolení pro nadrozměrné přepravy; trasové předpisy Lueg/A10 | svátky (kandidáti 1. 1., 6. 1.), víkendy, zimní noční režim IG-L na A12; zdroje přes RIS OGD |
| DE | výjimky zemí kvůli nízké hladině po 31. 10. (návrh VMK do 20. 12.); Saarland nedostupný; rozsah výjimek v ostatních zemích | svátky (kandidáti 1. 1. celostátně, 6. 1. BW, BY, ST); ověřit, že po 20. 12. žádná výjimka neplatí, nebo doložit nové rozhodnutí |

## Kategorie C – částečné podklady: ES, PT, GR, BG, ME, RO

### ES

- Celostátní předpis DGT 2026 je prodloužený do účinnosti předpisu pro rok 2027,
  **kromě omezení s konkrétními daty** v přílohách I, II, V, VI a VIII
  (BOE-A-2026-1255, závěrečné ustanovení). Předpis 2026 vyšel 20. 1. 2026
  a účinnost nabyl 30. 1. 2026. Leden 2027 tak bude nejspíš v režimu prodloužení.
- Katalánsko (ISP/300/2026, bod 4): obsah se automaticky prodlužuje „con la
  aplicación análoga que corresponda por fechas“. Zimní soboty a neděle a celoroční
  omezení N-II tedy budou platit obdobně.
- Baskicko (BOE-A-2026-2625): prodloužení **kromě omezení s konkrétními daty
  v přílohách I a II**. Příloha II přitom přímo uvádí 2. 1. 2027 (11–14 h).
  **Právní otázka:** platí lednová data uvedená přímo v předpisu 2026? Potřebuje
  výklad.
- Dál chybí: příloha VII (celoroční), Katalánsko, Baskicko a příloha V. Podrobně
  v `docs/DRIVING_BANS_STATUS_2026-11-02.md`, oddíl 5.

### PT, GR, BG, ME, RO

| Kód | Otevřené body v registru |
| --- | --- |
| PT | omezení v obdobích státních svátků; omezení ADR |
| GR | trvalé rozhodnutí z roku 2017 (B3769), síť; režim nadrozměrných přeprav |
| BG | konečné znění ročního nařízení 2026 nestaženo; ad-hoc víkendová nařízení s krátkým předstihem |
| ME | zákonný víkendový a sváteční režim nezkontrolován; listopadová nařízení neznámá |
| RO | primární texty svátečních nařízení CNAIR nestaženy |

U všech přibude leden 2027 a prosinec 2026, který zatím nikdo nekontroloval.

## Kategorie D – 31 jurisdikcí bez podkladů

Pro každou je potřeba úplná základní kontrola: najít primární právní předpis,
projít všech 12 kontrol rozsahu a ověřit období prosinec–leden. Tempo zatím
odhadujeme na 1 až 3 hodiny na zemi. **Všech 31 do 1. 12. není reálné.** Proto
navrhujeme pořadí:

| Vlna | Jurisdikce | Cíl |
| --- | --- | --- |
| D1 – hlavní tranzitní trasy | BE, NL, UK, DK, SE, NO, RS | do 25. 11. |
| D2 | FI, EE, LV, LT, IE, BA, MK, AL, XK, MD, UA | do 31. 12. (s únorem) |
| D3 | AD, MC, SM, MT, CY, IS, BY, RU, KZ, TR, GE, AM, AZ | 1. čtvrtletí 2027 |

Země, které nestihneme, zůstanou fail-closed: „ověření probíhá“.

## Harmonogram

| Kdy | Krok |
| --- | --- |
| do 5. 11. 05:47 UTC | sloučit #80 (vlastník); rozhodnout o čtvrteční úloze 5. 11. |
| 3.–6. 11. | DE: text výnosu NRW, stav BW, RP a Saarland; ES: rozhodnutí o návrzích (11. 11. Baskicko) |
| 9.–13. 11. | kategorie A (11 zemí) – leden; AT a DE – leden |
| 16.–20. 11. | kategorie C – prosinec a leden |
| 16.–25. 11. | vlna D1 |
| 25. 11. | datový PR „leden 2027“ k revizi |
| 30. 11. | sloučení (vlastník) |
| 1. 12. | snapshot přejde na prosinec + leden |
| prosinec | IT dekret 2027, únor 2027 pro kategorie A–C, vlna D2 |

## Rozhodnutí vlastníka

1. Schválit pořadí a vlny D1–D3, včetně toho, že D2 a D3 budou v lednu „ověření
   probíhá“.
2. Postup u Itálie, pokud dekret 2027 vyjde po 25. 11.
3. Výklad prodloužení předpisů ES (zejména Baskicko a lednová data).
4. ~~Vypnout jednorázovou úlohu z 15. 12. 2026.~~ Provedeno 2. 11., tento plán ji nahrazuje.
