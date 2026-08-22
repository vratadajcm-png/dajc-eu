// Deterministic, zero-cost stand-in for scripts/lib/openai-client.mjs, used
// for local/CI sanity testing (--mock flag) without spending real OpenAI
// API credits. Produces the exact same shape as generateArticleWithOpenAI,
// built directly from the verified candidates with no LLM call, so the rest
// of the pipeline (cross-validation, quality gate, build) can be exercised
// end to end for free.

// Capped at 12 (not the previous 20): quality-gate.mjs now enforces the
// same 8-12 report count on a mock run as on a live run, so mock fixtures
// used in tests must supply at least 8 candidates for a mock run to reach
// a publishable article - see scripts/lib/__tests__/quality-gate.test.mjs.
const MAX_MOCK_DEVELOPMENTS = 12;

export async function generateArticleMock({ candidates, weekRangeLabel }) {
  const developments = candidates.slice(0, MAX_MOCK_DEVELOPMENTS).map((c) => ({
    country: c.country,
    title: c.title,
    whatChanged: c.summary || c.title,
    where: c.location || c.country,
    vehicleScope: c.vehicleScope || '',
    timeWindow: c.timeWindow || '',
    validFrom: c.validFrom || '',
    validTo: c.validTo || '',
    impact: 'Impact not assessed (mock mode).',
    recommendedAction: 'Recommendation not assessed (mock mode) - review before real publication.',
    exemptions: c.exemptions || '',
    isDrivingBan: c.type === 'driving_ban',
    isInfrastructure: ['bridge_restriction', 'tunnel_restriction', 'road_closure'].includes(c.type),
    sourceUrl: c.sourceUrl,
    sourceName: c.sourceName,
  }));

  return {
    seoTitle: `EU Oversize Weekly: Key Transport Restrictions and Permit Changes for ${weekRangeLabel} (MOCK)`,
    metaDescription: 'Mock-generated meta description for local pipeline testing - not for publication.',
    intro: 'This is a mock-mode article generated without calling the OpenAI API, for pipeline sanity testing only.',
    developments,
    operatorChecklist: ['Mock mode - no real checklist generated; review before real publication.'],
  };
}
