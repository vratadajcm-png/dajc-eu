import { describe, it, expect } from 'vitest';
import { parseCandidateArticle, reviewApproved } from '../../weekly-autonomous-review.mjs';

const now = new Date('2026-10-22T09:00:00Z');
const url = 'https://example.org/oversize-notice';
const path = 'src/content/news/eu-oversize/eu-oversize-weekly-2026-w44.md';
const fixture = [
  '---',
  'title: "DAJC Weekly test"',
  'description: "Oversize transport notice"',
  'slug: "eu-oversize-weekly-2026-w44"',
  'category: "eu-oversize"',
  'publishedAt: 2026-10-23T10:00:00.000Z',
  'language: "en"',
  'author: "DAJC"',
  'status: "published"',
  'sources:',
  '  - name: "Official road operator"',
  '    url: "' + url + '"',
  '---',
  '',
  '## Intro',
  '',
  'Verified transport news.',
  '',
  '## Lead reports',
  '',
  '### Changed permit rule (Netherlands)',
  '',
  'A verified, current permit change.',
  '',
  '**Recommended action:** Confirm permits.',
  '',
  '*Source: [Official road operator](' + url + ')*',
  '',
  '## Operator checklist',
  '',
  '- Check permits.',
  '',
  '## Sources',
  '',
  '- [Official road operator](' + url + ')',
  '',
  '## Next EU Oversize Weekly',
  '',
  'Friday 30 October 2026.'
].join('\n');

describe('OpenAI -> Grok -> Claude publisher gate', () => {
  it('accepts proper week, publication slot and one valid lead', () => {
    const r = parseCandidateArticle(path, fixture, now);
    expect(r.week).toBe('2026-W44');
    expect(r.leadCount).toBe(1);
    expect(r.restCount).toBe(0);
    expect(r.links).toEqual([url]);
  });
  it('rejects another ISO week, mismatched release time and no lead', () => {
    expect(() => parseCandidateArticle(path.replace('w44', 'w45'), fixture, now)).toThrow();
    expect(() => parseCandidateArticle(path, fixture.replace('10:00:00', '11:00:00'), now)).toThrow();
    expect(() => parseCandidateArticle(path, fixture.replace('## Lead reports', '## Other'), now)).toThrow();
  });
  it('requires every source to be endorsed by both models and zero blockers', () => {
    const good = { verdict: 'approve', blockingReasons: [], sourceChecks: [{ url, supported: true, reason: 'Sourced to official notice' }] };
    expect(reviewApproved(good, [url])).toBe(true);
    expect(reviewApproved({ ...good, verdict: 'reject' }, [url])).toBe(false);
    expect(reviewApproved({ ...good, blockingReasons: ['Missing axle load'] }, [url])).toBe(false);
    expect(reviewApproved({ ...good, sourceChecks: [] }, [url])).toBe(false);
    expect(reviewApproved({ ...good, sourceChecks: [good.sourceChecks[0], good.sourceChecks[0]] }, [url])).toBe(false);
    expect(reviewApproved({ ...good, sourceChecks: [{ ...good.sourceChecks[0], supported: false }] }, [url])).toBe(false);
  });
});
