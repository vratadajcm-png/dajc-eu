# DAJC AI — samostatný stavební plán a integrační mapa
Revize 1.0 · 2026-11-10 · **IMPLEMENTAČNÍ PODKLAD / NENÍ PRODUKČNÍ SCHVÁLENÍ**

## Autorita a hranice
Nadřazený produktový dokument: [DAJC-AI-PLAN-001 — Stavební Master Plan v0.1](https://docs.google.com/document/d/1gP65j89QtZCvtoLBVNrCLH0gJDkuC8h-YryYYBs4lP8/edit), stav **DRAFT / OWNER REVIEW**. Tato mapa předává jeho existující rozhodnutí agentům, kteří nemají přístup ke korporátnímu Google Drive ani e-mailům. Při rozporu má aktuální rozhodnutí vlastníka a schválený master přednost. Netvrdit, že dokumentace dokládá implementaci nebo schválení cen, licence či produkce.

**DAJC AI je třetí nezávislý produkt:** individuální e-mailový účet, nikoli účet dopravní společnosti Platform, identita TAR ani Ferda. Nemá výchozí přístup do žádné databáze, konverzací, nákladů, případů ani klíčů těchto produktů. Interní AI v Platform a TAR není automatická licence DAJC AI. Případné propojení musí být samostatné, auditované a výslovně schválené po poli/účelu.

## Již schválený veřejný model (neměnit bez rozhodnutí)
Každý registrovaný uživatel dostává **nejvýše tři bezplatné otázky za kalendářní den**. Potom se může dobrovolně podpořit vývoj přes https://www.dajc.eu/support, ale příspěvek **neodemkne otázky, kredity, předplatné ani přednostní obsluhu**. Historické úvahy 10/15/20/25 EUR a 15 EUR nejsou schváleným ceníkem. Nespouštět automatické refundace, checkout, placené tarify ani nárok na služby. Denní časovou zónu (Europe/Prague versus UTC) a pravidlo, zda se započítává nedoložitelná/technicky neúspěšná odpověď, musí potvrdit vlastník; v testech explicitně modelovat obě varianty, v produkci nehádat.

## Kde stavět a odkud čerpat
- Aplikační a webový repozitář `vratadajcm-png/dajc-eu`: `src/lib/ask/`, `src/lib/ai/`, `src/lib/kb/`, `src/pages/api/ask/`. Existence souboru neznamená produkční nasazení ani schválení endpointu.
- Vývojové větve DAJC AI Neon (`dajc-ai`, EU, samostatné schéma/role): dev, dev-security-tests, dev-kb-tests, production. Větev pojmenovaná production sama nepotvrzuje živou službu.
- Soukromý repo `vratadajcm-png/dajc-ai-lab` slouží k výzkumnému benchmarku modelů; není automaticky produkční runtime.
- Oficiální archiv [DAJC AI — Official European Road Transport Library](https://drive.google.com/drive/folders/1l-saHoPA3_hszCR3HetX9dN2uJaLGXsi) je spravovaný Google Drive zdroj, **nikoli automaticky index ani oprávnění modelu otevřít každý interní soubor**.
- [Source and Connector Registry](DAJC_AI_SOURCE_AND_CONNECTOR_REGISTRY.md) dává vývojáři seznam konkrétních úředních providerů, datových struktur, autority a nepokrytých oblastí. Nezaměňovat historickou matici 104 jurisdikcí s aktuální pravidelnou evidencí 50; pro každé téma a jurisdikci evidovat skutečnou ověřenost, ne pouze sledování.

## Realizační checklist pod nadřazeným masterem
| ID | Vývojový celek | Potřebný kontrakt / důkaz | Negativní test |
|---|---|---|---|
| AI-01 | Osobní účet a ověřený e-mail | vlastní identita, session, revokace, consent | cizí otázky nepřístupné, chybné session odmítnuty |
| AI-02 | Atomická kvóta 3 otázky/den | serverová idempotence; časová zóna potvrzená vlastníkem | souběžné dotazy neprolomí kvótu, retry nezapočte dvakrát |
| AI-03 | Source Registry a oprávnění | oficiální URL, správce, licence, dostupnost, jurisdikce, hash, účinnost | nelicencovaný či neověřený dokument nevydávat za platný |
| AI-04 | Ingest PDF/XML/HTML a revision model | originál, verze, část/článek, jazyk, účinnost, source hash | OCR/embedding nesmí být vydáván za originál |
| AI-05 | Hybridní vyhledávání / evidence passage | odděleně přesné citace, fulltext, vektorové kandidáty | nepodložená citace/nesprávná jurisdikce → UNKNOWN |
| AI-06 | Temporalita a pravidla nákladní dopravy | EU/národní právní režim, vehicle class, masa/nápravy, datum, výjimka | 2.5t/3.5t/12t nelze generalizovat na všechny předpisy |
| AI-07 | Zákazy jízd | 50-jurisdiction registry, 12měsíční výhled, úřední změny | UNVERIFIED ≠ NO_BAN, lokální a časové výjimky |
| AI-08 | Řízení/odpočinek/tachograf | EU 561/2006 a lokální použitelnost, parkování | špatné časové okno a profily řidiče nejsou legální plán |
| AI-09 | Permits, ADR, celní a dokladové dotazy | oficiální úřad, eFTI/eCMR/NCTS/TIR zdroje | AI nesmí vydávat povolení, schválit trasu ani vydávat se za úřad |
| AI-10 | Model/provider gateway | OpenAI/Anthropic/Gemini/xAI/ostatní jako adaptéry, cena a datové účely | rate 429, timeout, rozpočet, prompt injection, failover |
| AI-11 | Odpověď s citacemi | právní článek, official link, source-date + valid-from/to + nejistota | falšovaná citace, neúčinná novela, konfliktní zdroj |
| AI-12 | QA/monitoring/náklady | token ledger na uživatele/model/otázku, benchmark, datová práva | nekonečné retry, privacy leaks, prázdné evidence bez přiznání |
| AI-13 | Právní/release dokumentace | anglické public legal texty + lokální povinnosti, GDPR, AI Act dle scope | žádná implicitní schválená licence/placená entitlements |
| AI-14 | Sledování dopravních dat / veřejný web | výslovně oddělené public informational news od citované oficiální právní autority | článek DAJC Weekly není úřední aktuální zdroj |

## Pracovní etapy (odvozené ze schváleného obsahu masteru)
**0:** reality-check repa, Neon a env, zjištění scope a neuzavřených požadavků; neaktivovat produkci.
**1:** evidenční knihovna a oficiální zdroje, licence/provenience, validní pasáže a test dotazů; URL bez ingest/review ≠ hotová znalost.
**2:** identita, atomická kvóta, UI, reset, validace citací, stav není-li doloženo.
**3:** provider gateway, model regressions, bezpečnost/ochrana osobních údajů, ceny/limity.
**4:** end-to-end, security/policy/Neon testy, zálohy a evidence, staging a fyzické ověření deploymentu.
**5:** samostatné schválení vlastníka pro veřejný release; aspirace leden 2027 není pevné datum.
**6:** budoucí placené služby, nové země, hlubší integrace *až po novém rozhodnutí*.

## Source-of-truth schema
Minimálně: `source_id`, publisher/authority, `source_uri`, title, jurisdiction, region, `legal_subject`, affected vehicle type/weight, source language, publication/effective/expiry times, revision, retrieval/verification times, `sha256`, original asset locator, licensed content use/retention/model-training policy, extraction version, structured article identifiers, precedence, reviewer status, conflict/unknown flags. Odlišit `SOURCE_DISCOVERED`, `FETCHED`, `EXTRACTED`, `REVIEWED`, `RETRIEVABLE`, `CITABLE`, `EXPIRED`. Žádný přechod automaticky neznamená právní správnost.

## Produktové a finanční hranice
Samostatné logy/API budget DAJC AI; vývojové API modely, provider API pro znalosti a zákaznický runtime jsou odlišné nákladové účely. Pro vývojové GitHub Actions uživatel nastavil měsíční limity OpenAI 60 USD a Anthropic 80 USD; nejsou licencí produkčního produktu ani přímým hard-capping každé akce. Poslední ruční Claude developer běh #4 dokázal použití Sonnet 5.5 a zdrojový patch; publisher odmítl pomocný output.txt (oprava PR #116, původní změna zachráněna draft PR #117). Automatický end-to-end publish/review proto nepovažovat za odzkoušené dokončení. Seznam PR a skutečný stav CI načítat živě z GitHubu, ne z historie dokumentu.

## Otevřené rozhodnutí — nezablokovat ostatní práci
- **AI-D01:** kalendářní den kvóty Europe/Prague nebo UTC, zápis po neúspěchu, co se započítá.
- **AI-D02:** které země/témata mají minimální oficiální verified coverage pro veřejný start.
- **AI-D03:** pravidla práv/reuse při stažení a indexaci oficiálních dokumentů; odborná právní kontrola, pokud zdroj omezuje reuse.
- **AI-D04:** minimální varianta live odpovědi při chybě nebo došlém API budgetu; nepřijímat falešné právní závěry.
- **AI-D05:** priority providerů a hranice jejich využití a modelových nákladů pro runtime (odděleně od vývojových limitů).
- **AI-D06:** osobní úschova otázek, retence a mazání podle právního posouzení.

Agent má vytvořit issue `[DAJC AI][OWNER DECISION]` s přesnou otázkou, variantami, doporučeným bezpečným výchozím nastavením, linkem na podklad a dopadem na cenu/bezpečnost. Pokud nemá issue-write, vloží `OWNER_DECISION_REQUIRED` do PR nebo závěrečného reportu. Na čekající rozhodnutí neobcházet ochrany; pokračovat v nezávislých mock/test úlohách.

**Tento soubor je informační implementační mapa, nemění master sám a neopravňuje k nasazení, financování ani placenému provozu uživatelů.**
