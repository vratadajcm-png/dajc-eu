// The mandatory EU Oversize Weekly regression suite (cases A-R of the final
// Weekly repair brief). Each case is named after its letter.
import { describe, expect, it } from 'vitest';
import { runQualityGate, MAX_REPORTS, MAX_ROUNDUP_REPORTS } from '../quality-gate.mjs';
import { checkWeeklyEligibility } from '../weekly-eligibility.mjs';
import { selectCandidates } from '../select-candidates.mjs';
import { filterGeneratedItems } from '../generated-item-filter.mjs';
import { capSection, orderEditionItems } from '../edition-order.mjs';
import { renderArticleMarkdown } from '../render-article.mjs';

// W41 preparation: Thursday 1 October 2026, target week 5-11 October 2026.
const now = new Date('2026-10-01T05:17:00Z');
const weekStart = new Date('2026-10-05T00:00:00Z');
const weekEnd = new Date('2026-10-11T00:00:00Z');
const ctx = { now, weekStart, weekEnd, previousEditions: new Map() };

function candidate(n, overrides = {}) {
  return {
    country: 'Germany',
    type: 'permit_change',
    title: `Exceptional transport permit procedure change ref${n}`,
    summary: 'The authority changes the permit procedure for exceptional transports on federal roads.',
    sourceUrl: `https://authority.example/news/item-${n}`,
    sourceName: `Authority ${n}`,
    publishedAt: '2026-09-29',
    status: 'active',
    firstSeenAt: '2026-09-29T06:00:00Z',
    lastCheckedAt: '2026-10-01T05:00:00Z',
    ...overrides,
  };
}

function item(n, overrides = {}) {
  const c = candidate(n, overrides);
  return {
    country: c.country,
    title: c.title,
    whatChanged: c.summary,
    where: 'Federal road network',
    vehicleScope: 'Exceptional transports',
    timeWindow: '',
    validFrom: c.validFrom ?? null,
    validTo: c.validTo ?? null,
    impact: 'Permit applications need the new procedure.',
    recommendedAction: 'Submit new permit applications through the updated procedure.',
    exemptions: '',
    isDrivingBan: false,
    isInfrastructure: false,
    sourceUrl: c.sourceUrl,
    sourceName: c.sourceName,
  };
}

function gateFor(leads, roundup) {
  const developments = Array.from({ length: leads }, (_, i) => item(i));
  const europeRoundup = Array.from({ length: roundup }, (_, i) => item(500 + i, { country: 'Spain' }));
  const all = [...developments, ...europeRoundup];
  const candidatesByUrl = new Map(all.map((x, i) => [x.sourceUrl, candidate(i < leads ? i : 500 + i - leads, { country: x.country })]));
  return runQualityGate({
    frontmatter: {
      title: 'EU Oversize Weekly test', description: 'Test edition.', slug: 'eu-oversize-weekly-2026-w41',
      category: 'eu-oversize', publishedAt: '2026-10-02T10:00:00.000Z', language: 'en', author: 'DAJC',
      status: 'published', sources: all.map((x) => ({ name: x.sourceName, url: x.sourceUrl })),
    },
    body: 'Verified operational intelligence for exceptional transport. '.repeat(20),
    developments,
    europeRoundup,
    weekStart,
    weekEnd,
    candidatesByUrl,
    eligibilityContext: ctx,
  });
}

describe('A-E: quality over count, maximums kept', () => {
  it('A: 9 valid leads + 0 Rest of Europe publishes without filler', () => {
    expect(gateFor(9, 0).errors).toEqual([]);
    const { selected } = selectCandidates(Array.from({ length: 9 }, (_, i) => candidate(i)), ctx);
    expect(selected).toHaveLength(9);
  });

  it('B: 17 valid leads + 8 Rest of Europe publishes 17 + 8', () => {
    expect(gateFor(17, 8).errors).toEqual([]);
  });

  it('C: 25 valid leads + 12 Rest of Europe publishes 25 + 12', () => {
    expect(gateFor(25, 12).errors).toEqual([]);
  });

  it('D: 35 valid leads are capped at 30', () => {
    const { kept, left } = capSection(Array.from({ length: 35 }, (_, i) => item(i)), MAX_REPORTS);
    expect(MAX_REPORTS).toBe(30);
    expect(kept).toHaveLength(30);
    expect(left).toHaveLength(5);
    expect(gateFor(31, 0).ok).toBe(false);
  });

  it('E: 20 Rest-of-Europe items are capped at 15', () => {
    const { kept } = capSection(Array.from({ length: 20 }, (_, i) => item(i)), MAX_ROUNDUP_REPORTS);
    expect(MAX_ROUNDUP_REPORTS).toBe(15);
    expect(kept).toHaveLength(15);
    expect(gateFor(5, 16).ok).toBe(false);
  });
});

describe('F-H: Driving / truck bans', () => {
  it('F: an ordinary Sunday truck ban is excluded', () => {
    const result = checkWeeklyEligibility(candidate(1, {
      country: 'Austria', type: 'driving_ban',
      title: 'Sunday driving ban for trucks over 7.5 t on all Austrian roads',
      summary: 'Trucks over 7.5 t may not drive on Sundays from 00:00 to 22:00.',
    }), ctx);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/separate Driving Bans Calendar/);
  });

  it('G: a holiday HGV ban without an oversize-specific consequence is excluded', () => {
    const result = checkWeeklyEligibility(candidate(2, {
      type: 'infrastructure',
      title: 'Holiday HGV ban on German Unity Day, 3 October',
      summary: 'Lorries over 7.5 t are prohibited on the public holiday.',
    }), ctx);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/separate Driving Bans Calendar/);
  });

  it('H: an exceptional-transport-specific movement restriction is included', () => {
    const result = checkWeeklyEligibility(candidate(3, {
      country: 'Switzerland', type: 'driving_ban',
      title: 'Ausnahmetransporte: Fahrverbot an Feiertagen auf der A13 ausgeweitet',
      summary: 'Ab 5. Oktober 2026 dürfen Ausnahmetransporte an Feiertagen auch tagsüber nicht auf der A13 fahren.',
    }), ctx);
    expect(result.ok).toBe(true);
  });
});

describe('I-K: freshness and generic material', () => {
  it('I: an old article discovered today is NOT fresh merely because firstSeenAt is today', () => {
    const result = checkWeeklyEligibility(candidate(4, {
      publishedAt: '2026-05-06', status: 'new', firstSeenAt: '2026-10-01T05:00:00Z',
    }), ctx);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/newly discovered old page is not news/);
  });

  it('J: a completed school renovation is excluded', () => {
    const result = checkWeeklyEligibility(candidate(5, {
      type: 'roadworks',
      title: 'School renovation completed next to the B 27',
      summary: 'The renovation of the primary school is completed; trucks over 7.5 t may use the access road again.',
    }), ctx);
    expect(result.ok).toBe(false);
  });

  it('K: a generic roadworks page is excluded', () => {
    const result = checkWeeklyEligibility(candidate(6, {
      country: 'Slovenia', type: 'roadworks', title: 'Current roadworks', summary: 'Current roadworks on motorways for trucks.',
      sourceUrl: 'https://www.promet.si/en/current-roadworks',
    }), ctx);
    expect(result.ok).toBe(false);
  });
});

describe('L-N: road closures need a proven duration of more than 30 days', () => {
  const closure = (n, validTo) => candidate(n, {
    type: 'road_closure',
    title: `A2 motorway full closure between exits 12 and 14 ref${n}`,
    summary: `The A2 motorway is closed to traffic from 5 October 2026 to ${validTo}; HGV traffic is diverted via the B 6.`,
    validFrom: '2026-10-05',
    validTo,
  });

  it('L: a 14-day road closure is excluded', () => {
    const result = checkWeeklyEligibility(closure(7, '2026-10-19'), ctx);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/only 14 days/);
  });

  it('M: a 30-day road closure is excluded', () => {
    const result = checkWeeklyEligibility(closure(8, '2026-11-04'), ctx);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/only 30 days/);
  });

  it('N: a 31-day road closure is eligible when otherwise relevant', () => {
    expect(checkWeeklyEligibility(closure(9, '2026-11-05'), ctx).ok).toBe(true);
  });
});

describe('O-P: material changes and duplicates', () => {
  it('O: an old restriction that materially changes during the target week is eligible', () => {
    const result = checkWeeklyEligibility(candidate(10, {
      type: 'bridge_restriction',
      title: 'Elbe bridge weight limit lowered from 24 t to 12 t',
      summary: 'From 7 October 2026 the weight limit on the Elbe bridge is lowered from 24 t to 12 t.',
      publishedAt: '2026-08-15',
      firstSeenAt: '2026-08-16T06:00:00Z',
    }), ctx);
    expect(result).toEqual({ ok: true, freshness: 'takes-effect' });
  });

  it('P: a duplicate source URL yields one item only', () => {
    const twice = [candidate(11), { ...candidate(11), lastCheckedAt: '2026-09-30T05:00:00Z' }];
    expect(selectCandidates(twice, ctx).selected).toHaveLength(1);
    const filtered = filterGeneratedItems([item(11), { ...item(11), title: 'Same source, other wording' }], { weekStart, weekEnd });
    expect(filtered.kept).toHaveLength(1);
    expect(filtered.dropped[0].reason).toBe('duplicate sourceUrl');
  });
});

describe('Q-R: public text and operator-first order', () => {
  function render(developments, europeRoundup = []) {
    return renderArticleMarkdown(
      { seoTitle: 'T', metaDescription: 'D', intro: 'Intro.', developments, europeRoundup, operatorChecklist: ['Check permits.'] },
      { slug: 'eu-oversize-weekly-2026-w41', publishedAt: '2026-10-02T10:00:00.000Z', nextPublicationLabel: null, weekEnd: '2026-10-11' }
    ).body;
  }

  it('Q: internal quality-gate wording never appears in the rendered public article', () => {
    const body = render([item(12)], [item(13, { country: 'Spain' })]);
    for (const internal of [/at least ten/i, /minimum six/i, /quality gate/i, /candidate/i, /verified source set/i, /minimum 20/i]) {
      expect(body).not.toMatch(internal);
    }
    const leaked = gateFor(3, 0);
    expect(leaked.ok).toBe(true);
    const blocked = runQualityGate({
      frontmatter: null,
      body: `${'x'.repeat(500)} The verified source set had only 3 reports; minimum six countries.`,
      developments: [item(14)],
      europeRoundup: [],
    });
    expect(blocked.errors).toContain('public article contains internal DAJC editorial/publishing mechanics');
  });

  it('R: equally relevant Central-European reports lead peripheral jurisdictions', () => {
    const equallyRelevant = ['Madeira', 'Jersey', 'Austria', 'Germany', 'Czechia'].map((country, i) => item(20 + i, {
      country,
      title: `Bridge weight limit change ref${20 + i}`,
      summary: 'Bridge weight limit for lorries changes to 12 t.',
    }));
    const ordered = orderEditionItems(equallyRelevant);
    expect(ordered.map((x) => x.country)).toEqual(['Czechia', 'Germany', 'Austria', 'Madeira', 'Jersey']);
    const body = render(ordered);
    const positions = ordered.map((x) => body.indexOf(`(${x.country})`));
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it('R: a critical peripheral development can still lead a weak Central-European report', () => {
    const weakCentral = item(30, { country: 'Czechia', title: 'Toll portal maintenance window ref30', summary: 'Truck toll portal maintenance.' });
    const criticalPeripheral = item(31, { country: 'Madeira', title: 'New abnormal-load escort rule ref31' });
    const ordered = orderEditionItems([weakCentral, criticalPeripheral], { criticalUrls: new Set([criticalPeripheral.sourceUrl]) });
    expect(ordered.map((x) => x.country)).toEqual(['Madeira', 'Czechia']);
  });
});
