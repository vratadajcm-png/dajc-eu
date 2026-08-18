// Deterministic, zero-cost stand-in for scripts/lib/openai-client.mjs, used
// for local/CI sanity testing (--mock flag) without spending real OpenAI
// API credits. Produces the exact same shape as generateArticleWithOpenAI,
// built directly from the verified candidates with no LLM call, so the rest
// of the pipeline (cross-validation, quality gate, build) can be exercised
// end to end for free.

export async function generateArticleMock({ candidates, weekRangeLabel }) {
  const developments = candidates.slice(0, 20).map((c) => ({
    country: c.country,
    title: c.title,
    whatChanged: c.summary || c.title,
    where: c.location || c.country,
    validFrom: c.validFrom || '',
    validTo: c.validTo || '',
    impact: 'Impact not assessed (mock mode).',
    recommendedAction: 'Recommendation not assessed (mock mode).',
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
    operatorsWatchNextWeek: 'Mock mode - no real recommendation generated.',
  };
}
