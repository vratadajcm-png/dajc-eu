// Secure, single-use token handling shared by invitations, login links and
// sessions. Uses only Node's built-in crypto - no bespoke cryptography.
//
// Convention enforced everywhere in the portal: the RAW token is returned
// exactly once (to embed in an email link or a cookie) and is never
// persisted. Only `hashToken(raw)` is stored, so a database read can never
// leak a usable credential.
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';

// 256 bits of entropy, URL-safe base64url encoding (no padding).
const TOKEN_BYTES = 32;

export function generateSecureToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}

export function hashToken(rawToken: string): string {
  return createHash('sha256').update(rawToken, 'utf8').digest('hex');
}

// Constant-time comparison of two hex digests, defense-in-depth against
// timing side channels even though the DB lookup is itself an equality
// index lookup, not a loop-compared secret.
export function hashesEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'hex');
  const bufB = Buffer.from(b, 'hex');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
