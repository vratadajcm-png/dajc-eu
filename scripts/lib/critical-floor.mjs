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

function criticalTopicKey(candidate) {
  const text = `${candidate.title || ''} ${candidate.summary || ''}`.toLowerCase();
  if (/escort|begleit|pilot vehicle|accompagnement|doprovod/.test(text)) return 'escort';
  if (/permit|bewilligung|genehmigung|authori[sz]ation|povolen/.test(text)) return 'permit';
  if (/weight|height|width|axle|dimension|s[uú]ly|hmotnost|výšk|šíř/.test(text)) return 'limits';
  if (/border|customs|transit|grenz|hrani/.test(text)) return 'border';
  if (/toll|maut|péage|pedaggio|peaje|m[aý]to/.test(text)) return 'toll';
  return 'other';
}

export function ensureCriticalCoverage(
  article,
  verifiedCandidates,
  { maxLeads = 30, discoveryWindowStart } = {}
) {
  const developments = [...(article.developments || [])];
  const europeRoundup = [...(article.europeRoundup || [])];
  const critical = criticalWeeklyCandidates(verifiedCandidates, { discoveryWindowStart });

  const groups = new Map();
  for (const candidate of critical) {
    const key = `${candidate.country || ''}::${criticalTopicKey(candidate)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(candidate);
  }

  let addedToLeads = 0;
  let addedToRoundup = 0;

  for (const group of groups.values()) {
    const urls = new Set(group.map((c) => c.sourceUrl).filter(Boolean));
    let existingItem = [...developments, ...europeRoundup].find((item) => urls.has(item.sourceUrl));

    if (existingItem) {
      const extras = group
        .filter((c) => c.sourceUrl && c.sourceUrl !== existingItem.sourceUrl)
        .map((c) => ({ name: c.sourceName || c.title, url: c.sourceUrl }));
      const existingExtraUrls = new Set((existingItem.additionalSources || []).map((x) => x.url));
      existingItem.additionalSources = [
        ...(existingItem.additionalSources || []),
        ...extras.filter((x) => !existingExtraUrls.has(x.url)),
      ];
      continue;
    }

    const primary = group[0];
    const item = developmentFromCandidate(primary);
    item.additionalSources = group.slice(1).map((c) => ({
      name: c.sourceName || c.title,
      url: c.sourceUrl,
    }));

    if (developments.length < maxLeads) {
      developments.push(item);
      addedToLeads += 1;
    } else {
      europeRoundup.push(item);
      addedToRoundup += 1;
    }
  }

  return {
    article: { ...article, developments, europeRoundup },
    critical,
    addedToLeads,
    addedToRoundup,
  };
}

