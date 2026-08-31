import { z } from 'zod';

export const intelligenceStorageScopeSchema = z.enum([
  'public-shared',
  'tenant-private',
  'provider-customer-bound',
]);

export type IntelligenceStorageScope = z.infer<typeof intelligenceStorageScopeSchema>;

export const rightsDecisionSchema = z.enum(['allowed', 'denied', 'unknown']);
export type RightsDecision = z.infer<typeof rightsDecisionSchema>;

export const intelligenceSourceRightsSchema = z.object({
  sourceId: z.string().min(1).max(160),
  policyVersion: z.string().min(1).max(120),
  storageScope: intelligenceStorageScopeSchema,
  storage: rightsDecisionSchema,
  history: rightsDecisionSchema,
  derivedIntelligence: rightsDecisionSchema,
  redistribution: rightsDecisionSchema,
  attributionRequired: z.boolean(),
  evidenceReference: z.string().min(1).max(500),
  purpose: z.string().min(1).max(500),
  organizationId: z.string().min(1).max(120).optional(),
  customerBindingId: z.string().min(1).max(160).optional(),
});

export type IntelligenceSourceRights = z.infer<typeof intelligenceSourceRightsSchema>;

export const intelligenceRetentionBindingSchema = z.object({
  policyId: z.string().min(1).max(160),
  status: z.enum(['approved', 'pending-legal', 'disabled']),
});

export type IntelligenceRetentionBinding = z.infer<typeof intelligenceRetentionBindingSchema>;

export const intelligencePersistenceContextSchema = z.object({
  organizationId: z.string().min(1).max(120).optional(),
  userId: z.string().min(1).max(120).optional(),
  actorType: z.enum(['user', 'service']),
  purpose: z.string().min(1).max(500),
});

export type IntelligencePersistenceContext = z.infer<typeof intelligencePersistenceContextSchema>;

export type PersistencePermission = {
  allowed: boolean;
  reason?: string;
};

function deny(reason: string): PersistencePermission {
  return { allowed: false, reason };
}

function allow(): PersistencePermission {
  return { allowed: true };
}

function assertScopeBinding(
  rights: IntelligenceSourceRights,
  context: IntelligencePersistenceContext,
): PersistencePermission {
  if (rights.storageScope === 'public-shared') return allow();

  if (!rights.organizationId) {
    return deny('Tenant-bound source policy is missing organizationId');
  }

  if (!context.organizationId || context.organizationId !== rights.organizationId) {
    return deny('Persistence context does not match source organization binding');
  }

  if (rights.storageScope === 'provider-customer-bound' && !rights.customerBindingId) {
    return deny('Provider-customer-bound source policy is missing customerBindingId');
  }

  return allow();
}

export function canPersistSourceSnapshot(args: {
  rights: IntelligenceSourceRights;
  context: IntelligencePersistenceContext;
  retention: IntelligenceRetentionBinding;
}): PersistencePermission {
  const rights = intelligenceSourceRightsSchema.parse(args.rights);
  const context = intelligencePersistenceContextSchema.parse(args.context);
  const retention = intelligenceRetentionBindingSchema.parse(args.retention);

  if (rights.storage !== 'allowed') {
    return deny(`Source storage right is ${rights.storage}`);
  }

  const scope = assertScopeBinding(rights, context);
  if (!scope.allowed) return scope;

  if (retention.status !== 'approved') {
    return deny(`Retention policy is ${retention.status}`);
  }

  return allow();
}

export function canPersistSourceHistory(args: {
  rights: IntelligenceSourceRights;
  context: IntelligencePersistenceContext;
  retention: IntelligenceRetentionBinding;
}): PersistencePermission {
  const snapshot = canPersistSourceSnapshot(args);
  if (!snapshot.allowed) return snapshot;

  const rights = intelligenceSourceRightsSchema.parse(args.rights);
  if (rights.history !== 'allowed') {
    return deny(`Source history right is ${rights.history}`);
  }

  return allow();
}

export function canCreateDerivedIntelligence(args: {
  rights: IntelligenceSourceRights;
  context: IntelligencePersistenceContext;
}): PersistencePermission {
  const rights = intelligenceSourceRightsSchema.parse(args.rights);
  const context = intelligencePersistenceContextSchema.parse(args.context);
  const scope = assertScopeBinding(rights, context);
  if (!scope.allowed) return scope;

  if (rights.derivedIntelligence !== 'allowed') {
    return deny(`Derived-intelligence right is ${rights.derivedIntelligence}`);
  }

  return allow();
}

export function canRedistributeSourceData(args: {
  rights: IntelligenceSourceRights;
  context: IntelligencePersistenceContext;
}): PersistencePermission {
  const rights = intelligenceSourceRightsSchema.parse(args.rights);
  const context = intelligencePersistenceContextSchema.parse(args.context);
  const scope = assertScopeBinding(rights, context);
  if (!scope.allowed) return scope;

  if (rights.redistribution !== 'allowed') {
    return deny(`Redistribution right is ${rights.redistribution}`);
  }

  return allow();
}

export const dajcMaintainedDrivingBansRights: IntelligenceSourceRights = intelligenceSourceRightsSchema.parse({
  sourceId: 'dajc-driving-bans-registry',
  policyVersion: '2026-08-31-m1',
  storageScope: 'public-shared',
  storage: 'allowed',
  history: 'allowed',
  derivedIntelligence: 'allowed',
  redistribution: 'unknown',
  attributionRequired: true,
  evidenceReference: 'DAJC maintained Driving Bans registry and per-rule official source provenance',
  purpose: 'DAJC operational intelligence and change detection for maintained driving-ban rules',
});
