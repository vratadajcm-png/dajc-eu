# Driving Bans – AI vyhledávání a ověřování podkladů

> **Stav: implementováno, ve výchozím stavu vypnuto, živě neověřeno.** Analýza AI bake-off,
> diagnostika chyb API, profil výběru modelů a postup živého ověření:
> [`DRIVING_BANS_RESEARCH_BENCHMARK.md`](DRIVING_BANS_RESEARCH_BENCHMARK.md).
> V repozitáři ani v tomto prostředí nejsou klíče žádného AI poskytovatele.
> Všechny testy běží proti syntetickým přípravkům (`tests/fixtures/driving-bans-research/`).
> Úspěšný build ani syntetický test nejsou důkazem fungující živé integrace.

AI aktivně hledá oficiální dokumenty, čte je, extrahuje pravidla, nechá je
nezávisle zkontrolovat a porovná je s registrem. Výsledkem je **návrh**. Právní
ověření, schválení a publikace zůstávají na člověku a na schváleném pull requestu.
`data/driving-bans/canonical.json` zůstává jediným registrem; výzkum do něj
nikdy nezapisuje.

## Tok

```
Source Registry (PR 81), canonical.json, oficiální domény
        │
 DISCOVERED ──► DOCUMENT_RETRIEVED ──► AI_EXTRACTED ──► AI_CROSS_CHECKED ──► DETERMINISTICALLY_VALIDATED ──► REVIEW_REQUIRED
   hledání       bezpečné stažení       extrakce s         jiný dodavatel       existující validace PR 82/83     návrh čeká
   (Perplexity)  SHA-256, metadata      doslovnými citacemi + druhá extrakce     (suchý běh)                      na člověka
        │                │                     │                  │                        │
        └── NOT_RELEVANT, SOURCE_UNAVAILABLE, UNCHANGED_SOURCE, NO_CHANGE, DUPLICATE    INSUFFICIENT_EVIDENCE / CONFLICT
                                                                                              │
 člověk přečte primární text ──► promote ──► existující automat PR 82:
 IMPORTED → VALIDATED → REVIEW_REQUIRED → APPROVED (člověk) → READY_FOR_CANONICAL_UPDATE → kandidátní dataset → publikační PR
```

Výzkumné fáze jsou interní kroky před `IMPORTED`. Druhý schvalovací automat
nevzniká: stavy `REVIEW_REQUIRED`, `INSUFFICIENT_EVIDENCE`, `CONFLICT` a `REJECTED`
mají stejný význam jako v `review-workflow.mjs`.

## Soubory

| Soubor | Úloha |
| --- | --- |
| `src/lib/ai/providers.mjs` | adaptéry šesti poskytovatelů nad `fetch`, bez SDK |
| `src/lib/ai/orchestrator.mjs` | směrování úloh, nezávislost kontroly, rozpočet, retry, circuit breaker, ledger, audit |
| `src/lib/ai/model-profile.mjs` | výběr modelů z benchmarku; živé důkazy a stav účtů z DAJC AI Lab (`docs/DAJC_AI_LAB.md`) |
| `scripts/ai-lab-live-evidence.mjs` | převod artefaktů živých testů AI Lab na metadata pro katalog (bez citací a klíčů) |
| `src/lib/driving-bans/research/safe-fetch.mjs` | stahování bez SSRF |
| `src/lib/driving-bans/research/documents.mjs` | text a metadata dokumentu, obalení nedůvěryhodného textu, hledání vložených instrukcí |
| `src/lib/driving-bans/research/discovery.mjs` | výchozí zdroje a dotazy na jurisdikci |
| `src/lib/driving-bans/research/extraction.mjs` | schéma a prompt extrakce, deterministické kontroly citací, čísel a časů, návrh pravidla |
| `src/lib/driving-bans/research/cross-check.mjs` | nezávislá kontrola a porovnání dvou extrakcí |
| `src/lib/driving-bans/research/proposal.mjs` | porovnání s registrem, operace podání, suchý běh existující validace |
| `src/lib/driving-bans/research/pipeline.mjs` | běh, úložiště se strážcem zápisu, report |
| `src/lib/driving-bans/research/promote.mjs` | lidský krok do existujícího schvalování, zamítnutí |
| `src/lib/driving-bans/research/config.mjs` | připravenost a vypínač |
| `scripts/driving-bans-research.mjs` | CLI |

## Poskytovatelé

Jedno rozhraní, žádných šest systémů. Každý poskytovatel má vlastní klíč pro
výzkum (ne klíče Weekly ani Ask), model a cenu jen z proměnných prostředí. Bez
klíče, modelu nebo ceny je poskytovatel vypnutý.

| Poskytovatel | Výchozí role | Vstup PDF | Proměnné | Adaptér | Živý test |
| --- | --- | --- | --- | --- | --- |
| Perplexity | hledání na oficiálních doménách (`/search`, `search_domain_filter`) | – | `DAJC_RESEARCH_PERPLEXITY_API_KEY` | ano | ne |
| Anthropic Claude | extrakce (1. priorita), záložní kontrola | ano | `DAJC_RESEARCH_ANTHROPIC_API_KEY`, `_MODEL` | ano (Messages API, `output_config.format`) | ne |
| OpenAI | nezávislá kontrola (1. priorita), záložní extrakce | ano | `DAJC_RESEARCH_OPENAI_API_KEY`, `_MODEL` | ano (Responses API, `store: false`, strict schema) | ne |
| Google Gemini | kontrola, záložní extrakce | ano | `DAJC_RESEARCH_GEMINI_API_KEY`, `_MODEL` | ano (`generateContent`, `responseJsonSchema`) | ne |
| Mistral (EU) | kontrola, záložní extrakce | ne | `DAJC_RESEARCH_MISTRAL_API_KEY`, `_MODEL` | ano (chat completions, `json_schema`) | ne |
| xAI Grok | kontrola, záložní extrakce | ne | `DAJC_RESEARCH_XAI_API_KEY`, `_MODEL` | ano (chat completions, `json_schema`) | ne |

Ceny: `DAJC_RESEARCH_PRICING_USD`, například
`{"anthropic":{"input":3,"output":15},"perplexity":{"request":0.005}}` (USD za 1M tokenů,
resp. za požadavek; čísla jsou jen příklad, platí ceník dodavatele).

`npm run driving-bans:research -- status` vypíše, co chybí, jen názvy proměnných.

## Orchestrace

- Pořadí podle úlohy: `DAJC_RESEARCH_ROUTE_DISCOVER`, `_EXTRACT`, `_VERIFY`
  (id oddělená čárkou). Výchozí: hledání `perplexity`; extrakce
  `anthropic, openai, gemini, mistral, xai`; kontrola `openai, gemini, mistral, xai, anthropic`.
- Kontrola vždy běží u **jiného dodavatele** než extrakce. Rizikové změny
  (nové pravidlo, zrušení, změna hmotnosti, rozvrhu nebo silnic) dostanou navíc
  druhou nezávislou extrakci a porovnání pole po poli.
- Druhé čtení: extrakce, která neprojde deterministickými kontrolami, se jednou přečte
  znovu silnější trasou (`_EXTRACT_COMPLEX`) a použije se ta s méně blokujícími nálezy
  (`ESCALATED_EXTRACTION`). Druhé volání téhož modelu nikdy nevznikne. Druhá nezávislá
  extrakce, která sama neprojde kontrolami, nic nepotvrzuje: přečte ji ještě jeden další
  dodavatel (`SECOND_EXTRACTION_RETRIED`); neprojde-li ani ten, rozpor platí.
- Nezávislá kontrola: rozpor je jen `CONTRADICTED`, nebo `NOT_FOUND`/`UNCLEAR` u pole,
  které extrakce cituje. Nenalezené hodiny u zákazu bez hodin (nepřetržitý zákaz) jsou
  poznámka `CHECK_FOUND_NO_HOURS`, potvrzuje je člověk.
- `DAJC_RESEARCH_PREFER_LOWER_COST=true` seřadí povolené poskytovatele podle ceny.
  „Dostatečně kvalitní“ určuje vlastník tím, koho do pořadí zařadí.
- Retry s exponenciálním backoffem jen u dočasných chyb (408, 429, 5xx, 529, síť),
  circuit breaker po opakovaných selháních, pak přepnutí na dalšího poskytovatele.
- Limity: `DAJC_RESEARCH_RUN_BUDGET_USD`, `DAJC_RESEARCH_MONTHLY_BUDGET_USD`,
  `DAJC_RESEARCH_MAX_REQUESTS_PER_RUN`, `DAJC_RESEARCH_MAX_INPUT_TOKENS_PER_CALL`.
  Před každým voláním se odhadne cena; nevejde-li se, běh AI práci zastaví
  (`BUDGET_EXHAUSTED`) a nic nehádá. Useknutá, odmítnutá nebo poškozená odpověď se
  účtuje podle hlášeného usage: poskytovatel ji fakturuje.
- Náklady se účtují po modulech a poskytovatelích v `ledger.json` výzkumného
  úložiště. V GitHub Actions se ledger mezi běhy nepřenáší; skutečný měsíční strop
  tam drží `RUN_BUDGET` a limity nastavené přímo u poskytovatelů.
- Každé volání má auditní záznam: poskytovatel, model, tokeny, cena, výsledek,
  SHA-256 požadavku. Nikdy prompt ani klíč.
- Výzkum posílá poskytovatelům jen veřejné právní dokumenty (`dataClass: public-legal`).
  Data zákazníků (vozidla, trasy, organizace) orchestrátor výzkumu odmítne.

## Získávání dokumentů a bezpečnost

- Jen `https`, port 443, bez přihlašovacích údajů v URL, bez IP literálů.
- Host musí patřit k jurisdikci: domény z `config/official-authority-domains.mjs`,
  hosty PRIMARY zdrojů v `canonical.json` a PRIMARY záznamy Source Registry.
  Výsledky hledání mimo tyto hosty se zahodí a spočítají v reportu.
- Všechny DNS odpovědi musí být veřejné adresy; spojení se připne na ověřenou
  adresu (žádný DNS rebinding). Každé přesměrování se kontroluje znovu.
- Povolené typy: HTML, PDF (kontrola `%PDF-`), JSON, XML, RSS/Atom, text.
  Nejvýše 15 MB, timeout 25 s.
- Každý dokument: URL, konečná URL, autorita, čas získání, SHA-256, velikost,
  typ, jazyk, `Last-Modified`/ETag, ELI metadata a verze (je-li v HTML), stav
  dostupnosti, licence a práva ze Source Registry. Ustanovení a strana jsou u
  každé citace (`provision`, `page`).
- Předpis vydaný v několika oficiálních dokumentech (RIS vydává preambuli a každý
  paragraf zemského nařízení zvlášť) je jeden lead `{ url, parts, title }`: části se
  stáhnou stejně bezpečně, každá se uloží se svým SHA-256 a čtou se jako jeden
  `TEXT_EXCERPT` (zákaz, výjimky a účinnost dohromady). Selže-li jedna část, je celek
  `SOURCE_UNAVAILABLE` s `part_url`.
- Nedostupný zdroj je `SOURCE_UNAVAILABLE` a report u zdroje z registru říká
  „publication trust needs review; the ban is NOT cancelled“. Nikdy z toho nevznikne zrušení.
- DATEX II, RSS a jiná provozní data nevytvoří právní zákaz: konektory (PR 84)
  smí vytvořit jen dočasná omezení a extrakce označí provozní oznámení jako
  `TEMPORARY_TRAFFIC_RESTRICTION`, které se do veřejného kalendáře nedostane.

### Vložené instrukce (prompt injection)

- Text dokumentu je vždy data v obálce `<<<UNTRUSTED DOCUMENT nonce>>>` s náhodným
  nonce; podvržené značky v dokumentu se neutralizují.
- Systémový prompt výslovně říká, že nic uvnitř není instrukce; model hlásí
  pokusy přes `instructions_found_in_document`.
- Deterministický sken hledá typické fráze („ignore previous instructions“,
  „mark this rule as verified“ …) a návrh pošle do `CONFLICT`.
- Model nemá žádné nástroje ani možnost zápisu. Schéma výstupu nemá pole pro stav
  ověření, `NO_BAN` ani úplnost pokrytí. Každé rozhodné tvrzení musí mít doslovnou
  citaci, která se v dokumentu skutečně najde.

## Extrakce a deterministické kontroly

Model vrací pravidla v pevném schématu: druh omezení, kategorie vozidel, kritéria
hmotnosti a rozměrů (`any_of`/`all_of`, operátor, hodnota, jednotka, MAM vs.
skutečná hmotnost), rozvrh (dny, data, časy, přesah přes půlnoc), platnost,
časové pásmo, silnice, regiony, směr, výjimky s podmínkami, ADR, nadrozměrná
přeprava, vztah k dřívějším pravidlům a právní základ.

Kontroly (`checkExtractedRule`):

- citace musí být v dokumentu doslova (normalizace Unicode, uvozovek a mezer);
- citace musí existovat pro rozsah vozidel, hmotnost, dny nebo data, začátek,
  konec a právní základ; pro silnice, výjimky, platnost a zrušení, pokud jsou uvedeny;
- hodnota hmotnosti musí být číslem v citaci (`7 500 kg`, `7,5 t`), hodiny časů také;
- žádná chybějící hodnota se nedoplní (`WEIGHT_INCOMPLETE`, `VALIDITY_MISSING`,
  `TIMEZONE_AMBIGUOUS` u zemí s více pásmy, `CORRIDOR_SCOPE_MISSING` u KZ/RU/TR);
- u PDF nejde citace ověřit strojově (text se lokálně nevytahuje) → vždy
  `QUOTES_NOT_MACHINE_VERIFIABLE` a `INSUFFICIENT_EVIDENCE`; přednost mají HTML/ELI verze předpisů.

Pak běží existující validace (`validateProposal`: kanonické schéma, duplicity,
souběžné návrhy, sémantické kontroly `checkRules`, klasifikace `detectChanges`).
Kvůli suchému běhu dostane podání dočasně čas získání místo `legal_verified_at`;
uložený návrh má `legal_verified_at: null`.

## Porovnání s registrem

- Rozhoduje struktura: dny/data, časy, přesah, operátory a hodnoty hmotnosti,
  čísla silnic, rozšíření platnosti. Formulace (`applies_to`, třídy silnic,
  regiony, počet výjimek) jdou posuzovateli jako poznámky.
- Bez shody s registrem → `ADD_RULE` (a `ADD_SOURCE` pro nový oficiální zdroj).
- Rozdíl → `AMEND_RULE` s `expected_sequence`.
- Výslovné zrušení s citací: všech dní pravidla → `CANCEL_RULE`; jen některých
  dní → `AMEND_RULE` s `excluded_dates` (`PARTIAL_REPEAL`).
- Pravidlo z registru, které extrakce nenašla, je jen poznámka, nikdy zrušení.
- Dva dokumenty jednoho běhu, které stejné pravidlo mění různě → oba `CONFLICT` (`SOURCE_CONFLICT`).
- Dokument se stejným SHA-256 jako zdroj v registru → `UNCHANGED_SOURCE` bez volání AI.

## Lidský krok a publikace

```bash
npm run driving-bans:research -- list
npm run driving-bans:research -- show rdraft-…
# po přečtení primárního textu:
npm run driving-bans:research -- promote rdraft-… --reviewer "Jméno" --reason "…" \
  --legal-verified-at 2026-11-05T09:30:00Z --review-from 2026-11-01 --review-to 2026-12-31
npm run driving-bans:research -- reject rdraft-… --reviewer "Jméno" --reason "…"
# dál existující příkazy:
npm run driving-bans:evidence -- approve prop-… --reviewer "…" --reason "…"
npm run driving-bans:evidence -- prepare prop-…
```

`promote` přijme jen návrh `REVIEW_REQUIRED`, `legal_verified_at` nesmí být v
budoucnu. Teprve tím dostanou pravidla `PRIMARY_VERIFIED`, `verified_at` a
`review_window`. `prepare` zapíše kandidátní dataset do `staging/candidates/`.
Do `canonical.json` ho přenese člověk samostatným publikačním PR, který projde
`lint:driving-bans`, `typecheck`, `test`, `build` a `driving-bans:audit`.
Štítek posuzovatele není důkaz identity; tím je schválení PR na GitHubu.

## Čtvrteční kontrola a naplánované úlohy

- `.github/workflows/driving-bans-thursday.yml` má nový krok „AI research of official
  sources (drafts only)“. Plán se nemění a nový workflow nevzniká. Krok běží jen
  při proměnné repozitáře `DAJC_DRIVING_BANS_RESEARCH_ENABLED=true`, klíče bere ze
  secrets `DAJC_RESEARCH_*` a výsledky ukládá do artefaktu běhu. Úplný běh je jen
  ve čtvrtek (`assertSweepRequest`); ruční spuštění používá `--initial-repair`.
- Report odděluje technický stav, získávání zdrojů, AI analýzu, nezávislou
  kontrolu, právní ověření (`NOT_PERFORMED_BY_AI`) a úplnost registru a nikdy
  netvrdí úplnou kontrolu všech 50 jurisdikcí.
- Mimořádné změny: `run --mode urgent --jurisdictions XX --url https://…` zpracuje
  konkrétní oficiální oznámení stejnou kontrolní vrstvou.

### Připravené změny externích rutin (NEAPLIKOVÁNO)

Rutiny „DAJC HGV Driving Bans Thursday sweep“ (čtvrtek 06:47 Praha) a „DAJC HGV
Driving Bans daily immediate verification“ běží mimo GitHub nad `main` a dnes
v kroku 5 přímo upravují `canonical.json`. Nejsou změněné: běží nad `main`, kde
tyto moduly zatím nejsou, a úprava před sloučením by je rozbila. Po sloučení
Driving Bans 2.0 a této změny do `main` je má upravit vlastník:

1. Krok 5 („Edit canonical.json…“) nahradit:
   „Spusť `npm run driving-bans:research -- status`. Pokud je `enabled: true`,
   spusť `npm run driving-bans:research -- run --mode full` (denní rutina:
   `--mode urgent --jurisdictions XX --url URL` pro konkrétní oficiální oznámení).
   Pro vlastní nálezy připrav `submission.json` podle
   `docs/DRIVING_BANS_EVIDENCE_IMPORT.md` s `legal_verified_at: null` a importuj
   ho (`driving-bans:evidence -- import` a `validate`). `canonical.json` neměň.
   `promote`, `approve` ani `prepare` nikdy nevolej: AI nesmí sama potvrdit právní
   ověření.“
2. Krok 7 nahradit: „Commitni jen `data/driving-bans/staging/` (bez `blobs/` a
   `research/blobs/`) do `claude/driving-bans-sweep-YYYY-MM-DD` a otevři draft PR
   s tabulkou návrhů (stav, operace, URL a SHA-256 dokumentů, nálezy kontrol).“
3. Report doplnit o šest oddělených stavů z reportu běhu.

To mění i návrh v `DRIVING_BANS_THURSDAY_ROUTINE_PROPOSAL.md`: podle něj by
rutina sama vyplňovala `legal_verified_at`; podle pravidla „AI nesmí sama
povýšit podklad na dokončené právní ověření“ ho vyplní až člověk při `promote`.

Jednorázová úloha „DAJC: doplnit svátky a zákazy jízdy na rok 2027“ (15. 12. 2026)
popisuje vyřazené soubory (`config/driving-ban-calendars/index.mjs`,
`public-holidays.mjs`, `validYear`). Před spuštěním ji vlastník musí přepsat na
`canonical.json` a kontrolní vrstvu, jinak bude pracovat se starou strukturou.

## Zbývající omezení

- Živě ověřeno 29.–30. 10. 2026 (`docs/DRIVING_BANS_RESEARCH_BENCHMARK.md`, oddíl 6):
  OpenAI, Gemini a xAI; Anthropic a Mistral jen jako zablokované účty. Perplexity
  a Anthropic s klíčem Weekly zatím v tomto modulu živě volány nebyly.
- Opakované sezónní pravidlo (např. letní soboty 1. 7.–31. 8.) nejde ve schématu
  extrakce vyjádřit jednoznačně: modely ho kódovaly jako celoroční týdenní pravidlo
  nebo jako data bez dat. Takové návrhy neprojdou kontrolami a řeší je člověk.
- PDF citace nejdou ověřit strojově; takové návrhy zůstávají `INSUFFICIENT_EVIDENCE`
  a vyžadují ruční kontrolu nebo HTML verzi předpisu.
- Import (PR 82) přijímá textové dokumenty jen v UTF-8; stránka v jiné znakové sadě
  projde výzkumem, ale `promote` ji odmítne.
- Hledání (Perplexity) vrací jen kandidáty; úplnost pokrytí jurisdikce určuje
  dál jen `jurisdiction_reviews` v `canonical.json`, nikdy výzkum.
- Registr je ověřen do 31. 12. 2026 (PR 80). Od 1. 12. 2026 se zveřejňuje
  prosinec–leden a bez nové právní kontroly ledna klesne úplné pokrytí na 0 z 50.

## Testy (povinné scénáře)

| # | Scénář | Test |
| --- | --- | --- |
| 1 | nalezení oficiálního dokumentu | `research-pipeline` 1/6, „searches official domains only“ |
| 2 | neplatný nebo nedostupný zdroj | `research-pipeline` 2/7, `research-components` safe retrieval |
| 3 | extrakce hmotnosti | `research-components` 3 |
| 4 | rozpor dvou modelů | `research-pipeline` 4 |
| 5 | chybný výklad výjimky | `research-pipeline` 5 |
| 6 | nové pravidlo | `research-pipeline` 1/6 |
| 7 | jen metadata | `research-pipeline` 2/7 a 7 (`METADATA_ONLY`) |
| 8 | prokazatelné zrušení | `research-pipeline` 8 a částečné zrušení |
| 9 | nedostatek důkazů | `research-pipeline` 9 |
| 10 | neúplné AT/DE | `driving-bans-query` 10 |
| 11 | datum mimo období | `driving-bans-query` 11 |
| 12 | říjen → listopad → prosinec 2026 | `driving-bans-query` 12 |
| 13 | trasa přes více jurisdikcí | `driving-bans-query` 13 |
| 14 | vozidlo, na které zákaz platí | `driving-bans-query` 14 |
| 15 | nejednoznačné vozidlo | `driving-bans-query` 15 |
| 16 | výpadek poskytovatele | `research-components` 16, `research-pipeline` 16 |
| 17 | vyčerpání rozpočtu | `research-components` 17, `research-pipeline` 17 |
| 18 | duplicita a opakovaný běh | `research-pipeline` 18 |
| 19 | izolace tenantů | `driving-bans-query` 19 |
| 20 | PR #78 a JSON/ICS | sloučení s PR #78 bez konfliktu + všechny jeho testy; `coverage-api.test.ts`, `production.test.ts` |
| 21 | manipulace instrukcemi | `research-components` 21, `research-pipeline` 21 |
| 22 | žádný zápis do canonical.json | `research-pipeline` 22, lint |

`npm run driving-bans:research:demo` projde celý tok synteticky (bez sítě a klíčů)
a ověří, že se `canonical.json` nezměnil.
