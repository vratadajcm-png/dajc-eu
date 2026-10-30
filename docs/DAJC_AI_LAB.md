# DAJC AI Lab – Multi-Model Research & Testing

Soukromé výzkumné a testovací prostředí AI pro DAJC.eu. Není to samostatný produkt: slouží
Driving Bans, DAJC Intelligence, DAJC AI, DAJC Platform a DAJC Assistance a předává jim jen
ověřené výsledky, doporučené modelové konfigurace a metadata.

## Repozitář

| | |
| --- | --- |
| Název | `vratadajcm-png/dajc-ai-lab` (soukromý), https://github.com/vratadajcm-png/dajc-ai-lab |
| Dřívější název | `vratadajcm-png/dajc-ai-bakeoff`, přejmenováno vlastníkem 30. 10. 2026 (stejné ID repozitáře 1433088106) |
| Zachováno | historie, větve, PR #1, tři workflow, artefakty běhů, Secrets (ověřeno bezplatným během plánu) |
| README | aktualizované commitem `11e30da` (DAJC AI Lab a vztah k DAJC.eu) |

Konfigurace a odkazy v dajc-eu používají nový název. GitHub staré adresy přesměrovává,
ale nic v dajc-eu na přesměrování nespoléhá.

## Rozdělení odpovědností

| DAJC AI Lab | DAJC.eu |
| --- | --- |
| benchmarky OpenAI, Anthropic, Google, xAI, Mistral a testy Perplexity Search | autoritativní registr Driving Bans (`data/driving-bans/canonical.json`) |
| porovnání kvality, přesnosti, ceny a latence; ověření nových modelů | DAJC Intelligence, DAJC AI a Ask DAJC AI |
| testy extrakce právních dokumentů a nezávislých kontrol | kontrolní a schvalovací proces (PR #82) |
| omezené živé integrační testy (workflow `DAJC-eu research live check`) | veřejná rozhraní JSON/ICS a budoucí zákaznické funkce |

AI Lab nikdy nezapisuje do `canonical.json`, neschvaluje právní změny, neaktivuje
zákaznické funkce a nesdílí klíče. Totéž hlídá `config/ai-research-models.json` (`ai_lab.never`).

## Prostředí a klíče

| Prostředí | Klíče (jen názvy) | Účel |
| --- | --- | --- |
| AI Lab | `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `XAI_API_KEY`, `MISTRAL_API_KEY` | experimenty, benchmarky, živé testy |
| dajc-eu | `DAJC_RESEARCH_*` (zatím nenastavené) a klíče Weekly `ANTHROPIC_API_KEY`, `PERPLEXITY_API_KEY` | interní výzkumná integrace, Weekly |
| DAJC AI / Intelligence (vysvětlení) | `DAJC_AI_*` (zatím nenastavené: klíče, `DAJC_AI_RUN_BUDGET_USD`, `DAJC_AI_MONTHLY_BUDGET_USD`, `DAJC_AI_MODEL_PROFILE`) | vlastní rozpočet a ledger `dajc-ai-explain`; bez nich se nic neodešle |
| produkce | samostatné, zatím nezřízené | řízené prostředí s vlastním schválením |

- Hodnoty klíčů se nikdy nekopírují mezi repozitáři, do souborů, artefaktů ani logů.
- Stav účtů podle posledních živých testů AI Lab (pro klíče AI Lab, ne pro jiná prostředí) vrací `providerApiStatus()`:
  - OpenAI, Gemini, xAI: OK;
  - Anthropic: `CREDIT_OR_BILLING`;
  - Mistral: `RATE_LIMIT_PERSISTENT`;
  - Perplexity: v AI Lab netestováno, AI Lab nemá klíč.
- Každý produkt DAJC dostane v AI Lab vlastní workflow, vlastní rozpočet a vlastní data.
- Data zákazníků do AI Lab nepatří.

## Přístup mezi repozitáři (nejnižší oprávnění)

- **AI Lab → dajc-eu:** workflow AI Lab stahuje veřejný kód dajc-eu na připnutém commitu (`DAJC_EU_REF`) bez dalšího tokenu. Pozdější push do dajc-eu nezmění, co běží s klíči AI Lab.
- **dajc-eu → AI Lab:** žádný automatický přístup a žádný token mezi repozitáři.
  - Oprávněná osoba stáhne artefakt běhu a spustí převod:
    ```bash
    node scripts/ai-lab-live-evidence.mjs --repository vratadajcm-png/dajc-ai-lab \
      --run <RUN_ID>=<rozbalený artefakt>@<commit dajc-eu> [--run …] \
      --out data/ai-benchmark/live-checks-2026-10.json
    ```
  - Výsledek se do dajc-eu dostane jen pull requestem.
  - Převod ponechá jen metadata: poskytovatele, modely, výsledky, třídy chyb, tokeny, náklady, latence, kódy nálezů a stavy návrhů.
  - Prompty, text dokumentů, citace, extrahovaná pravidla ani zprávy poskytovatelů se nepřevádějí.
  - Cokoli, co vypadá jako klíč, import zastaví.

## Modelový katalog a schválená politika

- Jedna vrstva poskytovatelů a jeden orchestrátor (`src/lib/ai/`) pro Driving Bans Research, DAJC AI a Intelligence. Katalog obsahuje 6 poskytovatelů: OpenAI, Anthropic, Google Gemini, xAI Grok, Mistral AI a Perplexity AI.
- Politika `dajc-ai-2026-10-30` (`config/ai-research-models.json`, `policy`), schválená vlastníkem zadáním z 30. 10. 2026:

  | Úloha (třída) | Primární | Záloha / eskalace |
  | --- | --- | --- |
  | Discovery (`DISCOVERY`) | Perplexity Search | oficiální zdroje registru, úřední domény, leady |
  | Běžná extrakce (`EXTRACT_STANDARD`) | Gemini 3.5 Flash-Lite | GPT-6 Sol; druhé čtení Grok 4.7 |
  | Složitá extrakce (`EXTRACT_COMPLEX`) | GPT-6 Sol | Flash-Lite, Grok 4.7 |
  | Nezávislá kontrola (`INDEPENDENT_VERIFICATION`) | první způsobilý z Flash-Lite, Grok 4.7, GPT-6 Luna u jiného dodavatele než extrakce | další z nich |
  | Konflikty (`CHANGE_ANALYSIS`) | deterministický engine | nezávislá kontrola jako doplněk |
  | Vysvětlení (`EXPLAIN_VERIFIED_DATA`) | GPT-6 Luna | GPT-6 Sol při složitosti nebo nejistotě |
  | Odborné články | stávající Claude pipeline Weekly | mimo orchestrátor |

- Úrovně důkazů pro každý model a úlohu (`evidenceLevel`, `modelCatalog`):
  - `LIVE_EXTRACTION_VERIFIED`: model v této roli v živém běhu AI Lab, jehož návrh prošel všemi kontrolami;
  - `BENCHMARK_DIRECT`, `BENCHMARK_INDIRECT`: bake-off (zodpovídání nad registrem) je přímý důkaz pro vysvětlení a nepřímý pro extrakci a kontrolu;
  - `API_SMOKE_ONLY`, `NOT_BENCHMARKED`;
  - `UNAVAILABLE`: odmítnutí účtem nebo tarifem, ne kvalita (Anthropic, Mistral).
- Model smí sloužit jen v roli, pro kterou má úroveň z `eligible_levels`. Skóre z nesouvisejícího testu nedává žádnou úroveň ani skóre (`benchmark_relevance`).
- Katalog uvádí ke každému modelu poskytovatele, model ID, skutečně obsloužené ID, úlohy s úrovní důkazu, benchmark, latenci, cenu za milion tokenů, datum posledního ověření, stav API, zdroj a důvod vyřazení.
- Jazyky s živě otestovanou extrakcí: `cs`, `de` (`policy.tested_languages`). Dokument v jiném nebo neurčeném jazyce jde na silnější trasu.
- Výběr podle profilu `bakeoff-2026-10-25` (`config/ai-research-models.json`) zohledňuje:
  - přesnost, spolehlivost API, cenu a latenci;
  - vhodnost pro úlohu;
  - parametry, se kterými bake-off měřil.
- Živé důkazy z AI Lab (`data/ai-benchmark/live-checks-2026-10.json`):
  - `liveEvidenceFor()` je připojí ke každému modelu, `providerApiStatus()` k poskytovateli;
  - `recommendModels()` je vrací spolu s doporučením.
- Chyba API je fakt o účtu nebo požadavku, nikdy kvalita modelu. Modely bez dokončených odpovědí zůstávají `NOT_BENCHMARKED`.
- Schválená strategie Driving Bans zůstává:
  - Gemini Flash-Lite pro běžnou extrakci;
  - GPT-6 Sol pro složité dokumenty a pro druhé čtení po neúspěšné extrakci;
  - nezávislá kontrola jiným dodavatelem;
  - deterministické ověření;
  - lidské schválení.
- Placené běhy jen ručně, se stropem 1,50 USD na běh, 5 USD měsíčně a nejvýše 60 požadavky. Žádný plán ani pravidelný placený běh.

### Aktualizace z AI Lab (nic se neaplikuje samo)

1. Původ a schéma: oprávněná osoba převede stažený artefakt skriptem `ai-lab-live-evidence.mjs`. Zůstanou jen metadata a cokoli, co vypadá jako klíč, import zastaví.
2. Validace výsledků: převod započítá jen dokončené odpovědi. Chyby API zůstanou třídami chyb, ne kvalitou.
3. Návrh: skript vypíše `policy_proposals` (`proposePolicyUpdate`, vždy `applied: false`):
   - `CANDIDATE_FOR_POLICY`: model mimo politiku se silnějším důkazem;
   - `POLICY_MODEL_NOT_ELIGIBLE`: model politiky ztratil způsobilý důkaz.
4. Testy: změna jde do dajc-eu jen pull requestem se všemi kontrolami.
5. Schválení: politiku mění jen vlastníkem schválený PR (`policy.change_control`). Nový výsledek ani dobré skóre samy model neaktivují.

## Přejmenování (30. 10. 2026)

Vlastník repozitář přejmenoval v Settings → General → Repository name. Pak se upravilo:

| Kde | Změna |
| --- | --- |
| `config/ai-research-models.json` | `ai_lab.repository` = `vratadajcm-png/dajc-ai-lab`, `former_repository`, `renamed_on`, zdroj cen |
| `src/lib/ai/model-profile.mjs` | zdroj živých důkazů a klíčů se uvádí pod novým názvem (název v době běhu zůstává v `repository_at_run_time`) |
| `docs/DAJC_AI_LAB.md`, `docs/DRIVING_BANS_RESEARCH_BENCHMARK.md`, komentáře skriptů | odkazy na repozitář a běhy |
| popis PR #88 a PR #1 v AI Lab | odkazy |
| lokální klony | `git remote set-url origin https://github.com/vratadajcm-png/dajc-ai-lab` |

Lokální klon nebo jiné sezení, které repozitář znalo pod starým názvem, si ho připojí pod novým.

Historické názvy zůstávají, protože označují skutečné původní testy:
- `data/ai-benchmark/bakeoff-2026-10-25.json`, profil `bakeoff-2026-10-25` a `source.repository` v souboru živých důkazů;
- názvy workflow `DAJC AI bake-off` a `DAJC recover missing answers` a artefakty `bakeoff-*`;
- skupina souběhu `dajc-ai-bakeoff` ve workflow AI Lab. Je to zámek sdílený třemi workflow; změna jen v jednom by dovolila souběh placených běhů.

Workflow `DAJC-eu research live check` na název AI Lab neodkazuje (stahuje dajc-eu) a po přejmenování funguje beze změny.
