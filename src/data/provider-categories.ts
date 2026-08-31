// Neutral integration areas of the DAJC ecosystem. Used both as the content
// collection's `category` enum (src/content.config.ts) and as the public
// "Integration areas" grid on /partners - single source of truth so the two
// never drift apart.
export const PROVIDER_CATEGORIES = [
  'Vehicle & Fleet Data',
  'Road Intelligence',
  'Secure Truck Parking',
  'Ports & Terminals',
  'Permits',
  'Navigation',
  'Payments',
  'OEM & Service',
  'Infrastructure',
  'Defence & Military Mobility',
  'Customs & Transit',
] as const;

export type ProviderCategory = (typeof PROVIDER_CATEGORIES)[number];
