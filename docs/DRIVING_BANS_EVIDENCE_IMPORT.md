# Driving Bans – ruční import podkladů a schvalování

Dokud nejsou připojená API, přicházejí nové podklady ručně: úřední text, výtah
z dokumentu, PDF nebo odkaz s návrhem změny. Tento proces je převezme bezpečně,
ověří je a připraví změnu ke schválení. Do `canonical.json` nic nezapisuje.

```
podání (JSON + dokumenty)
  → IMPORTED                 import: schéma, cesty, velikosti, SHA-256, duplicity
  → VALIDATED                deterministická kontrola proti aktuálnímu datasetu
  → REVIEW_REQUIRED          každý návrh jde k člověku
  → APPROVED                 lokální rozhodnutí s důvodem (identita neověřena)
  → READY_FOR_CANONICAL_UPDATE  kandidátní dataset + diff v úložišti
  → pull request na GitHubu  skutečné schválení a publikace
vedlejší stavy: INSUFFICIENT_EVIDENCE, CONFLICT, REJECTED
```

| Z | Povolené přechody |
| --- | --- |
| `IMPORTED` | `VALIDATED`, `INSUFFICIENT_EVIDENCE`, `CONFLICT` |
| `VALIDATED` | `REVIEW_REQUIRED` (automaticky) |
| `REVIEW_REQUIRED` | `APPROVED`, `REJECTED` |
| `APPROVED` | `READY_FOR_CANONICAL_UPDATE`, `CONFLICT` (dataset se mezitím změnil) |
| `INSUFFICIENT_EVIDENCE` | `REJECTED` – důkazy podání se nemění, doplnění = nové podání |
| `CONFLICT` | nová validace (`VALIDATED` / `INSUFFICIENT_EVIDENCE`) nebo `REJECTED` |
| `READY_FOR_CANONICAL_UPDATE`, `REJECTED` | konečné |

## Příkazy

```
npm run driving-bans:evidence -- import cesta/k/submission.json [--root DIR]
npm run driving-bans:evidence -- validate prop-…
npm run driving-bans:evidence -- approve prop-… --reviewer "Jméno/role" --reason "…"
npm run driving-bans:evidence -- reject  prop-… --reviewer "…" --reason "…"
npm run driving-bans:evidence -- prepare prop-…
npm run driving-bans:evidence -- list | show prop-… | report [--output DIR] | verify-log
npm run driving-bans:evidence:demo      # celý průchod na syntetických datech
```

Výchozí úložiště je `data/driving-bans/staging/` (lze změnit přes `--store`).
Úložištěm nesmí být adresář s `canonical.json`. Surové dokumenty (`blobs/`) se
necommitují, commitují se jen jejich metadata s SHA-256.

## Formát podání

```json
{
 "submission_version": 1,
 "synthetic": false,
 "submitted_by": "role nebo jméno (není ověřeno)",
 "jurisdiction": "CZ",
 "summary": "co a proč se mění",
 "documents": [{"path": "documents/vyhlaska.pdf", "source_id": "cz-361", "title": "…", "retrieved_from": "https://…", "retrieved_at": "2026-10-27T10:00:00Z"}],
 "links": [{"url": "https://…", "source_id": "cz-361", "title": "…"}],
 "legal_effective": {"from": "2027-01-01", "to": null},
 "legal_verified_at": "2026-10-27T10:30:00Z",
 "operations": [ … ]
}
```

Operace:

- `ADD_SOURCE`: nový zdroj. Jeho `content_sha256` se doplní z dokumentu se stejným `source_id`.
- `ADD_RULE`: nové pravidlo ve tvaru `canonical.json`. Může dědit z existujícího `profile`.
- `AMEND_RULE`: změna polí. Vyžaduje `expected_sequence`, při neshodě vznikne `CONFLICT`.
  Revize (`sequence`) se zvýší automaticky.
- `CANCEL_RULE`: zrušení. Vyžaduje právní základ a dokument z PRIMARY zdroje.
  Nedostupný zdroj zákaz neruší.
- `SUPERSEDE_RULE`: nahrazení novým pravidlem. Staré dostane `SUPERSEDED`.

Kanálem nelze navrhnout `NO_BAN`, úplnost jurisdikce ani kontroly rozsahu
(`ban_state`, `coverage_complete`, `no_ban_evidence`, `scope_checks`). Změnit nejde
ani identitu pravidla ani `sequence`.

Dokumenty a odkazy mohou citovat libovolnou identitu z katalogu zdrojů (PR 1).
Pravidlo ale musí stát na zdroji z `canonical.json` nebo na zdroji přidaném
ve stejném podání.

## Co validace kontroluje

- jurisdikce je ve středním registru a pravidla nepatří do jiné jurisdikce,
- citované zdroje existují,
- je importován alespoň jeden dokument z PRIMARY zdroje (samotný odkaz není neměnný důkaz),
- `legal_verified_at` je vyplněné. Čas importu se nikdy nepovažuje za datum právního ověření,
- tvrzení `PRIMARY_VERIFIED` je podložené importovaným PRIMARY dokumentem,
- žádný jiný otevřený návrh nemění stejná pravidla,
- `expected_sequence` odpovídá datasetu,
- nové pravidlo neopakuje aktivní pravidlo,
- kandidátní dataset projde `validateCanonical`.

Při `prepare` se kontrola opakuje proti aktuálnímu datasetu. Pokud se mezitím
změnil, návrh přejde do `CONFLICT`.

## Bezpečnost vstupu

Podklady jsou nedůvěryhodný vstup.

- Cesty musí být relativní uvnitř kořene importu: žádné `..`, absolutní cesty ani symbolické odkazy.
- Povolené typy: `.txt`, `.md`, `.pdf`, `.html`, `.htm`, `.json`, `.xml`. Spustitelné soubory se odmítnou.
- Limity se kontrolují před čtením: podání 1 MB, text 2 MB, dokument 25 MB, celkem 60 MB.
- Text musí být platné UTF-8 bez NUL bajtů. PDF musí začínat `%PDF-`, nic se z něj nespouští ani neinterpretuje.
- JSON nesmí obsahovat klíče `__proto__`, `prototype` ani `constructor`.
- Schéma je striktní a neznámá pole odmítne. Odkazy musí být `https` bez přihlašovacích údajů v URL.
- Žádná síťová komunikace: import obsah cizích webů nestahuje, dokument je potřeba dodat.
- Report je statická stránka bez skriptů (`Content-Security-Policy: default-src 'none'`) a veškerý text je escapovaný.

## Schválení a publikace

Lokální `approve` zapíše štítek posuzovatele a důvod s `identity_verified: false`.
Není to doklad identity oprávněného schvalovatele, a proto nic nepublikuje.
`prepare` vytvoří jen `candidates/<id>/canonical.candidate.json` a `diff.json`.

Publikace pak probíhá samostatně:

1. Kandidátní změna se přenese do `canonical.json` v pull requestu.
2. Kontroly v CI musí projít.
3. Změnu schválí oprávněná osoba na GitHubu.

Syntetická podání (`"synthetic": true`) se do kandidáta dostanou jen s
`--allow-synthetic` a vždy nesou `SYNTHETIC_DEMO_NOT_FOR_PUBLICATION`.

## Auditní stopa a duplicity

- Každý přechod se zapíše do `audit-log.jsonl` s hashem předchozího záznamu.
  `verify-log` odhalí změnu, vynechání záznamu i stav návrhu, který neodpovídá logu.
- Stejné podání se stejnými dokumenty dostane stejný otisk. Opakovaný import vrátí
  `DUPLICATE` a nic nezapíše.
- Dokument se stejným SHA-256 z jiného podání se znovu nepoužije jako nový důkaz.
  Návrh ho uvede v `known_documents`.
