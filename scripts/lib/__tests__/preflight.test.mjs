import { describe, expect, it } from 'vitest';
import { checkOpenAiKeyPreflight } from '../preflight.mjs';

describe('checkOpenAiKeyPreflight', () => {
  it('fails a real (non-mock) run with no key', () => {
    const result = checkOpenAiKeyPreflight({ mock: false, apiKey: undefined });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/OPENAI_API_KEY/);
  });

  it('fails a real run with an empty-string key', () => {
    const result = checkOpenAiKeyPreflight({ mock: false, apiKey: '' });
    expect(result.ok).toBe(false);
  });

  it('passes a real run with a key set', () => {
    const result = checkOpenAiKeyPreflight({ mock: false, apiKey: 'sk-test' });
    expect(result.ok).toBe(true);
  });

  it('passes mock mode regardless of the key', () => {
    expect(checkOpenAiKeyPreflight({ mock: true, apiKey: undefined }).ok).toBe(true);
    expect(checkOpenAiKeyPreflight({ mock: true, apiKey: 'sk-test' }).ok).toBe(true);
  });
});
