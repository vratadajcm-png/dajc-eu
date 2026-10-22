import { describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { linkedinConfig, linkedinPostPayload, publishToLinkedIn } from '../linkedin-publishing.mjs';
import { collectSocialCandidates, selectNextSocialArticle, candidateKey } from '../social-publication.mjs';

function article(category, optIn = '') {
  return [
    '---',
    'title: "New DAJC Update"',
    'description: "An approved transport-industry update with a source link."',
    'slug: "new-dajc-update"',
    'category: "' + category + '"',
    'publishedAt: 2026-10-22T00:00:00+02:00',
    'status: "published"',
    optIn,
    '---',
    '',
    '## Details',
    'This is an approved DAJC public announcement.',
  ].join('\n');
}

function testFiles(callback) {
  const root = mkdtempSync(path.join(tmpdir(), 'dajc-social-'));
  try {
    for (const type of ['eu-oversize', 'platform']) {
      mkdirSync(path.join(root, 'src/content/news', type), { recursive: true });
    }
    return callback(root);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
}

describe('approved social news selection', () => {
  it('requires explicit socialPublish true for Platform Updates', () => testFiles((root) => {
    const folder = path.join(root, 'src/content/news/platform');
    writeFileSync(path.join(folder, 'not-opted-in.md'), article('platform'));
    expect(collectSocialCandidates(root, new Date('2026-10-22T12:00:00Z'))).toHaveLength(0);
    writeFileSync(path.join(folder, 'opted-in.md'), article('platform', 'socialPublish: true'));
    const articles = collectSocialCandidates(root, new Date('2026-10-22T12:00:00Z'));
    expect(articles).toHaveLength(1);
    expect(candidateKey(articles[0])).toBe('platform/new-dajc-update');
    expect(articles[0].linkedin).toContain('www.dajc.eu/news/platform/new-dajc-update');
  }));
  it('ignores drafts, future news and pre-22-October content', () => testFiles((root) => {
    const folder = path.join(root, 'src/content/news/eu-oversize');
    writeFileSync(path.join(folder, 'draft.md'), article('eu-oversize').replace('status: "published"', 'status: "draft"'));
    writeFileSync(path.join(folder, 'past.md'), article('eu-oversize').replace('2026-10-22T00:00:00+02:00', '2026-10-21T12:00:00+02:00'));
    expect(collectSocialCandidates(root, new Date('2026-10-22T12:00:00Z'))).toHaveLength(0);
  }));
  it('never retries an ambiguous pending post or a malformed entry', () => {
    const item = { category: 'platform', slug: 'new-dajc-update' };
    const ledger = { schemaVersion: 1, posts: { [candidateKey(item)]: { status: 'pending' } } };
    expect(() => selectNextSocialArticle([item], ledger)).toThrow('manual reconciliation');
    ledger.posts[candidateKey(item)] = { status: 'published' };
    expect(selectNextSocialArticle([item], ledger)).toBeNull();
    ledger.posts[candidateKey(item)] = {};
    expect(() => selectNextSocialArticle([item], ledger)).toThrow('unfinished');
  });
});

describe('LinkedIn official company-only API', () => {
  const valid = { LINKEDIN_ACCESS_TOKEN: 'valid-token', DAJC_LINKEDIN_ORGANIZATION_URN: 'urn:li:organization:12345' };
  it('will not accept a personal member URN or missing token', () => {
    expect(() => linkedinConfig({ ...valid, DAJC_LINKEDIN_ORGANIZATION_URN: 'urn:li:person:abc' })).toThrow('organization');
    expect(() => linkedinConfig({ ...valid, LINKEDIN_ACCESS_TOKEN: '' })).toThrow('missing');
    expect(() => linkedinPostPayload('urn:li:person:abc', 'Hi')).toThrow('non-company');
  });
  it('posts only as DAJC organization, captures the returned post URN', async () => {
    const request = vi.fn().mockResolvedValue({ status: 201, headers: { get: () => 'urn:li:share:123456789' } });
    const result = await publishToLinkedIn('Public DAJC update', linkedinConfig(valid), request);
    expect(result.url).toBe('https://www.linkedin.com/feed/update/urn:li:share:123456789/');
    const [, options] = request.mock.calls[0];
    expect(options.method).toBe('POST');
    expect(options.headers['Linkedin-Version']).toMatch(/^2026/);
    expect(options.headers.Authorization).toBe('Bearer valid-token');
    expect(JSON.parse(options.body)).toMatchObject({ author: valid.DAJC_LINKEDIN_ORGANIZATION_URN, lifecycleState: 'PUBLISHED' });
  });
  it('does not retry automatically after unauthorized or ambiguous response', async () => {
    const error = vi.fn().mockResolvedValue({ status: 401, headers: { get: () => '' } });
    await expect(publishToLinkedIn('test', linkedinConfig(valid), error)).rejects.toThrow('HTTP 401');
    const noId = vi.fn().mockResolvedValue({ status: 201, headers: { get: () => '' } });
    await expect(publishToLinkedIn('test', linkedinConfig(valid), noId)).rejects.toThrow('manual reconciliation');
  });
});
