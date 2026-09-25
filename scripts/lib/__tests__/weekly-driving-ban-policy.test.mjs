import { describe, expect, it } from 'vitest';
import { checkWeeklyDrivingBanPolicy } from '../weekly-driving-ban-policy.mjs';
import { filterGeneratedItems } from '../generated-item-filter.mjs';

describe('checkWeeklyDrivingBanPolicy', () => {
  it('leaves general holiday and transit bans to the Driving Bans calendar', () => {
    for (const title of [
      'Day of German Unity public-holiday driving ban (Germany)',
      'Public-holiday driving ban for St. Wenceslas Day (Czechia)',
      'Germany-bound transit ban for German Unity Day (Luxembourg)',
    ]) {
      expect(checkWeeklyDrivingBanPolicy({ title, isDrivingBan: true }).ok).toBe(false);
    }
  });

  it('keeps bans explicitly scoped to exceptional transport, hyphenated or not', () => {
    expect(checkWeeklyDrivingBanPolicy({ title: 'Exceptional-transport weekend movement ban', type: 'driving_ban' }).ok).toBe(true);
    expect(checkWeeklyDrivingBanPolicy({ title: 'Extraordinary-transport stoppages - A6 Rijeka-Kikovica', isDrivingBan: true }).ok).toBe(true);
    expect(checkWeeklyDrivingBanPolicy({ title: 'Weekend ban', summary: 'Applies to convoi exceptionnel movements.', isDrivingBan: true }).ok).toBe(true);
  });

  it('ignores exceptional-transport mentions that only appear in exemptions or impact notes', () => {
    expect(checkWeeklyDrivingBanPolicy({
      title: 'Sunday and nightly HGV driving ban (4 October 2026)',
      summary: 'Nightly 22:00-05:00 ban and all-day Sunday ban for heavy vehicle classes.',
      vehicleScope: 'Heavy motor vehicles above 3.5t',
      impact: 'Affected vehicles require a valid exception/permit.',
      exemptions: 'Exceptional transports also need their separate special-transport authorisation.',
      isDrivingBan: true,
    }).ok).toBe(false);
  });

  it('does not touch items that are not driving bans', () => {
    expect(checkWeeklyDrivingBanPolicy({ title: 'A4 Köln weight limit 44 t', type: 'weight_restriction' }).ok).toBe(true);
  });
});

describe('filterGeneratedItems', () => {
  it('drops a general driving ban returned by the model', () => {
    const { kept, dropped } = filterGeneratedItems([
      {
        title: 'Day of German Unity public-holiday driving ban',
        whatChanged: 'Trucks over 7.5 t may not use German roads on 3 October.',
        isDrivingBan: true,
        recommendedAction: 'Plan around the holiday.',
        sourceUrl: 'https://example.test/de-holiday',
      },
    ]);
    expect(kept).toEqual([]);
    expect(dropped[0].reason).toMatch(/Driving Bans Calendar/);
  });
});
