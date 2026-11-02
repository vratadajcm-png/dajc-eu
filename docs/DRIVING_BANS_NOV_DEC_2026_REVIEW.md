# Driving Bans – právní kontrola listopadu a prosince 2026 (fáze 0)

Datum kontroly: 27. 10. 2026 · Identifikátor: `2026-10-27.r4-nov-dec-priority` ·
Verze dat: `2026-10-27.r4-nov-dec-priority.geo50`

Strojově čitelný záznam důkazů (URL, HTTP stav, velikost, SHA-256 a čas stažení
každého dokumentu, matice 50 jurisdikcí): `data/driving-bans/source-reviews/2026-10-27-nov-dec.json`.

## Proč tato kontrola

Předchozí právní kontrola pokrývala období 1. 9.–30. 11. 2026. Od 1. 11. 2026 web zobrazuje
listopad a prosinec. Bez nové kontroly by od 1. 11. klesl počet plně ověřených jurisdikcí
z 11 na 0 a počet zveřejněných událostí z 638 na 212 (audit s hodinami nastavenými na 1. 11.).

Nejde o úplnou týdenní kontrolu všech 50 jurisdikcí (`full_registry_sweep: false`).
Prioritně se kontrolovalo 11 jurisdikcí, které byly plně ověřené, a k tomu jednotlivá
pravidla Rakouska a Německa.

## Postup

- Každý podklad je úřední právní text nebo stránka úřadu. Stahoval se přímo, a kde webové
  rozhraní blokovalo automatický přístup, přes úřední otevřené rozhraní (RIS OGD v Rakousku,
  ELI API Sejmu v Polsku). Bezpečnostní kontroly proti robotům se neobcházely.
- Každý použitý dokument je v záznamu identifikován otiskem SHA-256 a časem stažení.
  Stejný otisk je uložen u zdroje v `canonical.json` (`content_sha256`).
- Sekundární zdroje (agregátory, tisk) nesloužily k vytvoření ani odstranění zákazu.
  U Slovenska uvádí agregátor jiné časy než zákon, rozhoduje zákon.
- Datum ověření (`last_verified`) se změnilo jen u 11 plně zkontrolovaných jurisdikcí.
  U AT a DE se změnilo jen `last_checked`, jejich úplnost zůstává `false`.

## Výsledek

- **11 jurisdikcí plně ověřeno i pro listopad a prosinec:** CH, CZ, FR, HR, HU, IT, LI, LU, PL, SI, SK.
- **2 jurisdikce s ověřenými jednotlivými pravidly** (úplnost dál chybí): AT, DE.
- **37 jurisdikcí nekontrolováno:** mají nový důvod neúplnosti
  `NOV_DEC_2026_PRIORITY_REVIEW_NOT_PERFORMED`. V prosinci u nich nevzniká žádná událost,
  protože jejich pravidla mají ověřené období jen do 30. 11.
- Ověřené období datasetu je nově 1. 9.–31. 12. 2026. **Od 1. 12. 2026** (okno prosinec–leden)
  bude opět vše „Ověření probíhá“, pokud do té doby neproběhne kontrola ledna 2027.

## Ověřené změny pro listopad a prosinec

| Země | Změna | Právní základ |
| --- | --- | --- |
| CH | 25. 12. celodenní zákaz. 26. 12. 2026 **není** dnem zákazu, protože Vánoce připadají na pátek. | VRV čl. 91 odst. 1 |
| CZ | 24., 25. a 26. 12. 13–22 h. | zákon 361/2000 Sb. § 43 odst. 1 písm. a), zákon 245/2000 Sb. |
| FR | 24. 12. 22 h – 25. 12. 22 h. Île-de-France: 24. 12. 16–22 h (z Paříže), 25. 12. 22–24 h (oba směry), 26. 12. 6–10 h (do Paříže). | arrêté 16. 4. 2021 čl. 1 a 3 |
| HR | 24. 12. 15–23 h. Poslední den svátku (26. 12.) je sobota, proto platí neděle 27. 12. 12–23 h. | Naredba NN 64/2009 bod II, NN 110/2019 |
| HU | Nepřetržitě od 24. 12. 22 h do 27. 12. 22 h. 24. 12. není státní svátek. Výjimka pro mezinárodní dopravu EURO 3+ (4. 11.–1. 3.) zachována. | vládní nařízení 190/2008 § 2, zákoník práce § 102 |
| IT | 6., 8., 13., 20., 25., 26. a 27. 12. 9–22 h. | DM 12. 12. 2025 č. 325 |
| LI | 8., 25. a 26. 12. celodenně. | VRV čl. 89 (verze 58) |
| LU | 25. 12. pro směr Francie i Německo, 26. 12. jen pro směr Německo. | nařízení z 19. 7. 1997 (stránka policie) |
| PL | 25. a 26. 12. 8–22 h (nad 12 t). 24. 12. je od roku 2025 dnem volna, ale v seznamu zákazových dnů **není**. Před Vánoci neplatí ani večerní zákaz 18–22 h. | Dz.U. 2023 poz. 2423 § 2, Dz.U. 2025 poz. 296 |
| SI | 25. a 26. 12. 8–22 h. | Odredba UL 75/2011, 195/2021, 67/2025; ZPDPD |
| SK | Žádný den zákazu navíc. Neděle je dnem pracovního klidu, takže vánoční blok 24.–27. 12. končí v neděli 27. 12. a platí jen nedělní zákaz 6–22 h. | zákon 8/2009 Z. z. § 39, zákon 241/1993 Z. z. § 2 |
| AT | Víkendová, sváteční (8., 25., 26. 12.) a noční pravidla, zimní noční zákaz na A12. Na A12 začíná noční zákaz ve svátek ve 23 h, ne ve 20 h. | StVO § 42 (BGBl. I 17/2026), Feiertagsruhegesetz § 1, IG-L A12 § 3 |
| DE | 25. a 26. 12. celostátně 0–22 h. | StVO § 30 odst. 3–4 |

## Opravené vady v datech

- **LI, LU a AT:** víkendová a noční pravidla měla zveřejněné období ukončené k 31. 10. 2026,
  přestože předpisy platí celoročně. V listopadu by tak Lichtenštejnsko a Lucembursko
  vypadaly jako plně ověřené bez víkendových a nočních zákazů. Po přečtení platných textů
  jsou pravidla prodloužena do 31. 12. a jejich pořadové číslo revize (`sequence`) se zvýšilo.
- **AT:** výjimky víkendového zákazu odkazovaly na neaktuální číslování § 42. Jsou opraveny
  podle znění BGBl. I 17/2026 (odst. 2a, 3, 3a), včetně výjimky pro jízdy v obci o dvou
  sobotách před 24. 12.
- **SI:** doplněn zdroj novely Odredby z roku 2025 (čl. 5.a). Jde o dynamická omezení
  kamionů na dálnicích při kolonách. Nejsou kalendářová a DAJC je předem nezná.
- **SK:** do poznámky doplněno trvalé omezení nad 12 t na silnicích III. třídy (§ 39 odst. 4).
  Nejde o časový zákaz.

## Nedokončené právní kontroly

- **AT:** zemské předpisy pro vedlejší silnice, seznam zboží sektorového zákazu v Tyrolsku,
  trasové předpisy Lueg/A10 pro prosinec, režim povolení pro nadrozměrnou přepravu.
- **DE:** výjimky spolkových zemí kvůli nízké hladině Rýna po 31. 10. 2026 (úřední
  prodloužení se nenašlo, hledání proběhlo jen v sekundárních zdrojích).
- **37 nekontrolovaných jurisdikcí**, mimo jiné ES, PT, GR, BG, ME, BE, NL, UK a RO.
  ES a PT mají ověřené události jen pro listopad.
- **SI:** stránka promet.si byla 27. 10. nedostupná. Prosincová kontrola se opírá
  o texty z úředního věstníku.

## Dopad na čtvrteční technickou kontrolu

Audit počítá stáří kontroly z nejnovějšího `last_checked`. Po této kontrole proto čtvrteční
technická kontrola projde, i když nešlo o úplnou kontrolu všech 50 jurisdikcí. Rozlišení
je uvedené v `review_log` datasetu (`full_registry_sweep: false`). Oddělené vykazování
technické a právní kontroly přináší PR 4.

## Matice pokrytí (stav pro období 1. 11.–31. 12. 2026)

Události: počet zveřejněných událostí v listopadu a prosinci / z toho v prosinci.

| Kód | Jurisdikce | Výsledek kontroly | Stav | Události | Poznámka |
| --- | --- | --- | --- | --- | --- |
| AD | Andorra | nekontrolováno | ověření probíhá | 0 / 0 |  |
| AL | Albania | nekontrolováno | ověření probíhá | 0 / 0 |  |
| AM | Armenia | nekontrolováno | ověření probíhá | 0 / 0 |  |
| AT | Austria | ověřena jednotlivá pravidla | zákaz (neúplné) | 144 / 73 | víkendy, svátky 8., 25., 26. 12., noc, A12 IG-L; zemské a trasové předpisy otevřené; opraveno ukončení k 31. 10. |
| AZ | Azerbaijan | nekontrolováno | ověření probíhá | 0 / 0 |  |
| BA | Bosnia and Herzegovina | nekontrolováno | ověření probíhá | 0 / 0 |  |
| BE | Belgium | nekontrolováno | ověření probíhá | 0 / 0 |  |
| BG | Bulgaria | nekontrolováno | ověření probíhá | 0 / 0 |  |
| BY | Belarus | nekontrolováno | ověření probíhá | 0 / 0 |  |
| CH | Switzerland | plně ověřeno | zákaz | 72 / 36 | 25. 12. zákaz; 26. 12. 2026 ne (Vánoce v pátek) |
| CY | Cyprus | nekontrolováno | ověření probíhá | 0 / 0 |  |
| CZ | Czechia | plně ověřeno | zákaz | 13 / 7 | 24.–26. 12. 13–22 h |
| DE | Germany | ověřena jednotlivá pravidla | zákaz (neúplné) | 11 / 6 | 25.–26. 12. celostátně; výjimky kvůli nízké hladině po 31. 10. nepotvrzeny |
| DK | Denmark | nekontrolováno | ověření probíhá | 0 / 0 |  |
| EE | Estonia | nekontrolováno | ověření probíhá | 0 / 0 |  |
| ES | Spain | nekontrolováno | zákaz (neúplné) | 44 / 0 | listopadové události z dřívější kontroly, prosinec bez událostí |
| FI | Finland | nekontrolováno | ověření probíhá | 0 / 0 |  |
| FR | France | plně ověřeno | zákaz | 62 / 29 | 24. 12. 22 h – 25. 12. 22 h; Île-de-France 24.–26. 12. |
| GE | Georgia | nekontrolováno | ověření probíhá | 0 / 0 |  |
| GR | Greece | nekontrolováno | ověření probíhá | 0 / 0 |  |
| HR | Croatia | plně ověřeno | zákaz | 14 / 6 | 24. 12. 15–23 h; 27. 12. 12–23 h (posun z 26. 12.) |
| HU | Hungary | plně ověřeno | zákaz | 10 / 5 | nepřetržitě 24. 12. 22 h – 27. 12. 22 h |
| IE | Ireland | nekontrolováno | ověření probíhá | 0 / 0 |  |
| IS | Iceland | nekontrolováno | ověření probíhá | 0 / 0 |  |
| IT | Italy | plně ověřeno | zákaz | 12 / 7 | 6., 8., 13., 20., 25.–27. 12. 9–22 h |
| KZ | Kazakhstan (European transport scope) | nekontrolováno | ověření probíhá | 0 / 0 |  |
| LI | Liechtenstein | plně ověřeno | zákaz | 74 / 38 | 8., 25., 26. 12.; opraveno ukončení k 31. 10. |
| LT | Lithuania | nekontrolováno | ověření probíhá | 0 / 0 |  |
| LU | Luxembourg | plně ověřeno | zákaz | 22 / 11 | 25. 12. (FR i DE), 26. 12. (DE); opraveno ukončení k 31. 10. |
| LV | Latvia | nekontrolováno | ověření probíhá | 0 / 0 |  |
| MC | Monaco | nekontrolováno | ověření probíhá | 0 / 0 |  |
| MD | Moldova | nekontrolováno | ověření probíhá | 0 / 0 |  |
| ME | Montenegro | nekontrolováno | ověření probíhá | 0 / 0 |  |
| MK | North Macedonia | nekontrolováno | ověření probíhá | 0 / 0 |  |
| MT | Malta | nekontrolováno | ověření probíhá | 0 / 0 |  |
| NL | Netherlands | nekontrolováno | ověření probíhá | 0 / 0 |  |
| NO | Norway | nekontrolováno | ověření probíhá | 0 / 0 |  |
| PL | Poland | plně ověřeno | zákaz | 5 / 2 | 25.–26. 12. 8–22 h; 24. 12. bez zákazu |
| PT | Portugal | nekontrolováno | zákaz (neúplné) | 21 / 0 | listopadové události z dřívější kontroly, prosinec bez událostí |
| RO | Romania | nekontrolováno | ověření probíhá | 0 / 0 |  |
| RS | Serbia | nekontrolováno | ověření probíhá | 0 / 0 |  |
| RU | Russia (European transport scope) | nekontrolováno | ověření probíhá | 0 / 0 |  |
| SE | Sweden | nekontrolováno | ověření probíhá | 0 / 0 |  |
| SI | Slovenia | plně ověřeno | zákaz | 11 / 6 | 25.–26. 12. 8–22 h; dynamická omezení čl. 5.a |
| SK | Slovakia | plně ověřeno | zákaz | 9 / 4 | jen neděle; vánoční blok končí v neděli 27. 12. |
| SM | San Marino | nekontrolováno | ověření probíhá | 0 / 0 |  |
| TR | Türkiye (European transport scope) | nekontrolováno | ověření probíhá | 0 / 0 |  |
| UA | Ukraine | nekontrolováno | ověření probíhá | 0 / 0 |  |
| UK | United Kingdom | nekontrolováno | ověření probíhá | 0 / 0 |  |
| XK | Kosovo | nekontrolováno | ověření probíhá | 0 / 0 |  |

## Testy

Regresní testy jsou v `tests/driving-bans-production-cases.mjs` (sekce „27 Oct 2026“).
Kontrolují mimo jiné: CH 26. 12., PL 24. 12., SK vánoční blok, nepřetržitý zákaz v HU,
posun v HR, prodloužená pravidla LI/LU/AT, sváteční noci na A12, DE a stav nekontrolovaných
jurisdikcí. Test migrace na 50 jurisdikcí nově porovnává výstup migrace se zálohou
a v živých datech hlídá, že se žádná identita pravidla nesmaže.
