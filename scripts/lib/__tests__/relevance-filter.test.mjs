import { describe, expect, it } from 'vitest';
import { checkOperationalRelevance } from '../relevance-filter.mjs';

describe('checkOperationalRelevance', () => {
  // Regression: the exact incident that produced the first W35 article's
  // Hildesheim item - a stuck lorry is a one-off incident, not an ongoing
  // road closure/restriction.
  it('rejects the Hildesheim-style stuck-lorry incident', () => {
    const result = checkOperationalRelevance(
      'A lorry got stuck in a construction area on the southbound lane of BAB 7 near Hildesheim, causing road closure.'
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/stuck-vehicle/);
  });

  // Regression: the Murrashi Bridge item was a procurement/tender notice
  // for rehabilitation works, not a live traffic restriction.
  it('rejects a procurement notice even when it mentions a bridge', () => {
    const result = checkOperationalRelevance(
      'Specific procurement notice: rehabilitation works of Murrashi Bridge, invitation to tender for contractors.'
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/procurement/);
  });

  it('rejects a one-off traffic accident', () => {
    const result = checkOperationalRelevance('A multi-vehicle crash closed the eastbound carriageway for several hours.');
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/accident/);
  });

  it('rejects a theft report', () => {
    const result = checkOperationalRelevance('Police investigate theft of cargo from a parked truck overnight.');
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/theft/);
  });

  it('rejects unconfirmed planned works', () => {
    const result = checkOperationalRelevance('The authority is planning to begin a feasibility study for future road widening.');
    expect(result.ok).toBe(false);
  });

  it('rejects generic crime/administrative noise', () => {
    const result = checkOperationalRelevance('Man arrested for weapon possession following a routine traffic stop.');
    expect(result.ok).toBe(false);
  });

  it('rejects personal international-driving-permit guidance', () => {
    const result = checkOperationalRelevance('Conducir en el extranjero, permiso internacional: como solicitar el permiso internacional.');
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/international-driving-permit/);
  });

  it('rejects generic driver-licence accessibility guidance', () => {
    const result = checkOperationalRelevance('Accesibilidad en el permiso conducir. Medidas para facilitar la obtención del permiso de conducir.');
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/driver-licensing/);
  });

  it('rejects a generic laws/rules/permits landing page', () => {
    const result = checkOperationalRelevance('Wetten, regels en vergunningen Rijkswaterstaat');
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/generic authority/);
  });

  it('rejects a stale archived restriction that only references 2024', () => {
    const result = checkOperationalRelevance('7.5t weight restriction introduced on 2 April 2024 on route 801.');
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/historical archive/);
  });

  it('rejects pure toll collection revenue statistics', () => {
    const result = checkOperationalRelevance(
      'Toll collection reached 1.52 billion Czech crowns and grew 5 percent year-on-year.'
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/toll revenue\/statistics/);
  });

  it('accepts a current exceptional-transport escort policy change', () => {
    const result = checkOperationalRelevance(
      '19 August 2026: Switzerland proposes nationwide rules for private exceptional-transport escorts.'
    );
    expect(result.ok).toBe(true);
  });

  it('accepts a genuine, currently-applicable driving ban', () => {
    const result = checkOperationalRelevance(
      'Nationwide weekend driving ban for goods vehicles above 7.5 tonnes applies this Saturday and Sunday.'
    );
    expect(result.ok).toBe(true);
  });

  it('accepts a genuine bridge weight restriction', () => {
    const result = checkOperationalRelevance('Bridge closed to vehicles over 44 tonnes due to confirmed structural weight restriction.');
    expect(result.ok).toBe(true);
  });
});
