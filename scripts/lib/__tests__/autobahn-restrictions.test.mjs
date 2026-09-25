import { describe, expect, it } from 'vitest';
import {
  buildRestrictionFindings,
  fetchAutobahnRestrictionFindings,
  isOngoingRestriction,
  parseRoadworksRestriction,
} from '../autobahn-restrictions.mjs';

// Real record shapes from verkehr.autobahn.de (A4 Köln, September 2026).
const eifeltorMain = {
  identifier: '2024-046557--vi-bs.2026-07-16_18-00-00-000.devi-zus.2024-10-19_15-00-00-000.f.de282',
  title: 'A4 | Köln-Klettenberg - Köln-Eifeltor',
  subtitle: ' Heerlen/Aachen -> Köln',
  description: [
    'Zeitraum dieser Bauphase:',
    'Beginn: 16.07.26 um 18:00 Uhr',
    'Ende: 01.12.29 um 05:00 Uhr',
    '(Ende der Gesamtmaßnahme: 01.12.29)',
    '',
    'A4: Heerlen/Aachen -> Köln, zwischen 0.2 km hinter AS Köln-Klettenberg und 0.1 km vor AS Köln-Eifeltor',
    '',
    'Länge: 1.01 km | Maximale Durchfahrtsbreite: 3.25 m | zulässiges Gesamtgewicht: 44 t',
    '',
    'BW Eifeltor',
  ],
};

const eifeltorRamp = {
  identifier: 'ramp-2026-07-29',
  title: 'BW Eifeltor',
  subtitle: ' AS Köln-Klettenberg (aus Richtung Köln-West) nach A4',
  description: [
    'Zeitraum dieser Bauphase:',
    'Beginn: 29.07.26 um 18:00 Uhr',
    'Ende: 31.12.28 um 05:00 Uhr',
    '(Ende der Gesamtmaßnahme: 01.12.29)',
    '',
    'Länge: 0.48 km | Maximale Durchfahrtsbreite: 3.25 m | zulässiges Gesamtgewicht: 44 t',
    '',
    'BW Eifeltor',
  ],
};

const ordinaryLaneNarrowing = {
  identifier: 'narrow-lane',
  title: 'A4 | Köln-Süd - Rodenkirchener Brücke',
  subtitle: ' Heerlen/Aachen -> Köln',
  description: [
    'Zeitraum dieser Bauphase:',
    'Beginn: 04.09.26 um 05:00 Uhr',
    'Ende: 19.10.26 um 05:00 Uhr',
    '',
    'Länge: 0.7 km | Maximale Durchfahrtsbreite: 3.25 m',
    '',
    'Rheinbrücke Rodenkirchen',
  ],
};

const nightWindow = {
  identifier: 'night-only',
  title: 'A4 | Kerpen - Frechen',
  subtitle: ' Heerlen/Aachen -> Köln',
  description: [
    'Die Baustelle ist zu folgenden Zeiträumen gültig: 28.09.26 von 20:00 bis 22:00 Uhr',
    'Länge: 0.65 km | Maximale Durchfahrtsbreite: 2.5 m',
  ],
};

const narrowPassage = {
  identifier: 'a3-narrow',
  title: 'A3 | Passau -> Nürnberg',
  subtitle: '',
  description: [
    'Zeitraum dieser Bauphase:',
    'Beginn: 19.08.26 um 09:00 Uhr',
    'Ende: 16.10.26 um 15:00 Uhr',
    'Länge: 2 km | Maximale Durchfahrtsbreite: 2.75 m',
    'A3 Erhaltungsabschnitt zwischen AS Iggensbach und AS Aicha vorm Wald',
  ],
};

describe('parseRoadworksRestriction', () => {
  it('extracts the A4 Köln weight and width limits with phase dates', () => {
    const parsed = parseRoadworksRestriction(eifeltorMain, 'A4');
    expect(parsed).toMatchObject({
      road: 'A4',
      project: 'BW Eifeltor',
      section: 'Köln-Klettenberg - Köln-Eifeltor',
      direction: 'Heerlen/Aachen -> Köln',
      width: 3.25,
      weight: 44,
      phaseStart: '2026-07-16',
      phaseEnd: '2029-12-01',
      projectEnd: '2029-12-01',
    });
  });

  it('ignores an ordinary narrowed lane without a weight limit', () => {
    expect(parseRoadworksRestriction(ordinaryLaneNarrowing, 'A4')).toBeNull();
  });

  it('ignores short ad-hoc windows without a construction phase', () => {
    expect(parseRoadworksRestriction(nightWindow, 'A4')).toBeNull();
  });

  it('keeps a passage narrower than 3 m even without a weight limit', () => {
    expect(parseRoadworksRestriction(narrowPassage, 'A3')).toMatchObject({ width: 2.75, weight: null });
  });
});

describe('buildRestrictionFindings', () => {
  it('merges one project on one motorway into a single weight-restriction finding', () => {
    const findings = buildRestrictionFindings([
      parseRoadworksRestriction(eifeltorMain, 'A4'),
      parseRoadworksRestriction(eifeltorRamp, 'A4'),
      parseRoadworksRestriction(narrowPassage, 'A3'),
    ]);
    expect(findings).toHaveLength(2);

    const koeln = findings.find((f) => f.location.startsWith('A4'));
    expect(koeln.type).toBe('weight_restriction');
    expect(koeln.country).toBe('Germany');
    expect(koeln.title).toBe('A4 Köln-Klettenberg - Köln-Eifeltor (BW Eifeltor): max. gross vehicle weight 44 t, max. passage width 3.25 m');
    expect(koeln.validFrom).toBe('2026-07-16');
    expect(koeln.validTo).toBe('2029-12-01');
    expect(koeln.summary).toContain('AS Köln-Klettenberg (aus Richtung Köln-West) nach A4');
    expect(koeln.sourceUrl).toBe(
      `https://verkehr.autobahn.de/o/autobahn/details/roadworks/${encodeURIComponent(eifeltorMain.identifier)}`
    );
    expect(koeln.isStructuredRestriction).toBe(true);

    const a3 = findings.find((f) => f.location.startsWith('A3'));
    expect(a3.type).toBe('width_restriction');
    expect(a3.title).toContain('max. passage width 2.75 m');
  });
});

describe('isOngoingRestriction', () => {
  const [finding] = buildRestrictionFindings([parseRoadworksRestriction(eifeltorMain, 'A4')]);

  it('treats a phase that began before the news window as ongoing', () => {
    expect(isOngoingRestriction(finding, new Date('2026-09-17T00:00:00Z'))).toBe(true);
  });

  it('treats a phase beginning inside the news window as new', () => {
    expect(isOngoingRestriction(finding, new Date('2026-07-10T00:00:00Z'))).toBe(false);
  });

  it('never marks an ordinary monitored finding as ongoing', () => {
    expect(isOngoingRestriction({ validFrom: '2020-01-01' }, new Date('2026-09-17T00:00:00Z'))).toBe(false);
  });
});

describe('fetchAutobahnRestrictionFindings', () => {
  const source = { id: 'de-autobahn-restrictions' };
  const jsonResponse = (body) => ({ ok: true, json: async () => body });

  it('walks every motorway and returns restriction findings', async () => {
    const fetchImpl = async (url) => {
      if (url.endsWith('/autobahn/')) return jsonResponse({ roads: ['A4', 'A3'] });
      if (url.includes('/A4/')) return jsonResponse({ roadworks: [eifeltorMain, ordinaryLaneNarrowing] });
      return jsonResponse({ roadworks: [narrowPassage] });
    };
    const result = await fetchAutobahnRestrictionFindings(source, { fetchImpl });
    expect(result.status).toBe('ok');
    expect(result.findings.map((f) => f.location).sort()).toEqual(['A3 Passau -> Nürnberg', 'A4 Köln-Klettenberg - Köln-Eifeltor']);
  });

  it('reports the source as unavailable when the API cannot be reached', async () => {
    const fetchImpl = async () => ({ ok: false, status: 503 });
    const result = await fetchAutobahnRestrictionFindings(source, { fetchImpl });
    expect(result.status).toBe('unavailable');
    expect(result.findings).toEqual([]);
  });
});
