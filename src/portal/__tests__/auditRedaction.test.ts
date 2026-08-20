// Audit metadata must never carry secrets/raw tokens, even if a caller
// accidentally passes one - spec item 9 "Nikdy do auditu nezapisuj
// secrets nebo raw tokens".
import { describe, expect, it } from 'vitest';
import { redactMetadata } from '../lib/audit';

describe('redactMetadata', () => {
  it('returns null for undefined input', () => {
    expect(redactMetadata(undefined)).toBeNull();
  });

  it('passes through non-secret fields untouched', () => {
    expect(redactMetadata({ email: 'a@b.com', scope: 'orders.read' })).toEqual({
      email: 'a@b.com',
      scope: 'orders.read',
    });
  });

  it.each(['token', 'rawToken', 'token_hash', 'secret', 'clientSecret', 'password', 'apiKey', 'Authorization', 'cookie'])(
    'redacts forbidden key "%s" regardless of casing/separators',
    (key) => {
      const result = redactMetadata({ [key]: 'super-secret-value' });
      expect(result?.[key]).toBe('[redacted]');
    }
  );

  it('redacts only the forbidden keys, leaving siblings intact', () => {
    const result = redactMetadata({ email: 'a@b.com', token: 'shhh' });
    expect(result).toEqual({ email: 'a@b.com', token: '[redacted]' });
  });
});
