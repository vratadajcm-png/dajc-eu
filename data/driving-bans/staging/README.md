# Driving Bans – kontrolní vrstva (staging)

Výchozí úložiště pro ručně dodané podklady (`npm run driving-bans:evidence`).
Web, JSON API, ICS ani DAJC Intelligence odsud nic nečtou. Jediným zdrojem
pro publikaci zůstává `../canonical.json`.

| Adresář / soubor | Obsah |
| --- | --- |
| `submissions/` | neměnné záznamy podání (čas importu, kdo importoval, otisky dokumentů) |
| `evidence/` | metadata dokumentů podle SHA-256 (první výskyt, původní cesta, zdroj) |
| `blobs/` | surové dokumenty podle SHA-256, **necommitují se** (`.gitignore`) |
| `proposals/` | návrhy změn se stavem a historií |
| `candidates/` | kandidátní dataset a diff po stavu `READY_FOR_CANONICAL_UPDATE` |
| `audit-log.jsonl` | auditní log, každý záznam nese hash předchozího |
| `research/` | AI výzkum (`npm run driving-bans:research`): návrhy `drafts/`, reporty běhů `runs/`, metadata dokumentů `documents/`, cache extrakcí `cache/`, `ledger.json` s náklady a vlastní `audit-log.jsonl`; surové dokumenty `research/blobs/` se **necommitují**. Návrh vstoupí do schvalování jen přes `promote` člověkem. |

Postup a pravidla: `docs/DRIVING_BANS_EVIDENCE_IMPORT.md`.
