import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { getDrivingBansSnapshot } from '../../../config/driving-ban-calendars/runtime.mjs';
import { banStateText, verificationStateText, openItemCategory, openItemTexts } from './public-labels.mjs';

const CODE = /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/;
const clocks = ['2026-10-15T08:00:00Z', '2026-11-02T08:00:00Z', '2026-12-02T08:00:00Z'];

describe('public driving-bans wording', () => {
  it('translates every ban and verification state without exposing the code', () => {
    for (const state of ['HAS_BAN', 'NO_BAN', 'UNKNOWN']) for (const cs of [false, true]) {
      expect(banStateText(state, cs)).not.toMatch(CODE);
      expect(banStateText(state, cs)).not.toContain(state);
    }
    for (const state of ['PRIMARY_VERIFIED', 'CROSSCHECKED', 'UNVERIFIED', 'SOURCE_UNAVAILABLE']) for (const cs of [false, true]) {
      expect(verificationStateText(state, cs)).not.toMatch(CODE);
    }
    expect(verificationStateText('UNVERIFIED', true)).toBe('Ověření probíhá');
    expect(banStateText('NO_BAN', true)).toContain('Bez zákazu');
  });

  it('turns every open review code in the live registry into public text', () => {
    for (const clock of clocks) {
      const view = getDrivingBansSnapshot(new Date(clock));
      for (const j of view.jurisdictions) for (const cs of [false, true]) {
        const texts = openItemTexts(j.coverage_failures, cs);
        expect(texts.length > 0).toBe(j.coverage_failures.length > 0);
        for (const text of texts) expect(text).not.toMatch(CODE);
        expect(new Set(texts).size).toBe(texts.length);
      }
    }
  });

  it('classifies codes by meaning and falls back to an incomplete review', () => {
    expect(openItemCategory('ACTIVE_WINDOW_NOT_REVERIFIED').key).toBe('window');
    expect(openItemCategory('LOW_WATER_EXEMPTIONS_AFTER_2026_10_31_NOT_PRIMARY_CONFIRMED').key).toBe('exemptions');
    expect(openItemCategory('PRIMARY_SOURCE_UNAVAILABLE').key).toBe('source');
    expect(openItemCategory('BG_ADHOC_WEEKEND_ORDERS_ANNOUNCED_AT_SHORT_NOTICE').key).toBe('short_notice');
    expect(openItemCategory('AT_TYROL_SECTORAL_BAN_GOODS_LIST_NOT_ENCODED').key).toBe('not_in_calendar');
    // "EXCEPTIONAL" transport is not an exemption.
    expect(openItemCategory('EXCEPTIONAL_TRANSPORT_PERMIT_REGIME_NOT_REVIEWED').key).toBe('review');
    expect(openItemCategory('SOME_FUTURE_CODE').key).toBe('review');
    expect(openItemTexts(['FULL_SCOPE_PRIMARY_REVIEW_NOT_COMPLETED', 'ACTIVE_WINDOW_NOT_REVERIFIED'], true)).toEqual([
      'Aktuální období zatím nebylo znovu ověřeno z úředních zdrojů.',
      'Kontrola úředních zdrojů pro tuto jurisdikci zatím není úplná.',
    ]);
  });

  it('keeps internal review notes and raw codes out of the page template', () => {
    const page = readFileSync(new URL('../../pages/driving-bans.astro', import.meta.url), 'utf8');
    expect(page).not.toMatch(/\{j\.notes/);
    expect(page).not.toMatch(/coverage_failures\.join/);
    expect(page).not.toMatch(/<strong>\{j\.verification_state\}<\/strong>/);
    expect(page).not.toMatch(/\}\s*(?:HAS_BAN|NO_BAN|UNKNOWN)\b/);
    expect(page).toMatch(/openItemTexts\(j\.coverage_failures, cs\)/);
    // The warnings against reading missing events as "no ban" stay.
    expect(page).toContain('Missing events never mean unrestricted travel.');
    expect(page).toContain('Chybějící události nikdy neznamenají volný průjezd.');
  });
});
