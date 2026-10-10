import { describe, expect, it, vi } from 'vitest';
import {
  buildPostText, checkPublicArticle, currentPublication, frontmatterFields,
  oauth1Header, postingDecision, publishToX, validateArticle,
} from '../x-publishing.mjs';

const articleText = `---
title: "EU Oversize Weekly: Fréjus Closure | 12–18 October 2026"
description: "News"
slug: "eu-oversize-weekly-2026-w42"
category: "eu-oversize"
publishedAt: 2026-10-09T10:00:00.000Z
status: "published"
---
Article body`;

const credentials = { apiKey: 'test-key', apiSecret: 'test-secret', accessToken: 'test-access', accessTokenSecret: 'test-access-secret' };

describe('X Friday publication eligibility', () => {
  it('waits for actual Friday noon in Prague and selects the next ISO week', () => {
    expect(currentPublication(new Date('2026-10-09T09:59:00Z'))).toBeNull();
    const atRelease = currentPublication(new Date('2026-10-09T10:01:00Z'));
    expect(atRelease.slug).toBe('eu-oversize-weekly-2026-w42');
    expect(atRelease.slot.toISOString()).toBe('2026-10-09T10:00:00.000Z');
    expect(currentPublication(new Date('2026-10-10T12:01:00Z')).slug).toBe(atRelease.slug);
    expect(currentPublication(new Date('2026-10-11T10:01:00Z'))).toBeNull();
  });

  it('respects daylight saving time when clocks have changed', () => {
    const a = currentPublication(new Date('2026-11-06T11:01:00Z'));
    expect(a.slot.toISOString()).toBe('2026-11-06T11:00:00.000Z');
    expect(a.slug).toBe('eu-oversize-weekly-2026-w46');
  });

  it('rejects draft, future and misdated articles', () => {
    const published = currentPublication(new Date('2026-10-09T12:00:00Z'));
    const fields = frontmatterFields(articleText);
    expect(validateArticle(fields, published).slug).toBe(published.slug);
    expect(() => validateArticle({ ...fields, status: 'draft' }, published)).toThrow();
    expect(() => validateArticle({ ...fields, publishedAt: '2026-10-10T10:00:00Z' }, published)).toThrow();
    expect(() => validateArticle({ ...fields, slug: 'not-weekly' }, published)).toThrow();
  });

  it('builds a compact public post with the real article link', () => {
    const url = 'https://www.dajc.eu/news/eu-oversize/eu-oversize-weekly-2026-w42';
    const short = buildPostText({ title: 'T'.repeat(400), url });
    expect(Array.from(short).length).toBeLessThanOrEqual(265);
    expect(short).toContain(url);
  });

  it('blocks automatic retry after reservation', () => {
    expect(postingDecision()).toBe('new');
    expect(postingDecision({ status: 'pending' })).toBe('manual-reconciliation-required');
    expect(postingDecision({ status: 'published' })).toBe('already-published');
  });
});

describe('X API safety', () => {
  it('creates an OAuth 1.0a HMAC signature dependent on method and token', () => {
    const base = oauth1Header('GET', 'https://api.x.com/2/users/me', credentials, 'nonce', '123');
    expect(base).toContain('oauth_signature=');
    expect(base).toContain('oauth_consumer_key="test-key"');
    expect(oauth1Header('POST', 'https://api.x.com/2/users/me', credentials, 'nonce', '123')).not.toBe(base);
  });

  it('accepts only publicly served HTML and retries 404 next scheduled run', async () => {
    expect(await checkPublicArticle('https://www.dajc.eu/a', async () => ({ status: 404 }))).toBe(false);
    expect(await checkPublicArticle('https://www.dajc.eu/a', async () => ({ ok: true, status: 200, headers: { get: () => 'text/html' } }))).toBe(true);
  });

  it('rejects an OAuth token for any account other than @DAJCeu', async () => {
    const mocked = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: { username: 'somebodyelse' } }) });
    await expect(publishToX('test', credentials, mocked)).rejects.toThrow('not @DAJCeu');
    expect(mocked).toHaveBeenCalledTimes(1);
  });

  it('sends exactly one POST after verifying account identity', async () => {
    const mocked = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: { username: 'DAJCeu' } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: { id: '12345678901' } }) });
    const posted = await publishToX('Verified article', credentials, mocked);
    expect(posted.url).toBe('https://x.com/DAJCeu/status/12345678901');
    expect(mocked).toHaveBeenCalledTimes(2);
    expect(mocked.mock.calls[1][1].method).toBe('POST');
    expect(JSON.parse(mocked.mock.calls[1][1].body).text).toBe('Verified article');
  });
});
