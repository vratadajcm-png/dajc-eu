# NÁVRH — DAJC AI (bezplatný pracovní AI asistent): Privacy a Terms

> **ČEKÁ NA SCHVÁLENÍ PROVOZOVATELEM A ADVOKÁTEM. NEZVEŘEJŇOVAT.**
> Tento soubor není součástí webu. `src/pages/privacy.astro` ani
> `src/pages/terms.astro` se nemění. Texty níže se zveřejní samostatnou
> změnou až po schválení (krok L3 v `docs/DAJC_AI_B2C_LAUNCH.md`).
>
> Značky v textu:
> - **[PROVOZOVATEL]** — rozhodne provozovatel (vlastník DAJC),
> - **[ADVOKÁT]** — formulaci nebo právní posouzení musí potvrdit advokát,
> - **[OVĚŘIT U POSKYTOVATELE]** — údaj z obchodních podmínek / DPA
>   poskytovatele, který je nutné ověřit v aktuální smlouvě (nepředstírat).
>
> Text odpovídá implementaci v této větvi: bezplatná služba, 3 dotazy denně na
> ověřený e-mail, dobrovolný příspěvek nic neodemyká, nic se neprodává.
> Verze návrhu: 2026-11-08 (nahrazuje návrh fáze 1 z PR #78).

## A. Otevřené otázky pro provozovatele a advokáta

| # | Otázka | Kdo |
|---|---|---|
| 1 | **Správce údajů / provozovatel.** Web dnes uvádí fyzickou osobu Miroslav Dajč; produkty DAJC mají běžet pod Dajc s.r.o. Kdo je správcem a poskytovatelem služby DAJC AI? Sjednotit Privacy, Terms a patičku webu. | [PROVOZOVATEL] + [ADVOKÁT] |
| 2 | **Právní tituly:** čl. 6 odst. 1 písm. b) GDPR (poskytnutí služby na žádost uživatele) a písm. f) (ochrana před zneužitím, limity nákladů, bezpečnost). Potvrdit a doplnit balanční test pro f). | [ADVOKÁT] |
| 3 | **Informace vs. právní porada** (zák. č. 85/1996 Sb., stanovisko ČAK k AI): stačí systémová opatření (obecná pravidla se zdrojem, zákaz formulací „vy můžete / vám hrozí“, nepotvrzování průjezdnosti, povolení a výjimek, upozornění)? | [ADVOKÁT] |
| 4 | **Bezpečnost řidiče:** formulace upozornění na používání jen při bezpečném zastavení (zák. č. 361/2000 Sb., § 7 – zákaz držení telefonu za jízdy) a odpovědnost za používání za jízdy. | [ADVOKÁT] |
| 5 | **AI Act čl. 50** — stačí viditelné označení „Odpověď vytvořila AI…“ u každé odpovědi a na stránce? | [ADVOKÁT] |
| 6 | **Předávání do USA** (OpenAI, Anthropic, Perplexity, Resend; Vercel/Supabase podle smluv): DPF certifikace / standardní smluvní doložky, uzavřené DPA, doba uchování u poskytovatelů, zákaz trénování na API datech. | [OVĚŘIT U POSKYTOVATELE] + [ADVOKÁT] |
| 7 | **Spotřebitelské právo:** služba je zdarma, ale vyžaduje e-mail — jde o digitální službu „za osobní údaje“ (směrnice 2019/770, § 2389a a násl. OZ)? Co z toho plyne pro vady, odpovědnost a ukončení. | [ADVOKÁT] |
| 8 | **Omezení odpovědnosti** v mezích § 2898 OZ (nelze vyloučit újmu na zdraví, úmysl a hrubou nedbalost). | [ADVOKÁT] |
| 9 | **Doby uchování** v tabulce v části B. Kód dnes maže tokeny, relace, denní počty (35 dní) a záznamy proti zneužití (1 den) automaticky (`purgeExpired`), ale **otisk e-mailu drží do žádosti o výmaz** – automatické mazání po neaktivitě není implementované. Pokud má platit lhůta (např. 12 měsíců), je to malá změna kódu před zveřejněním textu. | [PROVOZOVATEL] |
| 10 | **Dobrovolné příspěvky** — potvrdit, že nejde o úplatu za službu (nic neodemykají), a daňové/účetní zařazení. | [ADVOKÁT] + účetní |
| 11 | **Jazykové verze** — služba je česky i anglicky; zveřejnit Privacy/Terms pro DAJC AI v obou jazycích? | [PROVOZOVATEL] |

---

## B. Privacy — návrh nové sekce (EN, jazyk webu)

### DAJC AI (free work assistant for truck drivers)

DAJC AI answers work questions of professional truck drivers about rules for
road, heavy and oversize transport in Europe (driving bans, road restrictions,
tolls, dimensions and weights, oversize permits), using DAJC's verified data
and official authority websites. **Controller:** [PROVOZOVATEL: Miroslav Dajč /
Dajc s.r.o., address, ID number], contact team@dajc.eu.

**Purposes and legal bases.**

| Purpose | Data | Legal basis |
|---|---|---|
| Sign-in and providing the service you ask for | e-mail address (only to send the sign-in link), keyed fingerprint of the address, session | Art. 6(1)(b) GDPR [ADVOKÁT] |
| Answering your question | text of the question (processed, not stored by DAJC) | Art. 6(1)(b) GDPR [ADVOKÁT] |
| Daily free limit, protection against abuse, cost limits, security | fingerprint, daily question count, fingerprints of IP address and e-mail per sign-in attempt | Art. 6(1)(f) GDPR — legitimate interest in keeping a free service available and secure [ADVOKÁT: balancing test] |
| Service quality and cost control | aggregated measurements without any user reference, question or answer | not personal data |
| Improving DAJC's verified data | official web addresses used as sources, without any user data | not personal data |

**Sign-in.** You sign in with a one-time link sent to your e-mail address. The
address is used only to send that link through our e-mail provider Resend.
DAJC does not store the address itself: it stores a keyed one-way fingerprint
(HMAC) of it, which recognises the same user and enforces the daily limit. A
strictly necessary session cookie (`dajc_ask_session`, HttpOnly, valid for 7
days, sent only to `/api/ask`) keeps you signed in. No analytics or
advertising cookies are used by DAJC AI.

**Your questions and the AI providers.** A question is processed only to
produce the answer; DAJC stores neither the question nor the answer. E-mail
addresses and phone numbers are removed automatically before processing.
Please do not include other personal data (names, registration plates,
locations of a specific vehicle). To produce the answer:

| Provider | What it receives | Role | Location / transfer |
|---|---|---|---|
| OpenAI | the question (after removal of e-mails and phone numbers) and the source texts — to understand the question and draft the answer from the sources; storage at the provider is disabled in the request (`store: false`) | processor [ADVOKÁT] | USA — [OVĚŘIT U POSKYTOVATELE: DPF / SCC, retention for abuse monitoring, e.g. up to 30 days] |
| Anthropic | the drafted statements, quotes and source excerpts — independent check; not the question itself | processor [ADVOKÁT] | USA — [OVĚŘIT U POSKYTOVATELE: DPF / SCC, retention] |
| Perplexity | short search keywords derived from the question, never the question itself | processor [ADVOKÁT] | USA — [OVĚŘIT U POSKYTOVATELE] |
| Resend | your e-mail address and the sign-in e-mail | processor | [OVĚŘIT U POSKYTOVATELE: region, DPF / SCC] |
| Supabase (database) | fingerprints, counters, sessions (no e-mail address, no questions) | processor | EU (Frankfurt, eu-central-1) [PROVOZOVATEL: project to be created in EU] |
| Vercel (hosting) | request data needed to run the service, as for the rest of the website | processor | functions in the EU (Frankfurt, `fra1`); [OVĚŘIT U POSKYTOVATELE: DPF / SCC for support access] |

The AI providers do not use API data to train their models
[OVĚŘIT U POSKYTOVATELE — confirm in each DPA before publication].

**What DAJC keeps.**

| Data | Purpose | Retention |
|---|---|---|
| E-mail fingerprint (HMAC) | recognise the user, daily limit | until you ask for erasure [PROVOZOVATEL: or at the latest 12 months after the last sign-in — requires the inactivity clean-up to be implemented first] |
| One-time sign-in token (hash) | sign-in | 15 minutes |
| Session (hash) | stay signed in | 7 days |
| Daily question count per fingerprint | daily free limit | 35 days |
| Fingerprints of IP address and e-mail per sign-in attempt | protection against abuse | 1 day |
| Aggregated measurement (answer level, language, path, cost, response time) without any user reference, question or answer | service quality and cost control | [PROVOZOVATEL: 24 months] |
| Official web addresses used as sources, without any user data | review of DAJC data | until reviewed |

**No automated decisions about you.** DAJC AI gives general information about
rules. It does not take decisions about you with legal or similarly
significant effects (Art. 22 GDPR), does not profile you and does not assess
your individual case.

**Your rights.** You have the right of access, rectification, erasure,
restriction of processing, data portability (for data processed under Art.
6(1)(b)) and the right to object to processing based on legitimate interest.
Write to team@dajc.eu from the address you use for DAJC AI; because DAJC does
not store the address, we use it only to compute the fingerprint and find
your data, and then discard it. You may also lodge a complaint with the
Czech Office for Personal Data Protection (Úřad pro ochranu osobních údajů,
Pplk. Sochora 27, 170 00 Praha 7, www.uoou.gov.cz) [ADVOKÁT: confirm address].

**Voluntary contributions** are processed by Revolut and Anycoin as described
above. DAJC does not link a contribution with your DAJC AI fingerprint,
questions or usage; a contribution changes nothing in DAJC AI.

---

## C. Terms — návrh nové sekce (EN, jazyk webu)

### DAJC AI (free work assistant for truck drivers)

1. **What it is.** DAJC AI is a free information service (beta) for
   professional truck drivers and transport staff. It answers questions about
   rules for road, heavy and oversize transport in Europe from DAJC's verified
   data and official authority websites. Every answer is labelled as
   AI-generated and shows its sources and the date they were checked.
   Provider: [PROVOZOVATEL].
2. **Free of charge.** Use is free. After signing in with your e-mail address
   you can ask up to [3] questions per day (Prague time); the free questions
   renew every day. You never have to pay to keep using DAJC AI.
   [ADVOKÁT: right to change the limit, with notice on the page.]
3. **Safety first.** Use DAJC AI only when the vehicle is safely stopped.
   Never use it while driving. Information from AI does not replace road
   signs, official regulations, permits or instructions from the competent
   authorities; they always take precedence. [ADVOKÁT]
4. **Information, not legal advice or authorisation.** Answers describe rules
   in general. They are not legal advice and do not assess any individual
   case. DAJC AI does not confirm that a route, road, bridge or tunnel is
   passable, that an oversize or abnormal transport is authorised or needs no
   permit, or that a legal exception applies; only the competent authority,
   the permit issued and the road signs on site can confirm that. Before any
   transport, check the current official source, your permit conditions and
   instructions from the competent authority. [ADVOKÁT]
5. **Answer levels.** VERIFIED: every statement is backed by a verified
   source. PARTIAL: every shown statement is backed, but the answer does not
   cover the whole question. INSUFFICIENT VERIFIED DATA: DAJC's legally
   verified data do not fully answer the question — missing information does
   not mean that there is no ban. DON'T KNOW: no answer could be verified.
   Statements marked "not verified by DAJC" come from official websites and
   are not a completed legal review.
6. **Availability.** The service is provided "as available" during beta. It
   has a cost limit and may pause until the limit resets (daily at midnight
   Prague time, monthly at the start of the month); it may change, be
   suspended or end. [ADVOKÁT: notice period for ending the service.]
7. **Fair use.** Do not include personal data in questions; do not automate,
   scrape or resell access; do not create several sign-ins to get around the
   daily limit; do not try to make the service produce content outside its
   purpose or to bypass its checks. DAJC may block access that breaks these
   rules. [ADVOKÁT]
8. **Voluntary contributions** under section 3 are never a condition of use,
   do not unlock additional questions, priority or features and do not create
   a subscription or any other contract for DAJC AI. [ADVOKÁT]
9. **Liability.** [ADVOKÁT: draft within mandatory consumer protection rules
   (§ 2898 OZ); DAJC is not liable for decisions taken on the basis of an
   answer without checking the official source, within the limits of law.]
10. **Ending use and your data.** You may stop using DAJC AI at any time and
    ask for erasure of your data at team@dajc.eu (see Privacy).
11. **Law and disputes.** [ADVOKÁT: Czech law; consumer out-of-court dispute
    resolution (ČOI, www.adr.coi.cz) if the service is a consumer contract.]

---

## D. Česká verze pro posouzení a případné zveřejnění

### Ochrana osobních údajů — DAJC AI

DAJC AI odpovídá na pracovní otázky profesionálních řidičů nákladních vozidel
k pravidlům silniční, těžké a nadrozměrné dopravy v Evropě z ověřených dat
DAJC a webů oficiálních úřadů. **Správce:** [PROVOZOVATEL], kontakt
team@dajc.eu.

- **Účely a právní tituly:** přihlášení a poskytnutí služby, o kterou žádáte
  (čl. 6 odst. 1 písm. b) GDPR); denní bezplatný limit, ochrana proti zneužití,
  limity nákladů a bezpečnost (čl. 6 odst. 1 písm. f) GDPR – oprávněný zájem
  na dostupnosti a bezpečnosti bezplatné služby) [ADVOKÁT]; anonymní měření
  kvality a nákladů (nejde o osobní údaje).
- **Přihlášení:** jednorázový odkaz na e-mail (Resend). DAJC e-mailovou adresu
  neukládá, jen její jednosměrný otisk (HMAC). Nezbytná session cookie
  `dajc_ask_session` na 7 dní. Žádné analytické ani reklamní cookies.
- **Dotazy a poskytovatelé AI:** dotaz ani odpověď DAJC neukládá; e-maily a
  telefonní čísla se z dotazu automaticky odstraní. Dotaz a texty zdrojů
  zpracuje OpenAI (porozumění a návrh odpovědi, ukládání u poskytovatele
  vypnuto), tvrzení se zdroji nezávisle zkontroluje Anthropic (bez samotného
  dotazu), Perplexity dostane jen krátká klíčová slova. Jde o předání do USA
  [OVĚŘIT U POSKYTOVATELE: DPF/SCC, doba uchování, zákaz trénování].
  Databáze (Supabase) a funkce (Vercel) běží v EU (Frankfurt).
- **Doby uchování:** otisk e-mailu do žádosti o výmaz [PROVOZOVATEL: případně
  nejdéle 12 měsíců od posledního přihlášení – vyžaduje doplnit mazání po neaktivitě]; přihlašovací token
  15 minut; relace 7 dní; denní počty 35 dní; záznamy proti zneužití 1 den;
  anonymní měření [PROVOZOVATEL: 24 měsíců]; oficiální URL zdrojů do kontroly.
- **Automatizované rozhodování:** DAJC AI o vás nerozhoduje, neprofiluje vás a
  neposuzuje váš konkrétní případ (čl. 22 GDPR).
- **Vaše práva:** přístup, oprava, výmaz, omezení zpracování, přenositelnost,
  námitka proti zpracování na základě oprávněného zájmu; napište na
  team@dajc.eu z adresy, kterou pro DAJC AI používáte. Stížnost můžete podat u
  Úřadu pro ochranu osobních údajů (www.uoou.gov.cz) [ADVOKÁT].
- **Dobrovolné příspěvky** zpracovává Revolut / Anycoin; DAJC je nespojuje s
  vaším otiskem, dotazy ani používáním DAJC AI a příspěvek v DAJC AI nic
  nemění.

### Podmínky používání — DAJC AI

1. **Co to je:** bezplatná informační služba (beta) pro profesionální řidiče a
   pracovníky v dopravě; odpovědi vytváří AI z ověřených zdrojů s označením
   AI, zdroji a datem ověření. Poskytovatel: [PROVOZOVATEL].
2. **Zdarma:** po přihlášení e-mailem až [3] dotazy denně (pražského času);
   bezplatné dotazy se obnovují každý den. Za další používání nikdy platit
   nemusíte.
3. **Bezpečnost:** DAJC AI používejte pouze při bezpečném zastavení vozidla.
   Informace AI nenahrazují dopravní značení, úřední předpisy, povolení ani
   pokyny příslušných orgánů; ty mají vždy přednost. [ADVOKÁT]
4. **Informace, ne právní porada ani povolení:** odpovědi popisují pravidla
   obecně a neposuzují konkrétní případ. DAJC AI nepotvrzuje průjezdnost
   trasy, oprávnění k nadrozměrné přepravě ani uplatnění právní výjimky;
   rozhoduje o tom příslušný úřad, vydané povolení a dopravní značení na
   místě. [ADVOKÁT]
5. **Úrovně odpovědí:** OVĚŘENO / ČÁSTEČNĚ / NEDOSTATEK OVĚŘENÝCH DAT
   (nedostatek informací neznamená, že zákaz neexistuje) / NEVÍM; tvrzení
   „neověřeno DAJC“ nejsou dokončenou právní kontrolou.
6. **Dostupnost:** beta „jak je“; při dosažení limitu nákladů se služba
   pozastaví do obnovení limitu (denní o půlnoci, měsíční na začátku měsíce);
   může se změnit, pozastavit nebo ukončit. [ADVOKÁT]
7. **Férové používání:** žádné osobní údaje v dotazech, žádná automatizace,
   scraping ani přeprodej, žádné obcházení denního limitu více přihlášeními,
   žádné pokusy obejít kontroly. [ADVOKÁT]
8. **Dobrovolné příspěvky** nejsou podmínkou používání, neodemykají další
   dotazy, přednost ani funkce a nevytvářejí předplatné ani jinou smlouvu.
9. **Odpovědnost:** [ADVOKÁT].
10. **Ukončení a výmaz:** používání můžete kdykoli ukončit a požádat o výmaz
    na team@dajc.eu.
11. **Rozhodné právo a spory:** [ADVOKÁT].
