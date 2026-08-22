import { describe, expect, it } from 'vitest';
import { renderArticleMarkdown, categorizeDevelopment } from '../render-article.mjs';

function makeArticle(developments, extra = {}) {
  return {
    seoTitle: 'Test title',
    metaDescription: 'Test description',
    intro: 'Test intro',
    developments,
    operatorChecklist: ['Check permit conditions.', 'Verify exemptions.'],
    ...extra,
  };
}

describe('categorizeDevelopment', () => {
  it('is mutually exclusive - a driving ban never also counts as infrastructure', () => {
    expect(categorizeDevelopment({ isDrivingBan: true, isInfrastructure: true })).toBe('bans');
    expect(categorizeDevelopment({ isDrivingBan: false, isInfrastructure: true })).toBe('infrastructure');
    expect(categorizeDevelopment({ isDrivingBan: false, isInfrastructure: false })).toBe('other');
  });
});

describe('renderArticleMarkdown', () => {
  // Regression test for the incident in the first published W35 article:
  // every development (Hildesheim, Monaco, Murrashi Bridge) was rendered
  // once under "Main developments" AND again under "Driving bans next
  // week" / "Infrastructure watch". This must never happen again - each
  // development's title+sourceUrl pair may appear as a rendered report
  // exactly once in the whole body.
  it('renders each development exactly once, even when isDrivingBan and isInfrastructure are both true', () => {
    const developments = [
      {
        country: 'Germany',
        title: 'Example bridge and driving ban development',
        whatChanged: 'Something changed.',
        where: 'Somewhere',
        impact: 'Some impact.',
        recommendedAction: 'Do something.',
        isDrivingBan: true,
        isInfrastructure: true,
        sourceUrl: 'https://example.test/a',
        sourceName: 'Example Source',
      },
    ];
    const { body } = renderArticleMarkdown(makeArticle(developments), {
      slug: 'eu-oversize-weekly-2026-w99',
      publishedAt: '2026-08-21',
      nextPublicationLabel: 'Friday, 28 August 2026 at 12:00 CEST',
    });

    const occurrences = body.split('Example bridge and driving ban development').length - 1;
    expect(occurrences).toBe(1);
    const sourceOccurrences = body.split('https://example.test/a').length - 1;
    // Once in the report's own "Source:" line, once in the "## Sources" list - never a third time.
    expect(sourceOccurrences).toBe(2);
  });

  it('puts a driving-ban development under "Driving bans and exceptional-transport restrictions" and never under "Infrastructure restrictions"', () => {
    const developments = [
      {
        country: 'Austria',
        title: 'Nationwide weekend driving ban',
        whatChanged: 'Weekend ban applies.',
        where: 'Nationwide',
        impact: 'No movement allowed.',
        recommendedAction: 'Plan around it.',
        isDrivingBan: true,
        isInfrastructure: false,
        sourceUrl: 'https://example.test/b',
        sourceName: 'Example Source B',
      },
    ];
    const { body } = renderArticleMarkdown(makeArticle(developments), {
      slug: 'eu-oversize-weekly-2026-w99',
      publishedAt: '2026-08-21',
      nextPublicationLabel: null,
    });
    expect(body).toContain('## Driving bans and exceptional-transport restrictions');
    expect(body).not.toContain('## Infrastructure restrictions');
    expect(body).not.toContain('## Main developments');
  });

  it('renders exactly one section when all developments are driving bans, plus checklist and sources', () => {
    const developments = Array.from({ length: 10 }, (_, i) => ({
      country: 'Country',
      title: `Report number ${i}`,
      whatChanged: 'Change.',
      where: 'Where',
      impact: 'Impact.',
      recommendedAction: 'Action.',
      isDrivingBan: true,
      isInfrastructure: false,
      sourceUrl: `https://example.test/${i}`,
      sourceName: `Source ${i}`,
    }));
    const { body } = renderArticleMarkdown(makeArticle(developments), {
      slug: 'eu-oversize-weekly-2026-w99',
      publishedAt: '2026-08-21',
      nextPublicationLabel: 'Friday, 28 August 2026 at 12:00 CEST',
    });
    expect(body).toContain('## Driving bans and exceptional-transport restrictions');
    expect(body).toContain('## Operator checklist');
    expect(body).toContain('## Sources');
    expect(body).toContain('## Next EU Oversize Weekly');
    // Exactly one occurrence of each heading - no secondary section repeats the reports.
    for (const heading of ['## Driving bans and exceptional-transport restrictions', '## Operator checklist', '## Sources']) {
      expect(body.split(heading).length - 1).toBe(1);
    }
  });

  it('includes additionalSources in both the report and the Sources list', () => {
    const developments = [
      {
        country: 'Switzerland',
        title: 'Sunday and night driving ban',
        whatChanged: 'Ban applies.',
        where: 'Nationwide',
        impact: 'No movement allowed.',
        recommendedAction: 'Apply for a permit.',
        isDrivingBan: true,
        isInfrastructure: false,
        sourceUrl: 'https://example.test/ch-primary',
        sourceName: 'ASTRA primary',
        additionalSources: [{ name: 'ASTRA secondary', url: 'https://example.test/ch-secondary' }],
      },
    ];
    const { body } = renderArticleMarkdown(makeArticle(developments), {
      slug: 'eu-oversize-weekly-2026-w99',
      publishedAt: '2026-08-21',
      nextPublicationLabel: null,
    });
    expect(body).toContain('[ASTRA secondary](https://example.test/ch-secondary)');
    const sourcesSection = body.split('## Sources')[1];
    expect(sourcesSection).toContain('https://example.test/ch-secondary');
  });
});
