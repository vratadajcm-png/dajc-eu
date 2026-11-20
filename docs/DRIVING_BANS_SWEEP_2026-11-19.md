# Čtvrteční kontrola zákazů jízd 19. 11. 2026 – pouze důkazy, registr nezměněn

Stav: **DELIVERY_BLOCKED_BY_OPEN_REGISTRY_PR**. `data/driving-bans/canonical.json` nebyl upraven
(pravidlo jediného zapisovatele z 2. 11. 2026): otevřený PR #45
(`chore/transport-relevant-jurisdictions-50`, poslední commit 22. 10. 2026) mění tento soubor
oproti main (nesloučené commity, `git cherry` = `+`; diff −4065 řádků). Tento dokument a
adresář `data/driving-bans/source-reviews/2026-11-19-thursday/` jsou jen důkazní podklad; nezvyšují
datum právního ověření ani poslední úplné kontroly.

- Základ: main `34bb8837bd54a0490a1e54adba5dd6a0b1b8c3d6`, dataset `2026-11-02.r5-es-de-targeted.geo50`,
  ověřené období datasetu 2026-09-01..2026-12-31.
- Plánovací horizont `publicationWindow()`: 2026-11-19..2027-11-19 (Europe/Prague).
- `reviewed_through` zatím není v `DRIVING_BANS_CANONICAL.md` zaveden, proto se `window.to` neposouvá.
- Kontrola zdrojů: **PARTIAL** (AT, DE, CH, LI, ES vč. CAT/BAS, PT, FR, IT, BE, UK, CZ, SK, PL, HU,
  SI, HR, LU, GR, BG, RO, ME; ostatních 29 identit z 50 nebylo tento týden zkontrolováno).

## Nálezy k zapracování (po uvolnění registru, se zvýšením `sequence`)

| Země | Typ | Nález | Primární zdroj |
| --- | --- | --- | --- |
| HU | CHANGED | Zákon 2026. évi LXXII. (vyhlášen 13. 11., účinný 14. 11. 2026) činí 24. 12. trvalým dnem pracovního klidu. Podle nař. 190/2008 začíná vánoční zákaz už **23. 12. 2026 22:00** (do 27. 12. 22:00). Pravidlo `hu-holiday-2026-12-25-26` začíná až 24. 12. 22:00. | njt.jog.gov.hu/jogszabaly/2026-72-00-00 (SHA-256 0f5e415c…) |
| FR | NEW_BAN | Chybí výskyt Nového roku: čt 31. 12. 2026 22:00 – pá 1. 1. 2027 22:00 (>7,5 t), Île-de-France 31. 12. 16–22 výjezd, 2. 1. 06–10 příjezd. FR je přitom vedena jako úplně ověřená do 31. 12. | Arrêté 16. 4. 2021 (NOR TRAT2031119A), PDF JO přes Bison Futé |
| ES | NEW_BAN | Prosincové řádky Resolución DGT BOE-A-2026-1255 (příl. II 4., 5., 6., 8. 12.; N-230 Benabarre–Aneto; ADR řádky) nejsou v datasetu. Bez opravy BOE 2.–18. 11. | boe.es BOE-A-2026-1255 |
| ES-CT / ES-PV | NEW_BAN | Katalánsko a Baskicko – prosincové řádky (Immaculada, Pyreneje, Aran; Baskicko 4.–8. 12.). | transit.gencat.cat, BOE-A-2026-2625 |
| GR | NEW_BAN | ΦΕΚ Β΄ 912/2026 obsahuje 24. 12. 16–22, 27. 12. 15–22, 31. 12. 15–21 a 1., 3., 6. 1. 2027 (>3,5 t). V datasetu chybí. | et.gr |
| PT | CHANGED (k ověření) | VCI Porto (DL 155-A/2026, pracovní dny 07–21) nemá konec platnosti; 1., 8. a 25. 12. jsou svátky – ověřit, zda je dataset nezahrnuje. Portaria 281/2019 ADR režim není zakódován. | diariodarepublica.pt |
| AT | NEW_BAN | Zákazy sjezdů pro vozidla >12 m: A12 Wattens po–so 06–10; A13 Innsbruck Süd po–so 07–11 a 15–18 (BGBl. II 289/2020, 290/2020). | RIS OGD API |
| BE | NEW_BAN (nadrozměrná přeprava) | Flandry (KB 2. 6. 2010 čl. 30) so 12:00 – ne 24:00 a svátky od 16:00 předchozího dne; Valonsko (AGW 21. 3. 2024 čl. 35) so 22:00 – ne 24:00. | ejustice / wallex |
| LI | NO_CHANGE (zdroj) | Nová konsolidace VRV v59 (01.11.2026), čl. 89–91a beze změny; aktualizovat odkaz v58→v59. | gesetze.li |
| BG | UNKNOWN | Jen návrh příkazu 2026 (23.12., 24.12., 28.12., >12 t); konečný text nedohledán. | — |

Beze změny: AT StVO §42 (BGBl. I 17/2026), A12 IG-L, DE §30 StVO, CH VRV, CZ, SK, PL, HR, LU, IT
(prosinec). DE nízkovodní výjimky BW/RP/NRW: úřední stránky končí 31. 10. 2026, prodloužení
nepotvrzeno (UNVERIFIED, nikoli zrušení).

## Rok 2027 – stav předpisů

- Opakující se zákon (data odvoditelná): AT, DE (§30 StVO, Ferienreiseverordnung – trasy ověřit),
  CH, LI, CZ, SK (15. 9. 2027 je opět den zákazu), PL, HU, HR, LU, FR (základ), IT pouze zákonný rámec.
- AWAITING_PUBLICATION: ES (DGT 2027), Katalánsko, Baskicko, IT (decreto 2027), FR (doplňkové soboty 2027),
  AT (Fahrverbotskalender, A10, Lueg 2027), GR (únor–prosinec 2027), BG, ME (léto).
- SOURCE_UNAVAILABLE: RO (cnadnr.ro, legislatie.just.ro), SI (uradni-list.si TLS, pisrs.si 407),
  ME (gov.me), saarland.de (403), Légifrance (403), London Councils (403), PSNI (403), mit.gov.it.

## Technické kontroly (main 34bb883)

lint:driving-bans PASS; typecheck PASS (0 chyb); test PASS (97 souborů, 1013 testů); build PASS;
`driving-bans:audit --mode full --max-sweep-age-days 8` **FAIL**: `active_window_reviewed=false`,
`sweep_age_days=16.6` – registr nelze bez úpravy canonical.json obnovit.

## Navazující běh 19. 11. 2026 (~11:15 UTC) – oprava registru `2026-11-19.r6-thursday-hu-fr-gr`

PR #45 byl vlastníkem uzavřen bez sloučení. Kontrola jediného zapisovatele zopakována: 25 otevřených PR,
`git diff --quiet origin/main...<head> -- data/driving-bans/canonical.json` čisté pro všechny → registr
odblokován. Ranní důkazy (9f58f36) sloužily jen jako vodítko; níže uvedené zdroje byly znovu staženy
z primárních zdrojů (`source-reviews/2026-11-19-thursday/r6-registry-corrections.json`, SHA-256 u každého).
Snímek před změnou: SHA-256 `6b8cbcc1…988c` (shodný s ranním).

| Země | Změna | ID / sekvence | Primární důkaz |
| --- | --- | --- | --- |
| HU | CHANGED: vánoční zákaz začíná **st 23. 12. 2026 22:00** (dříve 24. 12. 22:00), trvá nepřetržitě do ne 27. 12. 22:00 | `hu-holiday-2026-12-25-26`, UID beze změny, sequence 0→1 | zákon 2026. évi LXXII. (účinný 14. 11.), Mt. §102(1), nař. 190/2008 §2 |
| FR | NEW_BAN: čt 31. 12. 22:00 – pá 1. 1. 2027 22:00 (>7,5 t); Île-de-France Paříž→provincie 31. 12. 16–22 | `fr-holiday-2027-01-01`, `fr-idf-out-eve-2026-12-31` | Arrêté 16. 4. 2021 čl. 1, čl. 3 II a) |
| GR | NEW_BAN: 24. 12. 16–22 (A1), 27. 12. 15–22 (A2), 31. 12. 15–21 (A1), >3,5 t | `gr-christmas-eve-outbound-2026`, `gr-christmas-return-2026`, `gr-new-year-eve-outbound-2026` | ΦΕΚ Β΄ 912/2026 B8 |

Neposunuto: `window.to` = 2026-12-31; `last_verified` jurisdikcí neobnoveno; GR zůstává neúplné
(`coverage_failures` zachovány). Lednové výskyty (FR IdF 1.–2. 1., GR 1., 3., 6. 1. 2027) jsou mimo
ověřené období – jen důkaz. HU §2(2) „első nap 8 órától“: ponechán výklad z 27. 10. (první den = první svátek);
23. 12. 22:00 je minimum vyplývající přímo z §2(1)(b).

Stále jen důkazy (nezakódováno v tomto běhu): ES/CAT/BAS prosincové řádky, AT A12/A13 sjezdy >12 m,
BE nadrozměrné přepravy, PT VCI svátky/ADR, LI odkaz v59, BG (jen návrh). 29 identit nezkontrolováno.

Technické kontroly na větvi: lint PASS, typecheck PASS (0 chyb), test PASS (97 souborů, 1017 testů),
build PASS, `driving-bans:audit --mode full --max-sweep-age-days 8` **FAIL** (`active_window_reviewed=false`,
`sweep_age_days=16.8`) – očekávané, brána nebyla oslabena.

## Nezávislá kontrola a prosinec ES (20. 11. 2026, `2026-11-20.r7-es-dec-cat-bas`)

Důkazy: `data/driving-bans/source-reviews/2026-11-20-es-december.json` (SHA-256 každého staženého dokumentu).
- HU, FR, GR: zdroje staženy znovu, bajtově shodné s 19. 11.; všech šest pravidel PR #144 odpovídá textu
  (HU zákon LXXII/2026 + nař. 190/2008 §2(1)(b); FR arrêté 16. 4. 2021 čl. 1 a 3 II a); GR ΦΕΚ Β΄ 912/2026 B8).
  `OWNER_DECISION_REQUIRED`: výklad HU §2(2) („első nap 8 órától“) – zakódovaný začátek 23. 12. 22:00 je nejdřívější
  začátek výslovně daný §2(1)(b).
- ES prosinec zakódován řádek po řádku: DGT příloha II (72 kombinací řádek×datum, 63 pravidel), Katalánsko
  (příloha A Inmaculada, Pyreneje zimní neděle a svátky vč. 26. 12. podle Ordre EMT/66/2025, Arán 7.1), Baskicko
  (příloha II body 1–2). Příloha VII a katalánské body 8–9 přečteny znovu (beze změny).
- Nezakódováno: příloha V (ADR a vozidla se zvláštním povolením), katalánské body 2–4 a euromodulární AP-7,
  baskická příloha I a ADR, leden 2027. ES zůstává `UNVERIFIED` a neúplné; `window.to` ani `last_checked`
  se neposouvají (cílená kontrola není úplný sweep).
