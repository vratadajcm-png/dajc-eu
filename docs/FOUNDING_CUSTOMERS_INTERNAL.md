# DAJC Founding Customers — internal functional sandbox

**Status:** Internal preview only. Not a sellable product, not publicly launched.

## Access controls

- The route is `/internal/founding-customers` in a **Vercel preview deployment**, not on production DAJC.eu.
- Preview deployments are protected by Vercel Authentication (SSO); do not disable protection.
- The route is rendered on demand and sets HTTP 404 unless `VERCEL_ENV=preview` or Astro development mode. Response includes `X-Robots-Tag: noindex, nofollow, noarchive`; HTML includes a robots meta via BaseLayout.
- This branch should **remain a draft PR**. Do not merge it into `main` without explicit owner approval and full commercial readiness review.

## Internal QA scenarios

Use only synthetic companies/contacts and test@example.invalid. No bank/card details.

1. Open the protected preview URL and select Platform (€199), TAR (€299) and bundle (€399), one at a time. Check that dates and pricing follow each choice.
2. Try blank or malformed required company fields; the flow should prevent advancing.
3. Fill synthetic B2B company details, read draft reservation principles and check both required demo acknowledgements.
4. Simulate DECLINED payment. It must remain on checkout and NOT create an order.
5. Simulate CANCELED payment. It must return to review with no order.
6. Simulate SUCCESS payment. Dashboard must display a `DEMO-` ID, `SIMULATED PAID`, the selected product, correct indicative credit and `NOT ACTIVE` licence.
7. Preview the simulated confirmation email, and download a `TEST-NOT-INVOICE.txt` receipt. Neither is actually sent or a tax document.
8. Refresh the page within the same browser tab; the demo should retain its mock state in `sessionStorage`.
9. Simulate refund: the dashboard must change to `SIMULATED REFUNDED`, and the mock credit must become zero. Repeat refund cannot duplicate it.
10. Clear the test and start again. No real customer/order data should have been stored by DAJC.
11. Verify production `https://www.dajc.eu/internal/founding-customers` remains inaccessible (404), and the public homepage, navigation and /pricing contain no internal offer.

## Scope

This is a browser-only demonstration, including plans, mock validation, mock checkout outcomes, client-side dashboard, confirmation preview/download and refund simulation.

**Not present:** payment provider checkout or real charge, merchant account review, server-side reservation persistence, payment callbacks or idempotency, authentication, email dispatch, legally binding terms, real invoice/refund, KYC/VAT invoicing, customer entitlements and production subscriptions.

## Production activation checklist (do not skip)

- Identify verified legal seller and merchant account, business and tax registration and insolvency implications; obtain professional review where required.
- Approve detailed B2B agreement: purchased entitlement and product specification, guaranteed testing wave vs target date, a binding long-stop deadline, refund procedure, changes/delay, company eligibility, governing law, VAT and currency terms, personal-data processing.
- Decide whether reservation amounts are fully refundable (funding implications), and define the 50-customer programme capacity if retained.
- Create separate Revolut or other merchant product-specific payment links, plus server-side payment order creation, signed webhook verification, idempotency, refund processing and transaction reconciliation.
- Restore access to a persistent database with tenant isolation and backup, record reservation/consents/terms version, credit ledger and invoice/refund lifecycle.
- Add authenticated customer area, transactional email templates, testing invitations, audit trail and support/incident procedure.
- Run end-to-end tests using the **payment provider's official sandbox**, including failed, canceled, duplicate and refund flows.
- Only after explicit approval, create production-specific release with marketing/legal/financial reviews and merchant confirmation. No public offer/charge before this gate.

## Draft business assumptions

- Platform: indicative one-time €199, planned pre-production testing Q3 2027.
- TAR: indicative one-time €299, **tentative** Q1 2028.
- Both: indicative one-time €399; two products remain independent.
- The proposal is to credit the reservation toward future software invoices. Production software subscriptions start on commercial activation, not during testing.
- Existing free Platform testing registrations are separate and should not be displaced.
