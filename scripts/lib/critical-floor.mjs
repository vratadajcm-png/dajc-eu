const HIGH_SIGNAL_TYPES = new Set([
  'permit_change',
  'permit_system',
  'escort_requirement',
  'police_escort',
  'border_restriction',
  'operational_change',
  'equipment',
  'route_restriction',
  'driving_ban',
]);

const OVERSIZE_SIGNAL =
  /exceptional transport|exceptional vehicle|oversize|oversized|abnormal load|wide load|heavy transport|schwertransport|gro[ßs]raum|ausnahmetransport|convoi exceptionnel|transport exceptionnel|trasporto eccezionale|transporte especial|izvanredni prijevoz|agabaritic|special transport|pilot vehicle|escort vehicle|begleitfahrzeug|private escort|police escort|route permit|special permit|overweight permit|overdimension|weight limit|height limit|width limit|axle load/i;

const REGULATORY_SIGNAL =
  /permit|authorisation|authorization|bewilligung|genehmigung|escort|begleit|pilot vehicle|new rule|new requirement|regulation|decree|law|procedure|digital system|toll system|weight restriction|height restriction|width restriction|border restriction/i;

function developmentFromCandidate(c) {
  return {
    country: c.country || '',
    title: c.title || '',
    whatChanged: c.summary || '',
    where: c.routeScope || c.location || '',
    vehicleScope: c.vehicleScope || '',
    timeWindow: c.timeWindow || '',
    validFrom: c.validFrom || '',
    validTo: c.validTo || '',
    impact: c.impact || '',
    recommendedAction:
      c.recommendedAction ||
      'Review the official change before planning or dispatching an affected exceptional transport.',
    exemptions: c.exemptions || '',
    isDrivingBan: Boolean(c.isDrivingBan || c.type === 'driving_ban'),
    isInfrastructure: Boolean(c.isInfrastructure),
    sourceUrl: c.sourceUrl,
    sourceName: c.sourceName,
    additionalSources: c.additionalSources || [],
  };
}

export function isCriticalWeeklyCandidate(candidate, { discoveryWindowStart } = {}) {
  if (!candidate || candidate.isOfficialCalendar || !candidate.sourceUrl) return false;

  const firstSeen = candidate.firstSeenAt ? new Date(candidate.firstSeenAt) : null;
  const discoveredThisWindow =
    discoveryWindowStart &&
    firstSeen &&
    !Number.isNaN(firstSeen.getTime()) &&
    firstSeen >= discoveryWindowStart;
  const fresh = ['new', 'updated'].includes(candidate.status) || Boolean(discoveredThisWindow);
  if (!fresh) return false;

  const text = `${candidate.title || ''} ${candidate.summary || ''}`;
  const directlyOversize = OVERSIZE_SIGNAL.test(text);
  const regulatory = REGULATORY_SIGNAL.test(text);

  return directlyOversize && (HIGH_SIGNAL_TYPES.has(candidate.type) || regulatory);
}

export function criticalWeeklyCandidates(verifiedCandidates = [], options = {}) {
  return verifiedCandidates.filter((candidate) => isCriticalWeeklyCandidate(candidate, options));
}

export function ensureCriticalCoverage(
  article,
  verifiedCandidates,
  { maxLeads = 12, discoveryWindowStart } = {}
) {
  const developments = [...(article.developments || [])];
  const europeRoundup = [...(article.europeRoundup || [])];
  const used = new Set(
    [...developments, ...europeRoundup].map((item) => item.sourceUrl).filter(Boolean)
  );

  const critical = criticalWeeklyCandidates(verifiedCandidates, { discoveryWindowStart });
  let addedToLeads = 0;
  let addedToRoundup = 0;

  for (const candidate of critical) {
    if (used.has(candidate.sourceUrl)) continue;
    const item = developmentFromCandidate(candidate);

    if (developments.length < maxLeads) {
      developments.push(item);
      addedToLeads += 1;
    } else {
      europeRoundup.push(item);
      addedToRoundup += 1;
    }
    used.add(candidate.sourceUrl);
  }

  return {
    article: { ...article, developments, europeRoundup },
    critical,
    addedToLeads,
    addedToRoundup,
  };
}
