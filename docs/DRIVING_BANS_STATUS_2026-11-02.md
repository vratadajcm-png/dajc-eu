# Driving Bans – skutečný stav k 2. 11. 2026 a ruční ověření DE a ES

Datum kontroly: 2. 11. 2026, 15:05–15:25 UTC · `main` = `5f7311d` · Bez změny
`data/driving-bans/canonical.json`, bez merge, bez změny naplánovaných úloh.

Tento dokument je auditní stopa ruční kontroly. Nálezy jsou **návrhy ke schválení**,
nic z nich zatím není v registru.

## 1. Stav k 2. 11. 2026

| Ukazatel | Hodnota |
| --- | --- |
| Plně ověřené jurisdikce na produkci (`main`) | **0 z 50** (od 1. 11. 00:00) |
| Důvod | Dataset `2026-10-01.r3-fr-de-delta.geo50` má ověřené období jen do 30. 11., snapshot od 1. 11. pokrývá listopad a prosinec |
| Plně ověřené jurisdikce po sloučení #80 | 11 (CH, CZ, FR, HR, HU, IT, LI, LU, PL, SI, SK) do 30. 11.; od 1. 12. opět 0 bez ověřeného ledna 2027 |
| PR #80 | otevřený draft, nesloučený |

Ověřeno výpočtem `getDrivingBansSnapshot` nad `main` a nad lokálním sloučením
`main` + #80 pro data 29. 10., 1. 11., 30. 11. a 1. 12.

Web se chová fail-closed: všech 50 zemí ukazuje „ověření probíhá“, nikde se
nezobrazuje „bez zákazu“. Ztráta pokrytí je tedy ztráta užitné hodnoty, ne chybná
informace.

### Naplánované rutiny od 29. 10.

| Běh | Základ | Výsledek |
| --- | --- | --- |
| Čtvrteční kontrola 29. 10. | `main` `e1fb0f2` | zdroje PARTIAL, doručení NO_CHANGES, kontrola čerstvosti FAIL (stáří 27,9 dne, limit 8) |
| Denní kontrola 2. 11. | `main` `5f7311d` | 0 z 50 úplných; žádná jurisdikce nedovedena do PRIMARY_VERIFIED; nic nedoručeno |

Obě rutiny pracují nad `main`, což odpovídá jejich zadání. Dokud #80 není sloučený,
nevidí jeho data. Denní rutina podle pravidel repozitáře období neprodlužuje, to smí
jen čtvrteční.

## 2. GitHub: závislosti vůči aktuálnímu `main`

`main` se od vzniku #80 posunul o 5 commitů (#85, #86, #87). Žádný nemění Driving Bans.

| PR | Head | Base | Pozadu za `main` | Zkušební merge s `main` | Mění `canonical.json` |
| --- | --- | --- | --- | --- | --- |
| #80 fáze 0 | `a4b1a33` | main | 5 | bez konfliktu | ano |
| #81 PR1 | `29a954b` | main | 5 | bez konfliktu | ne |
| #82 PR2 | `9de1871` | #81 | 5 | bez konfliktu | ne |
| #83 PR3 | `2263995` | #82 | 5 | bez konfliktu | ne |
| #84 PR4 | `d7ccc4d` | #83 | 5 | bez konfliktu | ne |
| #88 PR5 | `72bc86f` | #84 | 5 | bez konfliktu | ano, jen převzatým commitem #80 |
| #78 Ask | `632f8d6` | #84 | 5 | bez konfliktu | ne |
| #90 Ask FAQ | `a09b494` | #78 | 5 | bez konfliktu | ne |
| #89 Weekly | `92fb9c0` | main | 0 | bez konfliktu | ne |
| #79 testing Q3 2027 | `d59ffff` | main | 5 | **konflikt** | ne |

- **#88 obsahuje commit #80** (`a4b1a33` je předek #88). Po sloučení #80 zmizí změna
  `canonical.json` z diffu #88. Zkušební merge #80 × #88 je bez konfliktu.
- **#90 obsahuje #78.**
- **#79 není plně nahrazen #85.** Konflikt je jen ve formulacích se stejným významem
  (Q3 2027), ale `src/pages/demo-guide.astro` na `main` stále odkazuje na
  „Register for testing from 4 January 2027“. Tuto změnu má jen #79. #79 zůstává
  otevřený podle pokynu vlastníka.
- Mimo #80 (a #88, který ho nese) nemění `canonical.json` žádný otevřený PR a žádná
  rutina od 29. 10. nevytvořila větev se změnou registru.

## 3. PR #80: finální kontrola pro sloučení

Lokální sloučení `main` `5f7311d` + #80 `a4b1a33` (nepushnuto), čistá instalace `npm ci`:

| Kontrola | Výsledek |
| --- | --- |
| `npm run lint:driving-bans` | PASS |
| `npm run lint:geographic-coverage` | PASS (migrace idempotentní, archiv izolovaný) |
| `npx vitest run` | 65 souborů, 731 testů, 0 selhání |
| `node tests/run-driving-bans.mjs` | 73/73 |
| `npm run typecheck` | 232 souborů, 0 chyb, 0 varování |
| `npm run build` | úspěch |
| CI na headu #80 (27. 10., proti `e2b88ad`) | application-validate, news-validate, technical-only, Vercel – vše zelené |

Výhrady, které sloučení neblokují:

1. **Kontrola čerstvosti ve čtvrtek 5. 11. neprojde ani s #80.** Nejnovější
   `last_checked` je 27. 10. 11:20 UTC, ve čtvrtek 5. 11. 05:47 UTC to bude
   8,77 dne při limitu 8. Projde jen tehdy, když čtvrteční rutina skutečně
   zkontroluje zdroje (viz oddíl 6).
2. **DE:** poznámka v #80 o výjimkách kvůli nízké hladině „do 31. 10.“ odpovídá
   úředním stránkám k 2. 11. Nový stav je v oddílu 4.
3. **ES:** prosinec nemá v #80 žádné události a ES zůstává neúplné (fail-closed).
   Listopad je ověřen v oddílu 5.

**Doporučení:** #80 je technicky připravený ke sloučení do `main`. Sloučení zůstává
na vlastníkovi. Čím dřív proběhne, tím dřív se vrátí 11 ověřených zemí. Po sloučení
nezapomenout na #88, který #80 nese.

## 4. DE – výjimky ze zákazu jízdy v neděli a ve svátek kvůli nízké hladině

Základní zákaz podle § 30 odst. 3 StVO (neděle a svátky 0–22 h, nad 7,5 t) platí beze
změny. Výjimky se týkají jen přeprav souvisejících s nízkou hladinou vody.

| Úroveň | Zjištění | Druh důkazu |
| --- | --- | --- |
| Konference ministrů dopravy (VMK) 21.–22. 10. 2026 | Usnesení TOP 8.6, bod 8: VMK **navrhuje** prodloužit pozastavení zákazu „bis einschließlich 20. Dezember 2026“ a situaci sledovat | primární, ale jen doporučení zemím, ne závazné opatření |
| NRW | Úřední stránka ministerstva (MUNV) k 2. 11.: poslední zpráva z 28. 9., prodloužení **do 31. 10. 2026**. Tiskové zprávy land.nrw za 1.–29. 10. prodloužení neobsahují | primární |
| NRW | dpa (23. 10.): NRW vydalo výnos okresním vládám, pozastavení platí **do 20. 12.** | sekundární, úřední text výnosu nenalezen |
| BW | Úřední tisková zpráva z 28. 9.: prodloužení **do konce října**. Novější zpráva na seznamu ministerstva k 2. 11. není | primární |
| RP | Úřední tisková zpráva MdI z 28. 9.: prodloužení **do 31. 10. 2026**. Novější zpráva nenalezena | primární |
| Saarland | saarland.de vrací automatickým klientům 403 (ochrana proti robotům). Ochrana se neobchází | SOURCE_UNAVAILABLE |

**Závěr DE:** po 31. 10. je stav výjimek **neověřený**. Existuje silné vodítko
(doporučení VMK do 20. 12. a zpráva dpa o výnosu NRW), ale primární text žádné
země o prodloužení po 31. 10. jsme nenašli. Registr nesmí výjimku po 31. 10. uvádět
jako platnou.

Návrh ke schválení (neprovedeno):

- doplnit zdroj `de-vmk-2026-10-beschluss-8-6` (PRIMARY, doporučení),
- ponechat `LOW_WATER_EXEMPTIONS_AFTER_2026_10_31_NOT_PRIMARY_CONFIRMED`
  a doplnit poznámku o návrhu VMK do 20. 12. a zprávě o výnosu NRW,
- vyžádat si text výnosu NRW od MUNV nebo okresní vlády. BW a RP znovu zkontrolovat
  v denní rutině.

## 5. ES – listopad 2026

### 5.1 Celostátní předpis DGT (BOE-A-2026-1255, příloha II)

- Plné znění staženo 2. 11. z BOE. BOE k tomuto dni eviduje jen tři pozdější zásahy:
  změnu BOE-A-2026-13892 (16. 6.) a opravy BOE-A-2026-4377 a BOE-A-2026-7127.
- Opravy mění jen přílohy I a VIII (sportovní akce, zatmění), přílohu II ne.
- Změna BOE-A-2026-13892 jen přesouvá Velkou cenu Valencie z 20.–22. 11. na
  **27.–29. 11. 2026** a obsah řádků nemění.
- Listopadové tabulky přílohy II po změně: **44 řádků, v registru (na `main` i v #80)
  nalezeno 44, chybí 0, navíc 0** (porovnání data, času od–do a silnice s kilometrem).
  Obsahují 1. 11. (A-8), 2. 11. (23 úseků) a 27.–29. 11. (20 úseků u Cheste).
- Žádné obecné (opakované) omezení přílohy II v listopadu neplatí. Prosincová
  opakovaná omezení (pátky 4.–18. 12., neděle 6.–27. 12., N-230 a A-8) a prosincové
  tabulky (4., 5., 6., 8., 24. a 31. 12.) v registru zatím nejsou.

### 5.2 Mezery v registru (návrhy nových pravidel, neprovedeno)

Tyto omezení platí podle primárních textů, ale v registru chybí. ES je proto
správně neúplné. Hodnota `corridors: PRIMARY_VERIFIED` u ES je ale v rozporu
s bodem A níže a měla by se změnit na `UNVERIFIED`.

**A. Celoroční omezení – příloha VII DGT (každý den 0–24 h, oba směry)**

| Silnice | Úsek | Dotčená vozidla |
| --- | --- | --- |
| N-340 | km 957 (Nules, výjezd 278 z A-7) – km 997 (Oropesa) | MMA nad 7,5 t |
| N-340 | km 1012,2 (Torreblanca) – km 1058,44 (hranice Castellón/Tarragona) | 4 a více náprav |
| N-124 | km 45,99 (Briñas) – km 39 (Gimileo) | 4 a více náprav, kromě cílů/výchozích bodů v Haro |
| N-232 | km 446,71 (Gimileo) – km 330,875 (Alfaro) | 4 a více náprav |

**B. Katalánsko – Resolución ISP/300/2026 (BOE-A-2026-6095) se změnou ISP/1933/2026**

| Kdy | Silnice | Čas |
| --- | --- | --- |
| každou sobotu (celoročně) – v listopadu 7., 14., 21., 28. 11. | N-II km 630 (Montgat) – km 682,2 (Can Bartolí), síť přístupů k Barceloně | 10–14 h |
| každou neděli (celoročně) – v listopadu 1., 8., 15., 22., 29. 11. | N-II, týž úsek | 17–22 h |
| soboty od 28. 11. do 26. 12. (zimní) | N-145 km 0–10, C-14 km 116–178, N-260 km 193–234 (Pyreneje) | 10–14 h |
| trvale, oba směry | N-II km 773,5–709 (La Jonquera–Fornells), N-240 km 87,4–36,5, N-340 km 1058,4–1122 a km 1176,4–1209,5 | zákaz nad 26 t |
| trvale | C-153 km 60,9–61,9 (Olot) | zákaz nad 7,5 t |

- Tabulka u řádků „Anual“ směr neuvádí. Výklad směru je potřeba potvrdit.
- Změna ISP/1933/2026 mění jen poznámku k evropským soupravám (v létě) a trasy ADR.
  Uvedené řádky nemění.
- Změnu ISP/2853/2026 z 5. 8. uvádí Servei Català de Trànsit, v BOE dohledána
  není. Podle sekundárních zdrojů se týká zatmění 12. 8. Plné znění jsme nečetli.

**C. Baskicko – Resolución de 9 de enero de 2026 (BOE-A-2026-2625), příloha II**

| Kdy | Silnice | Čas | Poznámka |
| --- | --- | --- | --- |
| 1. 11. (proběhlo) | A-8, BI-734, BI-3724, N-634, směr Bilbao | 16–21 h | |
| **10. 11. 22:00 – 11. 11. 22:00** | AP-8 (Amorebieta → Behobia/Francie), GI-20, A-15, AP-1 (→ Irún), A-1 (→ Vitoria-Gasteiz), N-I, GI-636, GI-11, N-121A | 22–22 h | **jen přeshraniční přeprava**; 11. 11. je svátek ve Francii |

Rozsah: vozidla nad 7,5 t (bod 3.1). Výjimky podle přílohy IV.

Omezení z 11. 11. je nejbližší konkrétní zákaz na hlavní tranzitní trase
Španělsko–Francie, který registr nezná. Protože ES je neúplné, web ho nevydává za
„bez zákazu“. Doplnění ale vyžaduje schválení vlastníka.

### 5.3 Příloha V (ADR a zvláštní přepravy)

Dál platí `ES_ANNEX_V_EXCEPTIONAL_ADR_RESTRICTIONS_NOT_EVENT_ENCODED`. Pro listopad
je v příloze V mimo jiné omezení na N-433 (soboty v listopadu a prosinci 11–22 h)
a obecná nedělní a sváteční omezení ADR. Pro běžné kamiony nad 7,5 t se příloha V
nepoužije.

**Závěr ES:** celostátní listopad (příloha II) je ověřený a odpovídá registru.
Úplnost ES brání příloha VII, Katalánsko, Baskicko, příloha V a prosinec.

## 6. Rutiny a souběžné zápisy do `canonical.json` (jen návrh)

Rutiny nejsou součástí repozitáře a tento dokument je nemění.

### Riziko ve čtvrtek 5. 11.

Pokud #80 do čtvrtka 5. 11. 05:47 UTC nebude sloučený, čtvrteční rutina poběží nad
`main` s obdobím do 30. 11. Rutina smí podle zadání upravit `canonical.json`
a otevřít PR. Vznikly by dva souběžné zápisy do registru (#80 a nový PR) se
stejnými poli `dataset_version`, `window` a `jurisdiction_reviews`, tedy jistý
konflikt.

Možnosti pro vlastníka:

1. sloučit #80 před 5. 11. 05:47 UTC (doporučeno), nebo
2. čtvrteční úlohu na 5. 11. dočasně vypnout.

### Pravidlo jednoho zapisujícího (návrh textu do obou rutin)

Vložit jako nový krok před úpravu registru:

> Before editing data/driving-bans/canonical.json, list the open pull requests in
> vratadajcm-png/dajc-eu that modify data/driving-bans/canonical.json. If any is
> open, do not edit canonical.json. Record your findings only as evidence in the
> report (and, once the evidence pipeline is merged, as a staging submission),
> name the blocking pull request, and report DELIVERY_BLOCKED_BY_OPEN_REGISTRY_PR.

Technická pojistka k samostatnému schválení:

- `CODEOWNERS` pro `data/driving-bans/canonical.json` s povinnou kontrolou vlastníka,
- kontrola v CI, která selže, pokud registr mění víc otevřených PR najednou.

Dlouhodobě to řeší návrh `docs/DRIVING_BANS_THURSDAY_ROUTINE_PROPOSAL.md` z PR 4.
V něm rutiny jen vytvářejí návrhy a registr mění samostatný schválený PR.

### Proč čtvrteční rutina končí PARTIAL

- Běh 29. 10. trval 2,5 minuty (13 kroků) a 50 jurisdikcí v něm zkontrolovat
  nejde.
- Kontrola čerstvosti počítá dny od nejnovějšího `last_checked`. Bez skutečné
  kontroly proto selže vždy, když předchozí kontrola je starší než 8 dní.
- Rakouský RIS (`www.ris.bka.gv.at`) vrací automatickým klientům 503 se
  stránkou „Security Check“. Úřední otevřené rozhraní RIS OGD
  (`data.bka.gv.at/ris/api/v2.6/…`) vrací 200. Rutina má používat to, stejně jako #80.
- saarland.de vrací 403 (ochrana proti robotům). Řešení: ruční stažení vlastníkem
  a import jako důkaz, nebo jiný úřední kanál (Amtsblatt, dotaz na ministerstvo).
  Ochrana se nesmí obcházet.

Návrh: kontrolu rozdělit na střídající se dávky po zhruba 7 jurisdikcích v denních
bězích a čtvrteční běh nechat jen sloučit výsledky. O sémantice čtvrteční brány
(varianta A nebo B) rozhoduje vlastník.

### Jednorázová úloha z 15. 12. 2026 (`trig_01CrvivJ8DA3KPGhMyFxnC9F`)

- Odkazuje na soubory, které na `main` už nejsou:
  - `config/driving-ban-calendars/public-holidays.mjs`,
  - `scripts/lib/driving-ban-calendar.mjs`,
  - `scripts/lib/__tests__/driving-ban-calendar.test.mjs`.
- Popisuje starou architekturu (seedované svátky v konfiguraci), která obchází
  `canonical.json`.
- Spustí se 15. 12., tedy 14 dní **po** termínu 1. 12., kdy se snapshot přepne na
  prosinec a leden.

Doporučení: úlohu vypnout a nahradit plánem
`docs/DRIVING_BANS_JANUARY_2027_PLAN.md`. Seznam kandidátních svátků 2027 z jejího
zadání je v plánu převzatý jako neověřený vstup.

## 7. Auditní stopa

Staženo 2. 11. 2026 z prostředí Claude Code, bez obcházení ochran. U HTML stránek
identifikuje otisk SHA-256 staženou kopii, ne trvalý obsah stránky. Stažené soubory
nejsou v gitu (stejně jako `blobs/`).

| Dokument | URL | Staženo (UTC) | HTTP | SHA-256 |
| --- | --- | --- | --- | --- |
| BOE-A-2026-1255 (DGT 2026) | https://www.boe.es/diario_boe/txt.php?id=BOE-A-2026-1255 | 2026-11-02T15:09Z | 200 | `1f8b1d1acbd47ed88f6a5c0fbea46d64d79fa6240c68168e6a94b8b0cddd19e6` |
| BOE-A-2026-13892 (změna, GP Valencia) | https://www.boe.es/diario_boe/txt.php?id=BOE-A-2026-13892 | 2026-11-02T15:09Z | 200 | `30c0526aed2f927b0565f0e51b1b25d2d4d91881948c8e812ecd97c35d002ee9` |
| BOE-A-2026-4377 (oprava) | https://www.boe.es/diario_boe/txt.php?id=BOE-A-2026-4377 | 2026-11-02T15:10Z | 200 | `12e7395f253bfbdbf3c7c4b59157e4078ba43bad9ada55d479dff198de68419c` |
| BOE-A-2026-7127 (oprava) | https://www.boe.es/diario_boe/txt.php?id=BOE-A-2026-7127 | 2026-11-02T15:10Z | 200 | `c740e60b869298c854a8924b734eda98f358c652857cf53f813d6f2ea6d9e198` |
| BOE-A-2026-6095 (Katalánsko ISP/300/2026) | https://www.boe.es/diario_boe/txt.php?id=BOE-A-2026-6095 | 2026-11-02T15:14Z | 200 | `9624141f0662fc7bd85ef4907cf4fb314ec3fa6441d3214487e1ad09be06961a` |
| BOE-A-2026-16758 (Katalánsko ISP/1933/2026) | https://www.boe.es/diario_boe/txt.php?id=BOE-A-2026-16758 | 2026-11-02T15:16Z | 200 | `b3f58a469f5237adbba3033ecf248383bf1e7905276a81f0e5c27e1e7f66bfb8` |
| BOE-A-2026-2625 (Baskicko 2026) | https://www.boe.es/diario_boe/txt.php?id=BOE-A-2026-2625 | 2026-11-02T15:14Z | 200 | `0d5117bf4b26b550d3c28b4f149a0a942e7e22e02d426948a2791ab2bb5aa098` |
| Servei Català de Trànsit – restrikce | https://transit.gencat.cat/ca/informacio-viaria/professionals-transport/mesures-especials/ | 2026-11-02T15:16Z | 200 | `74d4fef7b74da889104a61b439f9442fcb545c1d31566d053688426dbcf4efcc` |
| VMK usnesení TOP 8.6 (PDF) | https://www.verkehrsministerkonferenz.de/VMK/DE/termine/sitzungen/26-10-21-22-vmk/Beschl%C3%BCsse/Beschluss_8.6.pdf | 2026-11-02T15:12Z | 200 | `9f2fb667cf18b7f76e846309fcd783b45f33ec607cfda2a7a96242f3212eeec6` |
| VMK zpráva NRW k TOP 8.6 (PDF) | https://www.verkehrsministerkonferenz.de/VMK/DE/termine/sitzungen/26-10-21-22-vmk/Berichte/Bericht_8.6.pdf | 2026-11-02T15:12Z | 200 | `1ffdbf28015e43a82abf5faa3ff9e174e17f3a64a13b8e4ffa0dffb1dc820d85` |
| Bavorsko – tisková zpráva k VMK | https://www.stmb.bayern.de/med/pressemitteilungen/pressearchiv/2026/122b/index.php | 2026-11-02T15:11Z | 200 | `09dfea82c0c7235cf60b10b198774f4c1fc9533ad2c6a0c50048e6c56f100470` |
| NRW MUNV – Güterverkehr | https://www.umwelt.nrw.de/themen/verkehr/strasse/strassenverkehr/gueterverkehr | 2026-11-02T15:11Z | 200 | `6771f9eef49cd082d3bcc46e2f31e65db11c6a467d3fc0512cec5b2ecc93b0ec` |
| NRW – seznam tiskových zpráv (str. 1) | https://www.land.nrw/pressemitteilungen?page=1 | 2026-11-02T15:13Z | 200 | `3b7b489322e56c83aaf650ff1ea8634ade5f48ced090b94cc0bd8fd96a02b53c` |
| BW – tisková zpráva 28. 9. | https://vm.baden-wuerttemberg.de/de/service/presse/pressemitteilung/pid/baden-wuerttemberg-verlaengert-erleichterungen-fuer-lkw-transporte | 2026-11-02T15:12Z | 200 | `416c7ac4f274982433e793ef6097b4f4150bb8cc3b079d272664cbfd8a6ec6aa` |
| BW – seznam tiskových zpráv | https://vm.baden-wuerttemberg.de/de/service/presse | 2026-11-02T15:11Z | 200 | `46ff49cd26b29580cba9b97eda9f14ee84315e9fea1e146e8d3b8844d3987284` |
| RP MdI – tisková zpráva 28. 9. | https://mdi.rlp.de/service/pressemitteilungen/detail/rheinland-pfalz-verlaengert-aussetzung-des-sonn-und-feiertagsverbots-fuer-lkw-transporte | 2026-11-02T15:12Z | 200 | `7b350a206a388ac06086c99a99ddbedf2207c56515e51d2a17aa9022492c70c7` |
| RP MdI – seznam tiskových zpráv | https://mdi.rlp.de/service/pressemitteilungen | 2026-11-02T15:11Z | 200 | `2bb241e6ed3c0bd1afa0dc44cc4df1f205c93a36572147465256637d54b111fe` |
| Saarland – výjimka (PDF) | https://www.saarland.de/SharedDocs/Downloads/DE/mukmav/verkehr/Strassenverkehrsbehoerde/dl_erweiterung_aussetzung_sonn_u_feiertag_1.pdf | 2026-11-02T15:13Z, 15:24Z | 403 | – |
| RIS (webové rozhraní) | https://www.ris.bka.gv.at/ | 2026-11-02T15:24Z | 503 „Security Check“ | – |
| RIS OGD API | https://data.bka.gv.at/ris/api/v2.6/Bundesrecht | 2026-11-02T15:24Z | 200 | – |

Sekundární vodítko (nepoužito jako důkaz): dpa-AFX přes ARIVA, 23. 10. 2026,
„NRW: Lkw-Sonntagsfahrverbot bleibt fast bis Jahresende ausgesetzt“,
https://www.ariva.de/news/nrw-lkw-sonntagsfahrverbot-bleibt-fast-bis-jahresende-12179879

## 8. Rozhodnutí vlastníka

1. Sloučit #80, ideálně před čtvrtkem 5. 11. 05:47 UTC, nebo na ten den vypnout
   čtvrteční úlohu.
2. Schválit návrhy z oddílů 4 a 5.2 k doplnění do registru. Bez schválení se nic
   nemění. Nejbližší dotčené datum je 11. 11. (Baskicko).
3. Vložit pravidlo jednoho zapisujícího do obou rutin (oddíl 6).
4. Vypnout nebo nahradit jednorázovou úlohu z 15. 12.
5. Schválit plán ledna 2027 (`docs/DRIVING_BANS_JANUARY_2027_PLAN.md`).
