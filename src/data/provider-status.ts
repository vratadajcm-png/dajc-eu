// Status vocabulary for future integration providers. Editing a provider's
// `relationshipStatus` / `integrationStatus` in content is the only thing
// needed to change what is publicly shown - no component changes required.
// Nothing here implies a formal partnership on its own; `formal_partnership`
// must only be set once that relationship genuinely and publicly exists.
export const RELATIONSHIP_STATUSES = [
  'exploratory_discussions',
  'integration_discussions',
  'technical_discussions',
  'developer_access',
  'integration_onboarding',
  'formal_partnership',
] as const;

export type RelationshipStatus = (typeof RELATIONSHIP_STATUSES)[number];

export const INTEGRATION_STATUSES = [
  'not_started',
  'planned',
  'in_preparation',
  'in_development',
  'testing',
  'available',
] as const;

export type IntegrationStatus = (typeof INTEGRATION_STATUSES)[number];

const RELATIONSHIP_STATUS_LABELS: Record<RelationshipStatus, string> = {
  exploratory_discussions: 'Exploratory discussions',
  integration_discussions: 'Integration discussions',
  technical_discussions: 'Technical discussions',
  developer_access: 'Developer access',
  integration_onboarding: 'Integration onboarding',
  formal_partnership: 'Formal partnership',
};

const INTEGRATION_STATUS_LABELS: Record<IntegrationStatus, string> = {
  not_started: 'Not started',
  planned: 'Integration planned',
  in_preparation: 'In preparation',
  in_development: 'In development',
  testing: 'Testing',
  available: 'Available',
};

/**
 * Composes a human-readable status label from whichever status fields a
 * provider entry actually has set. Returns undefined if neither is set, so
 * callers can skip rendering a status line entirely.
 */
export function formatStatusLabel(
  relationshipStatus?: RelationshipStatus,
  integrationStatus?: IntegrationStatus
): string | undefined {
  const relationshipLabel = relationshipStatus ? RELATIONSHIP_STATUS_LABELS[relationshipStatus] : undefined;
  const integrationLabel = integrationStatus ? INTEGRATION_STATUS_LABELS[integrationStatus] : undefined;

  if (relationshipLabel && integrationLabel) return `${relationshipLabel} · ${integrationLabel}`;
  return relationshipLabel ?? integrationLabel;
}
