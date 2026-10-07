import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const ACCESS_COOKIE = 'dajc_investor_access';
export const ACCESS_TTL = 8 * 60 * 60;
export const PRIVATE_HEADERS = {
  'Cache-Control': 'private, no-store, max-age=0',
  'CDN-Cache-Control': 'no-store',
  'Vercel-CDN-Cache-Control': 'no-store',
  'X-Robots-Tag': 'noindex, nofollow, noarchive, nosnippet',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
};

export function accessConfiguration() {
  const password = process.env.DAJC_INVESTOR_ACCESS_CODE ?? '';
  const hexKey = process.env.DAJC_INVESTOR_DOCUMENT_KEY ?? '';
  if (password.length < 16 || !/^[a-f0-9]{64}$/i.test(hexKey)) return null;
  const key = Buffer.from(hexKey, 'hex');
  const passwordHash = createHash('sha256').update(password).digest();
  // Domain separation and password binding make rotation revoke all sessions.
  const sessionKey = createHmac('sha256', key)
    .update('DAJC investor session v1\0').update(passwordHash).digest();
  return { key, passwordHash, sessionKey };
}

export function verifyAccessCode(candidate: string) {
  const config = accessConfiguration();
  if (!config || candidate.length > 256) return false;
  const hash = createHash('sha256').update(candidate).digest();
  return timingSafeEqual(hash, config.passwordHash);
}

export function issueAccessSession(now = Date.now()) {
  const config = accessConfiguration();
  if (!config) throw new Error('Investor access is unavailable');
  const payload = Buffer.from(JSON.stringify({
    scope: 'investor-pitch-deck',
    expires: Math.floor(now / 1000) + ACCESS_TTL,
    nonce: randomBytes(16).toString('hex'),
  })).toString('base64url');
  const signature = createHmac('sha256', config.sessionKey).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

export function hasAccessSession(token: string | undefined, now = Date.now()) {
  const config = accessConfiguration();
  if (!config || !token || token.length > 400) return false;
  const parts = token.split('.');
  if (parts.length !== 2 || !/^[A-Za-z0-9_-]+$/.test(parts[0]) || !/^[A-Za-z0-9_-]{43}$/.test(parts[1])) return false;
  const expected = createHmac('sha256', config.sessionKey).update(parts[0]).digest();
  const supplied = Buffer.from(parts[1], 'base64url');
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return false;
  try {
    const payload = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    const seconds = Math.floor(now / 1000);
    return payload.scope === 'investor-pitch-deck' && Number.isSafeInteger(payload.expires)
      && payload.expires > seconds && payload.expires <= seconds + ACCESS_TTL;
  } catch { return false; }
}

export function isSameOriginPost(request: Request) {
  const origin = request.headers.get('origin');
  return Boolean(origin && origin === new URL(request.url).origin);
}

// Secondary per-instance throttling; the random access code is not guessable.
// This does not claim a distributed rate limit or use the Partner Portal DB.
const attempts = new Map<string, { count: number; expires: number }>();
export function allowAccessAttempt(address: string, now = Date.now()) {
  for (const [ip, entry] of attempts) if (entry.expires <= now) attempts.delete(ip);
  let entry = attempts.get(address);
  if (!entry) {
    if (attempts.size >= 2000) return false;
    entry = { count: 0, expires: now + 10 * 60 * 1000 };
    attempts.set(address, entry);
  }
  return ++entry.count <= 10;
}

export function clearAccessAttempts(address: string) { attempts.delete(address); }
