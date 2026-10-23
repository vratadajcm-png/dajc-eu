import { describe, it, expect } from 'vitest';
import {
  sourceTier, needsSecondaryDiscovery, isOfficialPublisher,
  secondaryAttribution, MIN_PRIMARY_ITEMS_BEFORE_FALLBACK,
} from '../source-policy.mjs';
import { dedupeNearDuplicates } from '../select-candidates.mjs';
import { renderArticleMarkdown } from '../render-article.mjs';
import { isCriticalWeeklyCandidate } from '../critical-floor.mjs';

describe('official-first European source policy', () => {
  it('classifies government as primary and trade media as secondary', () => {
    expect(isOfficialPublisher('https://www.gov.uk/government/news/special-transport')).toBe(true);
    expect(sourceTier('https://www.heavytorque.co.uk/news/oversize-loads')).toBe('industry');
  });
  it('falls back only when primary news is sparse, never to meet a publication quota', () => {
    expect(MIN_PRIMARY_ITEMS_BEFORE_FALLBACK).toBe(3);
    expect(needsSecondaryDiscovery(0)).toBe(true);
    expect(needsSecondaryDiscovery(2)).toBe(true);
    expect(needsSecondaryDiscovery(3)).toBe(false);
    expect(needsSecondaryDiscovery(30)).toBe(false);
  });
  it('labels industry source citations without claiming official confirmation', () => {
    const article = {
      seoTitle: 'Industry update', metaDescription: 'Practical fleet update',
      intro: 'Practical relevance to heavy freight',
      developments: [{
        country: 'United Kingdom', title: 'Fleet technology for heavy trucks',
        whatChanged: 'A dispatcher workflow change has been announced.', where: 'UK',
        recommendedAction: 'Operators should evaluate their dispatch tools.',
        sourceUrl: 'https://www.heavytorque.co.uk/news/fleet-update',
        sourceName: 'HeavyTorque', sourceTier: 'industry', type: 'equipment',
        isDrivingBan: false, isInfrastructure: false,
      }],
      europeRoundup: [], operatorChecklist: ['Review tools.'],
    };
    const rendered = renderArticleMarkdown(article, {
      slug: 'eu-oversize-weekly-2026-w44',
      publishedAt: '2026-10-23T10:00:00Z',
      nextPublicationLabel: null,
    });
    expect(rendered.body).toContain('Industry report — not an official authority notice');
    expect(secondaryAttribution({ sourceTier: 'industry', type: 'permit_change' })).toContain('regulatory/route conditions require confirmation');
  });
  it('prefers primary pages over duplicative second-hand headlines', () => {
    const common = {
      country: 'Germany', title: 'New abnormal transport permit rule for heavy trucks',
      type: 'permit_change', sourceName: 'Publisher', status: 'new',
    };
    const secondary = { ...common, sourceUrl: 'https://media.example/a', sourceTier: 'industry', publishedAt: '2026-10-22' };
    const primary = { ...common, sourceUrl: 'https://www.gov.uk/news/a', sourceTier: 'official', publishedAt: '2026-10-20' };
    expect(dedupeNearDuplicates([secondary, primary])).toEqual([primary]);
  });
  it('does not treat media-only reports as mandatory regulatory critical news', () => {
    const report = {
      country: 'Germany', sourceUrl: 'https://media.example/oversize',
      title: 'New exceptional transport permit system', summary: 'Oversize exceptional transport authorisations changed',
      type: 'permit_change', publishedAt: '2026-10-22', sourceTier: 'industry',
    };
    const ctx = { now: new Date('2026-10-23T10:00:00Z'),
      weekStart: new Date('2026-10-26T00:00:00Z'), weekEnd: new Date('2026-11-01T00:00:00Z') };
    expect(isCriticalWeeklyCandidate(report, ctx)).toBe(false);
    expect(isCriticalWeeklyCandidate({ ...report, sourceTier: 'official' }, ctx)).toBe(true);
  });
});
