import { describe, expect, it } from 'vitest';
import { dajcEuropeCoverage } from '../../../../config/europe-coverage.mjs';
import { accessRegisterProblems, connectorMatrix, connectorProblems, loadAccessRegister, loadConnectors } from '../connectors.mjs';
import { CostLedger, CostLimitExceeded, limitsFromEnv } from '../costs.mjs';

describe('connector plan', () => {
  it('covers exactly the 50 DAJC jurisdictions and is consistent', () => {
    expect(dajcEuropeCoverage).toHaveLength(50);
    expect(connectorProblems()).toEqual([]);
    expect(connectorMatrix().filter((m) => m.jurisdiction !== 'EU')).toHaveLength(50);
  });
  it('never marks a declared-only connector as implemented', () => {
    const bad = loadConnectors().map((c) => ({ ...c })).filter((c) => c.status === 'PLANNED');
    bad[0].status = 'IMPLEMENTED';
    expect(connectorProblems([...loadConnectors(), { ...bad[0], id: 'x' }]).some((p) => p.includes('IMPLEMENTED needs'))).toBe(true);
  });
  it('flags a jurisdiction outside the registry and a missing jurisdiction', () => {
    expect(connectorProblems([{ id: 'a', jurisdiction: 'ZZ', format: 'HTML', status: 'PLANNED' }]).some((p) => p.includes('not a DAJC'))).toBe(true);
  });
});

describe('internal access register', () => {
  it('is metadata only, and a promise is not permission', () => {
    expect(accessRegisterProblems(loadAccessRegister())).toEqual([]);
    expect(accessRegisterProblems({ entries: [{ jurisdiction: 'AT', permissionStatus: 'GRANTED' }] })[0]).toMatch(/promise/);
    expect(accessRegisterProblems({ entries: [{ jurisdiction: 'AT', body: 'private text' }] })[0]).toMatch(/metadata only/);
  });
  it('states that the e-mail audit was not performed', () => {
    expect(loadAccessRegister().audit.performed).toBe(false);
  });
});

describe('cost ledger', () => {
  it('aggregates by phase, jurisdiction and connector and aborts above the limit', () => {
    const l = new CostLedger({ AI_VERIFICATION: 1 });
    l.record({ phase: 'AI_VERIFICATION', jurisdiction: 'CZ', usd: 0.6 });
    l.record({ phase: 'MONTHLY_AUDIT', jurisdiction: 'CZ', connector: 'cz-x', usd: 0 });
    expect(() => l.record({ phase: 'AI_VERIFICATION', jurisdiction: 'DE', usd: 0.5 })).toThrow(CostLimitExceeded);
    expect(l.report().byJurisdiction.CZ).toBeCloseTo(0.6);
  });
  it('reads limits from the environment', () => {
    expect(limitsFromEnv({ DAJC_KB_LIMIT_MONTHLY_AUDIT_USD: '2' })).toEqual({ MONTHLY_AUDIT: 2 });
  });
});
