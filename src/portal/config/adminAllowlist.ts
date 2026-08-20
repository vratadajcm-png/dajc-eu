// DAJC staff allowed to sign into the Partner Portal admin. Deny-by-default:
// an empty/missing allowlist means nobody can log in as admin, not "anyone
// can". Magic-link requests for emails outside this list are silently
// treated the same as "email not found" (no user enumeration - see
// docs/PARTNER_PORTAL.md security notes).
function parseAllowlist(): Set<string> {
  const raw = process.env.DAJC_PARTNER_ADMIN_ALLOWLIST ?? '';
  return new Set(
    raw
      .split(',')
      .map((email) => email.trim().toLowerCase())
      .filter((email) => email.length > 0)
  );
}

export function isAllowlistedAdmin(email: string): boolean {
  return parseAllowlist().has(email.trim().toLowerCase());
}
