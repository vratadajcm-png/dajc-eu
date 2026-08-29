const DEFAULT_MIN_LEADS = 10;
const DEFAULT_MAX_LEADS = 12;

function developmentFromOfficialCandidate(c) {
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
    recommendedAction: c.recommendedAction || '',
    exemptions: c.exemptions || '',
    isDrivingBan: Boolean(c.isDrivingBan || c.type === 'driving_ban'),
    isInfrastructure: Boolean(c.isInfrastructure),
    sourceUrl: c.sourceUrl,
    sourceName: c.sourceName,
  };
}

export function ensureOfficialCalendarLeadFloor(
  article,
  verifiedCandidates,
  { minLeads = DEFAULT_MIN_LEADS, maxLeads = DEFAULT_MAX_LEADS } = {}
) {
  const developments = [...(article.developments || [])];
  let europeRoundup = [...(article.europeRoundup || [])];
  const usedLeadUrls = new Set(developments.map((x) => x.sourceUrl).filter(Boolean));

  const official = verifiedCandidates.filter(
    (c) => c.isOfficialCalendar && c.sourceUrl && !usedLeadUrls.has(c.sourceUrl)
  );

  const roundupUrls = new Set(europeRoundup.map((x) => x.sourceUrl).filter(Boolean));
  const omitted = official.filter((c) => !roundupUrls.has(c.sourceUrl));
  const inRoundup = official.filter((c) => roundupUrls.has(c.sourceUrl));

  let added = 0;
  let promoted = 0;

  for (const candidate of omitted) {
    if (developments.length >= minLeads || developments.length >= maxLeads) break;
    developments.push(developmentFromOfficialCandidate(candidate));
    usedLeadUrls.add(candidate.sourceUrl);
    added += 1;
  }

  for (const candidate of inRoundup) {
    if (developments.length >= minLeads || developments.length >= maxLeads) break;
    if (europeRoundup.length <= 1) break;
    const item = europeRoundup.find((x) => x.sourceUrl === candidate.sourceUrl);
    if (!item) continue;
    europeRoundup = europeRoundup.filter((x) => x.sourceUrl !== candidate.sourceUrl);
    developments.push(item);
    usedLeadUrls.add(candidate.sourceUrl);
    promoted += 1;
  }

  // Remove non-actionable roundup noise before the hard quality gate. This
  // does not lower the gate: it prevents a model-selected weak item from
  // blocking an otherwise valid edition.
  europeRoundup = europeRoundup.filter(
    (item) => item.recommendedAction && item.recommendedAction.trim().length >= 10
  );

  // If that leaves no roundup, use one remaining verified official-calendar
  // restriction that is not already a lead. This preserves the editorial
  // requirement for a real Rest-of-Europe item without inventing filler.
  if (europeRoundup.length === 0) {
    const remainingOfficial = verifiedCandidates.find(
      (candidate) =>
        candidate.isOfficialCalendar &&
        candidate.sourceUrl &&
        !usedLeadUrls.has(candidate.sourceUrl)
    );
    if (remainingOfficial) {
      europeRoundup.push(developmentFromOfficialCandidate(remainingOfficial));
    }
  }

  return {
    article: { ...article, developments, europeRoundup },
    added,
    promoted,
  };
}
