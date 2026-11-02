# Návrh úpravy naplánovaných rutin Driving Bans

> **Stav: ČEKÁ NA SAMOSTATNÉ PROVEDENÍ.**
> Naplánované úlohy nejsou součástí repozitáře a tento PR je nemění.
> Rutiny dál běží beze změny. Úpravu provede vlastník v nastavení
> naplánovaných úloh, a to až po sloučení PR 2 až PR 4 do `main`.

## Proč změna

Čtvrteční úplný průchod („DAJC HGV Driving Bans Thursday sweep“) v kroku 5 přímo
upravuje `data/driving-bans/canonical.json` a v kroku 7 otevírá PR s hotovou
změnou. Denní cílené ověřování („DAJC HGV Driving Bans daily immediate verification“)
dělá totéž.

Po Driving Bans 2.0 má každá právní změna projít kontrolní vrstvou:

- importovaný důkaz s otiskem SHA-256,
- validace proti datasetu a Source Registry,
- klasifikace změn,
- hashovaná auditní stopa,
- lidské schválení.

Teprve potom se mění `canonical.json`. Rutina proto má vytvářet návrh, ne
publikovat.

## Nový průběh čtvrteční rutiny

1. **Příprava.** Beze změny: `main`, SHA, 50 kódů, Prague čas, období
   (aktuální + následující měsíc).
2. **Právní kontrola.** Beze změny: všech 12 kontrol rozsahu, jen primární zdroje,
   fail-closed.
3. **Podklady.** Každý použitý oficiální dokument se uloží do pracovního adresáře
   mimo repozitář (např. `$TMPDIR/dajc-sweep/documents/`).
4. **Podání.** Pro každou jurisdikci se změnou vznikne `submission.json` ve formátu
   z `docs/DRIVING_BANS_EVIDENCE_IMPORT.md`:
   - operace `ADD_RULE`, `AMEND_RULE` s `expected_sequence`, `CANCEL_RULE`
     nebo `SUPERSEDE_RULE`,
   - `legal_verified_at` je skutečný čas ověření,
   - `synthetic: false`.
5. **Import a validace.**
   `npm run driving-bans:evidence -- import <submission.json> --root <adresář>` a
   `npm run driving-bans:evidence -- validate <prop-id>`. Rutina nikdy nevolá
   `approve` ani `prepare`.
6. **Report.**
   - `npm run driving-bans:evidence -- report` a `verify-log`,
   - `npm run driving-bans:changes -- --after <kandidát>`, pokud je kandidát k dispozici,
   - `npm run driving-bans:audit -- --mode validate`.
7. **Doručení.** Commit jen do `data/driving-bans/staging/`:
   - návrhy, metadata důkazů a `audit-log.jsonl`,
   - bez `blobs/`, ty zůstávají mimo git.

   Větev je `claude/driving-bans-sweep-YYYY-MM-DD`. PR se otevře jako návrh
   s tabulkou:
   - návrh,
   - stav (`VALIDATED`, `REVIEW_REQUIRED`, `CONFLICT`, `INSUFFICIENT_EVIDENCE`),
   - klasifikované změny,
   - u každého dokumentu URL a SHA-256, aby si ho posuzovatel mohl stáhnout
     a porovnat.

   `canonical.json` se v tomto PR nemění.
8. **Lidské schválení.** Oprávněná osoba zkontroluje PR a lokálně nebo v
   samostatné relaci spustí:
   - `approve <prop-id> --reviewer … --reason …`,
   - `prepare <prop-id>`.

   Vznikne kandidát `canonical.candidate.json`.
9. **Publikace.** Kandidát se přenese do `canonical.json` v samostatném PR. Projdou
   lint, typecheck, testy, build a audit. Teprve sloučení tohoto PR změní web, JSON
   a ICS.

Kroky 8 (Change Register) a 9 (výstup) původní rutiny zůstávají. Change Register
se aktualizuje až po publikaci, ne po vytvoření návrhu.

## Text k nahrazení v rutině (anglicky, jako stávající prompt)

Nahradit krok 5:

> 5. Do not edit data/driving-bans/canonical.json. For every jurisdiction with a
> supported change, save the official documents you relied on into a working
> directory outside the repository and write one submission.json in the format of
> docs/DRIVING_BANS_EVIDENCE_IMPORT.md (operations ADD_RULE / AMEND_RULE with
> expected_sequence / CANCEL_RULE / SUPERSEDE_RULE; real legal_verified_at;
> synthetic false). Run `npm run driving-bans:evidence -- import <file> --root <dir>`
> and `npm run driving-bans:evidence -- validate <proposal-id>`. Never run approve
> or prepare. Run `npm run driving-bans:evidence -- verify-log` and `report`.
> Keep rule ids stable; a removed or unreachable source is never a cancellation.

Nahradit krok 7:

> 7. With validated proposals and passing required gates, commit only
> data/driving-bans/staging/ (proposals, evidence metadata, audit-log.jsonl; never
> blobs/) to claude/driving-bans-sweep-YYYY-MM-DD, push only that branch and open a
> draft PR titled "Driving Bans review proposals YYYY-MM-DD". The PR body lists
> each proposal with state, classified changes, and every document's official URL
> and SHA-256. canonical.json must remain unchanged in this PR. Never push to main,
> merge, approve proposals or deploy. Publication happens later in a separate PR
> after a human approves and prepares the proposal.

## Denní rutina

Stejná změna:

- Místo přímé úpravy `canonical.json` vytváří podání a validuje je.
- Větev je `claude/driving-bans-daily-YYYY-MM-DD`.
- Pokyn „add them immediately“ se mění na „submit them immediately as proposals
  and mark the PR as urgent“.
- Naléhavost řeší rychlé lidské schválení, ne obejití kontrolní vrstvy.

## Jednorázová úloha „doplnit svátky a zákazy jízdy na rok 2027“

Úloha je naplánovaná na 15. 12. 2026 a je zastaralá:

- **Neexistující soubory.** Odkazuje na `config/driving-ban-calendars/public-holidays.mjs`,
  `scripts/lib/driving-ban-calendar.mjs`, pole `seededHolidays` a `lastVerified`.
  Nic z toho už neexistuje. `config/driving-ban-calendars/index.mjs` je jen
  kompatibilní vstup do `canonical.json`.
- **Pozdní termín.** Snapshot vyžaduje ověřený aktuální i následující měsíc
  (Europe/Prague). Leden 2027 proto musí být ověřený a schválený do 1. 12. 2026.
  Jinak budou 1. 12. všechny jurisdikce `ACTIVE_WINDOW_NOT_REVERIFIED`.

Doporučení vlastníkovi:

1. Úlohu vypnout, nebo ji přeplánovat na začátek listopadu.
2. Prompt nahradit odkazem na průběh výše: podání pro leden 2027 a celý rok 2027.
3. Seznamy svátků 2027 z původního promptu brát jen jako kontrolní seznam, ne
   jako ověřený zdroj.

## Rozhodnutí pro vlastníka: sémantika čtvrteční brány

`--max-sweep-age-days` měří stáří podle nejnovějšího `last_checked` libovolné
jurisdikce. Po cílené kontrole 27. 10. 2026 proto brána projde, i když
`review_log` uvádí `full_registry_sweep: false`. Audit nově vypisuje zvlášť
`last_full_registry_sweep` (zatím `null`).

| Varianta | Chování | Riziko |
| --- | --- | --- |
| A. Ponechat (doporučeno pro přechod) | brána hlídá obecnou čerstvost, úplnost hlásí audit zvlášť | cílená kontrola „obnoví“ bránu |
| B. Brána podle `last_full_registry_sweep` | brána projde jen po úplném průchodu všech 50 jurisdikcí | dnes by okamžitě selhala, nutný úplný průchod |

## Předpoklady přepnutí

1. PR 2 až PR 4 jsou sloučené do `main`.
2. Na `main` projde `npm run driving-bans:evidence:demo`.
3. Je určeno, kdo smí schvalovat. Lokální `approve` neověřuje identitu, oprávnění
   dává až schválení PR na GitHubu.
4. Nejpozději do 1. 12. 2026 je schválený a publikovaný leden 2027 (viz výše),
   ať už starým, nebo novým postupem.
