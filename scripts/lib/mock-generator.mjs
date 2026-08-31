// Deterministic zero-cost stand-in for OpenAI synthesis.
// Mirrors the production contract: 20 lead reports plus at least 10 concise
// Rest-of-Europe items spanning at least six jurisdictions when fixtures allow.

const MIN_LEADS = 20;
const MIN_ROUNDUP = 10;
const MIN_ROUNDUP_COUNTRIES = 6;

export async function generateArticleMock({ candidates, weekRangeLabel }) {
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

  const reserved = [];
  const reservedUrls = new Set();
  const countries = new Set();

  for (let i = candidates.length - 1; i >= 0 && countries.size < MIN_ROUNDUP_COUNTRIES; i -= 1) {
    const candidate = candidates[i];
    const country = String(candidate.country || '').trim();
    if (!country || countries.has(country) || !candidate.sourceUrl) continue;
    countries.add(country);
    reservedUrls.add(candidate.sourceUrl);
    reserved.unshift(candidate);
  }
  for (let i = candidates.length - 1; i >= 0 && reserved.length < MIN_ROUNDUP; i -= 1) {
    const candidate = candidates[i];
    if (!candidate?.sourceUrl || reservedUrls.has(candidate.sourceUrl)) continue;
    reservedUrls.add(candidate.sourceUrl);
    reserved.unshift(candidate);
  }

  const leadPool = candidates.filter((c) => !reservedUrls.has(c.sourceUrl));
  const developments = leadPool.slice(0, 30).map(mapCandidate);
  const europeRoundup = reserved.slice(0, 20).map(mapCandidate);

  // Keep mock behavior honest: do not fabricate missing reports.
  if (developments.length < MIN_LEADS || europeRoundup.length < MIN_ROUNDUP || countries.size < MIN_ROUNDUP_COUNTRIES) {
    return {
      seoTitle: `DAJC European Oversize Intelligence for ${weekRangeLabel} (MOCK - insufficient fixture)`,
      metaDescription: 'Mock fixture does not contain enough verified items for the production 20+10 contract.',
      intro: 'Mock fixture is intentionally insufficient; the quality gate should block this edition.',
      developments,
      europeRoundup,
      operatorChecklist: ['Mock mode - insufficient fixture; publication should be blocked.'],
    };
  }

  return {
    seoTitle: `DAJC European Oversize Intelligence for ${weekRangeLabel} (MOCK)`,
    metaDescription: 'Mock-generated DAJC European oversize intelligence for pipeline validation only.',
    intro: 'Mock-mode article generated without OpenAI, using the same 20-lead and 10-by-6 roundup contract as production.',
    developments,
    europeRoundup,
    operatorChecklist: ['Mock mode - verify real sources before production publication.'],
  };
}
