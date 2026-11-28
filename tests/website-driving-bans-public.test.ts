import { describe, it, expect } from 'vitest';
import { getDrivingBansSnapshot } from '../config/driving-ban-calendars/runtime.mjs';
import { officialDrivingBansView } from '../src/lib/driving-bans/public-view.mjs';

const when = new Date('2026-11-23T08:00:00.000Z');
const original = () => getDrivingBansSnapshot(when);

describe('Public Driving Bans: primary-source verified areas only', () => {
  it('preserves the 50-code canonical registry without publishing unverified countries', () => {
    const snapshot = original();
    const publicView = officialDrivingBansView(snapshot);
    expect(snapshot.jurisdictions).toHaveLength(50);
    expect(publicView.tracked_jurisdictions).toBe(50);
    expect(publicView.jurisdictions.length).toBeLessThan(50);
    expect(publicView.jurisdictions.length).toBeGreaterThan(0);
    const published = new Set(publicView.jurisdictions.map(j => j.jurisdiction));
    expect(published.has('AD')).toBe(false);
    expect(publicView.events.every(e => published.has(e.jurisdiction))).toBe(true);
    expect(publicView.events.every(e => e.verification_state === 'PRIMARY_VERIFIED')).toBe(true);
    for (const event of publicView.events) {
      const source = publicView.sources.find(s => s.source_id === event.source_id);
      expect(source?.role).toBe('PRIMARY');
      expect(source?.url).toBe(event.source_url);
    }
  });
  it('shows verified Tyrol A12 restrictions even though Austria is not fully reviewed', () => {
    const snapshot = original();
    const austria = snapshot.jurisdictions.find(j => j.jurisdiction === 'AT');
    expect(austria?.coverage_complete).toBe(false);
    const publicView = officialDrivingBansView(snapshot);
    const verifiedA12 = publicView.events.filter(e => e.jurisdiction === 'AT' && e.roads.some(road => road.includes('A12')) && e.regions.includes('Tyrol'));
    expect(verifiedA12.length).toBeGreaterThan(0);
    expect(publicView.jurisdictions.some(j => j.jurisdiction === 'AT')).toBe(true);
    expect(publicView.jurisdictions.find(j => j.jurisdiction === 'AT')?.coverage_complete).toBe(false);
  });
  it('does not promote secondary, missing or unavailable sources into official verification', () => {
    const snapshot = structuredClone(original());
    const target = snapshot.events.find(e => e.jurisdiction === 'AT');
    expect(target).toBeDefined();
    const officialSource = snapshot.sources.find(s => s.source_id === target.source_id);
    expect(officialSource?.role).toBe('PRIMARY');
    officialSource.availability = 'SOURCE_UNAVAILABLE';
    const publicView = officialDrivingBansView(snapshot);
    expect(publicView.events.some(e => e.source_id === target.source_id)).toBe(false);
    expect(publicView.sources.some(s => s.source_id === target.source_id)).toBe(false);
  });
  it('does not show unverified countries based on UNKNOWN or unsupported NO_BAN assertions', () => {
    const snapshot = structuredClone(original());
    const ad = snapshot.jurisdictions.find(j => j.jurisdiction === 'AD');
    ad.ban_state = 'NO_BAN';
    ad.verification_state = 'UNVERIFIED';
    ad.coverage_complete = false;
    expect(officialDrivingBansView(snapshot).jurisdictions.some(j => j.jurisdiction === 'AD')).toBe(false);
  });
  it('allows an explicit full-period NO_BAN only with complete official source evidence', () => {
    const snapshot = structuredClone(original());
    const code = 'AD', id = 'synthetic-verified-no-ban';
    snapshot.sources.push({ source_id: id, url: 'https://example.invalid/official-test', authority: 'Test only', role: 'PRIMARY' });
    const ad = snapshot.jurisdictions.find(j => j.jurisdiction === code);
    Object.assign(ad, {
      ban_state: 'NO_BAN', verification_state: 'PRIMARY_VERIFIED', coverage_complete: true,
      last_verified: when.toISOString(), source_ids: [id],
      no_ban_evidence: [{ source_id: id, explicit_no_ban: true, period: snapshot.window }],
    });
    const publicView = officialDrivingBansView(snapshot);
    expect(publicView.jurisdictions.some(j => j.jurisdiction === code)).toBe(true);
  });
  it('keeps JSON, ICS and website on the same public projection', async () => {
    const { readFileSync } = await import('node:fs');
    const website = readFileSync(new URL('../src/pages/driving-bans.astro', import.meta.url), 'utf8');
    const json = readFileSync(new URL('../src/pages/api/driving-bans.json.ts', import.meta.url), 'utf8');
    const ics = readFileSync(new URL('../src/pages/api/driving-bans.ics.ts', import.meta.url), 'utf8');
    for (const content of [website, json, ics]) expect(content).toContain('officialDrivingBansView');
    // The website uses a canonical snapshot variable, unlike the APIs.
    expect(website).toContain('officialDrivingBansView(canonical)');
    expect(json).toContain('officialDrivingBansView(getDrivingBansSnapshot())');
    expect(ics).toContain('officialDrivingBansView(getDrivingBansSnapshot())');
  });
});
