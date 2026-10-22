# Oficiální weby a rozsah silnic – doplnění 22. 10. 2026

Požadavek uživatele: AT, DE, ES, BE, UK a PT ověřovat na oficiálních webech;
KZ/RU/TR sledovat pro dálnice a hlavní silnice. Původní omezení na evropské a
návazné mezinárodní nákladní koridory zůstává zachováno.

## Co se ověřilo na webu

Jde o cílenou kontrolu podkladů pro říjen a listopad 2026, nikoli dokončenou
kontrolu všech pravidel šesti zemí. Strojově čitelný záznam obsahuje 13 úředních
zdrojů, jejich působnost, způsob načtení a zbývající úkoly:
`data/driving-bans/source-reviews/2026-10-22.json`.

| Země | Ověřený podklad a praktický význam |
| --- | --- |
| AT | [RIS – sektorální zákaz A12](https://www.ris.bka.gv.at/GeltendeFassung.wxe?Abfrage=LrT&Gesetzesnummer=20000636): vymezený úsek a druhy zboží, přesný práh nad 7,5 t a výjimky. Kódování musí zachovat všechny podmínky § 3–4. |
| DE | [Sársko – úřední rozhodnutí z 28. 9. 2026](https://www.saarland.de/SharedDocs/Downloads/DE/mukmav/verkehr/Strassenverkehrsbehoerde/dl_erweiterung_aussetzung_sonn_u_feiertag_1.pdf?__blob=publicationFile&v=2): výjimka pro přepravy související s nízkým stavem Rýna platí do 31. 10. včetně a výslovně zahrnuje GST. Obsahuje podmínky úlev do 44 t a požadavky na technickou způsobilost/povolení. Pro listopad se její platnost neprodlužuje odhadem. |
| ES | [DGT / BOE](https://www.boe.es/diario_boe/txt.php?id=BOE-A-2026-1255), [Katalánsko – říjnový kalendář TE/VE](https://transit.gencat.cat/web/.content/restriccions_circulacio/documents/10-octubre/Restriccions-10-Octubre-2026_TE_VE.pdf), [Baskicko – předpis 2026](https://www.boe.es/buscar/act.php?id=BOE-A-2026-2625): oddělené působnosti a kategorie vozidel. DGT se nepřenáší na regionální kalendáře. |
| BE | [Flandry – úřední přehled](https://www.vlaanderen.be/belastingen-en-begroting/vlaamse-belastingen/boetes-uitzonderlijk-vervoer) a [Valonsko – čl. 35](https://wallex.wallonie.be/eli/arrete/2024/03/21/2024007525/2026/02/13): rozdílné začátky víkendového omezení (sobota 12:00 vs. 22:00), rozdílné výjimky pro jeřáby a další podmínky. Nesmějí vzniknout jednotné celobelgické hodiny. |
| UK | [Police Scotland](https://www.scotland.police.uk/contact-us/moving-an-abnormal-load/): uvádí špičková omezení nadrozměrných přeprav 06:30–09:30 a 15:30–18:30 v pracovní dny a individuální posouzení oznámení. [PSNI](https://www.psni.police.uk/safety-and-support/roads-and-driving/abnormal-loads) odkazuje na postup AL1 v Severním Irsku. [National Highways](https://nationalhighways.co.uk/roads-and-travel/freight-and-professional-drivers/abnormal-loads-and-the-esdal-system/notifying-an-abnormal-load-movement-offline/) poskytuje aktuální formuláře; starší stránka GOV.UK byla označena withdrawn. |
| PT | [Diário da República – konsolidovaná Portaria 281/2019](https://diariodarepublica.pt/dr/legislacao-consolidada/portaria/2019-168527126) a [novela 163/2021](https://diariodarepublica.pt/dr/detalhe/portaria/163-2021-168561725): ADR režim pro pevninské Portugalsko, rozdílné kategorie vozidel, časová/trasová omezení a výjimky. Nepřenáší se na Madeiru a Azory. |

## Co zůstává otevřené

Převedení nově přečtených podmínek na kalendářové události vyžaduje přesné
zpracování výjimek a testy jejich působnosti. Tato změna takový převod netvrdí.
Zůstává zejména úplný říjnový/listopadový rozpis ES, další zemské předpisy AT/DE,
Brusel, Wales a další policejní oblasti UK, portugalské ostrovní režimy a aktuální
mimořádná opatření. Dostupnost stránky se nezaměňuje za úplnost kontroly země.
Původní kanonické mezery jsou historickým stavem tohoto datasetu; nově načtené
podklady a jejich další zpracování jsou evidovány samostatně v cílené kontrole.

## Trvalé zapojení

- Existující čtvrteční úloha DAJC Driving Bans byla upravena bez změny rozvrhu
  (čtvrtek ráno 08:00 Europe/Prague) a bez založení nové úlohy. Zůstává read-only.
- Před sloučením čte jediný registr z aktuální hlavy PR #46; po sloučení z main.
  Starý seznam 104 nesmí spustit jako náhradní rozsah.
- Technický audit exportuje plán přesně pro centrální registr a aktuální plus
  následující měsíc. Seznam úředních podkladů není další seznam jurisdikcí.
- KZ/RU/TR vyžadují doloženou kategorii dálnice/hlavní silnice a identifikaci
  komunikace či úseku. Neověřená působnost není povolením k jízdě ani NO_BAN.
- Všech 182 původních pravidel, profily a jejich data ověření zůstaly zachovány.
  Opravena byla stará organizační poznámka ES o samostatných jurisdikcích
  Katalánska/Baskicka; migrační skript před zápisem vytvořil další zálohu.
- Main, release a produkční nasazení se nemění.
