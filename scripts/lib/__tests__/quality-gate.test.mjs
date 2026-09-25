import { describe, expect, it } from 'vitest';
import { runQualityGate } from '../quality-gate.mjs';

const weekStart = new Date('2026-09-07T00:00:00Z');
const weekEnd = new Date('2026-09-13T00:00:00Z');
const countries = ['Spain','Romania','Denmark','Portugal','Croatia','Switzerland','Belgium','Lithuania'];

function makeDevelopment(i, overrides = {}) {
  return {
    country: countries[i % countries.length],
    title: `Exceptional transport road permit change ${i}`,
    whatChanged: 'A verified exceptional transport road permit or routing requirement changed.',
    where: 'National road network',
    vehicleScope: 'Heavy and exceptional road transport',
    timeWindow: '',
    validFrom: '2026-09-08',
    validTo: '2026-09-10',
    impact: 'Operators may need to change routing, permits or dispatch timing.',
    recommendedAction: 'Check the official source and update the transport plan before dispatch.',
    exemptions: '',
    isDrivingBan: false,
    isInfrastructure: false,
    sourceUrl: `https://example.test/report-${i}`,
    sourceName: `Official road authority ${i}`,
    ...overrides,
  };
}

function baseEdition() {
  const developments = Array.from({ length: 20 }, (_, i) => makeDevelopment(i));
  const europeRoundup = Array.from({ length: 10 }, (_, i) => makeDevelopment(100 + i));
  return { developments, europeRoundup };
}

function makeFrontmatter(items) {
  return {
    title: 'DAJC European Oversize Intelligence test edition',
    description: 'Verified heavy and exceptional road transport changes across Europe.',
    slug: 'eu-oversize-weekly-2026-w37',
    category: 'eu-oversize',
    publishedAt: '2026-09-04',
    language: 'en',
    author: 'DAJC',
    status: 'published',
    sources: items.map((d) => ({ name: d.sourceName, url: d.sourceUrl })),
  };
}

const LONG_BODY = 'x'.repeat(800);

function run({ developments, europeRoundup, requiredSourceUrls = [] }) {
  const all = [...developments, ...europeRoundup];
  return runQualityGate({
    frontmatter: makeFrontmatter(all),
    body: LONG_BODY,
    developments,
    europeRoundup,
    weekStart,
    weekEnd,
    requiredSourceUrls,
  });
}

describe('DAJC Weekly quality gate', () => {
  it('passes exactly 20 lead reports plus 10 roundup reports across at least six countries', () => {
    const edition = baseEdition();
    const gate = run(edition);
    expect(gate.ok).toBe(true);
  });

  it('publishes a small edition: 5 lead reports plus 1 roundup report', () => {
    const edition = baseEdition();
    edition.developments = edition.developments.slice(0, 5);
    edition.europeRoundup = edition.europeRoundup.slice(0, 1);
    const gate = run(edition);
    expect(gate.errors).toEqual([]);
    expect(gate.ok).toBe(true);
  });

  it('publishes lead reports without any roundup', () => {
    const edition = baseEdition();
    edition.developments = edition.developments.slice(0, 3);
    edition.europeRoundup = [];
    expect(run(edition).ok).toBe(true);
  });

  it('blocks an edition with no lead reports at all', () => {
    const gate = run({ developments: [], europeRoundup: [] });
    expect(gate.ok).toBe(false);
    expect(gate.errors.some((e) => /no lead reports/.test(e))).toBe(true);
  });

  it('blocks more than 30 lead reports', () => {
    const edition = baseEdition();
    edition.developments = Array.from({ length: 31 }, (_, i) => makeDevelopment(i));
    const gate = run(edition);
    expect(gate.ok).toBe(false);
    expect(gate.errors.some((e) => /31 lead reports/.test(e))).toBe(true);
  });

  it('publishes a roundup from a single jurisdiction', () => {
    const edition = baseEdition();
    edition.europeRoundup = edition.europeRoundup.slice(0, 2).map((item) => ({ ...item, country: 'Spain' }));
    expect(run(edition).ok).toBe(true);
  });

  it('blocks a general HGV driving ban (it belongs to the Driving Bans calendar)', () => {
    const edition = baseEdition();
    edition.developments[0] = {
      ...edition.developments[0],
      title: 'Public-holiday HGV driving ban for German Unity Day',
      whatChanged: 'Trucks over 7.5 t may not drive on 3 October.',
      vehicleScope: 'Trucks over 7.5 t',
      isDrivingBan: true,
    };
    const gate = run(edition);
    expect(gate.ok).toBe(false);
    expect(gate.errors.some((e) => /Driving Bans Calendar/.test(e))).toBe(true);
  });

  it('keeps a movement ban explicitly scoped to exceptional transport', () => {
    const edition = baseEdition();
    edition.developments[0] = {
      ...edition.developments[0],
      title: 'Exceptional-transport weekend movement ban',
      isDrivingBan: true,
    };
    expect(run(edition).ok).toBe(true);
  });

  it('blocks a duplicate source between leads and roundup', () => {
    const edition = baseEdition();
    edition.europeRoundup[0] = { ...edition.europeRoundup[0], sourceUrl: edition.developments[0].sourceUrl };
    const gate = run(edition);
    expect(gate.ok).toBe(false);
    expect(gate.errors.some((e) => /duplicates a sourceUrl/.test(e))).toBe(true);
  });

  it('blocks a road closure without verified duration longer than 30 days', () => {
    const edition = baseEdition();
    edition.europeRoundup[0] = {
      ...edition.europeRoundup[0],
      title: 'Motorway full closure after storm damage',
      whatChanged: 'The motorway remains fully closed to traffic.',
      isInfrastructure: true,
      validFrom: '',
      validTo: '',
    };
    const gate = run(edition);
    expect(gate.ok).toBe(false);
    expect(gate.errors.some((e) => /no verifiable planned duration longer than 30 days/.test(e))).toBe(true);
  });

  it('allows a verified closure longer than 30 days', () => {
    const edition = baseEdition();
    edition.europeRoundup[0] = {
      ...edition.europeRoundup[0],
      title: 'Motorway full closure for bridge reconstruction',
      whatChanged: 'The motorway is fully closed to traffic during bridge reconstruction.',
      isInfrastructure: true,
      validFrom: '2026-09-01',
      validTo: '2026-10-15',
    };
    const gate = run(edition);
    expect(gate.ok).toBe(true);
  });

  it('blocks omission of a required critical source', () => {
    const edition = baseEdition();
    const gate = run({ ...edition, requiredSourceUrls: ['https://example.test/critical-switzerland'] });
    expect(gate.ok).toBe(false);
    expect(gate.errors.some((e) => /critical verified development omitted/.test(e))).toBe(true);
  });
});
