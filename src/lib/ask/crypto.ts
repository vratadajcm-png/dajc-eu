// Encryption of personal content at rest (history, memory, feedback
// comments, billing details waiting for accounting sync).
//
// AES-256-GCM with a random 96-bit IV per record. The ciphertext is bound
// to its owner and purpose through the additional authenticated data
// ("dajc-ai|<purpose>|<owner>"): a row copied to another user, or a history
// entry presented as a memory item, fails authentication instead of
// decrypting. Keys come from DAJC_AI_DATA_KEYS only (server environment):
//
//   DAJC_AI_DATA_KEYS = "k2026a:<base64 32 bytes>,k2025b:<base64 32 bytes>"
//
// The first key encrypts; every listed key decrypts, so a key can be rotated
// by prepending a new one and re-encrypting at leisure. Without a valid key
// every feature that stores personal content stays off (fail closed).

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export type CipherPurpose = 'history' | 'memory' | 'feedback' | 'billing-details';

export interface DataKeyring {
  activeKeyId: string;
  keys: Map<string, Buffer>;
}

const KEY_ID = /^[a-z0-9][a-z0-9_-]{0,31}$/;

/** Parses DAJC_AI_DATA_KEYS; null when absent or invalid (problems name no value). */
export function parseDataKeys(raw: string | undefined): { keyring: DataKeyring | null; problem: string | null } {
  if (!raw || !raw.trim()) return { keyring: null, problem: 'DAJC_AI_DATA_KEYS is missing' };
  const keys = new Map<string, Buffer>();
  let activeKeyId: string | null = null;
  for (const part of raw.split(',').map((p) => p.trim()).filter(Boolean)) {
    const index = part.indexOf(':');
    const id = index > 0 ? part.slice(0, index) : '';
    if (!KEY_ID.test(id)) return { keyring: null, problem: 'DAJC_AI_DATA_KEYS has an invalid key id' };
    const key = Buffer.from(part.slice(index + 1), 'base64');
    if (key.length !== 32) return { keyring: null, problem: `DAJC_AI_DATA_KEYS key ${id} must be 32 bytes (base64)` };
    if (keys.has(id)) return { keyring: null, problem: `DAJC_AI_DATA_KEYS lists key ${id} twice` };
    keys.set(id, key);
    activeKeyId ??= id;
  }
  if (!activeKeyId) return { keyring: null, problem: 'DAJC_AI_DATA_KEYS is missing' };
  return { keyring: { activeKeyId, keys }, problem: null };
}

function aad(purpose: CipherPurpose, owner: string): Buffer {
  return Buffer.from(`dajc-ai|${purpose}|${owner}`, 'utf8');
}

export interface Sealed {
  keyId: string;
  ciphertext: string;
}

export function seal(keyring: DataKeyring, purpose: CipherPurpose, owner: string, value: unknown): Sealed {
  const key = keyring.keys.get(keyring.activeKeyId)!;
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(aad(purpose, owner));
  const body = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { keyId: keyring.activeKeyId, ciphertext: Buffer.concat([iv, tag, body]).toString('base64') };
}

export class DecryptionError extends Error {
  constructor() {
    super('personal data could not be decrypted');
    this.name = 'DecryptionError';
  }
}

export function open<T = unknown>(keyring: DataKeyring, purpose: CipherPurpose, owner: string, sealed: Sealed): T {
  const key = keyring.keys.get(sealed.keyId);
  if (!key) throw new DecryptionError();
  try {
    const raw = Buffer.from(sealed.ciphertext, 'base64');
    if (raw.length < 29) throw new DecryptionError();
    const decipher = createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12));
    decipher.setAAD(aad(purpose, owner));
    decipher.setAuthTag(raw.subarray(12, 28));
    const text = Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
    return JSON.parse(text) as T;
  } catch {
    throw new DecryptionError();
  }
}
