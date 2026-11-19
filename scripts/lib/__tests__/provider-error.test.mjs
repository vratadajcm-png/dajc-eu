import { describe, expect, it } from 'vitest';
import { errorDetailFromBody, providerErrorDetail } from '../provider-error.mjs';

describe('provider error detail', () => {
  it('keeps the type and message of an Anthropic error body', () => {
    const body = JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'Your credit balance is too low to access the Anthropic API.' } });
    expect(errorDetailFromBody(body)).toBe('invalid_request_error: Your credit balance is too low to access the Anthropic API.');
  });

  it('reads plain-text and string-error bodies and caps their length', () => {
    expect(errorDetailFromBody('{"error":"Invalid API key"}')).toBe('Invalid API key');
    expect(errorDetailFromBody('<html>  Bad   Gateway </html>')).toBe('<html> Bad Gateway </html>');
    expect(errorDetailFromBody('x'.repeat(500))).toHaveLength(240);
    expect(errorDetailFromBody('')).toBe('');
  });

  it('appends the reason to the HTTP status and never throws', async () => {
    const body = '{"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}';
    expect(await providerErrorDetail({ text: async () => body })).toBe(' (authentication_error: invalid x-api-key)');
    expect(await providerErrorDetail({ text: async () => { throw new Error('stream closed'); } })).toBe('');
  });
});
