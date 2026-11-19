import { describe, expect, it } from 'vitest';
import { alignEditionSummary } from '../edition-summary.mjs';
import { crossValidateDevelopments } from '../cross-validate.mjs';
import { renderArticleMarkdown } from '../render-article.mjs';

const weekRangeLabel = '16-22 November 2026';
const retained = {
  country: 'Italy', title: 'Italy: tachograph enforcement checks on goods vehicles',
  whatChanged: 'The source reports targeted tachograph enforcement checks.',
  vehicleScope: 'Commercial goods vehicles using a tachograph',
  recommendedAction: 'Check the source notice and retain the required records.',
  sourceName: 'Transport authority', sourceUrl: 'https://authority.example/enforcement',
};
const dropped = {
  country: 'Italy', title: 'Italy: draft Highway Code reform adopted',
  whatChanged: 'Unsupported adoption of legislation with a universal 12 t limit.',
  sourceName: 'Unverified outlet', sourceUrl: 'https://outlet.example/draft',
};
const summaryText = article => [article.seoTitle, article.metaDescription, article.intro, ...(article.operatorChecklist || [])].join('\n');

describe('edition-level claims derive only from retained reports', () => {
  it('removes a dropped Italian legislation claim even though an Italian enforcement report survives (W47)', () => {
    const candidates = [{ ...retained }];
    const { kept, droppedCount } = crossValidateDevelopments([retained, dropped], candidates);
    expect(droppedCount).toBe(1);
    const article = {
      seoTitle: 'EU Oversize Weekly: Italy adopts Highway Code reform',
      metaDescription: 'Italy adopted a new draft law with a universal 12 t limit.',
      intro: 'Italian draft legislation was adopted. Tachograph enforcement also changed.',
      developments: kept, europeRoundup: [],
      operatorChecklist: ['Apply the new universal 12 t limit.'],
    };
    const { fixed } = alignEditionSummary(article, { weekRangeLabel });
    expect(fixed).toEqual(['seoTitle', 'metaDescription', 'intro']);
    expect(summaryText(article)).not.toMatch(/Highway Code|draft|adopted|12 t|legislation/);
    expect(article.seoTitle).toBe(`EU Oversize Weekly: ${retained.title} | ${weekRangeLabel}`);
    expect(article.metaDescription).toContain(retained.title);
    expect(article.intro).toContain(retained.title);
    expect(article.operatorChecklist).toEqual([`Italy: ${retained.recommendedAction}`]);
    const { body } = renderArticleMarkdown(article, { slug: 'eu-oversize-weekly-2026-w47', publishedAt: '2026-11-16T18:00:00Z' });
    expect(body).not.toMatch(/Highway Code|draft|adopted|12 t|legislation/);
  });
  it('also discards unsupported summary claims that mention no country', () => {
    const article = { seoTitle: 'New legal duties adopted', metaDescription: 'All vehicles need a permit.',
      intro: 'Parliament has passed the reform.', developments: [retained], europeRoundup: [] };
    alignEditionSummary(article, { weekRangeLabel });
    expect(summaryText(article)).not.toMatch(/legal duties|All vehicles|Parliament|passed the reform/);
  });
  it('does not truncate exact report thresholds, conditions or exceptions', () => {
    const report = { ...retained, title: 'Vehicles >7.5 t: permit requirement, except local deliveries',
      recommendedAction: 'Check >7.5 t scope and the local-delivery exception.' };
    const article = { developments: [report], europeRoundup: [] };
    alignEditionSummary(article, { weekRangeLabel });
    for (const field of ['seoTitle', 'metaDescription', 'intro']) expect(article[field]).toContain(report.title);
    expect(article.operatorChecklist[0]).toContain(report.recommendedAction);
  });
  it('includes retained roundup reports and remains deterministic on repeated application', () => {
    const article = { developments: [retained], europeRoundup: [{ ...retained, country: 'Germany', title: 'Germany: new permit portal', sourceUrl: 'https://authority.example/portal' }] };
    alignEditionSummary(article, { weekRangeLabel });
    expect(article.metaDescription).toContain('Germany: new permit portal');
    expect(article.intro).toContain('Italy and Germany');
    const before = JSON.stringify(article);
    expect(alignEditionSummary(article, { weekRangeLabel }).fixed).toEqual([]);
    expect(JSON.stringify(article)).toBe(before);
  });
  it('does not introduce story count requirements or change the retained reports', () => {
    const article = { developments: [retained], europeRoundup: [] };
    const reportsBefore = JSON.stringify(article.developments);
    alignEditionSummary(article, { weekRangeLabel });
    expect(article.developments).toHaveLength(1);
    expect(JSON.stringify(article.developments)).toBe(reportsBefore);
    expect(summaryText(article)).not.toMatch(/minimum|at least|more reports|only 1/);
  });
});
