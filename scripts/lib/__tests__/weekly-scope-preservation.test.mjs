import { describe, expect, it } from 'vitest';
import { checkWeeklyEligibility } from '../weekly-eligibility.mjs';
import { renderArticleMarkdown } from '../render-article.mjs';
import { dajcCoverageCount } from '../../../config/europe-coverage.mjs';

const context = {
  now: new Date('2026-11-12T05:17:00Z'),
  weekStart: new Date('2026-11-16T00:00:00Z'),
  weekEnd: new Date('2026-11-22T00:00:00Z'),
  previousEditions: new Map(),
};
const candidate = {
  country: 'Germany', type: 'operational_change',
  title: 'New tachograph procedure for goods vehicles at exactly 3.5 t',
  summary: 'Professional road freight operators using tachographs must follow the revised calibration procedure.',
  sourceName: 'Transport authority', sourceUrl: 'https://authority.example/news/calibration',
  sourceTier: 'official', publishedAt: '2026-11-11', status: 'active',
};

describe('approved Weekly audience does not rewrite statutory limits', () => {
  it('includes a relevant exact-3.5-t tachograph development without an N3 floor', () => {
    expect(checkWeeklyEligibility(candidate, context).ok).toBe(true);
    expect(dajcCoverageCount).toBe(50);
  });

  it.each(['>7.5 t', '>12 t'])('retains source limit %s and its exception in public copy', (limit) => {
    const report = {
      country: 'Germany', title: 'Bridge restriction for goods vehicles',
      whatChanged: `The bridge is restricted to vehicles ${limit}.`,
      where: 'Named bridge only', vehicleScope: `Goods vehicles ${limit}`,
      timeWindow: '16–22 November 2026', validFrom: '2026-11-16', validTo: '2026-11-22',
      impact: 'Affected vehicles require the signed diversion.',
      recommendedAction: 'Check vehicle mass and the bridge permit conditions.',
      exemptions: 'Emergency service vehicles and vehicles with an individual authority permit are exempt.',
      isDrivingBan: false, isInfrastructure: true,
      sourceUrl: candidate.sourceUrl, sourceName: candidate.sourceName, sourceTier: 'official',
    };
    const { body } = renderArticleMarkdown({
      seoTitle: 'EU Oversize Weekly', metaDescription: 'Verified bridge restriction.',
      intro: 'A route restriction for professional freight operators.',
      developments: [report], europeRoundup: [], operatorChecklist: [],
    }, {
      slug: 'eu-oversize-weekly-2026-w47', publishedAt: '2026-11-13T11:00:00Z',
      weekEnd: '2026-11-22', nextPublicationLabel: null,
    });
    expect(body).toContain(`**Affected vehicles:** Goods vehicles ${limit.replace('>', '&gt;')}`);
    expect(body).toContain(`**Exemptions/conditions:** ${report.exemptions}`);
    expect(body).not.toContain('3.5');
    expect(body).not.toContain('all vehicles');
  });
});
