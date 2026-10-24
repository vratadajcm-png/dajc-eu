import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { readBufferConfig, validateBufferChannel, checkBufferChannel, publishViaBuffer } from '../buffer-publishing.mjs';

const config = { backend: 'buffer', channel: 'x', channelId: 'abcdef0123456789abcdef01', token: 'test-token' };
const validX = {
  id: config.channelId, service: 'twitter', type: 'profile',
  name: 'DAJCeu', externalLink: 'https://x.com/DAJCeu',
  isDisconnected: false, isLocked: false,
};
const bufferResponse = (data) => ({ ok: true, json: async () => ({ data }) });

describe('Buffer free-plan company publishing adapter', () => {
  it('requires configured API key and real-looking channel ID', () => {
    expect(() => readBufferConfig('x', {})).toThrow('BUFFER_API_KEY');
    expect(readBufferConfig('x', { BUFFER_API_KEY: 'key', DAJC_BUFFER_X_CHANNEL_ID: config.channelId }).channelId).toBe(config.channelId);
    expect(() => readBufferConfig('linkedin', { BUFFER_API_KEY: 'key', DAJC_BUFFER_LINKEDIN_CHANNEL_ID: 'guess' })).toThrow('channel ID');
  });
  it('rejects any X profile except @DAJCeu', () => {
    expect(validateBufferChannel('x', validX)).toBe(true);
    expect(() => validateBufferChannel('x', { ...validX, name: 'someone' })).toThrow('official DAJC');
    expect(() => validateBufferChannel('x', { ...validX, externalLink: 'https://x.com/other' })).toThrow('official DAJC');
    expect(() => validateBufferChannel('x', { ...validX, isDisconnected: true })).toThrow('disconnected');
  });
  it('rejects personal LinkedIn channels and unrelated pages', () => {
    const base = { ...validX, service: 'linkedin', type: 'page', name: 'DAJC', externalLink: 'https://www.linkedin.com/company/dajc/' };
    expect(validateBufferChannel('linkedin', base)).toBe(true);
    expect(() => validateBufferChannel('linkedin', { ...base, type: 'profile' })).toThrow('company page');
    expect(() => validateBufferChannel('linkedin', { ...base, name: 'OtherCompany' })).toThrow('company page');
    expect(() => validateBufferChannel('linkedin', { ...base, externalLink: 'https://linkedin.com/in/personal' })).toThrow('company page');
  });
  it('verifies the social profile before attempting any API write', async () => {
    const fetchFn = vi.fn().mockResolvedValue(bufferResponse({ channel: validX }));
    expect(await checkBufferChannel(config, fetchFn)).toBe(true);
    expect(fetchFn).toHaveBeenCalledOnce();
    const payload = JSON.parse(fetchFn.mock.calls[0][1].body);
    expect(payload.query).toContain('VerifyDajcBufferChannel');
    expect(payload.query).toContain(config.channelId);
  });
  it('creates an immediate post via official GraphQL API; does not infer external URL', async () => {
    const fetchFn = vi.fn().mockResolvedValue(bufferResponse({ createPost: { post: { id: 'post123', status: 'buffer' } } }));
    const r = await publishViaBuffer('Hello DAJC', config, fetchFn);
    expect(r).toEqual({ id: 'post123', url: null, status: 'submitted' });
    const payload = JSON.parse(fetchFn.mock.calls[0][1].body);
    expect(payload.query).toContain('mode: shareNow');
    expect(payload.query).toContain('Hello DAJC');
    expect(fetchFn.mock.calls[0][1].headers.Authorization).toBe('Bearer test-token');
  });
  it('records sent only when Buffer explicitly reports sent', async () => {
    const fetchFn = vi.fn().mockResolvedValue(bufferResponse({ createPost: { post: { id: 'sent123', status: 'sent' } } }));
    expect((await publishViaBuffer('Hello DAJC', config, fetchFn)).status).toBe('published');
  });
  it('fails closed on GraphQL rejection and ambiguous success', async () => {
    const refused = vi.fn().mockResolvedValue(bufferResponse({ createPost: { message: 'Channel not found' } }));
    await expect(publishViaBuffer('a post', config, refused)).rejects.toThrow('reconcile');
    const errors = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ errors: [{ message: 'private content' }] }) });
    await expect(publishViaBuffer('a post', config, errors)).rejects.toThrow('request refused');
  });
});

describe('social publishing workflows', () => {
  const workflow = (name) => readFileSync(new URL(`../../../.github/workflows/${name}`, import.meta.url), 'utf8');
  const values = (text, key) => new Set([...text.matchAll(new RegExp(`^\\s+${key}:\\s*(.+)$`, 'gm'))].map((m) => m[1].trim()));

  // A post reserved after verifying the Buffer channel must be sent through
  // that same backend and channel. The X publish step once had no defaults,
  // so with only DAJC_X_ENABLED set it would have switched to the direct X
  // API and left a pending reservation that blocks every later post.
  it.each([
    ['publish-x-weekly.yml', 'DAJC_BUFFER_X_CHANNEL_ID'],
    ['publish-linkedin-news.yml', 'DAJC_BUFFER_LINKEDIN_CHANNEL_ID'],
  ])('%s reserves and publishes through the same backend and channel', (name, channelKey) => {
    const text = workflow(name);
    expect(values(text, 'DAJC_SOCIAL_BACKEND').size).toBe(1);
    expect(values(text, channelKey).size).toBe(1);
  });
});

describe('social publishing activation', () => {
  // Owner decision, 24 October 2026: on by default, the variable is an off switch.
  it.each([
    ['publish-x-weekly.yml', 'DAJC_X_ENABLED'],
    ['publish-linkedin-news.yml', 'DAJC_LINKEDIN_ENABLED'],
  ])('%s publishes unless %s is false', (name, flag) => {
    const text = readFileSync(new URL(`../../../.github/workflows/${name}`, import.meta.url), 'utf8');
    expect(text).toContain(`vars.${flag} != 'false'`);
    expect(text).toContain(`inputs.dry_run == false && vars.${flag} == 'false'`);
    expect(text).not.toContain(`vars.${flag} == 'true'`);
  });
});
