# DAJC AI — evropská knihovna úředních předpisů (znalostní báze)

Stav k 2026-11-08. Knihovna je ve výchozím stavu **vypnutá** (`DAJC_KB_ENABLED`), placené funkce, platby ani ABRA se jí netýkají.

Zásada: **existence úředního dokumentu sama neznamená správný právní výklad.** Knihovna dodává ověřitelné pasáže s článkem a stranou. Odpověď z nich sestavuje existující pipeline DAJC AI se svou deterministickou a nezávislou kontrolou. Halucinace to nevylučuje, jen snižuje jejich riziko a umožňuje je měřit (`dajc_ask.metrics`, přehled úrovní odpovědí).

## 1. Architektura

```
úřední zdroj (EUR-Lex, sbírka zákonů, ministerstvo …)   ← jen registrované domény, HTTPS i po přesměrování
        │  scripts/kb-import.mjs  (manifest: metadata, platnost a datum jejího ověření)
        ▼
archiv originálů (archive.mjs)          katalog + index (Neon, schéma dajc_kb)
  local:<dir> | S3-kompatibilní            documents → document_versions (URL, SHA-256, platnost, původ)
  (Cloudflare R2 EU / AWS S3 …)            → pages (text po stranách) → provisions (článek/§/příloha, strany,
  klíč = <země>/<dokument>/<jazyk>/<sha256>  tsvector, hmotnostní pásmo)
        │                                          │ pohled answerable_provisions (jen platné a ověřené)
        │                                          ▼
        └──────── scripts/kb-review.mjs ──► DAJC AI (src/lib/ask/library.ts → pipeline)
                  (osoba: HUMAN_VERIFIED / REJECTED)   přesný fulltext → citace → guard → nezávislá kontrola
```

| Vrstva | Soubor | Poznámka |
|---|---|---|
| Slovník (témata, kategorie, prahy, použitelnost) | `src/lib/kb/taxonomy.mjs` | 12 témat, nadrozměrná přeprava první |
| Registr právních zdrojů | `src/lib/kb/legal-sources.mjs` | země × témata × kategorie, podmínky užití, co bylo ověřeno |
| Archiv | `src/lib/kb/archive.mjs` | paměť, lokální adresář, S3-kompatibilní (SigV4 dle testovací sady AWS) |
| PDF | `src/lib/kb/pdf-text.mjs` | pdf.js bez eval/fontů/skriptů, limity velikosti, stran a času |
| Ustanovení | `src/lib/kb/provisions.mjs` | kotvy na samostatném řádku, odkazy nikdy nedělí, záhlaví a značky EUR-Lex pryč |
| Import a kontrola člověkem | `src/lib/kb/importer.mjs`, `scripts/kb-import.mjs`, `scripts/kb-review.mjs` | jedna transakce, nic se nemaže |
| Vyhledávání | `src/lib/kb/search.mjs`, `scripts/kb-search.mjs` | přesný fulltext + filtry; vektory jen později jako návrh kandidátů |
| Napojení na DAJC AI | `src/lib/ask/library.ts`, `pipeline.ts` | před placeným webovým hledáním; ne pro zákazy jízd |
| Schéma a práva | `drizzle-kb/0000_dajc_kb_library.sql` | vlastní historie migrací, nekoliduje s #102 |

Přechod mezi úložišti (R2 ↔ S3 ↔ jiné S3-kompatibilní) je jen změna proměnných `DAJC_KB_ARCHIVE` a `DAJC_KB_S3_*`. Klíče objektů jsou obsahově adresované, takže objekty lze zkopírovat beze změny.

**Cloudflare R2 je zatím návrh.** Bucket ani účet nebyly vytvořeny. Před nasazením je potřeba schválení vlastníka, účet Cloudflare a nastavení jurisdikce EU (koncový bod `https://<účet>.eu.r2.cloudflarestorage.com`).

## 2. Evidence každého dokumentu

| Požadavek | Kde |
|---|---|
| název, země, vydávající orgán, právní kategorie | `documents` (+ lokalizovaný název verze v `version_label`) |
| původní úřední URL | `document_versions.official_url` |
| vydání, účinnost, zrušení / nahrazení | `issued_on`, `effective_from`, `effective_to`, `superseded_by`, `validity` |
| datum posledního ověření | `validity_checked_on`, `last_verified_at`, `verified_by`; doklad v `notes` (URL stavu u vydavatele) |
| jazyk a verze | `language`, `version_label` |
| SHA-256 | `sha256` (také v klíči archivu; archiv obsah při čtení ověřuje) |
| kontrola původu a platnosti | `provenance` UNVERIFIED → AUTO_CHECKED → HUMAN_VERIFIED / REJECTED, `review_log` |
| autenticita | `authenticity` (např. konsolidované znění EUR-Lex = dokumentační nástroj) |
| podmínky stažení, uložení, užití | `reuse_status` (ze zdroje); import s UNKNOWN/RESTRICTED se zastaví ještě před stažením |
| vazba na články, přílohy a stránky | `provisions` (typ a číslo kotvy, `page_from`–`page_to`), `pages` |
| skenované PDF | `text_extraction = NEEDS_OCR` + `ocr_queue`; žádný text se neindexuje bez schválené OCR cesty |
| historie | starší verze se označí SUPERSEDED s `effective_to`; nikdy se nemaže (importér nemá `DELETE`) |

Na co se DAJC AI smí odvolat (pohled `answerable_provisions` + kontroly v kódu): verze IN_FORCE / NOT_YET_IN_FORCE platná v dotazovaný den, s textovou vrstvou, bez omezených podmínek užití, s článkem/§/přílohou (nikdy preambule) a s povoleným stavem původu. V produkci smí odpověď vycházet jen z verzí HUMAN_VERIFIED. AUTO_CHECKED jen pro interní test (`DAJC_KB_ALLOW_AUTO_CHECKED`, mimo Vercel produkci) a vždy jako ČÁSTEČNĚ.

## 3. Rozsah: jurisdikce a témata

- **Jurisdikce:** jediný zdroj pravdy zůstává `config/europe-coverage.mjs` (50 kódů), plus `EU` a `INT`. Rozšíření = nová země v `europe-coverage.mjs` (zvedne `COVERAGE_VERSION`) a její zdroje v `legal-sources.mjs`. `legislationCoverageGaps()` vypíše země bez zdroje legislativy; registr validuje test.
- **Témata:** nadrozměrná a těžká přeprava; povolení, výjimky, doprovody a zvláštní podmínky; hmotnosti, rozměry, nápravy; zákazy jízd; doby řízení a odpočinku; tachografy; pravidla pro nákladní vozidla nad 2,5 t a vyšší prahy; ADR; silniční kontroly a doklady; mýto, poplatky a ekologická omezení; přeshraniční přeprava a kabotáž; úřední uzavírky.
- **Hmotnostní prahy (2,5 t, 3,5 t, 7,5 t, 12 t, …):** text ustanovení se zmínkou o tunách dostane jen nápovědu `mass_mentions`. Pásmo, pro které pravidlo platí, nastavuje jmenovitě recenzent (`massBands` v manifestu, kontrola v DB). Bez potvrzeného pásma je výsledek UNREVIEWED a odpověď může být nejvýš ČÁSTEČNĚ. Pravidlo jiného pásma (MISMATCH) se nikdy nepoužije.
- **Použitelnost práva EU:** nařízení EU platí přímo v členských státech. U směrnice je nutné ověřit národní provedení, u států EHP (NO, IS, LI) začlenění do Dohody o EHP. Pro UK, Švýcarsko a země mimo EU/EHP se právo EU **nepoužije**. Mezinárodní dohody (ADR, AETR) vyžadují kontrolu smluvní strany.
- **Zákazy jízd:** jedinou autoritou pro DAJC AI zůstává registr Driving Bans. Knihovna smí uchovávat úřední podklady k zákazům pro jejich kontrolní vrstvu, ale DAJC AI z ní u zákazů neodpovídá.

## 4. Úřední zdroje (registr) a co bylo skutečně ověřeno

| Zdroj | Stav ověření 2026-11-08 |
|---|---|
| **EUR-Lex** (`eur-lex.europa.eu`) | **podmínky ověřeny** na právním upozornění: užití povoleno (rozhodnutí 2011/833/EU), konsolidovaná znění CC BY 4.0 s uvedením zdroje; autentické je jen znění v Úředním věstníku. Stav platnosti 6 předpisů ověřen na stránkách EUR-Lex („In force“, poslední konsolidace). |
| e-Sbírka (CZ), Slov-Lex (SK), Gesetze im Internet (DE) | dostupné z vývojového prostředí; podmínky užití nepřečteny (právní základ volného užití úředních děl uveden k potvrzení advokátem). gesetze-im-internet.de odmítá automatizované stahování (HTTP 503 pro importér), ochrana se neobcházela. |
| ISAP / Dziennik Ustaw (PL), RIS (AT), UNECE (ADR/AETR) | **zablokované** pro vývojové prostředí (HTTP 403/503 přímo z jejich serverů) |
| Ostatní národní sbírky (FR, IT, ES, NL, BE, LU, HU, SI, HR, RO, BG, DK, SE, FI, EE, LV, LT, IE, PT, GR, CH, LI, NO, UK, MT), ministerstva a silniční správci | v registru jako NOT_CHECKED; import se zastaví, dokud se neověří podmínky užití |

## 5. Zpracované dokumenty (lokální vývojová DB, ne produkce)

Staženo z EUR-Lex 2026-11-08, archivováno lokálně (obsahově adresováno), stav AUTO_CHECKED. Žádný dokument zatím neověřil člověk.

| Předpis (konsolidace) | Jazyky | Stran | Ustanovení (cs/de/en/pl/sk) | Účinnost verze |
|---|---|---|---|---|
| Nařízení (ES) č. 561/2006 — doby řízení a odpočinku | cs, de, en, pl, sk | 26 | 38 / 39 / 38 / 39 / 38 | 31. 12. 2024 |
| Nařízení (EU) č. 165/2014 — tachografy | cs, de, en, pl, sk | 49 | 59 / 64 / 62 / 64 / 60 | 31. 12. 2024 |
| Směrnice 96/53/ES — hmotnosti a rozměry | cs, de, en, pl, sk | 29 | 30 / 35 / 37 / 31 / 32 | 14. 8. 2019 |
| Nařízení (ES) č. 1072/2009 — přístup na trh, kabotáž | cs, de, en, pl, sk | 24 | 35 / 37 / 35 / 28 / 27 | 21. 2. 2022 |

20 verzí, SHA-256 a ID verzí jsou ve výstupu importu a v DB. StVO (DE) se importovat nepodařilo (viz výše). Na Neonu (`dev-kb-tests`) je kvůli ověření kompatibility jen vzorek 3 ustanovení nařízení 561/2006 (CS); plný import na Neon čeká na spojení importéru (sandbox nepouští TCP 5432).

## 6. Vyhledávání a odpověď

1. Klasifikace dotazu řidiče (existující Ask): země, téma, data, hmotnost vozidla, klíčová slova v úředním jazyce i angličtině.
2. Knihovna (ne pro zákazy jízd): přesný fulltext ve vybraných jazycích (jazyk dotazu, úřední jazyky zemí, angličtina) s filtry na jurisdikci včetně použitelnosti EU, den účinnosti, téma a povolený stav původu. Pro cs/sk/pl se hledá podle kmene (předpony), protože PostgreSQL pro ně nemá stemmer. Shoda celého výrazu má přednost, protože PostgreSQL nezná vzácnost slov.
3. Kontrola citovatelnosti: článek/§/příloha, strana, `#page=N`, SHA-256, platnost v daný den, žádné jiné hmotnostní pásmo, použitelnost v zemi.
4. Země, na kterou knihovna odpovídá přímo, se **nehledá placeně na webu**.
5. Návrh odpovědi jen z pasáží, doslovná citace, čísla musí být v citaci, deterministická kontrola (včetně zákazu potvrzovat průjezdnost, povolení nebo výjimku) a nezávislá kontrola jiným poskytovatelem. Ta se kvůli ceně nevypíná.
6. Zobrazení: *dokument · článek · strana*, odkaz na úřední PDF na konkrétní stranu, datum ověření a pevná upozornění. Citace není výklad, konsolidované znění není závazné a u neověřené verze, nejisté použitelnosti nebo hmotnostního pásma odpověď přizná nejistotu (nejvýš ČÁSTEČNĚ).

**Dotazy v pěti jazycích (lokální knihovna, role `dajc_ask_app` přes pooler, 2026-11-08):**

| Jazyk | Dotaz | První výsledek |
|---|---|---|
| cs | přestávka v řízení po čtyřech a půl hodinách | Nařízení (ES) č. 561/2006 · Článek 7 · s. 7 |
| pl | dzienny okres odpoczynku | Rozporządzenie (WE) nr 561/2006 · Artykuł 4 / Artykuł 8 · str. 4–10 |
| en (IE) | cabotage operations international carriage | Regulation (EC) No 1072/2009 · Article 8 · p. 7–9 |
| sk | tachograf karta vodiča | Nariadenie (EÚ) č. 165/2014 · Článok 2 · s. 3–5 |
| de | Fahrtunterbrechung, Lenkdauer viereinhalb Stunden | 561/2006 Artikel 4 (definice), Artikel 7 hned za ním |
| en (UK) | daily rest period driver | **nic** (právo EU se na UK nepoužije) |
| en (NO) | weekly rest period | 561/2006 Article 8 jako „ověřit začlenění do EHP“ |
| cs (2019-01-01) | přestávka v řízení | **nic** (verze účinná až od 31. 12. 2024) |

Celé odpovědi AI se zatím nemohly vyzkoušet, protože chybí klíče poskytovatelů. Pipeline je otestovaná s podvrženými modely na skutečných úryvcích článku 7 v cs/en/de/pl/sk (`src/lib/ask/__tests__/library.test.ts`).

**Regresní testy:** zastaralá a nahrazená verze, chybné hmotnostní pásmo (3,5 t vs 7,5 t), neúplná citace (preambule, chybí strana nebo hash), chybná výjimka („výjimka se zde uplatní“), čísla mimo citaci, neověřená a zamítnutá verze, UK/EHP/směrnice, výpadek knihovny.

## 7. Náklady provozu (3 dotazy denně, 30 dní; odhad, ne měření)

Předpoklady: ceny modelů jako v `docs/DAJC_AI_B2C_LAUNCH.md` (klasifikace 0,20/1,25; návrh 0,75/4,50; nezávislá kontrola 2/10 USD za 1M tokenů ≈ Claude Sonnet 5.5; vyhledávání 0,005 USD; 0,92 EUR/USD). Odpověď z knihovny posílá do modelu ≤ 4 ustanovení (≈ 4 000 tokenů) místo stažených webových stránek (≈ 10 000 tokenů) a nevolá Perplexity.

| Cesta dotazu | Náklad AI na dotaz |
|---|---|
| přes web (Perplexity + stránky) | ≈ 0,023 € |
| z knihovny (bez Perplexity) | ≈ 0,014 € (**−38 %**) |
| z knihovny + kontrola Claude Haiku 5.5 | ≈ 0,007 € (kvalitu nutno ověřit) |

| Řidiči (dotazů/měsíc) | AI jen web | AI 50 % knihovna | AI 80 % knihovna | Neon (Launch) | Archiv R2 | Import a indexace | **Celkem při 50 % knihovně*** |
|---|---|---|---|---|---|---|---|
| 100 (9 000) | 207 € | 167 € | 144 € | ≈ 15 € | 0 € | 0 € | **≈ 200 €** |
| 500 (45 000) | 1 035 € | 833 € | 720 € | ≈ 18 € | 0 € | 0 € | **≈ 890 €** |
| 1 000 (90 000) | 2 070 € | 1 665 € | 1 440 € | ≈ 23 € | 0 € | 0 € | **≈ 1 720 €** |

\* včetně Vercel Pro ≈ 18 € a Resend (0 € / 18 € / 18 €) z `DAJC_AI_B2C_LAUNCH.md`.

- **Neon:** Launch vychází podle odhadu aktivní doby na 0,25–0,5 CU zhruba na 110–240 CU-h (12–26 USD) plus úložiště ~1 GB (0,35 USD) a historie (0,20 USD/GB). Free tarif (100 CU-h, uspávání) stačí pro interní test, ne pro denní dostupnost.
- **Archiv R2:** celoevropská knihovna ≈ 1–5 GB PDF (≈ 750 národních předpisů × ~1 MB + předpisy EU ve 24 jazycích). Vejde se do bezplatných 10 GB-měsíc, výstup dat je zdarma a při dotazech se PDF nečte (text je v DB). Nad rámec bezplatného limitu stojí 0,015 USD/GB-měsíc. Vyžaduje účet Cloudflare a schválení.
- **Import a indexace:** bez AI (pdf.js + PostgreSQL fulltext), řádově sekundy na dokument; lze spouštět lokálně nebo v GitHub Actions v rámci bezplatných minut. Vektorové embeddingy se nepoužívají.
- **Skutečný hlavní náklad knihovny je lidská kontrola** (HUMAN_VERIFIED, hmotnostní pásma, podmínky užití), nikoli infrastruktura.
- **Knihovna vs. Perplexity:** každý dotaz zodpovězený z knihovny ušetří ≈ 0,009 €. Při 50 % podílu je to ≈ 40 / 200 / 400 € měsíčně pro 100 / 500 / 1 000 řidičů. Úspora roste s pokrytím knihovny.

Stropy rozpočtu (`DAJC_ASK_DAILY_BUDGET_EUR`, `…MONTHLY…`) a bezpečné pozastavení zůstávají beze změny. Doporučené hodnoty jsou v `DAJC_AI_B2C_LAUNCH.md` § 5.

## 8. Známá omezení

- PostgreSQL nemá stemmer pro češtinu, slovenštinu ani polštinu: hledání podle kmene je hrubé, přesnost řeší řazení a kontroly. Definiční články (např. čl. 4 nařízení 561/2006) se umísťují vysoko.
- EUR-Lex PDF obsahují slova rozdělená na konci řádku. Citace přes takové místo kontrola zahodí, což je bezpečné, ale snižuje to počet použitelných citací.
- Rozsah stran u dlouhých článků rozdělených na části je celý rozsah článku (citace nikdy neukáže před text).
- OCR cesta je jen fronta, samotné OCR není implementováno ani schváleno.
- Na Neonu je zatím jen vzorek. Plný import vyžaduje spuštění importéru z prostředí s TCP přístupem k Neonu (počítač vlastníka nebo GitHub Actions s tajemstvím).
