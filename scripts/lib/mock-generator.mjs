// Deterministic zero-cost stand-in for OpenAI synthesis (--mock).
// Mirrors the production contract: every verified candidate it is given is
// reported once, up to the maximums of 30 lead reports and 15 Rest-of-Europe
// updates. There is no minimum and nothing is invented to fill a section.

import { MAX_REPORTS, MAX_ROUNDUP_REPORTS } from './quality-gate.mjs';

const mapCandidate = (c) => ({
  country: c.country,
  title: c.title,
  whatChanged: c.summary || c.title,
  where: c.location || c.country,
  vehicleScope: c.vehicleScope || 'Heavy/exceptional road transport',
  timeWindow: c.timeWindow || '',
  validFrom: c.validFrom || '',
  validTo: c.validTo || '',
  impact: c.impact || 'Operational impact on heavy/exceptional road transport.',
  recommendedAction: c.recommendedAction || 'Review the verified restriction/change before dispatch.',
  exemptions: c.exemptions || '',
  isDrivingBan: c.type === 'driving_ban',
  isInfrastructure: ['bridge_restriction', 'tunnel_restriction', 'road_closure', 'roadworks', 'route_restriction'].includes(c.type),
  sourceUrl: c.sourceUrl,
  sourceName: c.sourceName,
});

export async function generateArticleMock({ candidates, weekRangeLabel }) {
  const usable = candidates.filter((c) => c?.sourceUrl);
  const developments = usable.slice(0, MAX_REPORTS).map(mapCandidate);
  const europeRoundup = usable.slice(MAX_REPORTS, MAX_REPORTS + MAX_ROUNDUP_REPORTS).map(mapCandidate);

  return {
    seoTitle: `DAJC European Oversize Intelligence for ${weekRangeLabel} (MOCK)`,
    metaDescription: 'Mock-generated DAJC European oversize intelligence for pipeline validation only.',
    intro: 'Mock-mode article generated without OpenAI from the verified candidates only, for pipeline validation.',
    developments,
    europeRoundup,
    operatorChecklist: ['Mock mode - verify real sources before production publication.'],
  };
}

/** Mock counterpart of generateRequiredItemsWithOpenAI: one item per development. */
export async function generateRequiredItemsMock({ groups }) {
  return groups.map((group) => mapCandidate(group.candidates[0]));
}
