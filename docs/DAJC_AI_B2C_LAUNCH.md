# DAJC AI — veřejné bezplatné spuštění (B2C): stav připravenosti

Stav k 2026-11-08, větev `claude/gracious-brown-n9m8el`. Dokument popisuje jen
to, co bylo skutečně ověřeno; vše ostatní je výslovně označeno jako
neověřené nebo blokující.

**Rozhodnutí: NO-GO pro veřejný provoz.** Kód je připravený ke kontrole a
sloučení (vše zůstává vypnuté), ale chybí databáze, klíče poskytovatelů AI,
e-mail, schválené právní texty a rozhodnutí o rozpočtu. Podrobnosti v
oddílech 4–7.

> **Aktualizace 2026-11-08 (větev `claude/dajc-ai-neon-knowledge-base`):** databáze je nově
> **Neon PostgreSQL** (projekt `dajc-ai`, Frankfurt, větev `dev` s migracemi; produkční větev
> prázdná) — viz `docs/DAJC_AI_NEON.md`. Supabase zůstává beze změny. Přibyla evropská knihovna
> úředních předpisů (`docs/DAJC_AI_LEGAL_LIBRARY.md`). Body níže o Supabase platí pro Supabase;
> pro Neon platí blokující podmínky v tom dokumentu.

## 1. Co je DAJC AI v této verzi

Existující „Zeptejte se DAJC AI“ (Ask, PR #78) jako bezplatný pracovní AI
asistent profesionálních řidičů nákladních vozidel. Žádný druhý asistent,
orchestrátor ani registr zákazů jízd.

| Vlastnost | Stav v kódu |
|---|---|
| Přihlášení e-mailem (jednorázový odkaz, ukládá se jen HMAC otisk) | beze změny z #78 |
| 3 dotazy denně na ověřený e-mail, obnova o půlnoci pražského času | beze změny; test „další den zase zdarma“ |
| Nezávislá kontrola odpovědí (jiný poskytovatel) + deterministická kontrola | beze změny, rozšířeno o pravidlo nepotvrzování |
| Ověřitelné zdroje, „NEDOSTATEK OVĚŘENÝCH DAT“ | beze změny |
| Ochrana klíčů (jen server, oddělené od pipeline článků a research, kontrola bundlu) | beze změny |
| Rozpočtové limity (rezervace nejhoršího případu, denní a měsíční strop) | beze změny; text pozastavení opraven |
| Po vyčerpání limitu: text vlastníka + tlačítko „Dobrovolně podpořit DAJC AI“ → `/support` | **nové** |
| Upozornění pro řidiče (jen při bezpečném zastavení) | **nové**, na stránce i pod každou odpovědí |
| AI nepotvrzuje průjezdnost, oprávnění k nadrozměrné přepravě ani výjimku | **nové**, 4 vrstvy (detektor otázky, guard, prompt, nezávislá kontrola) |
| Odkaz v hlavní navigaci a ve FAQ jen po aktivaci **a** zveřejnění | **nové** (`DAJC_ASK_PUBLIC_ENTRY`) |
| Placené DAJC AI, Intelligence, ABRA, platby | **nejsou součástí**; zůstávají v #101/#102 |

Příspěvek nic neodemyká: API ani databáze žádný příspěvek nečtou, odkaz na
`/support` je obyčejný odkaz bez přesměrování (ověřeno testem i v prohlížeči).

## 2. Integrace PR

| PR | Co obsahuje | Jak je v této větvi |
|---|---|---|
| #98 | #96 + #97 + #78 | sloučen merge commitem `81fafd7` do aktuálního `main` (`7d06803`) |
| #96, #97, #78 | Driving Bans ověřené období, osobní kalendář (vypnuto), Ask | obsaženy přes #98 |
| #90 (v #101) | vstup přes „Ask DAJC · FAQ“ | převzato byte po bytu (`2e12b42`), brána upravena na `public-entry.ts` |
| #100 (v #101) | atomický throttling přihlášení (advisory lock) | převzato byte po bytu (`2e12b42`) |
| #102 | účet, placené DAJC AI, platby, ABRA, učení | **nepřevzato**, kromě bezpečnostní opravy ohraničeného čtení těla požadavku (`730750a`, stejné hunky) |

**Proč #98 hlásil `mergeable: false`.** GitHub hlásí u #98
`mergeable_state: behind`: větev stála na `ea27928` a `main` mezitím dostal
7 commitů (#103, #104, #105, odkaz na X, Founding Customers). Textový konflikt
neexistuje (lokální merge prošel bez konfliktu) a po sloučení prošly všechny
kroky Application CI. Sémantický konflikt nebyl nalezen.

**Navazující PR zůstávají použitelné.** Zkušební sloučení #102 (obsahuje #101)
nad touto větví: konflikty jen ve 4 souborech, vždy typu „zachovat obojí“.
Po vyřešení: typecheck 0 chyb, `npm test` 111 souborů, 1 280 testů prošlo,
26 přeskočeno (Postgres bez DB). Řešení pro budoucí sloučení:

| Soubor | Řešení |
|---|---|
| `src/lib/ask/guide-entry.ts` | ponechat verzi této větve (`isAskPublicEntryEnabled`) |
| `.env.example` | ponechat oba bloky (`DAJC_ASK_PUBLIC_ENTRY` i proměnné #102) |
| `src/pages/intelligence/ask.astro` | importy spojit (`getAccountRuntime` + `limitReachedText`), panel limitu a účet ponechat oba, styly oba |
| `src/lib/ask/client/ask-form.ts` | `limitReached = !paid && signedIn && remaining === 0`; po `renderAnswer(…, extras)` přidat bezpečnostní upozornění; větev 429 s panelem limitu ponechat |

Do `main` je nutné sloučit **merge commitem** (ne squash), aby #101/#102
zůstaly navázané na historii #98.

## 3. Provedené testy

| Krok (Application CI) | Výsledek |
|---|---|
| `npm run lint:geographic-coverage` | OK |
| `npm run lint:driving-bans` | PASS |
| `npm run driving-bans:audit` | OK |
| `npm run typecheck` | 0 chyb, 0 varování |
| `npm test` | 97 souborů, **1 148 prošlo**, 8 přeskočeno (Postgres bez DB) |
| `npm run build` | OK; render funkce má `maxDuration: 60` |
| `node scripts/check-ask-bundle.mjs` | v klientském kódu žádný klíč ani endpoint AI |

**Izolované prostředí (lokální kontejner, bez sítě k AI):**

- PostgreSQL 16, migrace `drizzle-ask` 0000 + 0001 jako admin, role
  `dajc_ask_app` s heslem: Ask testy včetně Postgres **232/232, 0 přeskočeno**
  (kontrakt úložiště, 12 paralelních přihlášení → přesně 3 povolena,
  aplikační role nečte metriky). `anon`/`authenticated` bez přístupu,
  `dajc_ask_app` bez superuser/bypassrls, nevlastní tabulky.
- `astro dev` proti této DB s fiktivními klíči, Chromium (Playwright):
  vyčerpaný limit → panel s přesným textem, tlačítko `/support`, odeslání
  zakázané, žádná navigace mimo stránku; 4. dotaz přes API → 429 i s polem
  `supported: true`; odkaz v navigaci a FAQ jen při `ENABLED` + `PUBLIC_ENTRY`;
  aktivováno bez zveřejnění → stránka 200, žádný odkaz; vypnuto → 404, žádný
  odkaz; bez horizontálního přetečení na 1180 px a iPhone 13.

**Netestováno (nelze bez schválení/přístupů):** skutečné volání OpenAI,
Anthropic, Perplexity; skutečné odeslání e-mailu přes Resend; nasazení s
produkční konfigurací; test hodnoty na 20 skutečných otázkách. Žádný z
výsledků výše není důkazem produkční připravenosti služeb třetích stran.

## 4. Provozní služby — co skutečně chybí (ověřeno 2026-11-08, jen čtení)

| Služba | Zjištěný stav | Co chybí |
|---|---|---|
| **Supabase / PostgreSQL EU** | Organizace „DAJC“ na tarifu **free**. Všechny 4 projekty (`dajc-partner-portal` eu-west-1, `dajc-assistance-dev`, `dajc-staging-e2e`, `HaulBoard` eu-central-1) jsou **INACTIVE**. Podle #102 obnova projektu selhala na „organization has unpaid invoices“ (neověřováno znovu, nic se neměnilo). | aktivní projekt v EU (Frankfurt), migrace 0000+0001, heslo role, kontrola „Exposed schemas“; vyřešit neuhrazené faktury |
| **OpenAI API** | Ve Vercelu žádný `DAJC_ASK_OPENAI_*`. Pipeline článků OpenAI nepoužívá; existenci účtu nelze z tohoto prostředí ověřit. | samostatný projektový klíč s limitem útraty, názvy modelů, ověřené ceny, DPA |
| **Anthropic API** | Ve Vercelu žádný `DAJC_ASK_ANTHROPIC_*` (pipeline článků používá vlastní klíč v GitHub Actions — pro Ask je zakázaný). | samostatný workspace a klíč s limitem útraty, model kontroly, DPA |
| **Perplexity API** | Ve Vercelu žádný `DAJC_ASK_PERPLEXITY_API_KEY`. | samostatný klíč s limitem, DPA |
| **Resend** | Ve Vercelu **chybí i `RESEND_API_KEY`** (týká se i registrace testování 2027). Ověření domény nelze odsud zjistit. | ověřená doména `dajc.eu`, klíč v Production, `DAJC_ASK_EMAIL_MODE=live` |
| **Vercel** | Projekt `dajc-eu` (tým HaulBoard). Proměnné: jen investor + 2 preview proměnné z #102. Produkční funkce běží v **iad1 (USA)**. Tarif nelze přes API zjistit (billing API vrací 404 → pravděpodobně Hobby). | Ask proměnné; region `fra1` (v této větvi v `vercel.json`, platí po sloučení); potvrdit tarif — podmínky Hobby omezují komerční použití, posoudit s ohledem na příspěvky a B2B nabídky |
| **Rozpočty a monitoring** | V kódu: denní a měsíční strop, tabulka `metrics`, SQL v `docs/ASK_DAJC_AI.md`. U poskytovatelů nic nastaveno. | rozhodnout stropy (oddíl 5), limity útraty u poskytovatelů, denní kontrola metrik |

Nic nebylo vytvořeno, obnoveno, migrováno ani změněno v Supabase ani ve
Vercelu.

## 5. Odhad provozních nákladů (3 dotazy denně, 30 dní)

**Předpoklady** (odhad, ne měření — první týden provozu je nutné porovnat s
tabulkou `metrics`):

- ceny z konfigurace §47.5 / `.env.example` (USD za 1M tokenů): klasifikace
  0,20/1,25, návrh odpovědi 0,75/4,50, kontrola 2/10 (= Claude Sonnet 5.5),
  vyhledávání 0,005 USD; kurz 0,92 EUR/USD. Ceny OpenAI a Perplexity nebyly
  ověřeny na aktuálním ceníku; ceny Anthropic odpovídají ceníku k 2026-10.
- tokeny na dotaz: klasifikace 700/200, návrh 5 000/700, kontrola 3 000/300,
  vyhledávání u 60 % dotazů.
- **základ ≈ 0,018 € / dotaz**; nejlevnější varianta s kontrolou Claude
  Haiku 5.5 (0,10/0,50 USD) ≈ 0,010 €; pesimistická (skryté reasoning
  tokeny, vyhledávání u všech dotazů) ≈ 0,028 €. Rezervace nejhoršího
  případu před dotazem ≈ 0,24 € (s Haiku ≈ 0,10 €).

| Aktivní řidiči | Dotazů / měsíc | AI základ | AI nejlevnější | AI pesimisticky | Infrastruktura | **Celkem základ** |
|---|---|---|---|---|---|---|
| 100 | 9 000 | 159 € | 89 € | 248 € | ≈ 41 € | **≈ 200 € / měsíc** |
| 500 | 45 000 | 797 € | 445 € | 1 238 € | ≈ 60 € | **≈ 860 € / měsíc** |
| 1 000 | 90 000 | 1 593 € | 889 € | 2 477 € | ≈ 60 € | **≈ 1 650 € / měsíc** |

Infrastruktura (seznamové ceny, ověřit): Supabase Pro 25 USD (≈ 23 €;
free tarif uspává neaktivní projekty a nemá zálohy), Vercel Pro 20 USD
(≈ 18 €; pokud Hobby nevyhovuje podmínkám), Resend free (3 000 e-mailů/měsíc,
100/den) stačí pro 100 řidičů, pro 500+ Resend Pro 20 USD (≈ 18 €).
Přihlášení platí 7 dní → ≈ 4–5 e-mailů na řidiče měsíčně.

Nejlevnější bezpečná varianta pro start (≈ 100 řidičů): kontrola Claude
Haiku 5.5, Supabase Pro, Resend free, Vercel podle posouzení tarifu →
**≈ 110–130 € / měsíc**. Kvalitu kontroly s Haiku je nutné ověřit testem
hodnoty (oddíl 7, krok 9) před přepnutím.

**Stropy v kódu musí odpovídat počtu uživatelů.** Výchozí hodnoty
(`DAJC_ASK_DAILY_BUDGET_EUR=2`, `DAJC_ASK_MONTHLY_BUDGET_EUR=20`) unesou jen
≈ 100 dotazů denně a ≈ 1 100 dotazů měsíčně (≈ 12 plně aktivních řidičů).
Potom se služba pozastaví — měsíční strop až do konce měsíce, což by
porušilo „zdarma každý další den“. Doporučení: měsíční strop ≥ 31 × denní,
aby rozhodoval denní strop a služba se každý den obnovila.

| Řidiči | `DAJC_ASK_DAILY_BUDGET_EUR` | `DAJC_ASK_MONTHLY_BUDGET_EUR` |
|---|---|---|
| 100 | 10 | 310 |
| 500 | 35 | 1 085 |
| 1 000 | 65 | 2 015 |

Další kapacitní limity v kódu: nejvýš 300 přihlašovacích e-mailů denně
celkem (`auth.ts`), Resend free 100 e-mailů denně — při spuštění pro stovky
řidičů najednou bude přihlášení první den omezené.

## 6. Zbývající blokující podmínky

1. **Právní texty** (`docs/ASK_DAJC_AI_LEGAL_DRAFT.md`): schválení
   provozovatelem a advokátem, sjednocení provozovatele (Miroslav Dajč vs.
   Dajc s.r.o.), zveřejnění v `/privacy` a `/terms` samostatnou změnou.
2. **DPA a předávání do USA** s OpenAI, Anthropic, Perplexity (a Resend):
   uzavřít, ověřit uchování a zákaz trénování.
3. **Databáze:** neuhrazené faktury Supabase, aktivní EU projekt, migrace.
4. **Klíče AI:** tři samostatné klíče s limity útraty, modely, ověřené ceny.
5. **Resend:** ověřená doména, klíč, `live` režim.
6. **Rozpočet:** rozhodnutí o stropech podle oddílu 5.
7. **Vercel:** tarif (komerční použití), proměnné prostředí, region `fra1`
   po sloučení.
8. **Test hodnoty** na 20 skutečných otázkách (EN, CS, SK, PL, DE) se
   schválením nákladů (≈ 0,5 €).
9. **Merge** této větve do `main` — jen po výslovném schválení vlastníka.

Doporučené, ne blokující: CAPTCHA/bot ochrana před přihlášením (otevřené z
#78), automatické mazání otisků po neaktivitě (pokud ho Privacy slíbí).

## 7. Poslední kroky ke spuštění (v tomto pořadí)

1. Vlastník zkontroluje a schválí PR; sloučit do `main` **merge commitem**.
   Po nasazení ověřit, že web funguje (region `fra1`), DAJC AI zůstává 404.
2. Rozhodnutí vlastníka: provozovatel, stropy, model kontroly (Sonnet 5.5
   vs. Haiku 5.5), tarif Vercel a Supabase.
3. Advokát schválí texty → samostatný PR zveřejní sekce DAJC AI v Privacy a
   Terms.
4. Supabase: vyřešit faktury, vytvořit/obnovit projekt v EU, jako admin
   `DAJC_ASK_MIGRATION_DB_URL=… npx drizzle-kit migrate --config drizzle.ask.config.ts`,
   `ALTER ROLE dajc_ask_app WITH LOGIN PASSWORD '…'` mimo repozitář,
   ověřit, že `dajc_ask` není v „Exposed schemas“; spustit
   `DAJC_ASK_TEST_DB_URL=… npx vitest run src/lib/ask` proti nové DB před
   prvními uživateli.
5. Vytvořit samostatné klíče OpenAI / Anthropic / Perplexity s měsíčním
   limitem útraty u poskytovatele (≤ měsíční strop) a uzavřít DPA.
6. Resend: ověřit doménu, klíč do Vercel Production.
7. Vercel Production — proměnné (jen názvy, hodnoty mimo repozitář):
   `DAJC_ASK_ENABLED=true`, `DAJC_ASK_PUBLIC_ENTRY=false`, `DAJC_ASK_DB_URL`,
   `DAJC_ASK_OPENAI_API_KEY`, `DAJC_ASK_ANTHROPIC_API_KEY`,
   `DAJC_ASK_PERPLEXITY_API_KEY`, `DAJC_ASK_OPENAI_CLASSIFIER_MODEL`,
   `DAJC_ASK_OPENAI_ANSWER_MODEL`, `DAJC_ASK_ANTHROPIC_VERIFIER_MODEL`,
   `DAJC_ASK_PRICING_USD`, `DAJC_ASK_USD_EUR_RATE`,
   `DAJC_ASK_DAILY_BUDGET_EUR`, `DAJC_ASK_MONTHLY_BUDGET_EUR`,
   `DAJC_ASK_DAILY_QUERY_LIMIT=3`, `DAJC_ASK_EMAIL_PEPPER` (≥ 32 znaků),
   `DAJC_ASK_EMAIL_MODE=live`, `RESEND_API_KEY`; znovu nasadit.
8. Kontrolní test v produkci přes přímou adresu `/intelligence/ask`:
   přihlášení e-mailem, 3 dotazy (úrovně, zdroje, bezpečnostní upozornění),
   4. dotaz → panel limitu s odkazem na `/support`; zkontrolovat řádky v
   `dajc_ask.metrics` a `dajc_ask.budget` a logy Vercelu.
9. Test hodnoty na 20 skutečných otázkách; vlastník posoudí odpovědi.
10. `DAJC_ASK_PUBLIC_ENTRY=true` a nové nasazení → odkaz „DAJC AI“ v hlavní
    navigaci a ve FAQ. Tím je služba veřejně spuštěná.
11. Provoz: denně SQL z `docs/ASK_DAJC_AI.md` (podíl NEVÍM, náklady na
    dotaz), útrata u poskytovatelů; podle skutečných nákladů upravit stropy.

Vypnutí kdykoli: `DAJC_ASK_PUBLIC_ENTRY=false` (skryje odkazy) nebo
`DAJC_ASK_ENABLED=false` (vše 404) a nové nasazení.
