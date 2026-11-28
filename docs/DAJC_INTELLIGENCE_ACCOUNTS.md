# DAJC Intelligence – zákaznické účty, platby a osobní kalendáře

Vše je vypnuté. Stránky i API vrací 404, dokud neplatí obojí:

- `DRIVING_BANS_INTELLIGENCE_RELEASED` je `true` (revidovaná změna kódu, dnes `false`);
- `DAJC_INTELLIGENCE_ACCOUNTS_ENABLED` je přesně `"true"`.

Kalendář navíc potřebuje `DAJC_INTELLIGENCE_BANS_ENABLED` a `DAJC_INTELLIGENCE_CALENDAR_ENABLED`.
Administrace leží v partnerském portálu, takže potřebuje i `DAJC_PARTNER_PORTAL_ENABLED`.

## Architektura

| Část | Kde |
| --- | --- |
| Přihlášení | sdílený mechanismus portálu: odkaz z e-mailu, relace, CSRF, rate limit, audit (`src/portal/lib`), nový typ přihlášeného `CUSTOMER` |
| Data | stejná databáze jako portál (`DAJC_PARTNER_DB_URL`), vlastní tabulky `intelligence_*` (`src/portal/db/intelligenceSchema.ts`, migrace `drizzle/0001_intelligence_accounts.sql`) |
| Logika | `src/lib/intelligence/accounts.ts` (firmy, členové, oprávnění, žádosti, úložiště kalendářů), `account-forms.ts` |
| Zákazník | `/intelligence/account` (přihlášení, předplatné, kalendáře) |
| DAJC | `/partner-portal/admin/intelligence` (firmy, členové, platby, oprávnění) |
| Kalendář | `/api/intelligence/calendar/dcal_<token>.ics` (`driving-bans-calendar.ts`) |

Partner a zákazník jsou oddělení:

- zákaznická relace platí jen pod `/intelligence/account` (vlastní cookies `dajc_customer_session`, `dajc_customer_csrf`);
- portálová relace platí jen pod `/partner-portal`;
- odkaz z e-mailu pro jednu oblast druhá oblast nepřijme a ani ho nespotřebuje (`consumeLoginToken(..., allowed)`).

Partner tak nikdy nezíská přístup k Intelligence a zákazník k partnerskému portálu.

## Účty

- Firmu a jejího vlastníka (OWNER) zakládá DAJC v administraci. Veřejná registrace neexistuje.
- Další členy (MEMBER nebo OWNER) přidává DAJC.
- Jeden e-mail patří jedné firmě, takže přihlášení vždy vede k jednomu tenantovi.
- Organizace se bere jen z relace, nikdy z formuláře nebo URL. Filtr kalendáře je striktní schéma.
- Pozastavený člen nebo firma přestane fungovat hned:
  - nedostane odkaz pro přihlášení;
  - jeho relace neplatí;
  - kalendáře pozastaveného člena se zruší.

## Platby (Revolut Pro, ručně)

Revolut Pro podle dokumentace Revolutu nenabízí Merchant API pro automatické předplatné.
To vyžaduje Revolut Business s obchodním účtem. Platby se proto zaznamenávají ručně:

1. Vlastník firmy v účtu požádá o předplatné: kalendář, volitelně filtr vozidla a koridoru, měsíc nebo rok.
   Firma má vždy nejvýše jednu otevřenou žádost.
2. Pokud je nastaven `DAJC_INTELLIGENCE_BILLING_EMAIL`, přijde na něj oznámení.
3. DAJC pošle platební odkaz Revolut Pro nebo fakturu a v administraci označí žádost INVOICED s referencí.
4. Po připsání platby ji DAJC označí PAID. Teprve tím vznikne oprávnění:
   - nové předplatné běží od tohoto okamžiku;
   - prodloužení navazuje na konec běžícího období a funkce se sčítají.
5. DAJC může oprávnění udělit nebo zrušit i ručně. Firma má vždy nejvýše jedno aktuální oprávnění;
   nové nahradí staré a historie zůstane.

Ceny se v kódu ani v databázi neukládají: nese je platební odkaz nebo faktura. Každý krok jde do
auditního logu portálu (`intelligence.*`) bez tokenů a tajných hodnot.

Pozdější automatizace s Revolut Business (Merchant API, předplatné, webhooky) by nahradila jen
krok 3–4. Tabulky i oprávnění zůstanou.

## Osobní kalendáře

- Vytváří je přihlášený člen. Adresa se ukáže jednou a v databázi je jen SHA-256 tokenu.
- Člen vidí a ruší jen své kalendáře.
- Při každém stažení se znovu ověří oprávnění firmy:
  - po skončení předplatného je kalendář prázdný s vysvětlením;
  - zrušená adresa vrací 404;
  - počet stažení je omezený.

## Spuštění (nic z toho se zatím neprovedlo)

1. Na databázi portálu (Supabase) spustit migraci `drizzle/0001_intelligence_accounts.sql`
   (`drizzle-kit migrate`). Rozšíří i výčty `portal_principal_type` a `portal_actor_type` o `CUSTOMER`.
2. Nastavit proměnné: `DAJC_INTELLIGENCE_ACCOUNTS_ENABLED`, `DAJC_INTELLIGENCE_CALENDAR_ENABLED`,
   `DAJC_INTELLIGENCE_BANS_ENABLED`, `DAJC_INTELLIGENCE_BILLING_EMAIL`, `DAJC_PARTNER_EMAIL_MODE=live`
   a ověřený odesílatel.
3. Revidovanou změnou nastavit `DRIVING_BANS_INTELLIGENCE_RELEASED = true`. Tím se zapne celá placená
   Intelligence podle svých přepínačů.
4. Doplnit obchodní podmínky a zásady ochrany osobních údajů pro placené předplatné, včetně fakturace a DPH.

## Testy

- `src/lib/intelligence/accounts.test.ts` běží proti skutečnému Postgresu v procesu (PGlite) se
  skutečnými migracemi:
  - přihlášení zákazníka a oddělení od portálu;
  - ruční platba a prodloužení;
  - kalendáře v databázi a izolace firem;
  - pozastavení člena.
- `account-forms.test.ts` testuje formuláře, `intelligence-gate.test.ts` bránu v middleware.

## Nalezená chyba v portálu

- Transakce portálu zapisovaly audit a zakládaly relaci přes druhé spojení. Klient má `max: 1`,
  takže by se taková transakce zasekla.
- Pro přihlášení (`consumeLoginToken`) je to opraveno:
  - relace vzniká uvnitř transakce;
  - audit se zapíše po ní, neúspěšný pokus tedy zůstane zaznamenán.
- Stejný vzor mají `invitations.ts` (aktivace pozvánky) a `partnerLifecycle.ts` (změny stavu partnera).
  Ty tento PR nemění; potřebují samostatnou opravu.
