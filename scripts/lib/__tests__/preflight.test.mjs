import { describe, expect, it } from 'vitest';
import { checkClaudeKeyPreflight } from '../preflight.mjs';

describe('checkClaudeKeyPreflight', () => {
  it('fails a real (non-mock) run with no key', () => {
    const result = checkClaudeKeyPreflight({ mock: false, apiKey: undefined });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/ANTHROPIC_API_KEY/);
  });

  it('fails a real run with an empty-string key', () => {
    expect(checkClaudeKeyPreflight({ mock: false, apiKey: '' }).ok).toBe(false);
  });

  it('passes a real run with a key set', () => {
    expect(checkClaudeKeyPreflight({ mock: false, apiKey: 'sk-ant-test' }).ok).toBe(true);
  });

  it('passes mock mode regardless of the key', () => {
    expect(checkClaudeKeyPreflight({ mock: true, apiKey: undefined }).ok).toBe(true);
    expect(checkClaudeKeyPreflight({ mock: true, apiKey: 'sk-ant-test' }).ok).toBe(true);
  });
});
