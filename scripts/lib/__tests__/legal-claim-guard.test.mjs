import { describe, expect, it } from 'vitest';
import { checkLegalClaimGrounding } from '../legal-claim-guard.mjs';
import { checkGeneratedItem } from '../generated-item-filter.mjs';

// The W47 veto (run 43919182436): an Italian DRAFT Highway Code scheme was
// written as adopted law. Evidence fields mirror data/oversize findings.
const italyDraft = {
  country: 'Italy', jurisdiction: 'IT', sourceTier: 'industry', type: 'route_restriction',
  title: 'Sicurezza nei cantieri autostradali: il nuovo CdS vieta il sorpasso ai camion',
  summary: 'Nuovo CdS: vietato ai camion il sorpasso nei cantieri autostradali. Multe da 170 a 680 euro.',
  searchSummary: 'The draft new Italian Highway Code scheme would bar trucks from overtaking other vehicles in motorway roadworks. The source reports a planned entry into force on 1 April 2027.',
  sourceUrl: 'https://www.sicurauto.it/news/x',
};
const item = (overrides = {}) => ({
  country: 'Italy', title: 'Italy bans truck overtaking in motorway work zones',
  whatChanged: 'The new Highway Code bans trucks from overtaking in motorway roadworks; fines EUR 170-680.',
  where: 'Italian motorways', vehicleScope: 'Trucks', timeWindow: '', validFrom: null, validTo: null,
  impact: 'Plan longer transit times.', recommendedAction: 'Brief drivers on the overtaking ban in roadworks.',
  exemptions: '', sourceUrl: italyDraft.sourceUrl, sourceName: 'sicurauto.it', ...overrides,
});

describe('legal-claim grounding guard', () => {
  it('rejects a draft presented as adopted law (W47 regression)', () => {
    const result = checkLegalClaimGrounding(item(), italyDraft);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/draft\/proposal/);
  });
  it('accepts the same development when it stays visibly pending', () => {
    expect(checkLegalClaimGrounding(item({
      title: 'Italy: draft Highway Code would bar truck overtaking in motorway work zones',
      whatChanged: 'A draft Highway Code scheme, reported by sicurauto.it, would bar trucks from overtaking in motorway roadworks; the planned entry into force is 1 April 2027 if adopted.',
    }), italyDraft)).toEqual({ ok: true });
  });
  it('rejects legal finality the evidence does not state', () => {
    const candidate = { sourceTier: 'official', title: 'Toll tariff notice', summary: 'New toll rates for heavy goods vehicles from 1 January 2027.' };
    const result = checkLegalClaimGrounding({ title: 'Toll law has entered into force', whatChanged: 'The regulation has been adopted and is legally binding.' }, candidate);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/not stated by the source evidence/);
  });
  it('allows finality wording that the evidence itself states', () => {
    const candidate = { sourceTier: 'official', title: 'Decree published', summary: 'The decree entered into force on 1 November 2026 after it was adopted by the government.' };
    expect(checkLegalClaimGrounding({ title: 'Decree has entered into force', whatChanged: 'It was adopted by the government.' }, candidate)).toEqual({ ok: true });
  });
  it('recognises non-English draft evidence (Czech toll proposal)', () => {
    const candidate = { sourceTier: 'industry', title: 'Mýto má zdražit až o polovinu', summary: 'Ministerstvo dopravy poslalo návrh do připomínkového řízení.' };
    expect(checkLegalClaimGrounding({ title: 'Czech truck tolls rise by up to 50% from July 2027', whatChanged: 'Tolls for trucks above 3.5 t rise.' }, candidate).ok).toBe(false);
    expect(checkLegalClaimGrounding({ title: 'Czech ministry proposes truck toll rise of up to 50% from July 2027', whatChanged: 'The proposal is in consultation.' }, candidate).ok).toBe(true);
  });
  it('never lets an industry report become an official confirmation', () => {
    const candidate = { sourceTier: 'industry', title: 'Police escort schedule', summary: 'Oversize transports move on 14 November from 01:00.' };
    const result = checkLegalClaimGrounding({ title: 'Escort schedule officially confirmed', whatChanged: 'Confirmed by the police.' }, candidate);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/non-official source/);
    expect(checkLegalClaimGrounding({ title: 'Escort schedule officially confirmed' }, { ...candidate, sourceTier: 'official' }).ok).toBe(true);
  });
  it('review finding: a hedge in another field or conditional evidence cannot launder a finality claim', () => {
    const candidate = { sourceTier: 'industry', title: 'Nuovo CdS', summary: 'The draft scheme, once adopted, would enter into force on 1 April 2027.' };
    const result = checkLegalClaimGrounding({ title: 'Italy truck overtaking ban has entered into force', whatChanged: 'Trucks may no longer overtake in work zones.', recommendedAction: 'Drivers would be fined; brief them.' }, candidate);
    expect(result.ok).toBe(false);
    // a qualifier only in recommendedAction is not enough for the headline
    expect(checkLegalClaimGrounding({ title: 'Italy bans truck overtaking in work zones', whatChanged: 'Trucks may not overtake.', recommendedAction: 'Watch the proposal.' }, candidate).ok).toBe(false);
  });
  it('review finding: negated or pending wording is a correct hedge, not a claim', () => {
    const industry = { sourceTier: 'industry', title: 'Escort schedule', summary: 'Oversize transports move on 14 November from 01:00.' };
    expect(checkLegalClaimGrounding({ title: 'Escort schedule reported', whatChanged: 'Reported by trade press; not officially confirmed by the police.' }, industry)).toEqual({ ok: true });
    expect(checkLegalClaimGrounding({ title: 'Schedule pending official confirmation' }, industry)).toEqual({ ok: true });
    const official = { sourceTier: 'official', title: 'Guidance note', summary: 'Guidance for hauliers on winter equipment.' };
    expect(checkLegalClaimGrounding({ title: 'New winter guidance', whatChanged: 'The guidance is not legally binding.' }, official)).toEqual({ ok: true });
  });
  it('review finding: a historical "proposal" does not force a qualifier when the evidence states adoption', () => {
    const candidate = { sourceTier: 'official', title: 'Axle load', summary: 'The proposal was adopted by parliament and entered into force on 1 November.' };
    expect(checkLegalClaimGrounding({ title: 'New axle-load rule entered into force on 1 November', whatChanged: 'The 11.5 t drive-axle limit applies.' }, candidate)).toEqual({ ok: true });
  });
  it('review finding: a missing sourceTier follows the pipeline default (official) instead of rejecting', () => {
    expect(checkLegalClaimGrounding({ title: 'Ministry officially confirmed escort schedule' }, { title: 'Escort', summary: 'Escort schedule for 20 November.' })).toEqual({ ok: true });
  });
  it('review finding: non-ASCII legal terms match at word boundaries', () => {
    const candidate = { sourceTier: 'official', title: 'Décret', summary: 'Le décret adopté le 3 novembre.' };
    expect(checkLegalClaimGrounding({ title: 'Decree has been adopted', whatChanged: 'Adopted on 3 November.' }, candidate)).toEqual({ ok: true });
    const ro = { sourceTier: 'industry', title: 'Proiect', summary: 'Proiect de ordonanță privind transportul agabaritic.' };
    expect(checkLegalClaimGrounding({ title: 'Romania changes oversize rules', whatChanged: 'New oversize permit rules.' }, ro).ok).toBe(false);
  });
  it('is applied by the deterministic generated-item filter before review', () => {
    const result = checkGeneratedItem(item(), { candidate: italyDraft });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/draft\/proposal/);
  });
});
