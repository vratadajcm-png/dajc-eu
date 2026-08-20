import { describe, expect, it } from 'vitest';
import { generateSecureToken, hashToken, hashesEqual } from '../lib/tokens';

describe('generateSecureToken', () => {
  it('produces high-entropy, URL-safe, unique tokens', () => {
    const tokens = new Set(Array.from({ length: 1000 }, () => generateSecureToken()));
    expect(tokens.size).toBe(1000);
    for (const token of tokens) {
      expect(token).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    }
  });
});

describe('hashToken', () => {
  it('is deterministic and never equals the raw input', () => {
    const raw = generateSecureToken();
    const hash = hashToken(raw);
    expect(hashToken(raw)).toBe(hash);
    expect(hash).not.toBe(raw);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('produces different hashes for different tokens', () => {
    expect(hashToken('a')).not.toBe(hashToken('b'));
  });
});

describe('hashesEqual', () => {
  it('matches identical hex digests and rejects different ones', () => {
    const raw = generateSecureToken();
    const hash = hashToken(raw);
    expect(hashesEqual(hash, hashToken(raw))).toBe(true);
    expect(hashesEqual(hash, hashToken('something-else'))).toBe(false);
  });

  it('rejects mismatched lengths without throwing', () => {
    expect(hashesEqual('ab', 'abcd')).toBe(false);
  });
});
