# Private investor documents

`/investor/pitch-deck` serves the English investor deck in PDF and PowerPoint.
The page and both download endpoints render on demand. No public navigation
links to this area; the sitemap excludes it and all responses use `noindex`
and `no-store`. These discovery controls complement server-side access checks.

Two server-only Vercel secrets are required:

- `DAJC_INVESTOR_ACCESS_CODE`: a randomly generated access code, at least 16
  characters, shared directly with selected investors.
- `DAJC_INVESTOR_DOCUMENT_KEY`: an independent random 32-byte AES key encoded
  as 64 hexadecimal characters. Never share this key with investors.

Do not prefix either variable with `PUBLIC_`, commit its value, put it in a URL,
or log it. Without both secrets, the page fails closed. The download handler
independently verifies access before reading files. Signed sessions expire
after eight hours. Access-code rotation invalidates existing sessions in new
deployments. Sign-out removes the browser cookie; it does not revoke a copy
of that session elsewhere. The login has same-origin validation and secondary
per-instance attempt throttling, without a new database dependency.

The repository is public. Only AES-256-GCM encrypted envelopes belong under
`private/investor/`; never place a readable PDF/PPTX under `public/`, in a
GitHub release, or anywhere in repository history. The Vercel adapter explicitly
bundles the two encrypted files in the server function. They are not static
assets. Encryption uses a 12-byte nonce, 16-byte authentication tag and AAD
`DAJC:investor:<pdf|pptx>:2026-10-07:v2`. The envelope is `DAJC1`, nonce, tag,
then ciphertext. GCM authentication completes before plaintext is streamed.

Vercel response streaming is required for the PDF, which exceeds the normal
4.5 MB function-response limit. The existing Astro adapter enables it. Verify
unauthenticated denial, successful access, both downloaded SHA-256 hashes,
no public static copies and no caching after every update. Do not promote
if either file is publicly accessible without the investor session.

This is shared-code access, not per-investor identity verification. An investor
can forward the code or a downloaded file. Share the code only with intended
recipients; change it and redeploy when access should be revoked.
