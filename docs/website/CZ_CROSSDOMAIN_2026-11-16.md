# DAJC.cz / DAJC.eu content split (draft, not deployed)

- English site: `dajc.eu`. Czech landing, Platform, TAR, testing and demo pages: `dajc.cz`.
- Canonical URLs remain on each respective host. Equivalent page pairs have reciprocal language alternates.
- Public registration for Platform pre-production testing: Q3 2027, exact date not confirmed; never market it as a separate pilot, early access, or live service.
- TAR is research/development only; no assistance dispatch is offered to the public.
- Czech forms call the existing, allowlisted DAJC.eu endpoints. No database or secrets are added to dajc.cz. The market-research endpoint only accepts origins on the explicit list; preflight support is required for browsers.
- `/api/market-research` must remain production-gated on the current database/privacy controls. Any service outage must present an error and not imply delivery.
- Validate cross-host CORS, CSP, Czech form delivery, English/Czech reciprocal SEO tags, mobile keyboard navigation and accessibility after the staged PR stack is approved.
- Do not merge/deploy or activate newsletter infrastructure as part of this draft.
