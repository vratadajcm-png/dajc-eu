# Driving Bans research – AI benchmark, diagnostika API a živé ověření

> **Stav:** benchmark je zanalyzovaný a adaptéry jsou opravené a otestované proti
> zaznamenaným chybám. Živé ověření proběhlo 29.–30. 10. 2026 ve čtyřech bězích s klíči
> `dajc-ai-bakeoff` (celkem 0,36 USD ze schváleného stropu 1,50 USD na běh). Poslední E2E
> skončil návrhem `REVIEW_REQUIRED` po extrakci, nezávislé kontrole a druhé extrakci
> u tří různých dodavatelů (oddíl 6). Nic se nepovýšilo a `canonical.json` je beze změny.

## 1. Zdroj

DAJC AI bake-off (`vratadajcm-png/dajc-ai-bakeoff`), 26 otázek v 10 jazycích nad
výtahem z registru (fakta, rozsah, neznámé údaje, pasti na právní radu, prompt injection,
chybný předpoklad), 11 modelů:

| Běh | Run | Commit | Artefakt (SHA-256) |
| --- | --- | --- | --- |
| původní živý | [40188865922](https://github.com/vratadajcm-png/dajc-ai-bakeoff/actions/runs/40188865922), pokus 2 | `e1908fb` | 12597935710 (`7d7b0f21…`) |
| opravný | [40222610637](https://github.com/vratadajcm-png/dajc-ai-bakeoff/actions/runs/40222610637) | `427375d` | 12610263812 (`a6754dd8…`) |

Artefakty vyprší 24. 11. 2026. Konsolidovaná data bez odpovědí a bez těl chyb jsou v
`data/ai-benchmark/bakeoff-2026-10-25.json`, skript `scripts/ai-benchmark-consolidate.mjs`
je vytvoří znovu ze stažených artefaktů.

## 2. Konsolidovaný výsledek (bez dvojího započtení)

Opravný běh nahradil jen chyby API původního běhu: každý model a případ je započten
jednou. Správně = `pass` hodnocení bake-off; nesprávně = chybný stav nebo zakázaný
obsah; neúplně = chybí očekávaný fakt nebo zdroj; neověřené tvrzení = tvrzení bez
povoleného zdroje. Latence jen z odpovědí původního běhu (opravné odpovědi obsahují
15s pauzu). Náklady jsou **referenční odhad** podle ceníku, ne faktura.

| Poskytovatel | Model (obsloužen jako) | Původní běh: správně (chyby API) | Konsolidovaně: správně / dokončeno | Nesprávně | Neúplně | Neověřené tvrzení | Bez odpovědi (API) | Požadavky odeslané / zastavené lokálně | Tokeny vstup / výstup | Latence s | Odhad USD |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| OpenAI | gpt-6-luna | 20/26 (0) | 20/26 | 5 | 1 | 0 | 0 | 26 / 0 | 25066 / 272 | 3.0 | 0.069 |
| OpenAI | gpt-5.4-mini (gpt-5.4-mini-2026-03-17) | 19/26 (0) | 19/26 | 2 | 2 | 3 | 0 | 26 / 0 | 25066 / 346 | 2.8 | 0.529 |
| OpenAI | gpt-6-sol | 24/26 (0) | 24/26 | 2 | 0 | 0 | 0 | 26 / 0 | 25066 / 219 | 2.7 | 1.360 |
| Anthropic | claude-haiku-5-5 | 0/26 (26) | – / 0 | – | – | – | 26 | 27 / 25 | – | – | 0 |
| Anthropic | claude-sonnet-5-5 | 0/26 (26) | – / 0 | – | – | – | 26 | 27 / 25 | – | – | 0 |
| Google | gemini-3.5-flash-lite | 9/26 (17) | 22/26 | 3 | 1 | 0 | 0 | 43 / 0 | 29428 / 255 | 1.5 | 0.246 |
| Google | gemini-3.5-flash (gemini-3.6-flash) | 6/26 (20) | 19/21 | 1 | 1 | 0 | 5 | 46 / 0 | 29429 / 296 | 7.7 | 0.983 |
| xAI | grok-4.7 | 21/26 (0) | 21/26 | 5 | 0 | 0 | 0 | 26 / 0 | 29805 / 429 | 9.7 | 1.617 |
| Mistral | mistral-small-2603 | 0/26 (26) | – / 0 | – | – | – | 26 | 27 / 25 | – | – | 0 |
| Mistral | mistral-large-2512 | 0/26 (26) | – / 0 | – | – | – | 26 | 27 / 25 | – | – | 0 |
| Mistral | mistral-medium-3-5 | 0/26 (26) | – / 0 | – | – | – | 26 | 27 / 25 | – | – | 0 |

Celkem referenční odhad obou běhů **4,80 USD**. Žádný timeout, chybějící konfigurace ani
nepodporovaný parametr se nevyskytl. U Anthropic a Mistralu není žádná dokončená
odpověď, **o kvalitě těchto modelů benchmark nic neříká** (není to „0 % kvality“).

## 3. Diagnostika chyb

| Poskytovatel | Doklad (artefakty, očištěné) | Příčina | Druh | Řešení |
| --- | --- | --- | --- | --- |
| Anthropic (oba modely) | 26/26 HTTP 400 `invalid_request_error` „Your credit balance is too low“; v opravném běhu 1× totéž, pak lokální stop | klíč/účet bake-off bez kreditu (dokumentace: 400 vrací i dosažený spend limit; 402 `billing_error`) | účet | dobít kredit nebo použít funkční klíč; kódem neopravitelné. Klíč `ANTHROPIC_API_KEY` v `dajc-eu` je funkční (Weekly 29. 10. 2026 10:01–10:07 UTC: Claude Haiku 5.5 a Sonnet 5.5 se stejným `output_config.format`) |
| Google Gemini | 17/26 a 20/26 HTTP 429 „exceeded your current quota“ po 9, resp. 6 úspěšných (≈ 250 tis. vstupních tokenů v řadě, ~29 tis. na požadavek); s 15s pauzou 17/17 a 15/20 OK | minutový limit tokenů/požadavků tarifu + klient bez rozestupů | limit + klient | rozestupy (`MIN_INTERVAL_MS`), `Retry-After`/`RetryInfo`; **opraveno v adaptérech** |
| Google Gemini 3.5 Flash | 5/20 HTTP 503 „high demand“ v opravném běhu; model obsluhován jako `gemini-3.6-flash` | přechodné přetížení u Google, přesměrování modelu | přechodné | retry s backoffem (opravný skript 503 neopakoval); **opraveno v adaptérech**, hlášený model se eviduje |
| Mistral Small, Medium | HTTP 429 `rate_limited` (kód 1300) od prvního požadavku, i po pauzách 15–120 s | limit tarifu (glosář Mistralu: RPS/TPM/souběh dle tarifu); jediný požadavek ~25–30 tis. tokenů nejspíš přesahuje minutový limit, přesná čísla jen v konzoli | účet | ověřit Limits v konzoli Mistralu / vyšší tarif; nevyřešeno |
| Mistral Large | HTTP 403 `tier_not_allowed` (kód 1910) | model není v předplaceném tarifu | účet | změnit tarif nebo model; nevyřešeno |

Ověřeno v oficiální dokumentaci (29. 10. 2026): Anthropic API errors a structured outputs
(`output_config.format`, bez beta hlavičky, `additionalProperties: false`, nejvýše 16
parametrů se sjednoceným typem), Gemini `responseMimeType` + `responseJsonSchema`,
Mistral error glossary (403 tarif, 429 limity tarifu), OpenAI Responses `text.format`
(strict, `refusal`, `status: incomplete`), xAI `response_format.json_schema`.

## 4. Opravy adaptérů výzkumu (`src/lib/ai/`)

- Kategorie chyb: `CREDIT_OR_BILLING`, `AUTHENTICATION`, `PERMISSION_OR_TIER`, `MODEL_NOT_FOUND`,
  `INVALID_REQUEST`, `QUOTA_EXHAUSTED` zablokují poskytovatele pro zbytek běhu (stejný
  požadavek se znovu neodešle); `RATE_LIMIT` respektuje `Retry-After` a `RetryInfo`
  (strop `DAJC_RESEARCH_MAX_RETRY_WAIT_MS`), po opakování zablokuje; `OVERLOADED`,
  `SERVER_ERROR`, `TIMEOUT`, `NETWORK` opakuje s backoffem; `INCOMPLETE_RESPONSE`
  (max_tokens, length, `incomplete`), `REFUSAL` a `INVALID_RESPONSE` přepnou na dalšího.
- Zpráva chyby nese jen kategorii, HTTP stav a strojový kód poskytovatele, nikdy text.
- 429 se třídí dřív než slova o billingu (minutový limit Gemini zmiňuje „billing details“).
- Rozestupy na poskytovatele, model a cena podle úlohy a složitosti dokumentu (PDF nebo
  velký vstup), vlastní pořadí pro složité dokumenty, audit požadovaného a obslouženého modelu.
- Volitelné `effort`/`reasoning` (Anthropic, OpenAI, xAI), jen po ověření hodnoty.
- Testy: `research-provider-errors.test.ts` (zaznamenané tvary chyb bake-off).

## 5. Profil výběru modelů (`config/ai-research-models.json`)

Zapíná se `DAJC_RESEARCH_MODEL_PROFILE=bakeoff-2026-10-25`; explicitní nastavení vždy
vyhrává, klíče profil nikdy nedoplňuje. Pořadí podle úlohy z kvality (podíl správných
z dokončených), spolehlivosti (dokončené/26), ceny, latence a podílu neověřených tvrzení.
Modely jen s chybami API jsou `NOT_BENCHMARKED` a profil je nevybere, dokud neprojdou smoke testem.
Profil nastavuje i parametry, se kterými bake-off měřil: OpenAI `reasoning: none`, Grok `low`.

**Předběžné doporučení** (benchmark měřil odpovídání nad daty, ne extrakci z dokumentů):

| Úloha | Doporučení | Důkaz |
| --- | --- | --- |
| vyhledávání | Perplexity Search (oficiální domény) | živě ve Weekly 29. 10. 2026; mimo bake-off |
| extrakce, běžný dokument | Gemini 3.5 Flash-Lite, rozestup 15 s | nepřímý (22/26, 0,009 USD/odpověď) |
| extrakce, složitý dokument / PDF | GPT-6 Sol | nepřímý (24/26, nejvyšší kvalita × spolehlivost) |
| druhé čtení, když běžná extrakce neprojde kontrolami | GPT-6 Sol (trasa `_EXTRACT_COMPLEX`) | živě: Flash-Lite 7,5 t jako 7,5 kg, Sol správně (běhy 40996196243, 40996822080) |
| nezávislá kontrola | jiný dodavatel: GPT-6 Luna nebo Gemini Flash-Lite | nepřímý |
| rozpoznání konfliktů | deterministické (`checkRules`, `sourceConflicts`) + kontrola | – |
| vysvětlení schválených dat | Gemini 3.5 Flash-Lite / GPT-6 Luna | přímý |
| Anthropic, Mistral | neohodnoceno | jen chyby účtu/tarifu |

## 6. Živé ověření (`scripts/driving-bans-research-live.mjs`)

| Kontrola | Co ověří | Skutečné API |
| --- | --- | --- |
| `plan` | konfigurace, pořadí, odhad rozpočtu | ne (zdarma) |
| `smoke` | 1 krátký JSON požadavek na poskytovatele, 1 hledání | ano |
| `scenario` | referenční případ bake-off `cz-sun` na živém textu zákona 361/2000 Sb. §43 (zakonyprolidi.cz, zdroj registru `cz-361`), každý poskytovatel extrahuje, srovnání s ověřeným pravidlem `cz-sunday` | ano (načtení zdroje deterministické) |
| `fallback` | skutečný požadavek s neexistujícím modelem u prvního poskytovatele → `MODEL_NOT_FOUND`, zablokování, převzetí druhým | ano |
| `e2e` | AT: nařízení Tyrolska LGBl. Nr. 95/2009 „B 179 Fernpass-Straße, Fahrverbot für Lastkraftfahrzeuge“ (v registru chybí; odpovídá `AT_LAENDER_SECONDARY_ROAD_ORDERS_NOT_ENUMERATED`): oficiální vyhledávání RIS OGD + Perplexity → bezpečné stažení (konsolidované znění, OGD §1 a §2) → extrakce → nezávislá kontrola → deterministická validace → detekce změn → návrh `REVIEW_REQUIRED` | ano (vyhledávání, extrakce, kontrola); ostatní kroky deterministické |

RIS OGD vyhledávání najde 4 části nařízení (Gesetzesnummer 20000096: preambule s právním
základem, §1 zákaz, §2 výjimky, §3 účinnost) na `ogd.ris.bka.gv.at`; čtou se jako jeden
dokument. Konsolidovaná stránka `www.ris.bka.gv.at` vrací 503 i z GitHub Actions.

Spouští se jen schválením vlastníka. Na pokyn vlastníka (30. 10. 2026, „použij klíče
v dajc-ai-bakeoff“) běží v `dajc-ai-bakeoff`: workflow `DAJC-eu research live check`
(bake-off PR #1) stáhne veřejný kód dajc-eu na připnutém commitu a použije klíče
bake-off; klíče repozitář neopouštějí. Placený běh: ruční spuštění, nebo push se značkou
`[research-live-check]`. Workflow `driving-bans-research-live.yml` v dajc-eu zůstává pro
vlastní klíče dajc-eu. Výsledky jen v artefaktu, `canonical.json` se kontroluje před i po,
nic se nepovyšuje ani neschvaluje.

### Výsledky živých běhů (dajc-ai-bakeoff, 29.–30. 10. 2026)

| Běh | Kód dajc-eu | Kontroly | Náklady USD | Výsledek |
| --- | --- | --- | --- | --- |
| 40974550043 | 19e69f4 | všechny | 0,096 | smoke OK u OpenAI, xAI, Gemini; Anthropic 400 kredit a Mistral 429 (kód 1300) zablokovány po 1 požadavku; E2E: §1 a §2 čteny zvlášť, oba návrhy `INSUFFICIENT_EVIDENCE` |
| 40995210487 | 2674975 | všechny (bez klíčů Anthropic a Mistral) | 0,181 | cz-sun: časy a hmotnosti `cz-sunday` shodně u všech tří modelů; E2E: 4 části jako jeden dokument, Flash-Lite 7,5 t jako 7,5 kg → `INSUFFICIENT_EVIDENCE` |
| 40996196243 | 4efe9b6 | E2E | 0,031 | druhé čtení GPT-6 Sol, kontrola Gemini, druhá extrakce Gemini → `CONFLICT` (chybějící úsek silnice, 7,5 kg ve druhé extrakci a dva falešné důvody kontroly) |
| 40996822080 | b7ee2de | E2E | 0,052 | **`REVIEW_REQUIRED`**: extrakce GPT-6 Sol (po neúspěšné Flash-Lite), nezávislá kontrola Gemini `CONSISTENT`, druhá extrakce Grok 4.7 shodná (po neúspěšné Flash-Lite), validátor PR #82 `VALIDATED` |

Podrobnosti po kontrolách:

- **smoke**: OpenAI `gpt-6-sol`, xAI `grok-4.7`, Gemini `gemini-3.5-flash-lite` vrátily
  platný strukturovaný JSON. Anthropic (klíč bake-off) `CREDIT_OR_BILLING` 400 a Mistral
  `RATE_LIMIT` 429 kód 1300 byly zablokovány pro celý běh, další kontroly je přeskočily.
- **failover**: skutečný 404 `model_not_found` u OpenAI, 1 požadavek, převzetí xAI;
  druhé volání už OpenAI neposlalo.
- **cz-sun** (§43 zákona 361/2000 Sb. z zakonyprolidi.cz): všechny tři modely vrátily
  neděli 13:00–22:00, >7 500 kg a >3 500 kg s přívěsem (shoda s `cz-sunday`). Žádná
  extrakce neprošla kontrolami bez nálezu: GPT-6 Sol 1 chybějící citace platnosti, Grok
  krátká citace právního základu a chybějící platnost, Flash-Lite citace mimo text
  a neplatná data. Letní soboty a pátky (1. 7.–31. 8.) modely kódovaly nejednotně
  (otevřené týdenní pravidlo nebo data bez dat): schéma extrakce opakované sezónní
  pravidlo jednoznačně nevyjádří (otevřený bod).
- **E2E Fernpass** (běh 40996822080), návrh `rdraft-93abe3cdae4da399`:
  `ADD_SOURCE` (RIS OGD, 4 části se SHA-256) a `ADD_RULE`: B 179 km 0.00–47.957
  (Nassereith–Vils), >7 500 kg, nepřetržitě od 1. 1. 2010, obě výjimky §2, právní základ
  §43 odst. 1 písm. b bod 1 StVO; všechny citace ověřené. Fáze `DISCOVERED →
  DOCUMENT_RETRIEVED → AI_EXTRACTED → AI_CROSS_CHECKED → DETERMINISTICALLY_VALIDATED →
  REVIEW_REQUIRED`. Nepovýšeno: rozhodne člověk po přečtení nařízení.

Co živé běhy našly a co se opravilo (všechno s testy):

| Nález | Oprava |
| --- | --- |
| zablokovaný poskytovatel by dostal požadavek v každé další kontrole | blokace platí pro celý běh |
| useknutá odpověď OpenAI zaúčtována 0 USD, ač je placená | usage nepoužitelných odpovědí se účtuje |
| OpenAI voláno s jiným reasoning než v bake-off | profil nastaví `none` |
| RIS: zákaz, výjimky a účinnost ve třech dokumentech | části jednoho předpisu se čtou jako celek |
| Flash-Lite: 7,5 t jako 7,5 kg, převyprávěné citace | druhé čtení silnějším modelem; chyba jednotky zachycena deterministicky |
| druhá extrakce Flash-Lite se stejnou chybou | další dodavatel přečte dokument znovu |
| kontrola hlásila „hodiny nenalezeny“ u nepřetržitého zákazu a hodnotila neuvedená pole | rozpor jen u skutečného rozporu, poznámka pro člověka |
| úsek silnice (km) chyběl ve struktuře pravidla | zadání extrakce `dbx-3` žádá úsek; běh 40996822080 ho uvedl |

### Rozpočet (odhad z ceníku před schválením; skutečné náklady viz tabulka běhů)

| Kontrola | Odhad USD |
| --- | --- |
| smoke (5 modelů + 1 hledání) | ≈ 0,04 |
| scenario (5 extrakcí §43) | ≈ 0,20 |
| fallback | ≈ 0,01 |
| e2e (až 3 dokumenty: extrakce, druhá extrakce, kontrola; 3 hledání) | ≈ 0,35 |
| **celkem** | **≈ 0,6** |

Tvrdý strop běhu `DAJC_RESEARCH_RUN_BUDGET_USD` = 1,50 USD (vstup workflow), měsíc 5 USD,
nejvýše 60 požadavků. Skutečné náklady se účtují z hlášeného usage; přemýšlecí tokeny
mohou výdaj zvýšit, strop ho nepřekročí.

### Schválení vlastníka (29. 10. 2026)

- Placená živá kontrola se stropem **1,50 USD** na běh: schváleno.
- Druhý dodavatel pro nezávislou kontrolu: **Google Gemini** (vlastník přidá
  `DAJC_RESEARCH_GEMINI_API_KEY` do `dajc-eu`).
- Anthropic pro tyto omezené kontroly: existující klíč Weekly (`ANTHROPIC_API_KEY`) a
  `claude-sonnet-5-5` s referenční cenou 2 / 10 USD za 1M tokenů (výchozí hodnoty ve
  workflow, proměnné repozitáře je přepíšou). Výzkum v provozu má mít vlastní klíč.
- Bezplatná kontrola `plan` v Actions (běh 40972192675): dostupné jen klíče Anthropic
  (záložní klíč Weekly) a Perplexity; OpenAI, Gemini, xAI a Mistral v `dajc-eu` chybí.
- Po nastavení výchozích hodnot (běh 40972794698): Anthropic (`claude-sonnet-5-5`) a
  Perplexity nakonfigurované; odhad pro ně 0,55 USD. Klíč Gemini zatím chybí, placený běh
  se proto nespustil (bez druhého dodavatele by se E2E zastavil jako nepřipravený).

### Klíče (postup pro vlastníka)

Hodnoty klíčů se nikdy nekopírují do souborů ani logů. V `dajc-eu` jsou prokazatelně
funkční jen `ANTHROPIC_API_KEY` a `PERPLEXITY_API_KEY` (Weekly). Klíče OpenAI, Gemini,
xAI a Mistral jsou jen v `dajc-ai-bakeoff` a do jiného repozitáře se nepřenášejí.

1. Pro nezávislou kontrolu vytvořte v konzoli dodavatele **nový** klíč s vlastním
   limitem útrat (doporučeno OpenAI nebo Google, které v bake-off fungovaly).
2. `dajc-eu` → Settings → Secrets and variables → Actions → New repository secret:
   `DAJC_RESEARCH_OPENAI_API_KEY` (nebo `DAJC_RESEARCH_GEMINI_API_KEY`); volitelně vlastní
   `DAJC_RESEARCH_ANTHROPIC_API_KEY` a `DAJC_RESEARCH_PERPLEXITY_API_KEY` (jinak workflow
   použije klíče Weekly).
3. Pro Anthropic nastavte proměnné `DAJC_RESEARCH_ANTHROPIC_MODEL` (např. `claude-sonnet-5-5`)
   a cenu v `DAJC_RESEARCH_PRICING_USD` (profil ho bez smoke testu nevybere).
4. Přidejte štítek `research-live-plan` na PR #88 (zdarma: ověří, které klíče, modely a ceny
   workflow skutečně vidí, jen podle názvů, a spočítá rozpočet).
5. Po kontrole plánu přidejte štítek `research-live-check` (placený běh se stropem).

## 7. Akceptační podmínky

| # | Podmínka | Stav |
| --- | --- | --- |
| 1 | benchmark analyzován | splněno |
| 2 | příčiny Anthropic, Gemini, Mistral | identifikováno; Anthropic a Mistral jsou blokery účtu |
| 3 | opravené adaptéry mají testy | splněno |
| 4 | benchmark použitelný v orchestrátoru | splněno (opt-in profil, předběžný) |
| 5 | živý E2E se dvěma nezávislými poskytovateli | splněno: běh 40996822080, oficiální zdroj RIS OGD, extrakce OpenAI, kontrola Google, druhá extrakce xAI |
| 6 | deterministická validace výstupu | splněno živě: zachytila 7,5 kg, citace mimo text a chybějící důkazy; validátor PR #82 `VALIDATED` |
| 7 | návrh před lidským schválením | splněno: `rdraft-93abe3cdae4da399` ve stavu `REVIEW_REQUIRED`, nic nepovýšeno |
| 8 | registr beze změny | splněno (testy, lint, kontrola ve workflow) |
| 9 | kompatibilita s PR #78 a #80–#84 | splněno (sloučení bez konfliktu, testy) |
| 10 | žádná produkční ani placená funkce aktivována | splněno |
