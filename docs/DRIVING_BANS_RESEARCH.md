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

- Jeden orchestrátor (`src/lib/ai/orchestrator.mjs`) pro všechny třídy úloh politiky modelů
  (`TASK_CLASSES`), mapované na existující úlohy:

  | Třída | Úloha orchestrátoru |
  | --- | --- |
  | `DISCOVERY` | `discover` |
  | `EXTRACT_STANDARD` | `extract` |
  | `EXTRACT_COMPLEX` | `extract` se silnější trasou (`_EXTRACT_COMPLEX`) |
  | `INDEPENDENT_VERIFICATION` | `verify` u jiného dodavatele |
  | `CHANGE_ANALYSIS` | bez vlastní AI úlohy: rozhoduje deterministický engine (`checkRules`, `detectChanges`, `sourceConflicts`), AI jen jako nezávislá kontrola |
  | `EXPLAIN_VERIFIED_DATA` | `explain` (vysvětlení ověřených odpovědí pro DAJC AI a Intelligence) |

  Auditní záznam každého volání nese `task_class`, `complex_reasons` a `language`.
- Pořadí podle úlohy: `DAJC_RESEARCH_ROUTE_DISCOVER`, `_EXTRACT`, `_EXTRACT_COMPLEX`, `_VERIFY`, `_EXPLAIN`
  (id oddělená čárkou). Výchozí: hledání `perplexity`; extrakce
  `anthropic, openai, gemini, mistral, xai`; kontrola `openai, gemini, mistral, xai, anthropic`;
  vysvětlení `openai, gemini, xai, anthropic, mistral`. Profil `bakeoff-2026-10-25` je přepíše
  podle schválené politiky (`config/ai-research-models.json`, `policy`).
- Silnější trasa (`complex_reasons`): PDF, dlouhý vstup (`DAJC_RESEARCH_COMPLEX_INPUT_TOKENS`),
  eskalace po neúspěšné extrakci a **jazyk dokumentu**. Jazyk určí `identifyLanguage`
  (deklarovaný `html lang`/`Content-Language`, jinak funkční slova a typická písmena textu);
  návrh ho ukládá v `document.language` a `document.language_source`. Dokument v jazyce bez
  živě otestované extrakce, nebo v neurčeném jazyce, jde na silnější trasu (`UNTESTED_LANGUAGE`).
  Otestované jazyky: `DAJC_RESEARCH_TESTED_LANGUAGES`, z politiky `cs,de` (živé běhy AI Lab:
  cz-sun a Tyrolsko B 179). Bez nastavení se kritérium neuplatní; smoke testy jazyk neuvádějí.
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
- Výzkum posílá poskytovatelům jen veřejné právní dokumenty (`dataClass: public-legal`),
  vysvětlení jen ověřená data registru (`verified-registry`). Data zákazníků (vozidla, trasy,
  organizace, tenanti) orchestrátor odmítne u každé úlohy (`TASK_DATA_CLASSES`).

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

Platnost a právní účinnost jsou oddělené (`draftRuleOf`, `legalEffectOf`):

- `valid_from`/`valid_to` navrženého pravidla jsou zveřejněné ověřené období (konvence registru,
  `validity_note`), omezené na posuzované období. Účinnost před ním nebo trvalá platnost se do
  nich nepřenáší.
- Účinnost, kterou dokument uvádí (začátek, konec nebo „bez konce“), dostane podání v
  `legal_effective` a návrh v `legal_effect`; pravidlo ji popíše v `validity_note`.
- Liší-li se účinnost mezi pravidly, `legal_effective` zůstane `null` a návrh nese
  `LEGAL_EFFECT_PER_RULE`: účinnost potvrdí posuzovatel u každého pravidla.

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
  --legal-verified-at 2026-11-05T09:30:00Z --review-from 2026-11-01 --review-to 2026-12-31 \
  --legal-effective-from 2010-01-01 [--legal-effective-to 2027-06-30] --exceptions-complete
npm run driving-bans:research -- reject rdraft-… --reviewer "Jméno" --reason "…"
# dál existující příkazy:
npm run driving-bans:evidence -- approve prop-… --reviewer "…" --reason "…"
npm run driving-bans:evidence -- prepare prop-…
```

`promote` přijme jen návrh `REVIEW_REQUIRED`, `legal_verified_at` nesmí být v
budoucnu. Posuzovatel musí navíc potvrdit to, co AI potvrdit nesmí (`review_checklist` návrhu):

- právní účinnost přečtenou v primárním textu (`--legal-effective-from`/`-to`, do podání jako
  `legal_effective`), odděleně od zveřejněného období;
- úplnost výjimek a jejich podmínek (`--exceptions-complete`).

Návrh, jehož pravidlo má platnost mimo posuzované období, mísí účinnost se zveřejněným obdobím
a `promote` ho odmítne. Je nutné ho opravit nebo dokument prozkoumat znovu.
Teprve tím dostanou pravidla `PRIMARY_VERIFIED`, `verified_at` a `review_window`. `prepare` zapíše kandidátní dataset do `staging/candidates/`.
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

### Fernpass (Tyrolsko, B 179) – návrh `rdraft-93abe3cdae4da399`

- Návrh vznikl v živém E2E AI Lab (běh 40996822080, artefakt AI Lab, ne úložiště dajc-eu) a zůstává
  `REVIEW_REQUIRED`, čeká na člověka. Nic nebylo povýšeno, schváleno ani zapsáno.
- Vznikl kódem před oddělením účinnosti: pravidlo má `valid_from 2010-01-01` (účinnost nařízení),
  `valid_to 2026-11-30` (konec posuzovaného období) a podání `legal_effective: null`.
- `promote` ho v této podobě odmítne. Před povýšením je potřeba:
  - návrh vytvořit znovu tímto kódem: pravidlo dostane zveřejněné období, `validity_note`
    a `legal_effective {from: 2010-01-01, to: null}`. Nový návrh má nové ID a starý se zamítne
    (`reject`);
  - v primárním textu (RIS) ověřit datum účinnosti a úplnost výjimek (cíl/zdroj, místní doprava
    a další podmínky) a potvrdit je při `promote`.
- Nový placený běh k tomu bez nového schválení vlastníka nespouštím.

### Vysvětlení pro DAJC AI a Intelligence (`src/lib/intelligence/driving-bans-ai-explain.ts`)

- `explainVerifiedAnswer` vysvětlí ověřenou odpověď dotazové služby (`answerDrivingBansQuery`)
  přes stejný orchestrátor a politiku (třída `EXPLAIN_VERIFIED_DATA`).
- Modely: GPT-6 Luna, při nejistotě nebo složitosti GPT-6 Sol, jen když to dovolí přístupová
  politika volajícího (`allowStrongerModel`) a rozpočet.
- Přístup se ověřuje na serveru při každém volání (feature `ai-assistant`, vlastní organizace).
- K modelu jdou jen data registru: u vozidla jen stav vyhodnocení, nikdy organizace, uživatel,
  hodnoty vozidla ani trasa.
- Deterministický stav, výsledky, zdroje a upozornění zůstávají beze změny. Vysvětlení, které
  cituje neznámé pravidlo nebo zdroj, nebo tvrdí oprávnění k jízdě, výjimku či povolení, se zahodí.
- Vlastní klíče, rozpočet a modul ledgeru (`DAJC_AI_*`, `dajc-ai-explain`), oddělené od výzkumu.
- Není připojeno na žádnou cestu ani vydáno (`DRIVING_BANS_INTELLIGENCE_RELEASED = false`).
  Bezplatné Ask DAJC AI (PR #78) ho nepoužívá a nezíská z něj placený přístup.

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

### Scénáře integrace modelů z AI Lab (zadání 30. 10. 2026)

Všechny testy jsou offline se skriptovanými poskytovateli (syntetické), nejde o živé API testy.
Živé důkazy jsou jen čtyři běhy AI Lab v `data/ai-benchmark/live-checks-2026-10.json`.

| # | Scénář | Test |
| --- | --- | --- |
| 1 | Gemini pro jednoduchý dokument | `research-model-profile` „drives the orchestrator“ (běžný a německý dokument → Flash-Lite) |
| 2 | GPT-6 Sol pro složitý dokument | totéž (PDF, francouzský a neurčený jazyk → Sol, `UNTESTED_LANGUAGE`) |
| 3 | 7,5 t vs. 7,5 kg | `research-components` „rejects a mass in the wrong unit“, `research-pipeline` druhé čtení |
| 4 | silnější model po selhání validace | `research-pipeline` „reads a document again on the stronger route“ |
| 5 | kontrola jiným poskytovatelem | `research-components` „routes by task…“, `research-pipeline` 16 |
| 6 | neověřené citace | `research-components` „requires verbatim quotes…“ |
| 7 | neexistující model ID | `research-provider-errors` „blocks … an unknown model“, `research-live` failover |
| 8 | nedostupný poskytovatel | `research-components` 16, `research-provider-errors` timeouty |
| 9 | rate limit | `research-provider-errors` „paces a token-rate 429“, „stops a provider whose rate limit persists“ |
| 10 | vyčerpání rozpočtu | `research-components` 17, `research-pipeline` 17, `driving-bans-ai-explain` 10 |
| 11 | duplicitní dokument | `research-pipeline` 18 |
| 12 | změna právního pravidla | `research-pipeline` 1/6, 4, 8; `legal-changes.test.ts` |
| 13 | jen metadata | `research-pipeline` 7, `legal-changes` „never treats … metadata as a change of law“ |
| 14 | neúplná jurisdikce | `driving-bans-query` 10, `driving-bans-intelligence` „answers incompletely verified AT and DE“ |
| 15 | chybějící parametr vozidla | `driving-bans-intelligence` „stays UNDETERMINED when data is missing“, `driving-bans-query` 15 |
| 16 | datum mimo zveřejněné období | `driving-bans-query` 11; oddělení účinnosti: `research-components` 16 (Fernpass), `research-pipeline` 22 |
| 17 | izolace tenantů | `driving-bans-query` 19, `driving-bans-ai-explain` 17/23 |
| 18 | kompatibilita s Ask DAJC AI | `driving-bans-ai-explain` 18, `driving-bans-query` „shares the evaluation with free Ask“, sloučení s PR #78 |
| 19 | veřejné JSON/ICS API | `coverage-api.test.ts`, `driving-bans-feed.test.ts`, `production.test.ts` |
| 20 | neměnnost canonical.json | `research-pipeline` 22, `research-live` (`canonical_unchanged`), `lint:driving-bans` |
| 21 | prompt injection | `research-components` 21, `research-pipeline` 21 |
| 22 | změna profilu z AI Lab | `research-ai-lab` „turns new AI Lab evidence into a proposal only“ |
| 23 | zákaz aktivace nevydaných funkcí | `driving-bans-intelligence` „keeps every paid feature off by default“, `driving-bans-ai-explain` 17/23 |
| 24 | nerelevantní benchmark | `research-ai-lab` „never uses a model for extraction because of a high score in an unrelated test“ |

`npm run driving-bans:research:demo` projde celý tok synteticky (bez sítě a klíčů)
a ověří, že se `canonical.json` nezměnil.
