import { describe, expect, it } from 'vitest';
import { renderArticleMarkdown, categorizeDevelopment, toFrontmatterYaml, safeUrl } from '../render-article.mjs';

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
  it('renders non-lead verified items in a distinct Europe-wide roundup', () => {
    const lead = {
      country: 'Germany', title: 'Lead report', whatChanged: 'Change.', where: 'DE', impact: 'Impact.',
      recommendedAction: 'Act.', isDrivingBan: true, isInfrastructure: false,
      sourceUrl: 'https://example.test/lead', sourceName: 'Lead source',
    };
    const roundup = {
      country: 'Romania', title: 'Romania roundup report', whatChanged: 'Change.', where: 'RO', impact: 'Impact.',
      recommendedAction: 'Act.', isDrivingBan: false, isInfrastructure: true,
      sourceUrl: 'https://example.test/roundup', sourceName: 'Roundup source',
    };
    const { body } = renderArticleMarkdown(makeArticle([lead], { europeRoundup: [roundup] }), {
      slug: 'eu-oversize-weekly-2026-w99', publishedAt: '2026-08-21', nextPublicationLabel: null,
    });
    expect(body).toContain('## Rest of Europe: verified operational roundup');
    expect(body).toContain('Romania roundup report');
    expect(body.split('Romania roundup report').length - 1).toBe(1);
  });

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

  it('puts an exceptional-transport movement restriction under its own section and never under "Infrastructure restrictions"', () => {
    const developments = [
      {
        country: 'Austria',
        title: 'Abnormal-load movement window shortened',
        whatChanged: 'Exceptional transports may no longer move on Friday afternoons.',
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
    expect(body).toContain('**Category:** Exceptional-transport movement restriction');
    expect(body).not.toContain('Driving bans');
    expect(body).not.toContain('## Infrastructure restrictions');
    expect(body).not.toContain('## Main developments');
  });

  it('renders all lead reports in one ordered section, plus checklist and sources', () => {
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
    expect(body).toContain('## Lead reports');
    expect(body).toContain('## Operator checklist');
    expect(body).toContain('## Sources');
    expect(body).toContain('## Next EU Oversize Weekly');
    // Exactly one occurrence of each heading - no secondary section repeats the reports.
    for (const heading of ['## Lead reports', '## Operator checklist', '## Sources']) {
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

  // Regression (W41): the Rest-of-Europe heading carried the internal rule
  // "At least ten concise verified items from at least six countries".
  it('never prints counting rules in the Rest-of-Europe section', () => {
    const roundup = {
      country: 'Norway', title: 'Roundup report', whatChanged: 'Change.', where: 'NO', impact: 'Impact.',
      recommendedAction: 'Act.', isDrivingBan: false, isInfrastructure: false,
      sourceUrl: 'https://example.test/r1', sourceName: 'Roundup source',
    };
    const lead = { ...roundup, country: 'Czechia', title: 'Lead report', sourceUrl: 'https://example.test/l1' };
    const { body } = renderArticleMarkdown(makeArticle([lead], { europeRoundup: [roundup] }), {
      slug: 'eu-oversize-weekly-2026-w99', publishedAt: '2026-08-21', nextPublicationLabel: null,
    });
    expect(body).not.toMatch(/at least|minimum|ten concise|six countries/i);
  });

  it('omits the Rest-of-Europe section entirely when there are no roundup items', () => {
    const lead = {
      country: 'Czechia', title: 'Lead report', whatChanged: 'Change.', where: 'CZ', impact: 'Impact.',
      recommendedAction: 'Act.', isDrivingBan: false, isInfrastructure: false,
      sourceUrl: 'https://example.test/l1', sourceName: 'Lead source',
    };
    const { body } = renderArticleMarkdown(makeArticle([lead], { europeRoundup: [] }), {
      slug: 'eu-oversize-weekly-2026-w99', publishedAt: '2026-08-21', nextPublicationLabel: null,
    });
    expect(body).not.toContain('Rest of Europe');
  });

  it('writes updatedAt into the frontmatter of a corrected edition', () => {
    const lead = {
      country: 'Czechia', title: 'Lead report', whatChanged: 'Change.', where: 'CZ', impact: 'Impact.',
      recommendedAction: 'Act.', sourceUrl: 'https://example.test/l1', sourceName: 'Lead source',
    };
    const { frontmatter } = renderArticleMarkdown(makeArticle([lead]), {
      slug: 'eu-oversize-weekly-2026-w41', publishedAt: '2026-10-02T10:00:00.000Z', updatedAt: '2026-10-02T15:00:00.000Z', nextPublicationLabel: null,
    });
    expect(frontmatter.updatedAt).toBe('2026-10-02T15:00:00.000Z');
    expect(toFrontmatterYaml(frontmatter)).toContain('updatedAt: 2026-10-02T15:00:00.000Z');
  });

  it('keeps the pipeline order of lead reports across categories', () => {
    const make = (country, title, isInfrastructure) => ({
      country, title, whatChanged: 'Change.', recommendedAction: 'Act now.', isDrivingBan: false, isInfrastructure,
      sourceUrl: `https://example.test/${title}`, sourceName: 'Source',
    });
    const { body } = renderArticleMarkdown(makeArticle([
      make('Czechia', 'first', false),
      make('Madeira', 'second', true),
    ]), { slug: 'eu-oversize-weekly-2026-w99', publishedAt: '2026-08-21', nextPublicationLabel: null });
    expect(body.indexOf('### first')).toBeLessThan(body.indexOf('### second'));
  });

  it('marks a change taking effect after the covered week as outlook', () => {
    const item = {
      country: 'Austria', title: 'Escort rule change', whatChanged: 'New escort rule.', recommendedAction: 'Prepare escorts.',
      validFrom: '2026-10-20', sourceUrl: 'https://example.test/o', sourceName: 'Source',
    };
    const { body } = renderArticleMarkdown(makeArticle([item]), {
      slug: 'eu-oversize-weekly-2026-w41', publishedAt: '2026-10-02', nextPublicationLabel: null, weekEnd: '2026-10-11',
    });
    expect(body).toContain('**Outlook:** takes effect 2026-10-20');
  });
});

// Audit DAJC-SEC-AUDIT-2026-10, F-09: article text is LLM output derived from
// third-party pages and is published without human review, so a
// prompt-injected source must not be able to inject HTML or script links.
describe('untrusted article content', () => {
  const base = {
    country: 'Germany', title: 'Report', whatChanged: 'Change.', where: 'DE', impact: 'Impact.',
    recommendedAction: 'Act.', isDrivingBan: false, isInfrastructure: true,
    sourceUrl: 'https://example.test/a', sourceName: 'Source',
  };
  const opts = { slug: 'eu-oversize-weekly-2026-w99', publishedAt: '2026-08-21', nextPublicationLabel: null };

  it('escapes HTML in every text field', () => {
    const item = {
      ...base,
      title: '<img src=x onerror=alert(1)>',
      whatChanged: '<script>alert(1)</script> A&B',
      sourceName: '</a><iframe>',
    };
    const { body } = renderArticleMarkdown(makeArticle([item], { intro: '<b>x</b>' }), opts);
    expect(body).not.toMatch(/<(script|img|iframe|b)\b/i);
    expect(body).not.toContain('</a>');
    expect(body).toContain('&lt;script&gt;alert(1)&lt;/script&gt; A&amp;B');
  });

  it('rejects non-http(s) source URLs', () => {
    for (const url of ['javascript:alert(1)', 'data:text/html,<script>', '/relative', 'not a url']) {
      expect(() => renderArticleMarkdown(makeArticle([{ ...base, sourceUrl: url }]), opts)).toThrow(/Unsafe source URL/);
    }
    expect(() =>
      renderArticleMarkdown(makeArticle([{ ...base, additionalSources: [{ name: 'x', url: 'javascript:alert(1)' }] }]), opts)
    ).toThrow(/Unsafe source URL/);
  });

  it('keeps URLs from breaking out of Markdown link syntax', () => {
    expect(safeUrl('https://example.test/a)(b c')).toBe('https://example.test/a%29%28b%20c');
  });
});
