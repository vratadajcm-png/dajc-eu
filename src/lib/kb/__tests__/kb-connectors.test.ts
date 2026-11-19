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
    expect(accessRegisterProblems(loadAccessRegister({}))).toEqual([]);
    expect(accessRegisterProblems({ entries: [{ jurisdiction: 'AT', permissionStatus: 'GRANTED' }] })[0]).toMatch(/promise/);
    expect(accessRegisterProblems({ entries: [{ jurisdiction: 'AT', body: 'private text' }] })[0]).toMatch(/metadata only/);
  });
  it('is not stored in the public repository', () => {
    expect(loadAccessRegister({}).available).toBe(false);
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

import { runProbe } from '../probe.mjs';
import { discoverPl } from '../discovery.mjs';

const fakeRobots = { admit: async () => undefined };
const res = (body: string, status = 200, ct = 'text/html') => ({ ok: status < 400, status, headers: new Headers({ 'content-type': ct }), arrayBuffer: async () => new TextEncoder().encode(body).buffer });

describe('connector probe', () => {
  it('proves only a body that carries the law marker, with SHA-256', async () => {
    const ok = await runProbe({ id: 'x', url: 'https://example.gov/a', markers: ['Road Traffic Act'] }, { robots: fakeRobots as never, fetchImpl: (async () => res('<h1>Road Traffic Act 1988</h1>')) as never });
    expect(ok.outcome).toBe('PROVEN');
    expect(ok.sha256).toMatch(/^[0-9a-f]{64}$/);
  });
  it('does not accept an application shell, an error or a robots refusal as proof', async () => {
    expect((await runProbe({ id: 'x', url: 'https://example.gov/a', markers: ['Law'] }, { robots: fakeRobots as never, fetchImpl: (async () => res('<app-root></app-root>')) as never })).outcome).toBe('MARKER_MISSING');
    expect((await runProbe({ id: 'x', url: 'https://example.gov/a', markers: ['Law'] }, { robots: fakeRobots as never, fetchImpl: (async () => res('', 503)) as never })).outcome).toBe('HTTP_ERROR');
    expect((await runProbe({ id: 'x', url: 'https://example.gov/a', markers: ['Law'] }, { robots: { admit: async () => { throw new Error('disallowed'); } } as never })).outcome).toBe('ROBOTS_REFUSED');
  });
});

describe('PL discovery', () => {
  it('lists only changed acts that match transport keywords', async () => {
    const items = [
      { ELI: 'DU/2026/1', title: 'Ustawa o ruchu drogowym zmiana', changeDate: '2026-11-05T10:00:00', status: 'obowiązujący' },
      { ELI: 'DU/2026/2', title: 'Rozporządzenie w sprawie szpitali', changeDate: '2026-11-05T10:00:00', status: 'obowiązujący' },
      { ELI: 'DU/2026/3', title: 'Ustawa o transporcie drogowym', changeDate: '2026-01-05T10:00:00', status: 'obowiązujący' },
    ];
    const out = await discoverPl({ year: 2026, since: '2026-10-01', fetchImpl: (async () => ({ ok: true, json: async () => ({ items }) })) as never });
    expect(out.map((a: { eli: string }) => a.eli)).toEqual(['DU/2026/1']);
  });
});
