import { describe, expect, it } from 'vitest';
import { runQualityGate } from '../quality-gate.mjs';

const weekStart = new Date('2026-10-05T00:00:00Z');
const weekEnd = new Date('2026-10-11T00:00:00Z');
const now = new Date('2026-10-01T10:00:00Z');
const countries = ['Germany', 'Czechia', 'Austria', 'Poland', 'Slovakia', 'Hungary', 'Switzerland', 'Slovenia'];

function makeDevelopment(i, overrides = {}) {
  return {
    country: countries[i % countries.length],
    title: `Exceptional transport permit procedure change number ${i}`,
    whatChanged: 'A verified exceptional transport road permit or routing requirement changed.',
    where: 'National road network',
    vehicleScope: 'Heavy and exceptional road transport',
    timeWindow: '',
    validFrom: null,
    validTo: null,
    impact: 'Operators may need to change routing, permits or dispatch timing.',
    recommendedAction: 'Check the official source and update the transport plan before dispatch.',
    exemptions: '',
    isDrivingBan: false,
    isInfrastructure: false,
    sourceUrl: `https://authority.example/news/report-${i}`,
    sourceName: `Official road authority ${i}`,
    ...overrides,
  };
}

// The verified record behind an item, as the generator passes it to the gate.
function candidateFor(item, overrides = {}) {
  return {
    country: item.country,
    type: 'permit_change',
    title: item.title,
    summary: item.whatChanged,
    sourceUrl: item.sourceUrl,
    sourceName: item.sourceName,
    publishedAt: '2026-09-29',
    validFrom: item.validFrom,
    validTo: item.validTo,
    status: 'active',
    ...overrides,
  };
}

function makeFrontmatter(items) {
  const sources = [];
  for (const item of items) {
    sources.push({ name: item.sourceName, url: item.sourceUrl });
    for (const extra of item.additionalSources || []) sources.push({ name: extra.name, url: extra.url });
  }
  return {
    title: 'DAJC European Oversize Intelligence test edition',
    description: 'Verified heavy and exceptional road transport changes across Europe.',
    slug: 'eu-oversize-weekly-2026-w41',
    category: 'eu-oversize',
    publishedAt: '2026-10-02T10:00:00.000Z',
    language: 'en',
    author: 'DAJC',
    status: 'published',
    sources,
  };
}

const LONG_BODY = 'Verified operational intelligence for exceptional transport. '.repeat(20);

function edition(leads, roundup) {
  return {
    developments: Array.from({ length: leads }, (_, i) => makeDevelopment(i)),
    europeRoundup: Array.from({ length: roundup }, (_, i) => makeDevelopment(100 + i)),
  };
}

function run({ developments, europeRoundup, requiredSourceGroups = [], body = LONG_BODY, candidateOverrides = {}, withCandidates = true }) {
  const all = [...developments, ...europeRoundup];
  const candidatesByUrl = withCandidates
    ? new Map(all.map((item) => [item.sourceUrl, candidateFor(item, candidateOverrides[item.sourceUrl] || {})]))
    : null;
  return runQualityGate({
    frontmatter: makeFrontmatter(all),
    body,
    developments,
    europeRoundup,
    weekStart,
    weekEnd,
    candidatesByUrl,
    eligibilityContext: withCandidates ? { now, weekStart, weekEnd, previousEditions: new Map() } : null,
    requiredSourceGroups,
  });
}

describe('DAJC Weekly quality gate - quality over count', () => {
  it.each([
    [17, 8],
    [9, 0],
    [25, 12],
    [1, 0],
    [30, 15],
  ])('publishes a genuine %i + %i edition without padding', (leads, roundup) => {
    const gate = run(edition(leads, roundup));
    expect(gate.errors).toEqual([]);
    expect(gate.ok).toBe(true);
  });

  it('has no Rest-of-Europe minimum and no country quota', () => {
    const gate = run(edition(12, 2));
    expect(gate.ok).toBe(true);
    expect(gate.errors.join(' ')).not.toMatch(/minimum|at least|countries\/jurisdictions/i);
  });

  it('blocks an edition with no lead report at all', () => {
    const gate = run(edition(0, 0));
    expect(gate.ok).toBe(false);
    expect(gate.errors.some((e) => /no lead report/.test(e))).toBe(true);
  });

  it('keeps the maximum of 30 lead reports', () => {
    const gate = run(edition(31, 0));
    expect(gate.ok).toBe(false);
    expect(gate.errors.some((e) => /31 lead reports - maximum is 30/.test(e))).toBe(true);
  });

  it('keeps the maximum of 15 Rest-of-Europe reports', () => {
    const gate = run(edition(10, 16));
    expect(gate.ok).toBe(false);
    expect(gate.errors.some((e) => /Rest of Europe has 16 reports - maximum is 15/.test(e))).toBe(true);
  });

  it('blocks a duplicate source between leads and roundup', () => {
    const e = edition(3, 2);
    e.europeRoundup[0] = { ...e.europeRoundup[0], sourceUrl: e.developments[0].sourceUrl };
    const gate = run(e);
    expect(gate.ok).toBe(false);
    expect(gate.errors.some((x) => /already cited by developments\[0\]/.test(x))).toBe(true);
  });

  it('blocks a URL cited both as a report and as another report\'s "Also see" source', () => {
    const e = edition(3, 0);
    e.developments[0] = {
      ...e.developments[0],
      additionalSources: [{ name: 'Duplicate', url: e.developments[1].sourceUrl }],
    };
    const gate = run(e);
    expect(gate.ok).toBe(false);
    expect(gate.errors.some((x) => /every development appears once/.test(x))).toBe(true);
  });

  it('blocks a road closure without verified duration longer than 30 days', () => {
    const e = edition(3, 1);
    e.europeRoundup[0] = {
      ...e.europeRoundup[0],
      title: 'Motorway full closure after storm damage affects HGV traffic',
      whatChanged: 'The motorway remains fully closed to traffic for lorries.',
      isInfrastructure: true,
    };
    const gate = run(e);
    expect(gate.ok).toBe(false);
    expect(gate.errors.some((x) => /no verifiable planned duration longer than 30 days/.test(x))).toBe(true);
  });

  it('allows a verified closure longer than 30 days', () => {
    const e = edition(3, 1);
    e.europeRoundup[0] = {
      ...e.europeRoundup[0],
      title: 'Motorway full closure for bridge reconstruction affects HGV routing',
      whatChanged: 'The motorway is fully closed to traffic during bridge reconstruction; lorries are diverted.',
      isInfrastructure: true,
      validFrom: '2026-10-05',
      validTo: '2026-12-15',
    };
    const gate = run(e);
    expect(gate.errors).toEqual([]);
  });

  it('blocks omission of a required critical development', () => {
    const gate = run({ ...edition(3, 0), requiredSourceGroups: [['https://authority.example/critical-switzerland']] });
    expect(gate.ok).toBe(false);
    expect(gate.errors.some((e) => /critical verified development omitted/.test(e))).toBe(true);
  });

  it('accepts a critical development covered by any one of its official pages', () => {
    const e = edition(3, 0);
    const gate = run({ ...e, requiredSourceGroups: [['https://authority.example/other-page', e.developments[1].sourceUrl]] });
    expect(gate.ok).toBe(true);
  });

  it('blocks an item whose source was published outside the freshness window (old page discovered now)', () => {
    const e = edition(3, 0);
    const gate = run({ ...e, candidateOverrides: { [e.developments[2].sourceUrl]: { publishedAt: '2026-05-06' } } });
    expect(gate.ok).toBe(false);
    expect(gate.errors.some((x) => /published 2026-05-06, older than the 7-day freshness window/.test(x))).toBe(true);
  });

  it('blocks an undated item', () => {
    const e = edition(2, 0);
    const gate = run({ ...e, candidateOverrides: { [e.developments[0].sourceUrl]: { publishedAt: null } } });
    expect(gate.ok).toBe(false);
    expect(gate.errors.some((x) => /no verifiable publication or effective date/.test(x))).toBe(true);
  });

  it('blocks an item that does not belong to the verified candidate set', () => {
    const e = edition(2, 0);
    const all = [...e.developments];
    const gate = runQualityGate({
      frontmatter: makeFrontmatter(all),
      body: LONG_BODY,
      developments: e.developments,
      europeRoundup: [],
      weekStart,
      weekEnd,
      candidatesByUrl: new Map([[all[0].sourceUrl, candidateFor(all[0])]]),
      eligibilityContext: { now, weekStart, weekEnd, previousEditions: new Map() },
    });
    expect(gate.ok).toBe(false);
    expect(gate.errors.some((x) => /not a verified candidate/.test(x))).toBe(true);
  });

  it('blocks a general HGV driving ban', () => {
    const e = edition(2, 0);
    e.developments[1] = {
      ...e.developments[1],
      title: 'Austria public-holiday lorry driving ban on 26 October',
      whatChanged: 'Lorries over 7.5 t may not drive on the national holiday.',
      isDrivingBan: true,
    };
    const gate = run(e);
    expect(gate.ok).toBe(false);
    expect(gate.errors.some((x) => /separate Driving Bans Calendar/.test(x))).toBe(true);
  });

  it.each([
    'At least ten concise verified items from at least six countries.',
    'This edition has only 9 reports because the verified candidate pool was small.',
    'The normal 20–30 lead target was not reached.',
  ])('blocks internal editorial mechanics in public text: %s', (leak) => {
    const gate = run({ ...edition(3, 0), body: `${LONG_BODY}\n\n${leak}` });
    expect(gate.ok).toBe(false);
    expect(gate.errors).toContain('public article contains internal DAJC editorial/publishing mechanics');
  });
});
