import { describe, expect, it } from 'vitest';
import {
  canCreateDerivedIntelligence,
  canPersistSourceHistory,
  canPersistSourceSnapshot,
  canRedistributeSourceData,
  dajcMaintainedDrivingBansRights,
  type IntelligenceSourceRights,
} from './persistence-contract';

const approvedRetention = { policyId: 'r7-test-policy', status: 'approved' as const };
const publicContext = { actorType: 'service' as const, purpose: 'test source processing' };

function tenantRights(overrides: Partial<IntelligenceSourceRights> = {}): IntelligenceSourceRights {
  return {
    sourceId: 'provider-x',
    policyVersion: 'v1',
    storageScope: 'tenant-private',
    storage: 'allowed',
    history: 'allowed',
    derivedIntelligence: 'allowed',
    redistribution: 'denied',
    attributionRequired: false,
    evidenceReference: 'provider evidence dossier',
    purpose: 'customer-authorized operational intelligence',
    organizationId: 'org-a',
    ...overrides,
  };
}

describe('DAJC Intelligence persistence security contract', () => {
  it('allows maintained public Driving Bans snapshot with approved retention', () => {
    expect(canPersistSourceSnapshot({
      rights: dajcMaintainedDrivingBansRights,
      context: publicContext,
      retention: approvedRetention,
    })).toEqual({ allowed: true });
  });

  it('fails closed when source storage rights are unknown', () => {
    const result = canPersistSourceSnapshot({
      rights: tenantRights({ storage: 'unknown' }),
      context: { actorType: 'service', purpose: 'test', organizationId: 'org-a' },
      retention: approvedRetention,
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('unknown');
  });

  it('fails closed while retention policy is pending legal approval', () => {
    const result = canPersistSourceSnapshot({
      rights: dajcMaintainedDrivingBansRights,
      context: publicContext,
      retention: { policyId: 'r7-pending', status: 'pending-legal' },
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('pending-legal');
  });

  it('blocks cross-organization persistence for tenant-private sources', () => {
    const result = canPersistSourceSnapshot({
      rights: tenantRights(),
      context: { actorType: 'service', purpose: 'test', organizationId: 'org-b' },
      retention: approvedRetention,
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('organization');
  });

  it('requires customer binding for provider-customer-bound sources', () => {
    const result = canPersistSourceSnapshot({
      rights: tenantRights({ storageScope: 'provider-customer-bound', customerBindingId: undefined }),
      context: { actorType: 'service', purpose: 'test', organizationId: 'org-a' },
      retention: approvedRetention,
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('customerBindingId');
  });

  it('separately enforces history rights', () => {
    const result = canPersistSourceHistory({
      rights: tenantRights({ history: 'denied' }),
      context: { actorType: 'service', purpose: 'test', organizationId: 'org-a' },
      retention: approvedRetention,
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('history');
  });

  it('can permit derived intelligence without permitting redistribution', () => {
    const rights = tenantRights({ derivedIntelligence: 'allowed', redistribution: 'denied' });
    const context = { actorType: 'service' as const, purpose: 'test', organizationId: 'org-a' };
    expect(canCreateDerivedIntelligence({ rights, context })).toEqual({ allowed: true });
    expect(canRedistributeSourceData({ rights, context }).allowed).toBe(false);
  });

  it('does not infer redistribution rights for the maintained Driving Bans registry', () => {
    const result = canRedistributeSourceData({
      rights: dajcMaintainedDrivingBansRights,
      context: publicContext,
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('unknown');
  });
});
