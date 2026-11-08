# DAJC AI — databáze Neon PostgreSQL (místo Supabase)

Stav k 2026-11-08. Supabase zůstává beze změny (projekty ani data se nemazaly).

## 1. Skutečný stav

| Položka | Stav (ověřeno přes Neon MCP v této relaci) |
|---|---|
| Přístup | Konektor Neon připojený do relace Claude Code. Neon API ze sandboxu dosažitelné; **přímé TCP spojení na port 5432 sandbox nepouští** — veškerá práce s DB šla přes Neon MCP (SQL běží na straně Neonu), žádný připojovací řetězec ani heslo neprošly sandboxem. |
| Organizace | „Miroslav“ (`org-winter-glitter-59519495`), tarif **Free**, bez platební karty |
| Projekt | **`dajc-ai`** (`lively-shadow-23612355`), region **`aws-eu-central-1` (Frankfurt)**, PostgreSQL **17.11**, UTF8 / `C.UTF-8` |
| Větev `production` (výchozí) | prázdná, žádné migrace — vyhrazená pro budoucí produkci |
| Větev `dev` | migrace `drizzle-ask` 0000+0001 a `drizzle-kb` 0000, evidence migrací drizzle (stejné SHA-256 jako soubory) |
| Větev `dev-security-tests` | testovací data bezpečnostních testů (1 otisk, počítadla, rozpočet, metrika) |
| Větev `dev-kb-tests` | vzorek knihovny: 3 ustanovení nařízení 561/2006 (CS) pro ověření vyhledávání |
| Data API | není zapnuté (404) — schémata nejsou vystavená přes HTTP |
| Free tarif | 100 projektů, 10 větví/projekt, 100 CU-h/projekt/měsíc, 1 GB/projekt (20 GB účet), uspání po 5 min nečinnosti (nelze vypnout), bez karty |

Testovací větve lze smazat, až nebudou potřeba (rozhodnutí vlastníka; Claude je nemaže).

## 2. Kompatibilita (ověřeno na Neonu a na lokálním klonu Neonu)

| Vlastnost | Výsledek |
|---|---|
| Vlastník DB (`dajc_owner`) | **není superuživatel**, ale má `CREATEROLE`, `CREATEDB`, **`BYPASSRLS`** (člen `neon_superuser`) → aplikace **nesmí** používat vlastníka |
| Role vytvořená migrací (`dajc_ask_app`) | bez superuživatele, bez `BYPASSRLS`, mimo `neon_superuser`, člen žádné role; heslo nastaví vlastník mimo repozitář (Neon vyžaduje ≥ 60 bitů entropie) |
| RLS | zapnuté na všech 8 tabulkách `dajc_ask`; aplikační role nečte metriky |
| Drizzle ORM + postgres-js | `prepare: false` (už v kódu) — kompatibilní s PgBouncerem Neonu v režimu `transaction` |
| Transakce, `pg_advisory_xact_lock` | fungují (zámek je transakční, ne relační — přesně to pooler podporuje) |
| `gen_random_uuid`, `unaccent`, generovaný `tsvector`, `regconfig` | fungují na PG 17.11 |
| Čeština/slovenština/polština ve fulltextu | správně (`ridic`, `prestavku` …) díky `C.UTF-8` + `unaccent`; PostgreSQL pro ně nemá stemmer → knihovna hledá kmeny předponou |

Lokální klon Neonu (PG 16, `UTF8`/`C.UTF-8`, vlastník bez superuživatele s `CREATEROLE`/`BYPASSRLS`, **PgBouncer 1.22 `pool_mode=transaction`**): migrace jako vlastník, testy jako `dajc_ask_app` přes pooler.

## 3. Výsledky testů databáze

**Na Neonu (`dev-security-tests`, PG 17.11, jako `dajc_ask_app`):**
- denní limit: 1 → 2 → 3, čtvrtý dotaz zamítnut, další den znovu 1;
- rezervace rozpočtu nad denní strop zamítnuta; zápis metriky povolen; `pg_advisory_xact_lock` funguje;
- zamítnuto oprávněním: čtení metrik, `DISABLE ROW LEVEL SECURITY` („must be owner“), `TRUNCATE budget`, `CREATE TABLE` v `dajc_ask` i `public`, čtení evidence migrací, `DELETE review_queue`;
- `dajc_ask_app` není členem žádné role a nemůže se přepnout na vlastníka ani `neon_superuser` (`pg_has_role … SET` = false).
  Poznámka: test přes MCP běží jako vlastník s `SET ROLE`; PostgreSQL u `SET ROLE` ověřuje přihlášeného uživatele, proto byl únik do role vlastníka ověřen přes `pg_has_role` a v lokálním klonu se skutečným přihlášením aplikační rolí.

**Na lokálním klonu Neonu přes PgBouncer (transakční režim), přihlášení `dajc_ask_app`:**
- `src/lib/ask/__tests__/db-security.test.ts` 15/15 (včetně 20 paralelních dotazů → přesně 3 povoleny; 12 paralelních rezervací → nikdy přes strop);
- celá sada Ask s databází 247/247, knihovna 58/58 (včetně práv rolí `dajc_kb_importer` a `dajc_ask_app`).

**Na Neonu (`dev-kb-tests`, jako `dajc_ask_app`):** přesný dotaz knihovny „přestávka řízení“ → *Nařízení (ES) č. 561/2006 · Článek 7 · s. 7* na prvním místě; aplikace čte jen pohled `answerable_provisions`, ne tabulky.

**Zbývající riziko (pro rozhodnutí vlastníka):** aplikační role smí měnit vlastní počítadla a rozpočet (potřebuje to pro vrácení dotazu po chybě). Kdo by získal její heslo, mohl by limity v DB přepsat. Zpevnění: funkce `SECURITY DEFINER` pro `consume/refund/reserve/settle` a odebrání přímého `UPDATE`; navrženo po sloučení #102 (jeho migrace 0002/0003 by jinak kolidovaly v číslování).

## 4. Postup připojení a nasazení (bez hesel v konverzaci)

Všechny řetězce a hesla zůstávají jen v Neon Console a ve Vercelu; do repozitáře, GitHubu ani konverzace nepatří.

1. **Neon Console → projekt `dajc-ai` → Connect.** Pro aplikaci zvolit větev, databázi `dajc` a zapnout **Connection pooling** (host s `-pooler`, `sslmode=require`); pro migrace pooling vypnout (přímé spojení).
2. **Hesla rolí** (SQL Editor v Neon Console, jako `dajc_owner`), vygenerovat ≥ 24 náhodných znaků:
   `ALTER ROLE dajc_ask_app WITH LOGIN PASSWORD '<heslo>';` a pro import `ALTER ROLE dajc_kb_importer WITH LOGIN PASSWORD '<heslo>';`
3. **Migrace na produkční větev** (až po schválení): z počítače s přístupem k Neonu
   `DAJC_ASK_MIGRATION_DB_URL=<přímé spojení vlastníka> npx drizzle-kit migrate --config drizzle.ask.config.ts`, potom
   `DAJC_KB_MIGRATION_DB_URL=<totéž> npx drizzle-kit migrate --config drizzle.kb.config.ts` (pořadí je důležité).
   Ověření: `DAJC_ASK_TEST_DB_URL=<pooled dajc_ask_app> npx vitest run src/lib/ask` — **jen na `dev`/testovací větvi**, testy zapisují data.
4. **Vercel → Environment Variables → Production**: `DAJC_ASK_DB_URL` = pooled řetězec role `dajc_ask_app`. Na Preview použít větev `dev` (jiný řetězec).
5. Data API v Neonu nezapínat; `dajc_ask` ani `dajc_kb` nesmí být vystavené.
6. **Plný import knihovny na větev `dev`** (sandbox Claude Code nepouští TCP k Neonu):
   - v Neon SQL editoru na větvi `dev`: `ALTER ROLE dajc_kb_importer WITH LOGIN PASSWORD '<heslo>';`
   - GitHub → Settings → Secrets and variables → Actions → nové tajemství
     `DAJC_KB_DEV_IMPORT_DB_URL` = řetězec větve `dev` s uživatelem `dajc_kb_importer` (ne vlastník, ne produkce);
   - přidat štítek **`kb-import-dev`** k PR #111 → workflow `.github/workflows/kb-import-dev.yml` naimportuje
     manifest (AUTO_CHECKED, bez AI, zdarma) a uloží originály PDF jako artefakt na 14 dní.

## 5. Plán produkčního prostředí

| Krok | Free (interní test) | Produkce (doporučení) |
|---|---|---|
| Tarif | Free: 100 CU-h/měsíc a uspávání nelze vypnout; při vyčerpání se compute zastaví do konce měsíce → v rozporu s „zdarma každý den“ | **Launch** (bez měsíčního minima): $0.106/CU-h, $0.35/GB-měsíc, instant restore $0.20/GB-měsíc, chráněné větve |
| Větve | `dev` pro vývoj, testovací větve krátkodobě | `production` s ochranou, `dev` pro Preview |
| Zálohy | historie 6 h | historie až 7 dní (Launch) |
| Kapacita | 0.25 CU stačí | 0.25–0.5 CU s autoscalingem; uspávání ponechat (studený start ~stovky ms) |

Odhad provozu DB je v `docs/DAJC_AI_LEGAL_LIBRARY.md` § 7.
