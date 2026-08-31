// Cross-validates generated reports against the verified candidate set.
// Source URL is the immutable identity. Country/source name/extra sources are
// restored from the verified record so the model cannot alter source identity.
export function crossValidateDevelopments(developments = [], verifiedCandidates = []) {
  const byUrl = new Map(
    verifiedCandidates.filter((c) => c?.sourceUrl).map((c) => [c.sourceUrl, c])
  );
  const kept = [];
  for (const item of developments || []) {
    const candidate = byUrl.get(item?.sourceUrl);
    if (!candidate) continue;
    kept.push({
      ...item,
      country: candidate.country || item.country || '',
      sourceName: candidate.sourceName || item.sourceName || '',
      sourceUrl: candidate.sourceUrl,
      additionalSources: candidate.additionalSources || item.additionalSources || [],
    });
  }
  return { kept, droppedCount: (developments || []).length - kept.length };
}
