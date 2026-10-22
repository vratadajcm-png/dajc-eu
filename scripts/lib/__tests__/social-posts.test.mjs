import { describe, expect, it } from 'vitest';
import { newsEntryFromMarkdown, makeSocialDrafts } from '../social-posts.mjs';

const content = (overrides = '') => `---
title: "DAJC Opens Specialist Transport Intelligence"
description: "Preliminary assessment of transport documents, dimensions and risks; no live service is being offered."
slug: "media-partnerships-test"
category: "platform"
publishedAt: 2026-10-22T00:00:00+02:00
status: "published"
${overrides}
---

DAJC Platform remains in development.

## Sponsored articles

Clearly labelled.

## Intelligence Report

Preliminary assessment.

## Intelligence Pro

Planned.
`;
const now = new Date('2026-10-22T13:00:00+02:00');
describe('DAJC social drafts from approved public news', () => {
  it('makes X and LinkedIn variants with the canonical news link', () => {
    const article = newsEntryFromMarkdown(content(), 'platform', now);
    expect(article?.slug).toBe('media-partnerships-test');
    const drafts = makeSocialDrafts(article);
    expect(drafts.x).toContain('dajc.eu/news/platform/media-partnerships-test');
    expect(Array.from(drafts.x).length).toBeLessThanOrEqual(260);
    expect(drafts.linkedin).toContain('Intelligence Report');
    expect(drafts.linkedin).toContain('Intelligence Pro');
  });
  it('does not expose a future article or a mismatched category', () => {
    expect(newsEntryFromMarkdown(content(), 'eu-oversize', now)).toBeNull();
    expect(newsEntryFromMarkdown(content(), 'platform', new Date('2026-10-21T10:00:00Z'))).toBeNull();
  });
  it('ignores drafts and content older than eight days', () => {
    expect(newsEntryFromMarkdown(content().replace('status: "published"', 'status: "draft"'), 'platform', now)).toBeNull();
    expect(newsEntryFromMarkdown(content(), 'platform', new Date('2026-11-05T12:00:00Z'))).toBeNull();
  });
  it('rejects malformed slugs instead of writing outside the artifact directory', () => {
    expect(newsEntryFromMarkdown(content().replace('media-partnerships-test', '../../bad'), 'platform', now)).toBeNull();
  });
});
