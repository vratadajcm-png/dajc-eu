import { describe, expect, it } from 'vitest';
import { editionPlan, isoWeekDate } from '../edition-plan.mjs';
import { renderArticleMarkdown, toFrontmatterYaml } from '../render-article.mjs';
import { parseCandidateArticle } from '../../claude-weekly-review.mjs';

describe('explicit ISO edition and transparent release times', () => {
  it('prepares on Thursday and holds publication until Prague Friday noon', () => {
    const plan = editionPlan({ now: new Date('2026-11-12T08:00:00Z') });
    expect(plan.targetWeek).toBe('2026-W47');
    expect(plan.publishedAt).toBe('2026-11-13T11:00:00.000Z');
    expect(plan.late).toBe(false);
  });
  it('distinguishes a late W47 repair from the next planned W48 edition', () => {
    const now = new Date('2026-11-16T16:00:00Z');
    const plan = editionPlan({ now, targetWeek: '2026-W47' });
    expect(plan.targetDate.toISOString()).toBe('2026-11-16T00:00:00.000Z');
    expect(plan.publicationSlot.toISOString()).toBe('2026-11-13T11:00:00.000Z');
    expect(plan.publishedAt).toBe(now.toISOString());
    expect(plan.findingsWeeks).toEqual(['2026-W46', '2026-W47']);
    expect(editionPlan({ now }).targetWeek).toBe('2026-W48');
  });
  it.each([
    ['2026-W13', '2026-03-20T11:00:00.000Z'],
    ['2026-W14', '2026-03-27T11:00:00.000Z'],
    ['2026-W15', '2026-04-03T10:00:00.000Z'],
    ['2026-W43', '2026-10-16T10:00:00.000Z'],
    ['2026-W44', '2026-10-23T10:00:00.000Z'],
    ['2026-W45', '2026-10-30T11:00:00.000Z'],
  ])('preserves CET/CEST for target %s', (targetWeek, slot) => {
    expect(editionPlan({ now: new Date('2026-01-01'), targetWeek }).publicationSlot.toISOString()).toBe(slot);
  });
  it('validates actual ISO week boundaries and rejects invalid/shell-shaped input', () => {
    expect(isoWeekDate('2020-W53').toISOString()).toBe('2020-12-28T00:00:00.000Z');
    for (const label of ['2025-W53', '2026-W00', '2026-W54', '2026-W1', '../W47', '2026-W47;echo']) expect(() => isoWeekDate(label)).toThrow();
  });
  it('the reviewer accepts explicit late metadata but rejects backdating and missing disclosure', () => {
    const now = new Date('2026-11-16T16:00:00Z');
    const plan = editionPlan({ now, targetWeek: '2026-W47' });
    const item = { title: 'Permit update', country: 'Germany', whatChanged: 'The authority changed the permit form.', recommendedAction: 'Check the official permit form.', sourceName: 'Authority', sourceUrl: 'https://authority.example/permit' };
    const { frontmatter, body } = renderArticleMarkdown({ seoTitle: 'Weekly', metaDescription: 'Weekly updates', intro: 'Update', developments: [item], europeRoundup: [], operatorChecklist: ['Check permits'] }, {
      slug: 'eu-oversize-weekly-2026-w47', publishedAt: plan.publishedAt, preparedAt: plan.preparedAt,
      scheduledPublicationAt: plan.publicationSlot.toISOString(), targetWeek: plan.targetWeek, late: true,
    });
    const raw = toFrontmatterYaml(frontmatter) + '\n\n' + body;
    const path = 'src/content/news/eu-oversize/eu-oversize-weekly-2026-w47.md';
    expect(parseCandidateArticle(path, raw, now, '2026-W47').week).toBe('2026-W47');
    expect(() => parseCandidateArticle(path, raw, now)).toThrow(/Wrong target/);
    expect(() => parseCandidateArticle(path, raw.replace(plan.publishedAt, plan.publicationSlot.toISOString()), now, '2026-W47')).toThrow(/backdated/);
    expect(() => parseCandidateArticle(path, raw.replace('prepared after its scheduled release', 'released'), now, '2026-W47')).toThrow(/disclosure/);
  });
});
