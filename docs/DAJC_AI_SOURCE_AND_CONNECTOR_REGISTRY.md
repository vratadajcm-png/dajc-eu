# DAJC AI — Official Source and Connector Registry
Revision 2026-11-10 · Developer-facing reference; **not a claim of complete verified coverage**.

Reference: [DAJC AI Build Source Map](DAJC_AI_BUILD_SOURCE_MAP.md) and [AI canonical draft master](https://docs.google.com/document/d/1gP65j89QtZCvtoLBVNrCLH0gJDkuC8h-YryYYBs4lP8/edit). The original library is [DAJC AI Official European Road Transport Library](https://drive.google.com/drive/folders/1l-saHoPA3_hszCR3HetX9dN2uJaLGXsi); registered or scraped web pages are discovery only until verified and ingested.

## External sources / connector families
| ID | Official/source family | Domain/question | Build scope and acceptance gate |
|---|---|---|---|
| AI-S01 | [EUR-Lex](https://eur-lex.europa.eu/) | consolidated EU transport law (561/2006, 165/2014, 1071/2009, 1072/2009, ADR applicability and amendments) | CELEX, article, language, temporal validity, official version/hash, approved text reuse |
| AI-S02 | [European Commission Transport](https://transport.ec.europa.eu/) | mobility, eFTI, international road rules | EU/regulatory chronology and **current** implementation dates; general guidance does not override legislation |
| AI-S03 | [EU eFTI legal/implementation pages](https://transport.ec.europa.eu/transport-themes/logistics-and-multimodal-transport/efti-regulation_en) | document data exchange | do not declare DAJC eFTI certified |
| AI-S04 | [UNECE](https://unece.org/transport) | ADR and TIR text sources | legal edition, applicable parties/countries and entry-into-force; annexes/authorities |
| AI-S05 | [European Commission Customs](https://taxation-customs.ec.europa.eu/) | transit/customs NCTS, AES, ICS2, TIR | actual authority role and customs office, no customs clearance claims |
| AI-S06 | [EU road-data NAP / DATEX II](https://datex2.eu/) | official traffic event, roads/closures/restrictions | per publisher, profile, precise road network, event age, licence and source reference |
| AI-S07 | Czech official law/publisher: [e-Sbírka](https://www.e-sbirka.cz/), [ŘSD/NDIC](https://ndic.cz/) | CZ trucks, restrictions, roadworks | verify primary legal text, regional exception, official DATEX publication and usage rights |
| AI-S08 | German official law: [Gesetze im Internet](https://www.gesetze-im-internet.de/), [Autobahn](https://www.autobahn.de/) | Germany rules, restrictions, traffic | time-specific law, per-Land and traffic event distinction |
| AI-S09 | Austrian official law: [RIS](https://www.ris.bka.gv.at/), [ASFINAG](https://www.asfinag.at/) | Austrian rules and restrictions | local rule and temporary restrictions separately |
| AI-S10 | UK [legislation.gov.uk](https://www.legislation.gov.uk/) | official UK Acts/Regulations/vehicle restrictions | XML/Atom feeds, CE/region/extent/version/commencement, source ID validation and amendment chain |
| AI-S11 | national legal journals/transport ministries of all tracked jurisdictions | local bans, truck profiles, exemptions and temporary exceptions | **50-jurisdiction operational set** from current DAJC registry; no inherited 104-country claim |
| AI-S12 | [DAJC Driving Bans canonical registry](DRIVING_BANS_CANONICAL.md) | scoped forward bans/exceptions | observed != verified; 12-month rolling horizon, weekly review; every country/vehicle/time independently verified |
| AI-S13 | official police/road authorities and permit portals (e.g. VEMAGS, ESDAL, SOTRA) | abnormal-load applications and authority decisions | information and referral only; no auto permit/route clearance without official authorization |
| AI-S14 | official GNSS/Galileo, [EUSPA](https://www.euspa.europa.eu/) | positioning and accuracy explainers | this is reference info, no automatic customer telemetry; safety flags |
| AI-S15 | official rest/parking information and public DATEX/NAP | driver rest and suitability | parking capacity and route availability separate from legal 561/2006 obligation |
| AI-S16 | official weather/meteorological providers | transport weather alerts | source freshness/coverage, not permit/safety guarantee |
| AI-S17 | original OEM and approved technical information portals | vehicle specs/recall/technical procedures | only within permitted user/data rights, AI hints not authoritative manufacturer approval |
| AI-S18 | [DAJC official website](https://www.dajc.eu/news) | secondary DAJC weekly news | discovery and explanation only; cannot be used as evidence of law, current ban or permit |
| AI-S19 | licensed external AI/search model provider APIs | language/query routing, NOT legal authority | no hallucinated citations, privacy/PII controls and per-provider measured budgets |
| AI-S20 | private Google Drive official library | controlled originals, archives, legal review queue | no automatic external model access to all user/internal Drive files; review and selective ingest |

## Official-source record acceptance
Source must have stable `publisher`, `official_uri`, `version/effective_from/effective_to`, `retrieved_at`, `last_human_or_qualified_review_at`, `jurisdiction`, `vehicle_class`, `source_type`, `sha256`, `rights_status`, `origin_asset`, `extraction_version`, `passage_id` and `citable` with precise support. At least date/jurisdiction/vehicle class filter, policy for conflicting sources and explicit UNKNOWN/UNVERIFIED. Exact PDF/HTML/XML original remains the evidence record; OCR, embeddings and LLM summary are derivatives only.

## Field-level authority
- A national statute is an authority for its legal scope; a traffic DATEX message is an **observation** of a road event, not a statutory exemption. Neither is a signed abnormal-load permit.
- One road-sign or motorway feed may be authoritative only for the covered road segment. A national publisher != coverage of every regional road or border. Resolve geospatial scope and units.
- A synthesized answer must include link to primary publisher and article/passage, relevant date, vehicle scope, uncertainty and method used to verify. Avoid false completeness claim when 50 jurisdictions are only being monitored.
- Personal question text, VIN, RZ, location and private uploads are not sent to search/LLM providers unless necessary, minimized, and covered by an explicit privacy/contract decision.

## Implementation rules
Develop source adapters behind a versioned retrieval interface: `discover → fetch with rate/robots/access policy → integrity/hash → extract with layout/official metadata → review and validity → persist origin + passages → index → retrieve → cite/evaluate`. For each source write mock fixtures, malicious identifier/path traversal cases (esp. UK XML), missing link, expired statute, non-existent article, unknown vehicle class, conflicting regulation, source unavailable, blocked licence, cost cap, non-overridden approved state and cross-user isolation.

All documentation must distinguish **supported protocol** from **discovered endpoint**, **tested authenticated sandbox** and **production authority**. Live official research needs current URLs, provider documents and licences; don't assume mail/Drive permissions in Claude Code. If missing a source, create `OWNER_DECISION_REQUIRED` with the exact agency/provider issue and continue other safe work.

No legal source is newly downloaded or licensed by this markdown file.
