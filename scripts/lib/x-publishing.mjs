import { createHmac, randomBytes } from 'node:crypto';
import { isoWeekLabel } from './week.mjs';
import { publicationSlotFor, targetWeekDateFor } from './next-publication.mjs';

export const X_ACCOUNT = 'DAJCeu';
export const X_API_URL = 'https://api.x.com';
export const SITE_ORIGIN = 'https://www.dajc.eu';

// Only share the edition for the most recent Friday, not old back-catalogue.
export function currentPublication(now = new Date()) {
  const slot = publicationSlotFor(now);
  const age = now.getTime() - slot.getTime();
  if (age < 0 || age > 48 * 60 * 60 * 1000) return null;
  const week = isoWeekLabel(targetWeekDateFor(slot));
  const slug = `eu-oversize-weekly-${week.toLowerCase()}`;
  return { slug, slot, url: `${SITE_ORIGIN}/news/eu-oversize/${slug}` };
}

export function frontmatterFields(markdown) {
  const block = markdown.match(/^---\s*\r?\n([\s\S]*?)\r?\n---(?:\s*\r?\n|$)/)?.[1];
  if (!block) throw new Error('Missing article frontmatter');
  const result = {};
  for (const line of block.split(/\r?\n/)) {
    const matched = line.match(/^([a-zA-Z][a-zA-Z0-9]*):\s*(.*)$/);
    if (!matched) continue;
    let val = matched[2].trim();
    if (val.startsWith('"') && val.endsWith('"')) {
      try { val = JSON.parse(val); } catch { val = val.slice(1, -1); }
    } else if (val.startsWith("'") && val.endsWith("'")) {
      val = val.slice(1, -1).replace(/''/g, "'");
    }
    result[matched[1]] = val;
  }
  return result;
}

export function validateArticle(fields, publication, now = new Date()) {
  if (fields.status !== 'published' || fields.category !== 'eu-oversize' || fields.slug !== publication.slug) {
    throw new Error('Article status, category or slug does not match the eligible published edition');
  }
  const date = new Date(fields.publishedAt);
  if (!fields.title || !Number.isFinite(date.getTime()) || date.getTime() > now.getTime()) {
    throw new Error('Article is missing a valid title or is not yet published');
  }
  // Reject stale, misdated content; legitimate Friday slots are 12:00 Prague.
  if (Math.abs(date.getTime() - publication.slot.getTime()) > 3 * 60 * 60 * 1000) {
    throw new Error('Article publication date does not match the expected Friday release');
  }
  return { title: fields.title, url: publication.url, slug: publication.slug };
}

export function buildPostText(article) {
  const prefix = '🚛 ';
  const suffix = `\n\nVerified updates for heavy and oversized transport in Europe.\n${article.url}`;
  const maxLength = 265; // headroom for X's URL/emoji weighting rules
  const available = maxLength - Array.from(prefix + suffix).length;
  if (available < 20) throw new Error('Article URL is too long for a post');
  const title = Array.from(article.title);
  const headline = title.length > available ? title.slice(0, available - 1).join('').trimEnd() + '…' : article.title;
  return prefix + headline + suffix;
}

export function postingDecision(record) {
  if (!record) return 'new';
  if (record.status === 'published') return 'already-published';
  if (record.status === 'pending') return 'manual-reconciliation-required';
  throw new Error('Invalid X publishing ledger state');
}

const encode = (input) => encodeURIComponent(String(input)).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

export function oauth1Header(method, url, credentials, nonce = randomBytes(16).toString('hex'), timestamp = String(Math.floor(Date.now() / 1000))) {
  const params = {
    oauth_consumer_key: credentials.apiKey,
    oauth_nonce: nonce,
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: timestamp,
    oauth_token: credentials.accessToken,
    oauth_version: '1.0',
  };
  const parsed = new URL(url);
  const pairs = [...Object.entries(params), ...parsed.searchParams.entries()]
    .map(([key, value]) => [encode(key), encode(value)])
    .sort(([ak, av], [bk, bv]) => ak.localeCompare(bk) || av.localeCompare(bv));
  const normalized = pairs.map(([k, v]) => `${k}=${v}`).join('&');
  const baseUrl = parsed.origin + parsed.pathname;
  const signatureBase = [method.toUpperCase(), encode(baseUrl), encode(normalized)].join('&');
  const key = `${encode(credentials.apiSecret)}&${encode(credentials.accessTokenSecret)}`;
  const signature = createHmac('sha1', key).update(signatureBase).digest('base64');
  return 'OAuth ' + Object.entries({ ...params, oauth_signature: signature })
    .map(([key, value]) => `${encode(key)}="${encode(value)}"`).join(', ');
}

export function readXCredentials(env = process.env) {
  const credentials = {
    apiKey: env.X_API_KEY,
    apiSecret: env.X_API_SECRET,
    accessToken: env.X_ACCESS_TOKEN,
    accessTokenSecret: env.X_ACCESS_TOKEN_SECRET,
  };
  if (Object.values(credentials).some((value) => typeof value !== 'string' || !value.trim())) {
    throw new Error('Missing X API credentials; configure all four GitHub Actions secrets');
  }
  return credentials;
}

export async function checkPublicArticle(url, expectedTitle, fetchFn = fetch) {
  const result = await fetchFn(url, { redirect: 'error', signal: AbortSignal.timeout(12000), headers: { 'Cache-Control': 'no-cache' } });
  if (result.status === 404) return false; // not deployed yet; next scheduled run will retry
  if (!result.ok) throw new Error(`Article readiness check failed: HTTP ${result.status}`);
  if (!(result.headers.get('content-type') || '').includes('text/html')) {
    throw new Error('Article readiness check did not return HTML');
  }
  const html = await result.text();
  if (!html.includes(expectedTitle.slice(0, 18))) {
    throw new Error('Public article page did not contain the expected title');
  }
  return true;
}

async function xRequest(method, endpoint, credentials, payload, fetchFn = fetch) {
  const url = `${X_API_URL}${endpoint}`;
  const response = await fetchFn(url, {
    method,
    headers: {
      Authorization: oauth1Header(method, url, credentials),
      Accept: 'application/json',
      ...(payload ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(payload ? { body: JSON.stringify(payload) } : {}),
    signal: AbortSignal.timeout(15000),
    redirect: 'error',
  });
  if (!response.ok) throw new Error(`X API ${method} ${endpoint} returned HTTP ${response.status}; manual reconciliation may be necessary`);
  return response.json();
}

export async function checkXAccount(credentials, fetchFn = fetch) {
  // Prevent inadvertently posting from the founder's personal X account.
  const me = await xRequest('GET', '/2/users/me', credentials, null, fetchFn);
  if (me?.data?.username?.toLowerCase() !== X_ACCOUNT.toLowerCase()) {
    throw new Error('Authorized X account is not @DAJCeu; refusing to publish');
  }
}

export async function publishToX(text, credentials, fetchFn = fetch) {
  await checkXAccount(credentials, fetchFn);
  const result = await xRequest('POST', '/2/tweets', credentials, { text }, fetchFn);
  const id = result?.data?.id;
  if (!/^\d+$/.test(String(id ?? ''))) throw new Error('X API success response contained no post ID; manual reconciliation required');
  return { id, url: `https://x.com/${X_ACCOUNT}/status/${id}` };
}
