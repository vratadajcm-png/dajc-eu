// Secondary, per-instance throttling (same approach as src/investor/access.ts):
// it does not survive cold starts or span instances, so it only blunts
// scripted abuse of the acknowledgement email. A real distributed limit
// or a CAPTCHA (Turnstile) is still required before RESEND_API_KEY is set
// in production - see audit DAJC-SEC-AUDIT-2026-10, F-08.
const PER_ADDRESS_LIMIT = 5;
const PER_ADDRESS_WINDOW_MS = 60 * 60 * 1000;
const INSTANCE_DAILY_LIMIT = 200;
const attempts = new Map<string, { count: number; expires: number }>();
let instanceDay = '';
let instanceCount = 0;

export function allowRegistrationAttempt(address: string, now = Date.now()) {
  const day = new Date(now).toISOString().slice(0, 10);
  if (day !== instanceDay) {
    instanceDay = day;
    instanceCount = 0;
  }
  if (instanceCount >= INSTANCE_DAILY_LIMIT) return false;
  for (const [key, entry] of attempts) if (entry.expires <= now) attempts.delete(key);
  let entry = attempts.get(address);
  if (!entry) {
    if (attempts.size >= 5000) return false;
    entry = { count: 0, expires: now + PER_ADDRESS_WINDOW_MS };
    attempts.set(address, entry);
  }
  if (entry.count >= PER_ADDRESS_LIMIT) return false;
  entry.count += 1;
  instanceCount += 1;
  return true;
}
