# W47 editorial audit — 16 November 2026

This records the withdrawn draft, not a new approval or a finding that no current
W47 news exists. Any replacement needs fresh source verification and a new
independent Claude approval of its exact bytes.

## Evidence inspected

- Main at the start of this audit: `88f4f522e903fd32302e23bb5aa16ba65458176c`.
- Scope proposal [PR #89](https://github.com/vratadajcm-png/dajc-eu/pull/89): its
  relevant specification, writer, classifier, transport-context and test changes
  are already incorporated in main by `2037448`. The old branch is not a safe
  replacement for current main and does not need a wholesale merge.
- Withdrawn [PR #130](https://github.com/vratadajcm-png/dajc-eu/pull/130), draft
  commit `81460dd0eb04c5824c8b0be6944b5a86f5611db0`, including its W46 findings
  and coverage data. It was already closed without merge before this audit.
- [Generation run 43207967888](https://github.com/vratadajcm-png/dajc-eu/actions/runs/43207967888),
  [job 131147863119](https://github.com/vratadajcm-png/dajc-eu/actions/runs/43207967888/job/131147863119).
  The job checked all 50 jurisdictions, selected 14 of 46 candidates and rendered
  two reports. A reachability check did not establish their factual/legal
  correctness. Claude vetoed both at `2026-11-12T11:23:39Z`; no release merge ran.

## Blocking claims in the withdrawn draft

| Report | Source evidence and blocking issue | Safe disposition |
| --- | --- | --- |
| Austria tolls and permits | [Parliament report](https://www.parlament.gv.at/aktuelles/pk/jahr_2025/pk1046), dated 20 November 2025. The report records a Nationalrat vote, not evidence of all further legislative stages or current entry into force. The 1 December 2026 date concerns the digital vignette, not a verified effective date for the truck toll tariff or every goods-transport permit. The draft generalized CEMT system modernization and included unrelated lock-operation language. | Remove these claims. A future report needs current competent-authority evidence for each actual toll/permit change, dates, vehicle categories and exceptions. A fresh discovery or an upcoming vignette date does not make an old truck-toll assertion current. |
| Italy ROADPOL checks | [Trasporti Italia](https://www.trasporti-italia.com/camion/controlli-polizia-mezzi-pesanti-dal-16-al-22-novembre/1523438/), dated 23 October 2026, describes 16–22 November checks but is a trade relay, not the police/ROADPOL notice. The reviewed evidence did not support special-transport framing or an over-12-t threshold. | Do not reuse the rejected wording. Recheck a first-hand authority announcement and report only its actual dates, scope and focus. Ordinary enforcement can be relevant to the approved broader audience, but that editorial scope is no proof of any legal limit or campaign applicability. |

The draft's title/description/introduction also imposed an unsupported
over-12-t scope. The approved audience is **commercial goods vehicles and
combinations at or above 3.5 t, including exactly 3.5 t, that use a tachograph**.
That definition must never replace an individual source's actual legal threshold,
exemptions, vehicle classes or route scope.

## Replacement requirements

The covered ISO week is `2026-W47` (16–22 November). Its planned release was
13 November 2026 at 12:00 Europe/Prague (`11:00Z`). A replacement prepared after
that instant must retain that planned slot separately and disclose the late
preparation. Its actual deployment/public availability needs a separate
observation; it must not appear to have been published on time.

Preserve PR #130 and its commit as the rejection audit. A new attempt must use a
new identity and repeat deterministic checks, current-source review, exact-byte
Claude approval, required GitHub CI and protected merge. It must never overwrite
an already published final edition or reuse the rejected article as approved.
There is no minimum report count: even one qualified development can form a
short edition; zero verified developments means a blocked publication.

This document does not certify API access, a replacement article, a successful
merge, Vercel deployment or public availability. Those require separate live
evidence from the replacement run and the public domain.
