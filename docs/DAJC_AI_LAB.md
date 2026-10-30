# DAJC AI Lab – Multi-Model Research & Testing

Soukromé výzkumné a testovací prostředí AI pro DAJC.eu. Není to samostatný produkt: slouží
Driving Bans, DAJC Intelligence, DAJC AI, DAJC Platform a DAJC Assistance a předává jim jen
ověřené výsledky, doporučené modelové konfigurace a metadata.

## Repozitář

| | |
| --- | --- |
| Současný název | `vratadajcm-png/dajc-ai-bakeoff` (soukromý) |
| Plánovaný název | `vratadajcm-png/dajc-ai-lab` |
| Stav přejmenování | **čeká na vlastníka** (viz níže). Nástroje této integrace repozitář přejmenovat neumí a kopie se jako náhrada nevytváří. |
| README | aktualizované commitem `11e30da` (DAJC AI Lab a vztah k DAJC.eu) |

Odkazy v dajc-eu míří na současný název, protože jen ten je dnes funkční. Po přejmenování
GitHub staré adresy přesměruje, ale konfigurace se upraví podle seznamu níže.

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
    node scripts/ai-lab-live-evidence.mjs --repository vratadajcm-png/dajc-ai-bakeoff \
      --run <RUN_ID>=<rozbalený artefakt>@<commit dajc-eu> [--run …] \
      --out data/ai-benchmark/live-checks-2026-10.json
    ```
  - Výsledek se do dajc-eu dostane jen pull requestem.
  - Převod ponechá jen metadata: poskytovatele, modely, výsledky, třídy chyb, tokeny, náklady, latence, kódy nálezů a stavy návrhů.
  - Prompty, text dokumentů, citace, extrahovaná pravidla ani zprávy poskytovatelů se nepřevádějí.
  - Cokoli, co vypadá jako klíč, import zastaví.

## Modelový katalog

- Jedna vrstva poskytovatelů a jeden orchestrátor (`src/lib/ai/`). Katalog obsahuje 6 poskytovatelů: OpenAI, Anthropic, Google Gemini, xAI Grok, Mistral AI a Perplexity AI.
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
- Placené běhy jen ručně, se stropem 1,50 USD na běh a nejvýše 60 požadavky. Žádný plán ani pravidelný placený běh.

## Přejmenování: krok vlastníka

1. GitHub → `vratadajcm-png/dajc-ai-bakeoff` → **Settings → General → Repository name**, napište `dajc-ai-lab` a zvolte **Rename**.
2. Viditelnost zůstane soukromá. Historie, větve, PR, Actions, artefakty i Secrets se přejmenováním nemění.

Po přejmenování (může udělat Claude):

| Kde | Změna |
| --- | --- |
| `config/ai-research-models.json` | `ai_lab.repository` na `vratadajcm-png/dajc-ai-lab`, `rename_status` na datum |
| `docs/DAJC_AI_LAB.md`, `docs/DRIVING_BANS_RESEARCH_BENCHMARK.md` | odkazy na repozitář a běhy živých testů |
| popis PR #88 a PR #1 v AI Lab | odkazy |
| lokální klony | `git remote set-url origin https://github.com/vratadajcm-png/dajc-ai-lab` |
| sezení Claude Code | připojit repozitář pod novým názvem |

Historické názvy zůstávají, protože označují skutečné původní testy:
- `data/ai-benchmark/bakeoff-2026-10-25.json`, profil `bakeoff-2026-10-25` a `source.repository` v souboru živých důkazů;
- názvy workflow `DAJC AI bake-off` a `DAJC recover missing answers` a artefakty `bakeoff-*`;
- skupina souběhu `dajc-ai-bakeoff` ve workflow AI Lab. Je to zámek sdílený třemi workflow; změna jen v jednom by dovolila souběh placených běhů.

Workflow `DAJC-eu research live check` na název AI Lab neodkazuje (stahuje dajc-eu) a po přejmenování funguje beze změny.
