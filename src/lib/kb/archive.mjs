// Private archive of original official documents for the DAJC legal library.
//
// One small interface, three implementations, so the store can move between
// Cloudflare R2 (EU jurisdiction), AWS S3 or any other S3-compatible service
// without touching the importer:
//   put(key, bytes, { contentType, sha256 }) -> { key }
//   get(key) -> Uint8Array | null   (content checked against its SHA-256)
//   has(key) -> boolean
// Objects are content-addressed (the SHA-256 is part of the key) and never
// overwritten, so a stored original can always be proven unchanged.
//
// Nothing here creates buckets or accounts. An S3-compatible archive is used
// only when the owner configures one (docs/DAJC_AI_LEGAL_LIBRARY.md).

import { createHash, createHmac } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';

export function sha256Hex(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function slug(value) {
  return String(value).normalize('NFKD').replace(/[^\w.-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'document';
}

/** Content-addressed key: <jurisdiction>/<document>/<language>/<sha256>.<ext> */
export function archiveKey({ jurisdiction, officialNumber, language, sha256, extension = 'pdf' }) {
  if (!/^[0-9a-f]{64}$/.test(sha256 || '')) throw new Error('archiveKey: sha256 must be 64 hex characters');
  if (!/^[a-z]{2}$/.test(language || '')) throw new Error('archiveKey: language must be ISO 639-1');
  return `${slug(jurisdiction)}/${slug(officialNumber)}/${language}/${sha256}.${slug(extension)}`;
}

function assertKey(key) {
  if (typeof key !== 'string' || !/^[\w.-]+(\/[\w.-]+)*$/.test(key) || key.includes('..')) throw new Error(`archive: invalid key ${key}`);
}

function checked(key, bytes) {
  const match = key.match(/([0-9a-f]{64})\.[\w-]+$/);
  if (match && sha256Hex(bytes) !== match[1]) throw new Error(`archive: content of ${key} does not match its SHA-256`);
  return bytes;
}

export class MemoryArchive {
  constructor() {
    this.objects = new Map();
  }
  async put(key, bytes, { sha256 } = {}) {
    assertKey(key);
    if (sha256 && sha256Hex(bytes) !== sha256) throw new Error('archive: SHA-256 mismatch on put');
    if (!this.objects.has(key)) this.objects.set(key, Uint8Array.from(bytes));
    return { key };
  }
  async get(key) {
    assertKey(key);
    const bytes = this.objects.get(key);
    return bytes ? checked(key, bytes) : null;
  }
  async has(key) {
    return this.objects.has(key);
  }
}

/** Local directory (development, tests, an offline mirror). */
export class LocalFsArchive {
  constructor(root) {
    this.root = resolve(root);
  }
  path(key) {
    assertKey(key);
    const full = resolve(join(this.root, key));
    if (!full.startsWith(this.root + sep)) throw new Error('archive: key escapes the archive root');
    return full;
  }
  async put(key, bytes, { sha256 } = {}) {
    if (sha256 && sha256Hex(bytes) !== sha256) throw new Error('archive: SHA-256 mismatch on put');
    const file = this.path(key);
    if (await this.has(key)) return { key };
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, bytes, { flag: 'wx', mode: 0o640 });
    return { key };
  }
  async get(key) {
    try {
      return checked(key, new Uint8Array(await readFile(this.path(key))));
    } catch (error) {
      if (error?.code === 'ENOENT') return null;
      throw error;
    }
  }
  async has(key) {
    try {
      await stat(this.path(key));
      return true;
    } catch {
      return false;
    }
  }
}

// --- AWS Signature Version 4 (S3-compatible stores: R2, S3, MinIO, ...) -----

function hmac(key, data) {
  return createHmac('sha256', key).update(data, 'utf8').digest();
}

function encodeRfc3986(value) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

/**
 * Signs a request with AWS Signature Version 4 and returns the headers to send
 * (including Authorization). Checked against the AWS SigV4 test suite.
 * `payloadHash` defaults to the SHA-256 of `body`.
 * @param {{ method: string, url: string, headers?: Record<string, string>, body?: string | Uint8Array, payloadHash?: string,
 *           region: string, service: string, credentials: { accessKeyId: string, secretAccessKey: string }, date?: Date }} input
 * @returns {Record<string, string>}
 */
export function signV4({ method, url, headers = {}, body = '', payloadHash, region, service, credentials, date = new Date() }) {
  const u = new URL(url);
  const amzDate = headers['x-amz-date'] || date.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const day = amzDate.slice(0, 8);
  const all = { ...Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v])), host: headers.host || u.host, 'x-amz-date': amzDate };
  const names = Object.keys(all).sort();
  const canonicalHeaders = names.map((n) => `${n}:${String(all[n]).trim().replace(/\s+/g, ' ')}\n`).join('');
  const signedHeaders = names.join(';');
  const canonicalPath = u.pathname.split('/').map((segment) => encodeRfc3986(decodeURIComponent(segment))).join('/') || '/';
  const query = [...u.searchParams.entries()].map(([k, v]) => [encodeRfc3986(k), encodeRfc3986(v)]).sort((a, b) => (a[0] === b[0] ? (a[1] < b[1] ? -1 : 1) : a[0] < b[0] ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join('&');
  const hashed = payloadHash || createHash('sha256').update(body).digest('hex');
  const canonicalRequest = [method.toUpperCase(), canonicalPath, query, canonicalHeaders, signedHeaders, hashed].join('\n');
  const scope = `${day}/${region}/${service}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, createHash('sha256').update(canonicalRequest).digest('hex')].join('\n');
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${credentials.secretAccessKey}`, day), region), service), 'aws4_request');
  const signature = createHmac('sha256', signingKey).update(stringToSign, 'utf8').digest('hex');
  return {
    ...all,
    authorization: `AWS4-HMAC-SHA256 Credential=${credentials.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}

/**
 * S3-compatible archive, path-style requests. For Cloudflare R2 in the EU
 * jurisdiction the endpoint is https://<account>.eu.r2.cloudflarestorage.com
 * with region "auto". Credentials come from the environment of the importer
 * only - never from the web runtime.
 */
export class S3CompatibleArchive {
  constructor({ endpoint, bucket, region = 'auto', credentials, fetchImpl = globalThis.fetch }) {
    const u = new URL(endpoint);
    if (u.protocol !== 'https:') throw new Error('S3 archive: endpoint must be https');
    if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket || '')) throw new Error('S3 archive: invalid bucket name');
    if (!credentials?.accessKeyId || !credentials?.secretAccessKey) throw new Error('S3 archive: credentials missing');
    this.endpoint = u.origin;
    this.bucket = bucket;
    this.region = region;
    this.credentials = credentials;
    this.fetch = fetchImpl;
  }
  url(key) {
    assertKey(key);
    return `${this.endpoint}/${this.bucket}/${key.split('/').map(encodeRfc3986).join('/')}`;
  }
  async request(method, key, { body, contentType, sha256 } = {}) {
    const url = this.url(key);
    const payloadHash = body ? sha256Hex(body) : sha256Hex(new Uint8Array());
    const headers = { 'x-amz-content-sha256': payloadHash };
    if (contentType) headers['content-type'] = contentType;
    if (sha256) headers['x-amz-meta-sha256'] = sha256;
    const signed = signV4({ method, url, headers, payloadHash, region: this.region, service: 's3', credentials: this.credentials });
    const { host: _host, ...send } = signed;
    return this.fetch(url, { method, headers: send, body });
  }
  async put(key, bytes, { contentType = 'application/octet-stream', sha256 } = {}) {
    if (sha256 && sha256Hex(bytes) !== sha256) throw new Error('archive: SHA-256 mismatch on put');
    if (await this.has(key)) return { key };
    const res = await this.request('PUT', key, { body: bytes, contentType, sha256: sha256 || sha256Hex(bytes) });
    if (!res.ok) throw new Error(`S3 archive: PUT failed with HTTP ${res.status}`);
    return { key };
  }
  async get(key) {
    const res = await this.request('GET', key);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`S3 archive: GET failed with HTTP ${res.status}`);
    return checked(key, new Uint8Array(await res.arrayBuffer()));
  }
  async has(key) {
    const res = await this.request('HEAD', key);
    if (res.status === 404) return false;
    if (!res.ok) throw new Error(`S3 archive: HEAD failed with HTTP ${res.status}`);
    return true;
  }
}

/**
 * The archive configured by the environment: DAJC_KB_ARCHIVE=local:<dir> or
 * s3 (DAJC_KB_S3_ENDPOINT, DAJC_KB_S3_BUCKET, DAJC_KB_S3_REGION,
 * DAJC_KB_S3_ACCESS_KEY_ID, DAJC_KB_S3_SECRET_ACCESS_KEY). Nothing else.
 */
export function archiveFromEnv(env = process.env) {
  const mode = env.DAJC_KB_ARCHIVE || '';
  if (mode.startsWith('local:')) return new LocalFsArchive(mode.slice('local:'.length));
  if (mode === 's3') {
    return new S3CompatibleArchive({
      endpoint: env.DAJC_KB_S3_ENDPOINT,
      bucket: env.DAJC_KB_S3_BUCKET,
      region: env.DAJC_KB_S3_REGION || 'auto',
      credentials: { accessKeyId: env.DAJC_KB_S3_ACCESS_KEY_ID, secretAccessKey: env.DAJC_KB_S3_SECRET_ACCESS_KEY },
    });
  }
  throw new Error('DAJC_KB_ARCHIVE must be local:<directory> or s3');
}
