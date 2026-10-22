# DAJC News conversion and publishing boundaries

The weekly news monitor, generator and editorial verification are documented
in NEWS_AUTOMATION.md. The weekly generator currently creates a reviewed PR,
and the owner-approved PR + CI gate is required before an article can be
included in the public site (MAIN_PROTECTION.md).

New `.github/workflows/prepare-news-social.yml` prepares automatic channel
variants every Friday after the site's 12:00 Europe/Prague release, on
approved News merges into main, and on explicit workflow_dispatch.
The resulting X and company LinkedIn drafts are kept as a GitHub Actions
artifact for 14 days. The generator ignores drafts, future releases and
articles older than 8 days. It does not use any AI API, spend on social
services or post to a social channel. Original published articles remain
unchanged.

**What still prevents fully automatic publication?**

1. Weekly article approval: the established ruleset and editorial review
   require owner-reviewed PR merging into main. Removing the human gate
   requires a separately approved change to MAIN_PROTECTION.md and associated
   release governance, not a hidden workaround.
2. X API: the existing official publisher only targets the weekly edition,
   with verified @DAJCeu token, four GitHub secrets, an explicit
   DAJC_X_ENABLED variable and a separate fail-closed de-duplication ledger.
   Article types other than EU Oversize Weekly do not post automatically.
3. LinkedIn: a separate company-page posting integration and
   w_organization_social authorization are needed. The founder's personal
   LinkedIn account must not be used as the company page or automatic fallback.
4. Do not post sponsored copy or paid article content as independent editorial
   without conspicuous labelling and the review of the actual commercial terms.

No secret values are logged or stored by the draft generator.
